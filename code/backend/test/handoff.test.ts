import { eq } from '../../db/orm.ts';
import { describe, expect, it } from 'vitest';
import { auditLog, bookings } from '../../db/schema.ts';
import { HttpError } from '../src/http/errors.ts';
import { checkOtpAttempt, createHandoffCodes, MAX_OTP_ATTEMPTS, OTP_LOCK_MS } from '../src/lib/handoff.ts';
import { createBookingFor, createListing, createPartner, createTraveler, makeFakeAppwrite, TEST_SECRET } from './helpers.ts';
import { testDb } from './testDb.ts';

const { db } = testDb();
const codes = createHandoffCodes(TEST_SECRET);
const ID = '8c1f5a54-3a0f-4f53-8c3d-3d7a9b1d2e11';

describe('handoff codes', () => {
  it('derives a stable six-digit code per booking and type', () => {
    const dropOff = codes.otpFor(ID, 'drop_off');
    expect(dropOff).toMatch(/^\d{6}$/);
    expect(codes.otpFor(ID, 'drop_off')).toBe(dropOff);
    expect(codes.otpFor(ID, 'pickup')).not.toBe(dropOff);
    expect(codes.otpFor('another-booking', 'drop_off')).not.toBe(dropOff);
  });

  it('depends on the secret', () => {
    const other = createHandoffCodes(Buffer.alloc(32, 7).toString('base64'));
    expect(other.otpFor(ID, 'pickup')).not.toBe(codes.otpFor(ID, 'pickup'));
  });

  it('formats the QR payload', () => {
    expect(codes.qrPayloadFor('PT-ABC234', ID, 'pickup')).toBe(`POTLI1|PT-ABC234|pickup|${codes.otpFor(ID, 'pickup')}`);
  });

  it('verifies only the exact code', () => {
    const otp = codes.otpFor(ID, 'drop_off');
    expect(codes.verifyOtp(ID, 'drop_off', otp)).toBe(true);
    expect(codes.verifyOtp(ID, 'pickup', otp)).toBe(false);
    expect(codes.verifyOtp(ID, 'drop_off', '000000' === otp ? '000001' : '000000')).toBe(false);
    expect(codes.verifyOtp(ID, 'drop_off', otp.slice(1))).toBe(false);
    expect(codes.verifyOtp(ID, 'drop_off', '')).toBe(false);
  });

  it('shows the check-in code only while booked and the pickup code while held', () => {
    const base = { id: ID, code: 'PT-ABC234' };
    expect(codes.codeFor({ ...base, status: 'booked' })?.type).toBe('drop_off');
    expect(codes.codeFor({ ...base, status: 'dropped' })?.type).toBe('pickup');
    expect(codes.codeFor({ ...base, status: 'stored' })?.type).toBe('pickup');
    for (const status of ['picked_up', 'completed', 'cancelled', 'expired', 'pending_payment'] as const) {
      expect(codes.codeFor({ ...base, status })).toBeNull();
    }
  });
});

describe('OTP attempts and lockout', () => {
  async function fixture() {
    const appwrite = makeFakeAppwrite();
    const partner = await createPartner(appwrite);
    const listing = await createListing(partner.profile.id);
    const traveler = await createTraveler(appwrite);
    const booking = await createBookingFor(traveler.profile.id, listing.id);
    const actor = { id: partner.profile.id, role: 'storage_partner' as const };
    return { booking, actor };
  }
  const attempt = async (bookingId: string, candidate: string, actor: { id: string; role: 'storage_partner' }, now?: Date) => {
    try {
      await checkOtpAttempt(db, codes, { bookingId, type: 'drop_off', candidate, actor, now });
      return 'ok';
    } catch (err) {
      return (err as HttpError).code;
    }
  };

  it('accepts the right code and resets the counter', async () => {
    const { booking, actor } = await fixture();
    expect(await attempt(booking.id, '999999', actor)).toBe('OTP_INVALID');
    expect(await attempt(booking.id, codes.otpFor(booking.id, 'drop_off'), actor)).toBe('ok');
    const [row] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(row?.otpFailedAttempts).toBe(0);
  });

  it('locks for 15 minutes after five wrong codes, audits once, and unlocks later', async () => {
    const { booking, actor } = await fixture();
    const wrong = codes.otpFor(booking.id, 'drop_off') === '123456' ? '654321' : '123456';
    const results: string[] = [];
    for (let i = 0; i < MAX_OTP_ATTEMPTS; i += 1) results.push(await attempt(booking.id, wrong, actor));
    expect(results).toEqual(['OTP_INVALID', 'OTP_INVALID', 'OTP_INVALID', 'OTP_INVALID', 'OTP_LOCKED']);

    // The correct code is refused while locked.
    expect(await attempt(booking.id, codes.otpFor(booking.id, 'drop_off'), actor)).toBe('OTP_LOCKED');
    const entries = await db.select().from(auditLog).where(eq(auditLog.action, 'otp.locked'));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ entityId: booking.id, actorId: actor.id });

    const later = new Date(Date.now() + OTP_LOCK_MS + 1_000);
    expect(await attempt(booking.id, codes.otpFor(booking.id, 'drop_off'), actor, later)).toBe('ok');
  });

  it('counts racing wrong attempts without losing any', async () => {
    const { booking, actor } = await fixture();
    await Promise.all(Array.from({ length: 4 }, () => attempt(booking.id, '111111' === codes.otpFor(booking.id, 'drop_off') ? '222222' : '111111', actor)));
    const [row] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(row?.otpFailedAttempts).toBe(4);
  });

  it('reports an unknown booking as not found', async () => {
    const { actor } = await fixture();
    expect(await attempt('00000000-0000-4000-8000-000000000000', '123456', actor)).toBe('NOT_FOUND');
  });
});
