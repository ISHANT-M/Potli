import { eq } from '../../../db/orm.ts';
import { describe, expect, it } from 'vitest';
import { createBooking } from '../../../db/bookings.ts';
import { auditLog, bookings, partnerProfiles } from '../../../db/schema.ts';
import { createAdmin, createBookingFor, createListing, createPartner, createTraveler, istSlot, makeApp } from '../helpers.ts';

const { db, appwrite, authed } = makeApp();
const ID = '8c1f5a54-3a0f-4f53-8c3d-3d7a9b1d2e11';

const ROUTES: [string, string, object?][] = [
  ['get', '/overview'],
  ['get', '/partners'],
  ['get', `/partners/${ID}`],
  ['post', `/partners/${ID}/approve`, {}],
  ['post', `/partners/${ID}/reject`, { reason: 'Not enough detail' }],
  ['post', `/partners/${ID}/suspend`, { reason: 'Not enough detail' }],
  ['post', `/partners/${ID}/reinstate`, {}],
  ['get', '/bookings'],
  ['get', `/bookings/${ID}`],
];

const call = (as: ReturnType<typeof authed>, [method, path, body]: (typeof ROUTES)[number]) => {
  const req = (as as unknown as Record<string, (p: string) => import('supertest').Test>)[method]?.(`/api/v1/admin${path}`);
  if (!req) throw new Error('bad method');
  return body ? req.send(body) : req;
};

describe('admin guard', () => {
  it('refuses signed-out users, travellers and partners on every route', async () => {
    const traveler = await createTraveler(appwrite);
    const partner = await createPartner(appwrite);
    for (const route of ROUTES) {
      expect((await call(authed(), route)).status, `anon ${route[1]}`).toBe(401);
      expect((await call(authed(traveler.token), route)).status, `traveler ${route[1]}`).toBe(403);
      expect((await call(authed(partner.token), route)).status, `partner ${route[1]}`).toBe(403);
    }
  });

  it('refuses a disabled admin', async () => {
    const admin = await createAdmin(appwrite, { disabled: true });
    expect((await authed(admin.token).get('/api/v1/admin/overview')).status).toBe(403);
  });
});

describe('partner review', () => {
  const auditCount = async (id: string) => (await db.select().from(auditLog).where(eq(auditLog.entityId, id))).length;

  it('approves a pending partner, records the reviewer and writes one audit row', async () => {
    const admin = await createAdmin(appwrite);
    const partner = await createPartner(appwrite, { status: 'pending' });
    const res = await authed(admin.token).post(`/api/v1/admin/partners/${partner.profile.id}/approve`).send({});
    expect(res.status).toBe(200);
    expect(res.body.partner).toMatchObject({ status: 'approved', reviewedBy: { id: admin.profile.id } });
    const [row] = await db.select().from(partnerProfiles).where(eq(partnerProfiles.userId, partner.profile.id));
    expect(row?.reviewedAt).toBeInstanceOf(Date);
    const entries = await db.select().from(auditLog).where(eq(auditLog.entityId, partner.profile.id));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'partner.approve', actorId: admin.profile.id, actorRole: 'admin', metadata: { from: 'pending', to: 'approved' } });
  });

  it('only allows the legal transitions', async () => {
    const admin = await createAdmin(appwrite);
    const as = authed(admin.token);
    const reason = { reason: 'Not a real business address' };
    const illegal: [string, 'pending' | 'approved' | 'rejected' | 'suspended', object][] = [
      ['approve', 'approved', {}],
      ['approve', 'rejected', {}],
      ['approve', 'suspended', {}],
      ['reject', 'approved', reason],
      ['reject', 'rejected', reason],
      ['suspend', 'pending', reason],
      ['suspend', 'rejected', reason],
      ['reinstate', 'pending', {}],
      ['reinstate', 'approved', {}],
    ];
    for (const [action, status, body] of illegal) {
      const partner = await createPartner(appwrite, { status });
      const res = await as.post(`/api/v1/admin/partners/${partner.profile.id}/${action}`).send(body);
      expect([res.status, res.body.error?.code], `${action} from ${status}`).toEqual([409, 'INVALID_TRANSITION']);
      expect(await auditCount(partner.profile.id), `${action} from ${status}`).toBe(0);
    }
  });

  it('requires a reason to reject or suspend, and 404s on unknown partners', async () => {
    const admin = await createAdmin(appwrite);
    const partner = await createPartner(appwrite, { status: 'pending' });
    const res = await authed(admin.token).post(`/api/v1/admin/partners/${partner.profile.id}/reject`).send({ reason: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.fields).toHaveProperty('reason');
    expect((await authed(admin.token).post(`/api/v1/admin/partners/${ID}/approve`).send({})).status).toBe(404);
    const traveler = await createTraveler(appwrite);
    expect((await authed(admin.token).post(`/api/v1/admin/partners/${traveler.profile.id}/approve`).send({})).status).toBe(404);
  });

  it('rejects with a visible reason, then suspension hides the listing and reinstating restores it', async () => {
    const admin = await createAdmin(appwrite);
    const as = authed(admin.token);
    const rejected = await createPartner(appwrite, { status: 'pending' });
    const r = await as.post(`/api/v1/admin/partners/${rejected.profile.id}/reject`).send({ reason: 'Address could not be verified' });
    expect(r.body.partner).toMatchObject({ status: 'rejected', rejectionReason: 'Address could not be verified' });
    const me = await authed(rejected.token).get('/api/v1/partner/me');
    expect(me.body.user.partner).toMatchObject({ status: 'rejected', rejectionReason: 'Address could not be verified' });

    const partner = await createPartner(appwrite);
    const listing = await createListing(partner.profile.id);
    const traveler = await createTraveler(appwrite);
    const slot = istSlot(1, 10, 3);
    const book = () => createBooking(db, { travelerId: traveler.profile.id, listingId: listing.id, bagCount: 1, slotStart: slot.start, slotEnd: slot.end });
    const existing = (await book()).booking;

    const suspended = await as.post(`/api/v1/admin/partners/${partner.profile.id}/suspend`).send({ reason: 'Complaints from travellers' });
    expect(suspended.body.partner.status).toBe('suspended');
    expect(suspended.body.impact).toEqual({ listings: 1, upcomingBookings: 1 });
    await expect(book()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await db.select().from(bookings).where(eq(bookings.id, existing.id)))[0]?.status).toBe('booked');

    expect((await as.post(`/api/v1/admin/partners/${partner.profile.id}/reinstate`).send({})).body.partner.status).toBe('approved');
    expect((await book()).created).toBe(true);
    expect(await auditCount(partner.profile.id)).toBe(2);
  });

  it('lists with filters and search, and shows detail with listings and stats', async () => {
    const admin = await createAdmin(appwrite);
    const as = authed(admin.token);
    const partner = await createPartner(appwrite, { status: 'pending', businessName: 'Zephyr 100%_Store' });
    await createListing(partner.profile.id);
    const list = await as.get('/api/v1/admin/partners?status=pending&q=100%25_');
    expect(list.body.items.map((p: { userId: string }) => p.userId)).toEqual([partner.profile.id]);
    expect(list.body.items[0]).toMatchObject({ businessName: 'Zephyr 100%_Store', listingCount: 1, status: 'pending' });
    expect((await as.get('/api/v1/admin/partners?q=Z%25e')).body.total).toBe(0); // wildcards are escaped
    const detail = await as.get(`/api/v1/admin/partners/${partner.profile.id}`);
    expect(detail.body.partner).toMatchObject({ address: '1 Test Road', reviewedBy: null });
    expect(detail.body.listings).toHaveLength(1);
    expect(detail.body.stats).toMatchObject({ completed: 0, feesDuePaise: 0, ratingAverage: null });
    expect((await as.get('/api/v1/admin/partners?status=bogus')).status).toBe(400);
  });
});

describe('admin bookings', () => {
  it('searches by code or traveller email, filters, and shows detail', async () => {
    const admin = await createAdmin(appwrite);
    const as = authed(admin.token);
    const partner = await createPartner(appwrite, { businessName: 'Locker Hub' });
    const listing = await createListing(partner.profile.id, { city: 'Jaipur' });
    const traveler = await createTraveler(appwrite, { email: 'Finder@Test.Potli' });
    const booking = await createBookingFor(traveler.profile.id, listing.id);
    await createBookingFor((await createTraveler(appwrite)).profile.id, listing.id);

    expect((await as.get(`/api/v1/admin/bookings?q=${booking.code.toLowerCase()}`)).body.items.map((b: { id: string }) => b.id)).toEqual([booking.id]);
    const byEmail = await as.get('/api/v1/admin/bookings?q=finder@test.potli');
    expect(byEmail.body.total).toBe(1);
    expect(byEmail.body.items[0]).toMatchObject({ traveler: { email: 'Finder@Test.Potli' }, partner: { businessName: 'Locker Hub' } });
    expect((await as.get('/api/v1/admin/bookings?city=jaipur&status=booked')).body.total).toBe(2);
    expect((await as.get('/api/v1/admin/bookings?status=completed')).body.total).toBe(0);

    const detail = await as.get(`/api/v1/admin/bookings/${booking.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ booking: { id: booking.id }, handoffs: [], rating: null, disputes: [], audit: [], payment: { method: 'cod', status: 'pending', settled: false } });
    expect((await as.get(`/api/v1/admin/bookings/${ID}`)).status).toBe(404);
  });
});
