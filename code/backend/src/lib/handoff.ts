/** Drop-off and pickup codes: derived OTPs, QR payloads and attempt lockout (02-CONTRACTS section 5). */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq, sql } from '../../../db/orm.ts';
import type { Database } from '../../../db/client.ts';
import { audit } from '../../../db/audit.ts';
import { bookings, type BookingRow, type Role } from '../../../db/schema.ts';
import type { HandoffCode, HandoffType } from '../../../shared/types.ts';
import { HttpError } from '../http/errors.ts';

export const MAX_OTP_ATTEMPTS = 5;
export const OTP_LOCK_MS = 15 * 60_000;

export interface HandoffCodes {
  /** Deterministic 6-digit code for a booking and handoff type; nothing is stored. */
  otpFor(bookingId: string, type: HandoffType): string;
  qrPayloadFor(bookingCode: string, bookingId: string, type: HandoffType): string;
  /** Constant-time comparison of a candidate against the derived code. */
  verifyOtp(bookingId: string, type: HandoffType, candidate: string): boolean;
  /** The code the traveller may see right now, per the visibility rules; null otherwise. */
  codeFor(booking: Pick<BookingRow, 'id' | 'code' | 'status'>): HandoffCode | null;
}

export function createHandoffCodes(secret: string): HandoffCodes {
  const key = Buffer.from(secret, 'base64');

  const otpFor = (bookingId: string, type: HandoffType): string => {
    const digest = createHmac('sha256', key).update(`${bookingId}:${type}`).digest();
    return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, '0');
  };
  const qrPayloadFor = (bookingCode: string, bookingId: string, type: HandoffType): string =>
    `POTLI1|${bookingCode}|${type}|${otpFor(bookingId, type)}`;

  return {
    otpFor,
    qrPayloadFor,
    verifyOtp(bookingId, type, candidate) {
      const expected = Buffer.from(otpFor(bookingId, type));
      const given = Buffer.from(candidate);
      return given.length === expected.length && timingSafeEqual(given, expected);
    },
    codeFor(booking) {
      const type: HandoffType | null =
        booking.status === 'booked' ? 'drop_off' : booking.status === 'dropped' || booking.status === 'stored' ? 'pickup' : null;
      if (!type) return null;
      return { type, otp: otpFor(booking.id, type), qrPayload: qrPayloadFor(booking.code, booking.id, type) };
    },
  };
}

export interface OtpCheckInput {
  bookingId: string;
  type: HandoffType;
  candidate: string;
  actor: { id: string; role: Role };
  ip?: string | null;
  now?: Date;
}

/**
 * Verify a partner-entered code. Five wrong attempts lock the booking for 15 minutes.
 * Resolves on success; otherwise throws 423 OTP_LOCKED or 400 OTP_INVALID.
 */
export async function checkOtpAttempt(db: Database, codes: HandoffCodes, input: OtpCheckInput): Promise<void> {
  const now = input.now ?? new Date();
  const [booking] = await db.select().from(bookings).where(eq(bookings.id, input.bookingId)).limit(1);
  if (!booking) throw new HttpError(404, 'NOT_FOUND', 'Booking not found.');

  if (booking.otpLockedUntil && booking.otpLockedUntil > now) {
    throw new HttpError(423, 'OTP_LOCKED', 'Too many wrong codes. Try again in a few minutes.');
  }

  if (codes.verifyOtp(booking.id, input.type, input.candidate)) {
    if (booking.otpFailedAttempts > 0) {
      await db.update(bookings).set({ otpFailedAttempts: 0 }).where(eq(bookings.id, booking.id));
    }
    return;
  }

  // One conditional UPDATE keeps the counter correct when attempts race.
  const lockUntil = new Date(now.getTime() + OTP_LOCK_MS).toISOString();
  const [updated] = await db
    .update(bookings)
    .set({
      otpFailedAttempts: sql`case when ${bookings.otpFailedAttempts} + 1 >= ${MAX_OTP_ATTEMPTS} then 0 else ${bookings.otpFailedAttempts} + 1 end`,
      otpLockedUntil: sql`case when ${bookings.otpFailedAttempts} + 1 >= ${MAX_OTP_ATTEMPTS} then ${lockUntil}::timestamptz else ${bookings.otpLockedUntil} end`,
    })
    .where(eq(bookings.id, booking.id))
    .returning({ lockedUntil: bookings.otpLockedUntil });

  if (updated?.lockedUntil && updated.lockedUntil > now) {
    await audit(db, {
      actorId: input.actor.id,
      actorRole: input.actor.role,
      action: 'otp.locked',
      entity: 'booking',
      entityId: booking.id,
      metadata: { type: input.type },
      ip: input.ip ?? null,
    });
    throw new HttpError(423, 'OTP_LOCKED', 'Too many wrong codes. Try again in a few minutes.');
  }
  throw new HttpError(400, 'OTP_INVALID', 'That code is not correct.');
}
