import { eq } from '../../db/orm.ts';
import { describe, expect, it } from 'vitest';
import { audit } from '../../db/audit.ts';
import { availableBags, createBooking, expireOverdueBookings, generateBookingCode, transitionBooking } from '../../db/bookings.ts';
import { DomainError } from '../../db/errors.ts';
import { auditLog, bookings, payments } from '../../db/schema.ts';
import { BOOKING_CODE_PATTERN } from '../../shared/validation.ts';
import { createBookingFor, createListing, createPartner, createTraveler, istSlot, makeFakeAppwrite, setBookingStatus } from './helpers.ts';
import { testDb } from './testDb.ts';

const { db } = testDb();

async function world(capacity = 5) {
  const appwrite = makeFakeAppwrite();
  const partner = await createPartner(appwrite);
  const listing = await createListing(partner.profile.id, { capacity });
  const traveler = await createTraveler(appwrite);
  return { appwrite, partner, listing, traveler };
}

describe('createBooking', () => {
  it('creates a booked COD booking with a payment row and a valid code', async () => {
    const { listing, traveler } = await world();
    const slot = istSlot(1, 10, 3);
    const { booking, created } = await createBooking(db, {
      travelerId: traveler.profile.id,
      listingId: listing.id,
      bagCount: 2,
      slotStart: slot.start,
      slotEnd: slot.end,
    });
    expect(created).toBe(true);
    expect(booking.status).toBe('booked');
    expect(booking.code).toMatch(BOOKING_CODE_PATTERN);
    expect(booking.quotedPaise).toBe(2 * 3 * 5000);
    expect(booking.bookedAt).toBeInstanceOf(Date);
    const [payment] = await db.select().from(payments).where(eq(payments.bookingId, booking.id));
    expect(payment).toMatchObject({ method: 'cod', status: 'pending', amountPaise: booking.quotedPaise });
  });

  it('never exceeds capacity under 20 concurrent requests', async () => {
    const { listing, traveler } = await world(5);
    const slot = istSlot(2, 10, 2);
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        createBooking(db, { travelerId: traveler.profile.id, listingId: listing.id, bagCount: 1, slotStart: slot.start, slotEnd: slot.end }),
      ),
    );
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(fulfilled).toHaveLength(5);
    expect(rejected).toHaveLength(15);
    for (const failure of rejected) {
      expect(failure.reason).toBeInstanceOf(DomainError);
      expect((failure.reason as DomainError).code).toBe('CAPACITY_UNAVAILABLE');
    }
    expect(await availableBags(db, listing.id, slot.start, slot.end)).toBe(0);
  });

  it('only counts bookings that overlap the window', async () => {
    const { listing, traveler } = await world(2);
    const morning = istSlot(3, 9, 2);
    const evening = istSlot(3, 15, 2);
    await createBookingFor(traveler.profile.id, listing.id, { bagCount: 2, slotStart: morning.start, slotEnd: morning.end });
    expect(await availableBags(db, listing.id, evening.start, evening.end)).toBe(2);
    expect(await availableBags(db, listing.id, morning.start, morning.end)).toBe(0);
    // Back-to-back slots do not overlap: the window is half-open.
    const adjacent = istSlot(3, 11, 2);
    await expect(
      createBooking(db, { travelerId: traveler.profile.id, listingId: listing.id, bagCount: 2, slotStart: adjacent.start, slotEnd: adjacent.end }),
    ).resolves.toMatchObject({ created: true });
  });

  it('frees capacity when a booking is cancelled', async () => {
    const { listing, traveler } = await world(1);
    const slot = istSlot(2, 10, 2);
    const first = await createBookingFor(traveler.profile.id, listing.id, { slotStart: slot.start, slotEnd: slot.end });
    await expect(createBooking(db, { travelerId: traveler.profile.id, listingId: listing.id, bagCount: 1, slotStart: slot.start, slotEnd: slot.end })).rejects.toMatchObject({ code: 'CAPACITY_UNAVAILABLE' });
    await transitionBooking(db, { bookingId: first.id, from: ['booked'], to: 'cancelled', actorId: traveler.profile.id, patch: { cancelReason: 'Plans changed' } });
    await expect(createBooking(db, { travelerId: traveler.profile.id, listingId: listing.id, bagCount: 1, slotStart: slot.start, slotEnd: slot.end })).resolves.toMatchObject({ created: true });
  });

  it('keeps overstaying bags counted until they leave', async () => {
    const { listing, traveler } = await world(1);
    const past = new Date(Date.now() - 3 * 86_400_000);
    const slot = istSlot(-2, 10, 2);
    const held = await createBookingFor(traveler.profile.id, listing.id, { slotStart: slot.start, slotEnd: slot.end, now: past });
    await setBookingStatus(held.id, 'stored');
    // The slot ended days ago, but the bags are still on the shelf right now.
    const aroundNow = [new Date(Date.now() - 3_600_000), new Date(Date.now() + 3_600_000)] as const;
    expect(await availableBags(db, listing.id, aroundNow[0], aroundNow[1])).toBe(0);
    const longAgo = istSlot(-2, 10, 2);
    expect(await availableBags(db, listing.id, new Date(longAgo.start.getTime() - 86_400_000), new Date(longAgo.start.getTime() - 3_600_000))).toBe(1);
  });

  it('returns the original booking for a repeated idempotency key, even in parallel', async () => {
    const { listing, traveler } = await world(10);
    const slot = istSlot(2, 12, 2);
    const input = { travelerId: traveler.profile.id, listingId: listing.id, bagCount: 1, slotStart: slot.start, slotEnd: slot.end, idempotencyKey: 'key-123' };
    const results = await Promise.all([createBooking(db, input), createBooking(db, input), createBooking(db, input)]);
    expect(new Set(results.map((result) => result.booking.id)).size).toBe(1);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    const rows = await db.select().from(bookings).where(eq(bookings.listingId, listing.id));
    expect(rows).toHaveLength(1);
  });

  it('rejects unavailable listings as not found', async () => {
    const appwrite = makeFakeAppwrite();
    const traveler = await createTraveler(appwrite);
    const slot = istSlot();
    const pending = await createPartner(appwrite, { status: 'pending' });
    const suspended = await createPartner(appwrite, { status: 'suspended' });
    const disabled = await createPartner(appwrite, { disabled: true });
    const paused = await createPartner(appwrite);
    const listings = [
      await createListing(pending.profile.id),
      await createListing(suspended.profile.id),
      await createListing(disabled.profile.id),
      await createListing(paused.profile.id, { status: 'paused' }),
      await createListing(paused.profile.id, { status: 'flagged' }),
    ];
    for (const listing of listings) {
      await expect(createBooking(db, { travelerId: traveler.profile.id, listingId: listing.id, bagCount: 1, slotStart: slot.start, slotEnd: slot.end })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
  });

  it('enforces slot rules', async () => {
    const { listing, traveler } = await world();
    const base = { travelerId: traveler.profile.id, listingId: listing.id, bagCount: 1 };
    const ok = istSlot(1, 10, 2);
    const reject = (overrides: object) => createBooking(db, { ...base, slotStart: ok.start, slotEnd: ok.end, ...overrides });

    await expect(reject({ slotEnd: ok.start })).rejects.toMatchObject({ code: 'SLOT_INVALID' });
    await expect(reject({ bagCount: 11 })).rejects.toMatchObject({ code: 'SLOT_INVALID' });
    await expect(reject({ bagCount: 0 })).rejects.toMatchObject({ code: 'SLOT_INVALID' });
    const past = istSlot(-1, 10, 2);
    await expect(reject({ slotStart: past.start, slotEnd: past.end })).rejects.toMatchObject({ code: 'SLOT_INVALID' });
    const far = istSlot(40, 10, 2);
    await expect(reject({ slotStart: far.start, slotEnd: far.end })).rejects.toMatchObject({ code: 'SLOT_INVALID' });
    const tooLong = istSlot(1, 10, 24 * 8);
    await expect(reject({ slotStart: tooLong.start, slotEnd: tooLong.end })).rejects.toMatchObject({ code: 'SLOT_INVALID' });
    const late = istSlot(1, 23, 1);
    await expect(reject({ slotStart: late.start, slotEnd: late.end })).rejects.toMatchObject({ code: 'OUTSIDE_OPENING_HOURS' });
  });
});

describe('transitionBooking', () => {
  it('lets exactly one of several racing requests win', async () => {
    const { listing, traveler } = await world();
    const booking = await createBookingFor(traveler.profile.id, listing.id);
    const attempts = await Promise.allSettled(
      Array.from({ length: 6 }, () => transitionBooking(db, { bookingId: booking.id, from: ['booked'], to: 'cancelled', actorId: traveler.profile.id })),
    );
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    for (const attempt of attempts) {
      if (attempt.status === 'rejected') expect(attempt.reason).toMatchObject({ code: 'INVALID_TRANSITION' });
    }
  });

  it('stamps the timestamp, actor and patch', async () => {
    const { listing, traveler } = await world();
    const booking = await createBookingFor(traveler.profile.id, listing.id);
    const cancelled = await transitionBooking(db, { bookingId: booking.id, from: ['booked'], to: 'cancelled', actorId: traveler.profile.id, patch: { cancelReason: 'Missed my train' } });
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.cancelledAt).toBeInstanceOf(Date);
    expect(cancelled.cancelledBy).toBe(traveler.profile.id);
    expect(cancelled.cancelReason).toBe('Missed my train');
  });

  it('reports 409 for a wrong current status and 404 for unknown or hidden bookings', async () => {
    const { listing, traveler } = await world();
    const other = await createTraveler(makeFakeAppwrite());
    const booking = await createBookingFor(traveler.profile.id, listing.id);
    await expect(transitionBooking(db, { bookingId: booking.id, from: ['stored'], to: 'picked_up', actorId: null })).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    await expect(transitionBooking(db, { bookingId: '00000000-0000-4000-8000-000000000000', from: ['booked'], to: 'dropped', actorId: null })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      transitionBooking(db, { bookingId: booking.id, from: ['booked'], to: 'cancelled', actorId: other.profile.id, visibleWhere: eq(bookings.travelerId, other.profile.id) }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [unchanged] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(unchanged?.status).toBe('booked');
  });

  it('refuses transitions the state machine forbids', async () => {
    await expect(transitionBooking(db, { bookingId: 'x', from: ['completed'], to: 'cancelled', actorId: null })).rejects.toThrow(/not allowed/);
  });
});

describe('expireOverdueBookings', () => {
  it('expires only booked bookings whose slot has ended, and audits each', async () => {
    const { listing, traveler } = await world(10);
    const past = new Date(Date.now() - 4 * 86_400_000);
    const old = istSlot(-3, 10, 2);
    const overdue = await createBookingFor(traveler.profile.id, listing.id, { slotStart: old.start, slotEnd: old.end, now: past });
    const heldBags = await createBookingFor(traveler.profile.id, listing.id, { slotStart: old.start, slotEnd: old.end, now: past });
    await setBookingStatus(heldBags.id, 'dropped');
    const upcoming = await createBookingFor(traveler.profile.id, listing.id);

    expect(await expireOverdueBookings(db)).toBe(1);
    expect(await expireOverdueBookings(db)).toBe(0);

    const status = async (id: string) => (await db.select().from(bookings).where(eq(bookings.id, id)))[0]?.status;
    expect(await status(overdue.id)).toBe('expired');
    expect(await status(heldBags.id)).toBe('dropped');
    expect(await status(upcoming.id)).toBe('booked');
    const entries = await db.select().from(auditLog).where(eq(auditLog.action, 'booking.expire'));
    expect(entries.map((entry) => entry.entityId)).toEqual([overdue.id]);
  });
});

describe('helpers', () => {
  it('generates well-formed, varied booking codes', () => {
    const codes = new Set(Array.from({ length: 200 }, generateBookingCode));
    expect(codes.size).toBeGreaterThan(190);
    for (const code of codes) expect(code).toMatch(BOOKING_CODE_PATTERN);
  });

  it('audit() appends an entry', async () => {
    await audit(db, { actorId: null, actorRole: null, action: 'test.event', entity: 'thing', entityId: '1', metadata: { a: 1 }, ip: '127.0.0.1' });
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, 'test.event'));
    expect(entry).toMatchObject({ entity: 'thing', entityId: '1', metadata: { a: 1 }, ip: '127.0.0.1' });
  });
});
