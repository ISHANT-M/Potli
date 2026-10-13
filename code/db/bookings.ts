/** Booking domain: capacity-safe creation, atomic status transitions, availability and expiry. */
import { randomInt } from 'node:crypto';
import { and, eq, inArray, lt, sql, type SQL } from 'drizzle-orm';
import type { Database } from './client.ts';
import { audit } from './audit.ts';
import { DomainError, isUniqueViolation } from './errors.ts';
import {
  bookings,
  listings,
  partnerProfiles,
  payments,
  profiles,
  type BookingRow,
  type ListingRow,
} from './schema.ts';
import { canTransition, CAPACITY_STATUSES } from '../shared/bookingStatus.ts';
import { isWithinOpeningHours, MAX_ADVANCE_DAYS, MAX_BAGS, MAX_DAYS, quote } from '../shared/pricing.ts';
import { BOOKING_CODE_ALPHABET } from '../shared/validation.ts';
import type { BookingStatus } from '../shared/types.ts';

const DAY_MS = 86_400_000;
const CLOCK_SKEW_MS = 5 * 60_000;
const CODE_ATTEMPTS = 5;

export function generateBookingCode(): string {
  let suffix = '';
  for (let i = 0; i < 6; i += 1) suffix += BOOKING_CODE_ALPHABET[randomInt(BOOKING_CODE_ALPHABET.length)];
  return `PT-${suffix}`;
}

/** Bags that overlap [start, end) and still occupy shelf space; overstaying bags count until now. */
async function usedBags(db: Database, listingId: string, start: Date, end: Date): Promise<number> {
  const [row] = await db
    .select({ used: sql<number>`coalesce(sum(${bookings.bagCount}), 0)::int` })
    .from(bookings)
    .where(
      and(
        eq(bookings.listingId, listingId),
        inArray(bookings.status, [...CAPACITY_STATUSES]),
        lt(bookings.slotStart, end),
        sql`(case when ${bookings.status} in ('dropped', 'stored') then greatest(${bookings.slotEnd}, now()) else ${bookings.slotEnd} end) > ${start.toISOString()}::timestamptz`,
      ),
    );
  return row?.used ?? 0;
}

/** Free bags for a window, without locking; used by search and quotes. */
export async function availableBags(db: Database, listingId: string, start: Date, end: Date): Promise<number> {
  const [listing] = await db
    .select({ capacity: listings.capacity })
    .from(listings)
    .where(eq(listings.id, listingId))
    .limit(1);
  if (!listing) return 0;
  return Math.max(0, listing.capacity - (await usedBags(db, listingId, start, end)));
}

export interface CreateBookingInput {
  travelerId: string;
  listingId: string;
  bagCount: number;
  slotStart: Date;
  slotEnd: Date;
  searchStartedAt?: Date | null;
  idempotencyKey?: string | null;
  /** Injected by tests; defaults to the current time. */
  now?: Date;
}

export interface CreateBookingResult {
  booking: BookingRow;
  /** False when an earlier request with the same idempotency key already created it. */
  created: boolean;
}

function assertSlot(input: CreateBookingInput, listing: ListingRow, now: Date): void {
  const { slotStart, slotEnd, bagCount } = input;
  if (!Number.isInteger(bagCount) || bagCount < 1 || bagCount > MAX_BAGS) {
    throw new DomainError('SLOT_INVALID', `Bags must be between 1 and ${MAX_BAGS}.`);
  }
  if (!(slotEnd > slotStart)) throw new DomainError('SLOT_INVALID', 'The end time must be after the start time.');
  if (slotStart.getTime() < now.getTime() - CLOCK_SKEW_MS) {
    throw new DomainError('SLOT_INVALID', 'The start time is in the past.');
  }
  if (slotStart.getTime() > now.getTime() + MAX_ADVANCE_DAYS * DAY_MS) {
    throw new DomainError('SLOT_INVALID', `Bookings open ${MAX_ADVANCE_DAYS} days ahead at most.`);
  }
  if (slotEnd.getTime() - slotStart.getTime() > MAX_DAYS * DAY_MS) {
    throw new DomainError('SLOT_INVALID', `Storage is limited to ${MAX_DAYS} days per booking.`);
  }
  const hours = { openTime: listing.openTime, closeTime: listing.closeTime, openDays: listing.openDays };
  if (!isWithinOpeningHours(slotStart, hours) || !isWithinOpeningHours(slotEnd, hours)) {
    throw new DomainError('OUTSIDE_OPENING_HOURS', 'Drop-off and pickup must fall within opening hours.');
  }
}

async function findByIdempotencyKey(db: Database, travelerId: string, key: string): Promise<BookingRow | null> {
  const [row] = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.travelerId, travelerId), eq(bookings.idempotencyKey, key)))
    .limit(1);
  return row ?? null;
}

/**
 * Create a COD booking inside one transaction. The listing row is locked first, so
 * concurrent bookings for the same listing are serialized and capacity cannot be exceeded.
 */
export async function createBooking(db: Database, input: CreateBookingInput): Promise<CreateBookingResult> {
  const now = input.now ?? new Date();
  const key = input.idempotencyKey ?? null;

  return db.transaction(async (tx) => {
    if (key) {
      const earlier = await findByIdempotencyKey(tx, input.travelerId, key);
      if (earlier) return { booking: earlier, created: false };
    }

    const [listing] = await tx.select().from(listings).where(eq(listings.id, input.listingId)).for('update');
    if (!listing) throw new DomainError('NOT_FOUND', 'Listing not found.');

    // A concurrent request with the same key may have committed while we waited for the lock.
    if (key) {
      const earlier = await findByIdempotencyKey(tx, input.travelerId, key);
      if (earlier) return { booking: earlier, created: false };
    }

    const [partner] = await tx
      .select({ status: partnerProfiles.status, isDisabled: profiles.isDisabled })
      .from(partnerProfiles)
      .innerJoin(profiles, eq(profiles.id, partnerProfiles.userId))
      .where(eq(partnerProfiles.userId, listing.partnerId))
      .limit(1);
    if (listing.status !== 'active' || !partner || partner.status !== 'approved' || partner.isDisabled) {
      throw new DomainError('NOT_FOUND', 'Listing not found.');
    }

    assertSlot(input, listing, now);

    const used = await usedBags(tx, listing.id, input.slotStart, input.slotEnd);
    if (used + input.bagCount > listing.capacity) {
      throw new DomainError('CAPACITY_UNAVAILABLE', 'Not enough space is free for those bags in that window.');
    }

    const price = quote(listing, input.bagCount, input.slotStart, input.slotEnd);

    let booking: BookingRow | undefined;
    for (let attempt = 0; attempt < CODE_ATTEMPTS && !booking; attempt += 1) {
      try {
        // A savepoint keeps a code collision from aborting the whole transaction.
        booking = await tx.transaction(async (savepoint) => {
          const [row] = await savepoint
            .insert(bookings)
            .values({
              code: generateBookingCode(),
              travelerId: input.travelerId,
              listingId: listing.id,
              bagCount: input.bagCount,
              slotStart: input.slotStart,
              slotEnd: input.slotEnd,
              status: 'booked',
              quotedPaise: price.totalPaise,
              paymentMethod: 'cod',
              searchStartedAt: input.searchStartedAt ?? null,
              bookedAt: now,
              idempotencyKey: key,
            })
            .returning();
          return row;
        });
      } catch (err) {
        if (!isUniqueViolation(err, 'bookings_code_unique')) throw err;
      }
    }
    if (!booking) throw new Error('could not allocate a unique booking code');

    await tx.insert(payments).values({
      bookingId: booking.id,
      method: 'cod',
      status: 'pending',
      amountPaise: price.totalPaise,
    });

    return { booking, created: true };
  });
}

const TIMESTAMP_FOR: Partial<Record<BookingStatus, keyof BookingRow>> = {
  booked: 'bookedAt',
  dropped: 'droppedAt',
  stored: 'storedAt',
  picked_up: 'pickedUpAt',
  completed: 'completedAt',
  cancelled: 'cancelledAt',
};

export type BookingPatch = Partial<
  Pick<BookingRow, 'finalPaise' | 'cancelReason' | 'otpFailedAttempts' | 'otpLockedUntil'>
>;

export interface TransitionInput {
  bookingId: string;
  /** Statuses the booking may currently be in. */
  from: BookingStatus[];
  to: BookingStatus;
  actorId: string | null;
  patch?: BookingPatch;
  /** Extra visibility rule (for example the traveller owns it); a miss reads as NOT_FOUND. */
  visibleWhere?: SQL;
}

/**
 * Move a booking between statuses with one conditional UPDATE, so exactly one of any
 * set of racing requests wins. Never write `status` outside this function.
 */
export async function transitionBooking(db: Database, input: TransitionInput): Promise<BookingRow> {
  for (const from of input.from) {
    if (!canTransition(from, input.to)) {
      throw new Error(`transition ${from} -> ${input.to} is not allowed by the state machine`);
    }
  }

  const now = new Date();
  const stamp = TIMESTAMP_FOR[input.to];
  const set: Partial<typeof bookings.$inferInsert> = {
    ...input.patch,
    status: input.to,
    updatedAt: now,
    ...(stamp ? { [stamp]: now } : {}),
    ...(input.to === 'cancelled' ? { cancelledBy: input.actorId } : {}),
  };

  const [updated] = await db
    .update(bookings)
    .set(set)
    .where(
      and(
        eq(bookings.id, input.bookingId),
        inArray(bookings.status, input.from),
        ...(input.visibleWhere ? [input.visibleWhere] : []),
      ),
    )
    .returning();
  if (updated) return updated;

  const [existing] = await db
    .select({ status: bookings.status })
    .from(bookings)
    .where(and(eq(bookings.id, input.bookingId), ...(input.visibleWhere ? [input.visibleWhere] : [])))
    .limit(1);
  if (!existing) throw new DomainError('NOT_FOUND', 'Booking not found.');
  throw new DomainError('INVALID_TRANSITION', `This booking is ${existing.status.replace('_', ' ')} and cannot change that way.`);
}

/** Expire bookings that were never dropped off before their slot ended; returns how many. */
export async function expireOverdueBookings(db: Database, now: Date = new Date()): Promise<number> {
  const expired = await db
    .update(bookings)
    .set({ status: 'expired', updatedAt: now })
    .where(and(eq(bookings.status, 'booked'), lt(bookings.slotEnd, now)))
    .returning({ id: bookings.id });

  for (const { id } of expired) {
    await audit(db, { actorId: null, actorRole: null, action: 'booking.expire', entity: 'booking', entityId: id });
  }
  return expired.length;
}
