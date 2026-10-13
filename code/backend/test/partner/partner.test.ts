import { eq } from '../../../db/orm.ts';
import { describe, expect, it } from 'vitest';
import { auditLog, bookings, handoffRecords, listings, partnerProfiles, payments, profiles } from '../../../db/schema.ts';
import { computeFee, quote } from '../../../shared/pricing.ts';
import { createBookingFor, createListing, createPartner, createTraveler, makeApp } from '../helpers.ts';

const ctx = makeApp();
const { db, appwrite, deps, authed } = ctx;
const HOUR = 3_600_000;
const jpeg = (size = 64) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size)]);
const listingBody = {
  name: 'Corner Shop',
  address: '12 Mall Road',
  city: 'Patiala',
  latitude: 30.33,
  longitude: 76.39,
  capacity: 10,
  hourlyRatePaise: 5000,
  dailyCapPaise: 40000,
  openTime: '08:00',
  closeTime: '20:00',
  openDays: [0, 1, 2, 3, 4, 5, 6],
};

/** A partner with a listing and a traveller booking whose slot is "now" (so check-in is open). */
async function counter(options: { status?: 'booked' | 'dropped' | 'stored'; startOffsetH?: number; endOffsetH?: number; hourly?: number; bags?: number; partnerStatus?: 'approved' | 'suspended' } = {}) {
  const partner = await createPartner(appwrite);
  const traveler = await createTraveler(appwrite);
  const hourly = options.hourly ?? 5000;
  const listing = await createListing(partner.profile.id, { hourlyRatePaise: hourly, dailyCapPaise: hourly * 8 });
  const booking = await createBookingFor(traveler.profile.id, listing.id, { bagCount: options.bags ?? 2 });
  const now = Date.now();
  const status = options.status ?? 'booked';
  const slotStart = new Date(now + (options.startOffsetH ?? -1) * HOUR);
  const slotEnd = new Date(now + (options.endOffsetH ?? 3) * HOUR);
  const quotedPaise = quote(listing, booking.bagCount, slotStart, slotEnd).totalPaise;
  await db.update(payments).set({ amountPaise: quotedPaise }).where(eq(payments.bookingId, booking.id));
  if (options.partnerStatus) await db.update(partnerProfiles).set({ status: options.partnerStatus }).where(eq(partnerProfiles.userId, partner.profile.id));
  const [row] = await db
    .update(bookings)
    .set({ slotStart, slotEnd, status, quotedPaise })
    .where(eq(bookings.id, booking.id))
    .returning();
  const as = authed(partner.token);
  const otp = (type: 'drop_off' | 'pickup') => deps.handoff.otpFor(booking.id, type);
  return { partner, traveler, listing, booking: row ?? booking, as, otp };
}

describe('POST /partners/apply', () => {
  const body = { businessName: 'Chai Point', businessType: 'cafe', phone: '+919876543210', address: '5 Lake View Road', city: 'Udaipur' };

  it('converts a traveller without bookings and sets the Appwrite label', async () => {
    const user = await createTraveler(appwrite);
    const res = await authed(user.token).post('/api/v1/partners/apply').send(body);
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ role: 'storage_partner', partner: { status: 'pending', businessName: 'Chai Point' } });
    expect(appwrite.calls.setLabels.at(-1)).toEqual({ userId: user.account.$id, labels: ['storagePartner'] });
    const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.profile.id));
    expect(profile?.role).toBe('storage_partner');
    const audits = await db.select().from(auditLog).where(eq(auditLog.entityId, user.profile.id));
    expect(audits.map((a) => a.action)).toEqual(['partner.apply']);
  });

  it('rejects travellers with bookings, unverified emails and existing partners', async () => {
    const owner = await createPartner(appwrite);
    const traveler = await createTraveler(appwrite);
    await createBookingFor(traveler.profile.id, (await createListing(owner.profile.id)).id);
    expect((await authed(traveler.token).post('/api/v1/partners/apply').send(body)).body.error.code).toBe('ALREADY_APPLIED');

    const unverified = await createTraveler(appwrite, { verified: false });
    expect((await authed(unverified.token).post('/api/v1/partners/apply').send(body)).body.error.code).toBe('EMAIL_NOT_VERIFIED');

    const pending = await createPartner(appwrite, { status: 'pending' });
    const again = await authed(pending.token).post('/api/v1/partners/apply').send(body);
    expect([again.status, again.body.error.code]).toEqual([409, 'ALREADY_APPLIED']);
    expect((await authed().post('/api/v1/partners/apply').send(body)).status).toBe(401);
  });

  it('validates the business fields', async () => {
    const user = await createTraveler(appwrite);
    const res = await authed(user.token).post('/api/v1/partners/apply').send({ ...body, businessType: 'bank', phone: '123' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields)).toEqual(expect.arrayContaining(['businessType', 'phone']));
  });
});

describe('/partner/me', () => {
  it('is for partners only', async () => {
    const traveler = await createTraveler(appwrite);
    expect((await authed(traveler.token).get('/api/v1/partner/me')).status).toBe(403);
  });

  it('resubmits a rejected application and clears the reason', async () => {
    const partner = await createPartner(appwrite, { status: 'rejected' });
    await db.update(partnerProfiles).set({ rejectionReason: 'Photos unclear' }).where(eq(partnerProfiles.userId, partner.profile.id));
    const res = await authed(partner.token).patch('/api/v1/partner/me').send({ businessName: 'Better Name' });
    expect(res.status).toBe(200);
    expect(res.body.user.partner).toMatchObject({ status: 'pending', rejectionReason: null, businessName: 'Better Name' });
    const actions = (await db.select().from(auditLog).where(eq(auditLog.entityId, partner.profile.id))).map((a) => a.action);
    expect(actions).toContain('partner.resubmit');
  });

  it('lets approved partners edit only phone and address', async () => {
    const partner = await createPartner(appwrite);
    const as = authed(partner.token);
    const blocked = await as.patch('/api/v1/partner/me').send({ businessName: 'Renamed' });
    expect([blocked.status, blocked.body.error.code]).toEqual([403, 'FORBIDDEN']);
    const ok = await as.patch('/api/v1/partner/me').send({ phone: '+919123456780', address: '9 New Street' });
    expect(ok.body.user.partner).toMatchObject({ status: 'approved', phone: '+919123456780', address: '9 New Street' });
  });
});

describe('partner listings', () => {
  it('only approved partners can create listings', async () => {
    for (const status of ['pending', 'rejected', 'suspended'] as const) {
      const partner = await createPartner(appwrite, { status });
      const res = await authed(partner.token).post('/api/v1/partner/listings').send(listingBody);
      expect([res.status, res.body.error.code]).toEqual([403, 'PARTNER_NOT_APPROVED']);
    }
  });

  it('creates, lists and edits an own listing', async () => {
    const partner = await createPartner(appwrite);
    const as = authed(partner.token);
    const created = await as.post('/api/v1/partner/listings').send(listingBody);
    expect(created.status).toBe(201);
    expect(created.body.listing).toMatchObject({ name: 'Corner Shop', status: 'active', openTime: '08:00', businessName: 'Test Storage' });
    const id = created.body.listing.id as string;
    expect((await as.get('/api/v1/partner/listings')).body.items).toHaveLength(1);
    const patched = await as.patch(`/api/v1/partner/listings/${id}`).send({ status: 'paused', capacity: 5 });
    expect(patched.body.listing).toMatchObject({ status: 'paused', capacity: 5 });
  });

  it('enforces the validation matrix', async () => {
    const partner = await createPartner(appwrite);
    const as = authed(partner.token);
    const cases: [Record<string, unknown>, string][] = [
      [{ latitude: 51.5 }, 'latitude'],
      [{ longitude: 10 }, 'longitude'],
      [{ capacity: 201 }, 'capacity'],
      [{ capacity: 0 }, 'capacity'],
      [{ hourlyRatePaise: 500 }, 'hourlyRatePaise'],
      [{ dailyCapPaise: 4000 }, 'dailyCapPaise'],
      [{ dailyCapPaise: 5000 * 24 + 1 }, 'dailyCapPaise'],
      [{ closeTime: '08:00' }, 'closeTime'],
      [{ closeTime: '07:00' }, 'closeTime'],
      [{ openTime: '25:00' }, 'openTime'],
      [{ openDays: [1, 1] }, 'openDays'],
      [{ openDays: [7] }, 'openDays.0'],
      [{ status: 'flagged' }, 'status'],
    ];
    for (const [override, field] of cases) {
      const res = await as.post('/api/v1/partner/listings').send({ ...listingBody, ...override });
      expect(res.status, JSON.stringify(override)).toBe(400);
      expect(res.body.error.fields, JSON.stringify(override)).toHaveProperty(field);
    }
    expect(await db.select().from(listings).where(eq(listings.partnerId, partner.profile.id))).toHaveLength(0);
  });

  it("returns 404 for another partner's listing and blocks unsafe capacity cuts", async () => {
    const owner = await createPartner(appwrite);
    const other = await createPartner(appwrite);
    const listing = await createListing(owner.profile.id, { capacity: 10 });
    expect((await authed(other.token).get(`/api/v1/partner/listings/${listing.id}`)).status).toBe(404);
    expect((await authed(other.token).patch(`/api/v1/partner/listings/${listing.id}`).send({ name: 'Mine now' })).status).toBe(404);

    const traveler = await createTraveler(appwrite);
    await createBookingFor(traveler.profile.id, listing.id, { bagCount: 6 });
    const cut = await authed(owner.token).patch(`/api/v1/partner/listings/${listing.id}`).send({ capacity: 5 });
    expect(cut.status).toBe(409);
    expect(cut.body.error.message).toContain('6');
    expect((await authed(owner.token).patch(`/api/v1/partner/listings/${listing.id}`).send({ capacity: 6 })).status).toBe(200);
  });

  it('keeps flagged listings flagged', async () => {
    const partner = await createPartner(appwrite);
    const listing = await createListing(partner.profile.id, { status: 'flagged', flagReason: 'Misleading photos' });
    const res = await authed(partner.token).patch(`/api/v1/partner/listings/${listing.id}`).send({ status: 'active' });
    expect(res.status).toBe(409);
  });
});

describe('partner bookings and lookup', () => {
  it('lists only own bookings, hides traveller email, and 404s on others', async () => {
    const mine = await counter();
    const theirs = await counter();
    const list = await mine.as.get('/api/v1/partner/bookings');
    expect(list.body.items.map((b: { id: string }) => b.id)).toEqual([mine.booking.id]);
    expect(list.body.items[0].traveler).toEqual({ fullName: mine.traveler.profile.fullName, phone: '' });
    expect(JSON.stringify(list.body)).not.toContain(mine.traveler.profile.email);
    expect((await mine.as.get(`/api/v1/partner/bookings/${theirs.booking.id}`)).status).toBe(404);
    expect((await mine.as.get(`/api/v1/partner/bookings/${mine.booking.id}`)).body.handoffs).toEqual([]);
    expect((await mine.as.get(`/api/v1/partner/bookings?status=completed`)).body.total).toBe(0);
  });

  it('looks codes up case-insensitively and never reveals other partners bookings', async () => {
    const mine = await counter();
    const theirs = await counter({ status: 'stored' });
    const found = await mine.as.post('/api/v1/partner/handoffs/lookup').send({ code: ` ${mine.booking.code.toLowerCase()} ` });
    expect(found.status).toBe(200);
    expect(found.body.expected).toBe('drop_off');
    expect(JSON.stringify(found.body)).not.toMatch(/otp|qrPayload/i);
    const other = await mine.as.post('/api/v1/partner/handoffs/lookup').send({ code: theirs.booking.code });
    expect(other.status).toBe(404);
    expect((await theirs.as.post('/api/v1/partner/handoffs/lookup').send({ code: theirs.booking.code })).body.expected).toBe('pickup');
  });
});

describe('check-in', () => {
  it('is only open from 30 minutes before the slot until it ends', async () => {
    const early = await counter({ startOffsetH: 1, endOffsetH: 4 });
    const res = await early.as.post(`/api/v1/partner/bookings/${early.booking.id}/check-in`).send({ otp: early.otp('drop_off'), method: 'otp' });
    expect([res.status, res.body.error.code]).toEqual([400, 'SLOT_INVALID']);
    const soon = await counter({ startOffsetH: 0.25, endOffsetH: 3 });
    expect((await soon.as.post(`/api/v1/partner/bookings/${soon.booking.id}/check-in`).send({ otp: soon.otp('drop_off'), method: 'qr' })).status).toBe(200);
    const late = await counter({ startOffsetH: -4, endOffsetH: -1 });
    expect((await late.as.post(`/api/v1/partner/bookings/${late.booking.id}/check-in`).send({ otp: late.otp('drop_off'), method: 'otp' })).status).toBe(400);
  });

  it('counts wrong codes, locks after 5 and resets on success', async () => {
    const c = await counter();
    const url = `/api/v1/partner/bookings/${c.booking.id}/check-in`;
    const wrong = c.otp('drop_off') === '000000' ? '111111' : '000000';
    for (let i = 0; i < 2; i += 1) expect((await c.as.post(url).send({ otp: wrong, method: 'otp' })).body.error.code).toBe('OTP_INVALID');
    expect((await c.as.post(url).send({ otp: c.otp('drop_off'), method: 'otp' })).status).toBe(200);
    expect((await db.select().from(bookings).where(eq(bookings.id, c.booking.id)))[0]?.otpFailedAttempts).toBe(0);

    const locked = await counter();
    const lockedUrl = `/api/v1/partner/bookings/${locked.booking.id}/check-in`;
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) statuses.push((await locked.as.post(lockedUrl).send({ otp: wrong, method: 'otp' })).status);
    expect(statuses).toEqual([400, 400, 400, 400, 423]);
    const after = await locked.as.post(lockedUrl).send({ otp: locked.otp('drop_off'), method: 'otp' });
    expect([after.status, after.body.error.code]).toEqual([423, 'OTP_LOCKED']);
    const actions = (await db.select().from(auditLog).where(eq(auditLog.entityId, locked.booking.id))).map((a) => a.action);
    expect(actions).toContain('otp.locked');
  });

  it('is scoped to the owning partner', async () => {
    const c = await counter();
    const intruder = await createPartner(appwrite);
    const res = await authed(intruder.token).post(`/api/v1/partner/bookings/${c.booking.id}/check-in`).send({ otp: c.otp('drop_off'), method: 'otp' });
    expect(res.status).toBe(404);
  });
});

describe('drop-off', () => {
  const send = (c: Awaited<ReturnType<typeof counter>>, files: { buf: Buffer; name?: string }[], fields: Record<string, string> = { bagCount: '2' }) => {
    let req = c.as.post(`/api/v1/partner/bookings/${c.booking.id}/drop-off`);
    for (const [key, value] of Object.entries(fields)) req = req.field(key, value);
    for (const file of files) req = req.attach('photos', file.buf, { filename: file.name ?? 'bag.jpg', contentType: 'image/jpeg' });
    return req;
  };

  it('enforces photo rules, stores the bags and is safe to retry', async () => {
    const c = await counter({ status: 'dropped' });
    expect((await send(c, [])).status).toBe(400);
    expect((await send(c, Array.from({ length: 5 }, () => ({ buf: jpeg() })))).status).toBe(400);
    expect((await send(c, [{ buf: Buffer.from('not an image at all'), name: 'x.jpg' }])).status).toBe(415);
    expect((await send(c, [{ buf: jpeg(6 * 1024 * 1024) }])).status).toBe(413);
    expect((await send(c, [{ buf: jpeg() }], { bagCount: '3' })).body.error.fields).toHaveProperty('note');

    const ok = await send(c, [{ buf: jpeg() }, { buf: jpeg() }]);
    expect(ok.status).toBe(200);
    expect(ok.body.booking.status).toBe('stored');
    expect(ok.body.booking.dropOffPhotoUrls).toHaveLength(2);
    const retry = await send(c, [{ buf: jpeg() }]);
    expect([retry.status, retry.body.booking.status]).toEqual([200, 'stored']);
    expect(await db.select().from(handoffRecords).where(eq(handoffRecords.bookingId, c.booking.id))).toHaveLength(1);
  });

  it('accepts a different bag count with a note', async () => {
    const c = await counter({ status: 'dropped' });
    const res = await send(c, [{ buf: jpeg() }], { bagCount: '3', note: 'One extra backpack' });
    expect(res.status).toBe(200);
    const [record] = await db.select().from(handoffRecords).where(eq(handoffRecords.bookingId, c.booking.id));
    expect(record).toMatchObject({ bagCount: 3, note: 'One extra backpack', type: 'drop_off' });
  });

  it('needs a checked-in booking', async () => {
    const c = await counter({ status: 'booked' });
    expect((await send(c, [{ buf: jpeg() }])).status).toBe(409);
  });
});

describe('pickup', () => {
  const pickup = (c: Awaited<ReturnType<typeof counter>>, cash: number, otp = c.otp('pickup')) =>
    c.as.post(`/api/v1/partner/bookings/${c.booking.id}/pickup`).send({ otp, method: 'otp', cashCollectedPaise: cash });

  it('completes with the quoted price, 15% fee and a captured payment', async () => {
    const c = await counter({ status: 'stored', hourly: 1001, bags: 1, startOffsetH: -0.5, endOffsetH: 2.5 });
    const final = c.booking.quotedPaise;
    expect(final).toBe(3 * 1001);
    const res = await pickup(c, final);
    expect(res.status).toBe(200);
    expect(res.body.booking).toMatchObject({ status: 'completed', finalPaise: final, feePaise: computeFee(final), partnerSharePaise: final - computeFee(final), paymentStatus: 'captured' });
    expect(computeFee(final)).toBe(450);
    const [payment] = await db.select().from(payments).where(eq(payments.bookingId, c.booking.id));
    expect(payment).toMatchObject({ status: 'captured', amountPaise: final, platformFeePaise: 450, partnerSharePaise: final - 450, collectedBy: c.partner.profile.id, settlementId: null });
    const kinds = (await db.select().from(handoffRecords).where(eq(handoffRecords.bookingId, c.booking.id))).map((h) => h.type);
    expect(kinds).toEqual(['pickup']);
  });

  it('rejects a wrong amount and charges overstay', async () => {
    const c = await counter({ status: 'stored', hourly: 5000, bags: 2, startOffsetH: -4.5, endOffsetH: -2 });
    const quoted = c.booking.quotedPaise;
    expect(quoted).toBe(2 * 3 * 5000);
    const bad = await pickup(c, quoted);
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields.cashCollectedPaise).toContain('50');
    const overstay = (await c.as.get(`/api/v1/partner/bookings/${c.booking.id}`)).body.booking;
    expect(overstay).toMatchObject({ isOverdue: true, overstayPaise: 2 * 2 * 5000 });
    const ok = await pickup(c, quoted + overstay.overstayPaise);
    expect(ok.status).toBe(200);
    expect(ok.body.booking.finalPaise).toBe(2 * 5 * 5000);
  });

  it('checks the pickup code, not the drop-off code', async () => {
    const c = await counter({ status: 'stored' });
    const res = await pickup(c, c.booking.quotedPaise, c.otp('drop_off'));
    expect(res.body.error.code).toBe('OTP_INVALID');
    expect((await db.select().from(bookings).where(eq(bookings.id, c.booking.id)))[0]?.status).toBe('stored');
  });

  it('completes exactly once when submitted twice at the same time', async () => {
    const c = await counter({ status: 'stored', startOffsetH: -0.5, endOffsetH: 2.5 });
    const results = await Promise.all([pickup(c, c.booking.quotedPaise), pickup(c, c.booking.quotedPaise)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await db.select().from(handoffRecords).where(eq(handoffRecords.bookingId, c.booking.id))).toHaveLength(1);
    const pickups = (await db.select().from(auditLog).where(eq(auditLog.entityId, c.booking.id))).filter((a) => a.action === 'handoff.pickup');
    expect(pickups).toHaveLength(1);
  });

  it('lets a suspended partner finish existing handoffs', async () => {
    const c = await counter({ status: 'stored', partnerStatus: 'suspended', startOffsetH: -0.5, endOffsetH: 2.5 });
    expect((await pickup(c, c.booking.quotedPaise)).status).toBe(200);
    const pending = await createPartner(appwrite, { status: 'pending' });
    expect((await authed(pending.token).post('/api/v1/partner/handoffs/lookup').send({ code: 'PT-AAAAAA' })).status).toBe(403);
  });
});
