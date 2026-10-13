import { randomUUID } from 'node:crypto';
import { eq } from '../../../db/orm.ts';
import { describe, expect, it } from 'vitest';
import { auditLog, bookings, listings, partnerProfiles, profiles } from '../../../db/schema.ts';
import { createBookingFor, createListing, createPartner, createTraveler, istSlot, makeApp, setBookingStatus } from '../helpers.ts';
import { testDb } from '../testDb.ts';

const { db } = testDb();

async function world(capacity = 10) {
  const ctx = makeApp();
  const partner = await createPartner(ctx.appwrite, { businessName: 'Secret Biz' });
  const listing = await createListing(partner.profile.id, { capacity, name: 'Station Locker', area: 'Rail Colony' });
  const traveler = await createTraveler(ctx.appwrite, { fullName: 'Asha Rao' });
  return { ...ctx, partner, listing, traveler };
}

const book = (listingId: string, slot = istSlot(1, 10, 4), extra: Record<string, unknown> = {}) => ({
  listingId,
  bags: 1,
  slotStart: slot.start.toISOString(),
  slotEnd: slot.end.toISOString(),
  paymentMethod: 'cod',
  ...extra,
});

describe('GET /listings', () => {
  it('returns visible listings without partner PII', async () => {
    const w = await world();
    const res = await w.anon().get('/api/v1/listings?q=station');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(w.partner.profile.email);
    expect(text).not.toContain('+919876543210');
    expect(text).not.toContain(w.partner.profile.id);
    expect(res.body.items[0]).toMatchObject({ id: w.listing.id, ratingCount: 0, distanceKm: null, available: null });
  });

  it('hides pending, suspended, disabled, paused and flagged listings', async () => {
    const w = await world();
    const hidden = new Set<string>();
    const pending = await createPartner(w.appwrite, { status: 'pending' });
    const suspended = await createPartner(w.appwrite, { status: 'approved' });
    await db.update(partnerProfiles).set({ status: 'suspended' }).where(eq(partnerProfiles.userId, suspended.profile.id));
    const disabled = await createPartner(w.appwrite, { disabled: true });
    for (const p of [pending, suspended, disabled]) hidden.add((await createListing(p.profile.id, { name: 'Hidden Zzz' })).id);
    hidden.add((await createListing(w.partner.profile.id, { name: 'Hidden Zzz', status: 'paused' })).id);
    hidden.add((await createListing(w.partner.profile.id, { name: 'Hidden Zzz', status: 'flagged' })).id);
    const res = await w.anon().get('/api/v1/listings?q=Hidden%20Zzz');
    expect(res.body.items).toHaveLength(0);
    expect(res.body.total).toBe(0);
    for (const id of hidden) expect((await w.anon().get(`/api/v1/listings/${id}`)).status).toBe(404);
  });

  it('escapes LIKE wildcards', async () => {
    const w = await world();
    await createListing(w.partner.profile.id, { name: '100% Safe_Box' });
    expect((await w.anon().get('/api/v1/listings?q=%25')).body.items.map((i: { name: string }) => i.name)).toEqual(['100% Safe_Box']);
    expect((await w.anon().get('/api/v1/listings?q=_')).body.items.map((i: { name: string }) => i.name)).toEqual(['100% Safe_Box']);
    expect((await w.anon().get('/api/v1/listings?q=Sta_ion')).body.items).toHaveLength(0);
  });

  it('computes availability for a window, hides closed listings, and sorts by distance', async () => {
    const w = await world(3);
    const slot = istSlot(1, 10, 4);
    await createBookingFor(w.traveler.profile.id, w.listing.id, { bagCount: 2, slotStart: slot.start, slotEnd: slot.end });
    const night = await createListing(w.partner.profile.id, { name: 'Night Only', openTime: '20:00', closeTime: '23:00' });
    const near = await createListing(w.partner.profile.id, { name: 'Far Away', latitude: 13.2, longitude: 77.8 });
    await db.update(listings).set({ latitude: 12.9, longitude: 77.6 }).where(eq(listings.id, w.listing.id));
    const q = `start=${encodeURIComponent(slot.start.toISOString())}&end=${encodeURIComponent(slot.end.toISOString())}&bags=1`;
    const res = await w.anon().get(`/api/v1/listings?${q}&lat=12.9&lng=77.6&radiusKm=50`);
    expect(res.status).toBe(200);
    const byId = new Map<string, { available: number; distanceKm: number }>(res.body.items.map((i: { id: string; available: number; distanceKm: number }) => [i.id, i]));
    expect(byId.has(night.id)).toBe(false);
    expect(byId.get(w.listing.id)?.available).toBe(1);
    expect(res.body.items[0].id).toBe(w.listing.id);
    expect(byId.get(near.id)?.distanceKm).toBeGreaterThan(20);
    // outside the radius
    const tight = await w.anon().get('/api/v1/listings?lat=12.9&lng=77.6&radiusKm=5');
    expect(tight.body.items.map((i: { id: string }) => i.id)).not.toContain(near.id);
  });

  it('rejects malformed queries', async () => {
    const { anon } = makeApp();
    expect((await anon().get('/api/v1/listings?lat=30')).status).toBe(400);
    expect((await anon().get('/api/v1/listings?bags=2')).status).toBe(400);
    expect((await anon().get('/api/v1/listings?radiusKm=999&lat=1&lng=1')).status).toBe(400);
    expect((await anon().get('/api/v1/listings?nope=1')).status).toBe(400);
  });
});

describe('GET /listings/:id and /quote', () => {
  it('returns detail and 404s for unknown ids', async () => {
    const w = await world();
    const ok = await w.anon().get(`/api/v1/listings/${w.listing.id}`);
    expect(ok.status).toBe(200);
    expect(ok.body.listing).toMatchObject({ id: w.listing.id, capacity: 10 });
    expect(ok.body.recentRatings).toEqual([]);
    expect((await w.anon().get(`/api/v1/listings/${randomUUID()}`)).status).toBe(404);
    expect((await w.anon().get('/api/v1/listings/nope')).status).toBe(400);
  });

  it('quotes with reason codes', async () => {
    const w = await world(2);
    const slot = istSlot(1, 10, 3);
    const url = (s: Date, e: Date, bags: number) =>
      `/api/v1/listings/${w.listing.id}/quote?start=${encodeURIComponent(s.toISOString())}&end=${encodeURIComponent(e.toISOString())}&bags=${bags}`;
    const ok = await w.anon().get(url(slot.start, slot.end, 2));
    expect(ok.body).toMatchObject({ available: true, remaining: 2, quotedPaise: 2 * 3 * 5000, hours: 3 });
    expect((await w.anon().get(url(slot.start, slot.end, 3))).body.reason).toBe('CAPACITY_UNAVAILABLE');
    await createBookingFor(w.traveler.profile.id, w.listing.id, { bagCount: 2, slotStart: slot.start, slotEnd: slot.end });
    const full = await w.anon().get(url(slot.start, slot.end, 1));
    expect(full.body).toMatchObject({ available: false, remaining: 0, reason: 'CAPACITY_UNAVAILABLE' });
    const closed = istSlot(1, 3, 2);
    expect((await w.anon().get(url(closed.start, closed.end, 1))).body.reason).toBe('OUTSIDE_OPENING_HOURS');
    expect((await w.anon().get(url(slot.end, slot.start, 1))).body.reason).toBe('SLOT_INVALID');
    expect((await w.anon().get(`/api/v1/listings/${randomUUID()}/quote?start=${slot.start.toISOString()}&end=${slot.end.toISOString()}&bags=1`)).status).toBe(404);
    expect((await w.anon().get(`/api/v1/listings/${w.listing.id}/quote`)).status).toBe(400);
  });
});

describe('POST /bookings', () => {
  it('creates a COD booking with a handoff code and audit entry', async () => {
    const w = await world();
    const res = await w.authed(w.traveler.token).post('/api/v1/bookings').set('Idempotency-Key', randomUUID()).send(book(w.listing.id, undefined, { searchStartedAt: new Date(Date.now() - 60_000).toISOString() }));
    expect(res.status).toBe(201);
    expect(res.body.booking).toMatchObject({ status: 'booked', paymentMethod: 'cod', canCancel: true, bagCount: 1 });
    expect(res.body.booking.handoffCode).toMatchObject({ type: 'drop_off' });
    expect(res.body.booking.handoffCode.otp).toMatch(/^\d{6}$/);
    const [row] = await db.select().from(bookings).where(eq(bookings.id, res.body.booking.id));
    expect(row?.searchStartedAt).toBeInstanceOf(Date);
    const trail = await db.select().from(auditLog).where(eq(auditLog.entityId, res.body.booking.id));
    expect(trail.map((a) => a.action)).toContain('booking.create');
  });

  it('ignores a searchStartedAt in the future or older than a day', async () => {
    const w = await world();
    for (const when of [Date.now() + 3_600_000, Date.now() - 2 * 86_400_000]) {
      const res = await w.authed(w.traveler.token).post('/api/v1/bookings').set('Idempotency-Key', randomUUID()).send(book(w.listing.id, istSlot(2 + (when > Date.now() ? 0 : 1)), { searchStartedAt: new Date(when).toISOString() }));
      expect(res.status).toBe(201);
      const [row] = await db.select().from(bookings).where(eq(bookings.id, res.body.booking.id));
      expect(row?.searchStartedAt).toBeNull();
    }
  });

  it('is idempotent per key', async () => {
    const w = await world();
    const key = randomUUID();
    const first = await w.authed(w.traveler.token).post('/api/v1/bookings').set('Idempotency-Key', key).send(book(w.listing.id));
    const second = await w.authed(w.traveler.token).post('/api/v1/bookings').set('Idempotency-Key', key).send(book(w.listing.id));
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.booking.id).toBe(first.body.booking.id);
    expect(await db.select().from(bookings).where(eq(bookings.listingId, w.listing.id))).toHaveLength(1);
  });

  it('rejects upi and card with 422', async () => {
    const w = await world();
    for (const paymentMethod of ['upi', 'card']) {
      const res = await w.authed(w.traveler.token).post('/api/v1/bookings').set('Idempotency-Key', randomUUID()).send(book(w.listing.id, undefined, { paymentMethod }));
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('PAYMENT_METHOD_UNAVAILABLE');
    }
  });

  it('validates input (400) and slot rules', async () => {
    const w = await world();
    const post = (body: unknown, key: string | null = randomUUID()) => {
      const req = w.authed(w.traveler.token).post('/api/v1/bookings');
      return (key ? req.set('Idempotency-Key', key) : req).send(body as object);
    };
    expect((await post({})).status).toBe(400);
    expect((await post(book(w.listing.id), null)).status).toBe(400);
    expect((await post(book(w.listing.id), 'not-a-uuid')).status).toBe(400);
    expect((await post(book(w.listing.id, undefined, { bags: 11 }))).body.error.fields.bags).toBeTruthy();
    expect((await post(book(w.listing.id, undefined, { extra: 1 }))).status).toBe(400);
    const closed = await post(book(w.listing.id, istSlot(1, 3, 2)));
    expect(closed.status).toBe(400);
    expect(closed.body.error.code).toBe('OUTSIDE_OPENING_HOURS');
    const past = await post(book(w.listing.id, istSlot(-1, 10, 2)));
    expect(past.body.error.code).toBe('SLOT_INVALID');
    expect((await post(book(randomUUID()))).status).toBe(404);
  });

  it('enforces auth, role and verified email', async () => {
    const w = await world();
    const key = randomUUID();
    expect((await w.anon().post('/api/v1/bookings').set('Idempotency-Key', key).send(book(w.listing.id))).status).toBe(401);
    expect((await w.authed(w.partner.token).post('/api/v1/bookings').set('Idempotency-Key', key).send(book(w.listing.id))).status).toBe(403);
    const unverified = await createTraveler(w.appwrite, { verified: false });
    const res = await w.authed(unverified.token).post('/api/v1/bookings').set('Idempotency-Key', key).send(book(w.listing.id));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('returns 409 when full and never exceeds capacity under 20 parallel creates', async () => {
    const w = await world(5);
    const slot = istSlot(3, 10, 2);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => w.authed(w.traveler.token).post('/api/v1/bookings').set('Idempotency-Key', randomUUID()).send(book(w.listing.id, slot))),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(5);
    const rejected = results.filter((r) => r.status !== 201);
    expect(rejected).toHaveLength(15);
    for (const r of rejected) {
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('CAPACITY_UNAVAILABLE');
    }
  });
});

describe('GET /bookings and /bookings/:id', () => {
  it('lists own bookings by scope, without codes', async () => {
    const w = await world();
    const mine = await createBookingFor(w.traveler.profile.id, w.listing.id);
    const old = await createBookingFor(w.traveler.profile.id, w.listing.id, { slotStart: istSlot(4).start, slotEnd: istSlot(4).end });
    await setBookingStatus(old.id, 'completed');
    const other = await createTraveler(w.appwrite);
    await createBookingFor(other.profile.id, w.listing.id, { slotStart: istSlot(5).start, slotEnd: istSlot(5).end });

    const all = await w.authed(w.traveler.token).get('/api/v1/bookings');
    expect(all.body.total).toBe(2);
    expect(all.body.items.every((b: { handoffCode: unknown }) => b.handoffCode === null)).toBe(true);
    const up = await w.authed(w.traveler.token).get('/api/v1/bookings?scope=upcoming');
    expect(up.body.items.map((b: { id: string }) => b.id)).toEqual([mine.id]);
    const past = await w.authed(w.traveler.token).get('/api/v1/bookings?scope=past');
    expect(past.body.items.map((b: { id: string }) => b.id)).toEqual([old.id]);
    expect((await w.authed(w.traveler.token).get('/api/v1/bookings?scope=bad')).status).toBe(400);
    expect((await w.anon().get('/api/v1/bookings')).status).toBe(401);
    expect((await w.authed(w.partner.token).get('/api/v1/bookings')).status).toBe(403);
  });

  it('shows the handoff code and partner phone by status, and 404s for another traveller', async () => {
    const w = await world();
    const b = await createBookingFor(w.traveler.profile.id, w.listing.id);
    const get = async (token = w.traveler.token) => w.authed(token).get(`/api/v1/bookings/${b.id}`);

    let res = await get();
    expect(res.body.booking.handoffCode.type).toBe('drop_off');
    expect(res.body.booking.handoffCode.qrPayload).toBe(w.deps.handoff.qrPayloadFor(b.code, b.id, 'drop_off'));
    expect(res.body.booking.listing.phone).toBe('+919876543210');
    for (const status of ['dropped', 'stored'] as const) {
      await setBookingStatus(b.id, status);
      res = await get();
      expect(res.body.booking.handoffCode.type).toBe('pickup');
      expect(res.body.booking.handoffCode.otp).toBe(w.deps.handoff.otpFor(b.id, 'pickup'));
      expect(res.body.booking.canCancel).toBe(false);
    }
    for (const status of ['picked_up', 'completed', 'cancelled', 'expired'] as const) {
      await setBookingStatus(b.id, status);
      expect((await get()).body.booking.handoffCode).toBeNull();
    }
    await setBookingStatus(b.id, 'cancelled');
    expect((await get()).body.booking.listing.phone).toBeUndefined();

    const other = await createTraveler(w.appwrite);
    expect((await get(other.token)).status).toBe(404);
    expect((await w.anon().get(`/api/v1/bookings/${b.id}`)).status).toBe(401);
    expect((await get(w.partner.token)).status).toBe(403);
    expect((await w.authed(w.traveler.token).get('/api/v1/bookings/xyz')).status).toBe(400);
  });
});

describe('POST /bookings/:id/cancel', () => {
  it('cancels a booked booking once, with audit', async () => {
    const w = await world();
    const b = await createBookingFor(w.traveler.profile.id, w.listing.id);
    const res = await w.authed(w.traveler.token).post(`/api/v1/bookings/${b.id}/cancel`).send({ reason: 'Plans changed' });
    expect(res.status).toBe(200);
    expect(res.body.booking).toMatchObject({ status: 'cancelled', cancelReason: 'Plans changed', canCancel: false, handoffCode: null });
    const [row] = await db.select().from(bookings).where(eq(bookings.id, b.id));
    expect(row?.cancelledBy).toBe(w.traveler.profile.id);
    const trail = await db.select().from(auditLog).where(eq(auditLog.entityId, b.id));
    expect(trail.map((a) => a.action)).toContain('booking.cancel');
    const again = await w.authed(w.traveler.token).post(`/api/v1/bookings/${b.id}/cancel`).send({});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('guards access and validates', async () => {
    const w = await world();
    const b = await createBookingFor(w.traveler.profile.id, w.listing.id);
    const url = `/api/v1/bookings/${b.id}/cancel`;
    const other = await createTraveler(w.appwrite);
    expect((await w.authed(other.token).post(url).send({})).status).toBe(404);
    expect((await w.anon().post(url).send({})).status).toBe(401);
    expect((await w.authed(w.partner.token).post(url).send({})).status).toBe(403);
    expect((await w.authed(w.traveler.token).post(url).send({ reason: 'x'.repeat(301) })).status).toBe(400);
    const [row] = await db.select().from(bookings).where(eq(bookings.id, b.id));
    expect(row?.status).toBe('booked');
    await setBookingStatus(b.id, 'dropped');
    expect((await w.authed(w.traveler.token).post(url).send({})).status).toBe(409);
  });
});

// Keep unused-import linting honest.
void listings;
void profiles;

describe('POST /bookings/:id/rating and /disputes', () => {
  async function setup(status: Parameters<typeof setBookingStatus>[1]) {
    const w = await world();
    const b = await createBookingFor(w.traveler.profile.id, w.listing.id);
    await setBookingStatus(b.id, status);
    return { w, b, post: (path: string, body: object, token = w.traveler.token) => w.authed(token).post(`/api/v1/bookings/${b.id}/${path}`).send(body) };
  }

  it('rates a completed booking once', async () => {
    const { w, b, post } = await setup('completed');
    expect((await post('rating', { score: 0 })).status).toBe(400);
    const ok = await post('rating', { score: 5, comment: 'Great' });
    expect(ok.status).toBe(201);
    expect(ok.body.rating).toMatchObject({ score: 5, comment: 'Great' });
    const again = await post('rating', { score: 4 });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_RATED');
    const got = await w.authed(w.traveler.token).get(`/api/v1/bookings/${b.id}`);
    expect(got.body.booking).toMatchObject({ canRate: false, rating: { score: 5 } });
  });

  it('rejects rating a non-completed or foreign booking', async () => {
    const { w, post } = await setup('stored');
    expect((await post('rating', { score: 5 })).status).toBe(409);
    const other = await createTraveler(w.appwrite);
    expect((await post('rating', { score: 5 }, other.token)).status).toBe(404);
  });

  it('opens one dispute per booking and rejects bad states', async () => {
    const { w, post } = await setup('stored');
    expect((await post('disputes', { reason: 'short' })).status).toBe(400);
    const ok = await post('disputes', { reason: 'My bag was damaged in storage.' });
    expect(ok.status).toBe(201);
    expect(ok.body.dispute).toMatchObject({ status: 'open' });
    const dup = await post('disputes', { reason: 'My bag was damaged in storage.' });
    expect(dup.status).toBe(409);
    const other = await createTraveler(w.appwrite);
    expect((await post('disputes', { reason: 'Not my booking at all.' }, other.token)).status).toBe(404);
    const fresh = await setup('booked');
    expect((await fresh.post('disputes', { reason: 'Nothing has happened yet.' })).status).toBe(409);
  });
});
