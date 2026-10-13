import { eq } from '../../../db/orm.ts';
import { describe, expect, it } from 'vitest';
import { auditLog, disputes, feeSettlements, payments, profiles } from '../../../db/schema.ts';
import { createAdmin, createBookingFor, createListing, createPartner, createTraveler, makeApp, setBookingStatus } from '../helpers.ts';

const { db, appwrite, authed } = makeApp();
const ID = '8c1f5a54-3a0f-4f53-8c3d-3d7a9b1d2e11';
const REASON = 'A sufficiently long reason';

async function world(status: 'booked' | 'stored' | 'completed' = 'booked') {
  const partner = await createPartner(appwrite);
  const listing = await createListing(partner.profile.id);
  const traveler = await createTraveler(appwrite);
  const booking = await createBookingFor(traveler.profile.id, listing.id);
  if (status !== 'booked') await setBookingStatus(booking.id, status);
  return { partner, listing, traveler, booking };
}
async function capture(bookingId: string, fee: number) {
  await db.update(payments).set({ status: 'captured', amountPaise: fee * 5, platformFeePaise: fee, partnerSharePaise: fee * 4, collectedAt: new Date() }).where(eq(payments.bookingId, bookingId));
}
const auditRows = async (action: string) => (await db.select().from(auditLog).where(eq(auditLog.action, action))).length;

describe('role guards', () => {
  const ROUTES: [string, string, object?][] = [
    ['get', '/ledger'], ['get', '/ledger/settlements'], ['post', '/ledger/settlements', {}], ['get', '/users'], ['post', `/users/${ID}/disable`, { reason: REASON }],
    ['post', `/users/${ID}/enable`, {}], ['get', '/listings'], ['post', `/listings/${ID}/flag`, { reason: REASON }], ['post', `/listings/${ID}/unflag`, {}],
    ['get', '/disputes'], ['post', `/disputes/${ID}/resolve`, { outcome: 'resolved', resolution: REASON }], ['get', '/audit'], ['get', '/counts'], ['post', `/bookings/${ID}/cancel`, { reason: REASON }],
  ];
  it('keeps new admin routes away from anonymous, traveller and partner callers', async () => {
    const t = await createTraveler(appwrite);
    const p = await createPartner(appwrite);
    for (const [method, path, body] of ROUTES) {
      for (const [who, code] of [[undefined, 401], [t.token, 403], [p.token, 403]] as const) {
        const req = (authed(who) as unknown as Record<string, (u: string) => import('supertest').Test>)[method]!(`/api/v1/admin${path}`);
        expect((await (body ? req.send(body) : req)).status, `${who ? 'role' : 'anon'} ${path}`).toBe(code);
      }
    }
  });
  it('keeps partner routes away from travellers', async () => {
    const t = await createTraveler(appwrite);
    for (const path of ['/stats', '/earnings', '/settlements']) expect((await authed(t.token).get(`/api/v1/partner${path}`)).status).toBe(403);
  });
});

describe('partner ops', () => {
  it('cancels a booked booking with a reason and one audit row; 404 for another partner', async () => {
    const w = await world();
    const other = await createPartner(appwrite);
    expect((await authed(other.token).post(`/api/v1/partner/bookings/${w.booking.id}/cancel`).send({ reason: REASON })).status).toBe(404);
    expect((await authed(w.partner.token).post(`/api/v1/partner/bookings/${w.booking.id}/cancel`).send({ reason: 'short' })).status).toBe(400);
    expect((await authed(w.partner.token).post(`/api/v1/partner/bookings/${w.booking.id}/cancel`).send({ reason: REASON })).status).toBe(200);
    const rows = await db.select().from(auditLog).where(eq(auditLog.entityId, w.booking.id));
    expect(rows.filter((r) => r.action === 'booking.cancel')).toHaveLength(1);
    expect((await authed(w.partner.token).post(`/api/v1/partner/bookings/${w.booking.id}/cancel`).send({ reason: REASON })).status).toBe(409);
  });

  it('raises a dispute only after handover, once, and only on own bookings', async () => {
    const w = await world();
    const url = `/api/v1/partner/bookings/${w.booking.id}/disputes`;
    expect((await authed(w.partner.token).post(url).send({ reason: REASON })).status).toBe(409);
    await setBookingStatus(w.booking.id, 'stored');
    const other = await createPartner(appwrite);
    expect((await authed(other.token).post(url).send({ reason: REASON })).status).toBe(404);
    expect((await authed(w.partner.token).post(url).send({ reason: REASON })).status).toBe(201);
    expect((await authed(w.partner.token).post(url).send({ reason: REASON })).status).toBe(409);
  });

  it('reports earnings and settlements from captured payments of own bookings only', async () => {
    const w = await world();
    await capture(w.booking.id, 100);
    const stranger = await world();
    await capture(stranger.booking.id, 999);
    const res = await authed(w.partner.token).get('/api/v1/partner/earnings');
    expect(res.body.summary).toMatchObject({ grossPaise: 500, feePaise: 100, sharePaise: 400, feesDuePaise: 100, feesSettledPaise: 0 });
    expect(res.body.items).toHaveLength(1);
    const stats = await authed(w.partner.token).get('/api/v1/partner/stats');
    expect(stats.body).toMatchObject({ feesDuePaise: 100, earnings30dPaise: 400 });
    expect((await authed(w.partner.token).get('/api/v1/partner/settlements')).body.items).toEqual([]);
  });

  it('replaces the cover photo and refuses a flagged listing', async () => {
    const w = await world();
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(32)]);
    const res = await authed(w.partner.token).post(`/api/v1/partner/listings/${w.listing.id}/cover`).attach('photo', png, 'a.png');
    expect(res.status).toBe(200);
    expect(res.body.listing.coverUrl).toMatch(/\/files\//);
    const other = await createPartner(appwrite);
    expect((await authed(other.token).post(`/api/v1/partner/listings/${w.listing.id}/cover`).attach('photo', png, 'a.png')).status).toBe(404);
    const admin = await createAdmin(appwrite);
    await authed(admin.token).post(`/api/v1/admin/listings/${w.listing.id}/flag`).send({ reason: REASON });
    expect((await authed(w.partner.token).post(`/api/v1/partner/listings/${w.listing.id}/cover`).attach('photo', png, 'a.png')).status).toBe(409);
  });
});

describe('ledger', () => {
  it('settles all unsettled dues, ignores settled ones, rejects mismatches and double settlement', async () => {
    const w = await world();
    const second = await createBookingFor(w.traveler.profile.id, w.listing.id, { slotStart: new Date(Date.now() + 5 * 86_400_000), slotEnd: new Date(Date.now() + 5 * 86_400_000 + 3_600_000) });
    await capture(w.booking.id, 300);
    await capture(second.id, 200);
    const admin = await createAdmin(appwrite);
    const ledger = await authed(admin.token).get('/api/v1/admin/ledger');
    expect(ledger.body.items.find((i: { partnerId: string }) => i.partnerId === w.partner.profile.id)).toMatchObject({ feesDuePaise: 500, completedCount: 2 });
    const post = (amount: number) => authed(admin.token).post('/api/v1/admin/ledger/settlements').send({ partnerId: w.partner.profile.id, reference: 'UPI-123', expectedAmountPaise: amount });
    expect((await post(499)).status).toBe(409);
    expect(await auditRows('ledger.settle')).toBe(0);
    const [a, b] = await Promise.all([post(500), post(500)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const ok = a.status === 201 ? a : b;
    expect(ok.body.settlement).toMatchObject({ amountPaise: 500, paymentCount: 2, reference: 'UPI-123' });
    expect(await auditRows('ledger.settle')).toBe(1);
    expect(await db.select().from(feeSettlements).where(eq(feeSettlements.partnerId, w.partner.profile.id))).toHaveLength(1);
    const earnings = await authed(w.partner.token).get('/api/v1/partner/earnings');
    expect(earnings.body.summary).toMatchObject({ feesDuePaise: 0, feesSettledPaise: 500 });
    expect((await authed(w.partner.token).get('/api/v1/partner/settlements')).body.items).toHaveLength(1);
    const history = await authed(admin.token).get(`/api/v1/admin/ledger/settlements?partnerId=${w.partner.profile.id}`);
    expect(history.body.items[0].recordedBy.id).toBe(admin.profile.id);
  });
});

describe('users', () => {
  it('disables and re-enables a user via Appwrite with one audit row each; not self or admins', async () => {
    const admin = await createAdmin(appwrite);
    const other = await createAdmin(appwrite);
    const t = await createTraveler(appwrite);
    const res = await authed(admin.token).post(`/api/v1/admin/users/${t.profile.id}/disable`).send({ reason: REASON });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ isDisabled: true });
    expect(appwrite.calls.setUserStatus.at(-1)).toEqual({ userId: t.account.$id, enabled: false });
    expect(await auditRows('user.disable')).toBeGreaterThanOrEqual(1);
    expect((await authed(admin.token).post(`/api/v1/admin/users/${t.profile.id}/disable`).send({ reason: REASON })).status).toBe(409);
    expect((await authed(admin.token).post(`/api/v1/admin/users/${admin.profile.id}/disable`).send({ reason: REASON })).status).toBe(403);
    expect((await authed(admin.token).post(`/api/v1/admin/users/${other.profile.id}/disable`).send({ reason: REASON })).status).toBe(403);
    expect((await authed(admin.token).post(`/api/v1/admin/users/${t.profile.id}/enable`).send({})).status).toBe(200);
    expect(appwrite.calls.setUserStatus.at(-1)).toEqual({ userId: t.account.$id, enabled: true });
    const entries = await db.select().from(auditLog).where(eq(auditLog.entityId, t.profile.id));
    expect(entries.map((e) => e.action).sort()).toEqual(['user.disable', 'user.enable']);
    const [row] = await db.select().from(profiles).where(eq(profiles.id, t.profile.id));
    expect(row?.isDisabled).toBe(false);
    const list = await authed(admin.token).get(`/api/v1/admin/users?q=${encodeURIComponent(t.profile.email)}`);
    expect(list.body.items[0]).toMatchObject({ id: t.profile.id, bookingCount: 0 });
  });
});

describe('listings, disputes, cancel, audit', () => {
  it('flags and unflags a listing with one audit row each', async () => {
    const w = await world();
    const admin = await createAdmin(appwrite);
    expect((await authed(admin.token).post(`/api/v1/admin/listings/${w.listing.id}/unflag`).send({})).status).toBe(409);
    const f = await authed(admin.token).post(`/api/v1/admin/listings/${w.listing.id}/flag`).send({ reason: REASON });
    expect(f.body.listing).toMatchObject({ status: 'flagged', flagReason: REASON });
    expect((await authed(admin.token).post(`/api/v1/admin/listings/${w.listing.id}/flag`).send({ reason: REASON })).status).toBe(409);
    expect((await authed(admin.token).post(`/api/v1/admin/listings/${w.listing.id}/unflag`).send({})).body.listing.status).toBe('active');
    const entries = await db.select().from(auditLog).where(eq(auditLog.entityId, w.listing.id));
    expect(entries.map((e) => e.action).sort()).toEqual(['listing.flag', 'listing.unflag']);
  });

  it('resolves a dispute once, counts open ones and writes one audit row', async () => {
    const w = await world('stored');
    await authed(w.partner.token).post(`/api/v1/partner/bookings/${w.booking.id}/disputes`).send({ reason: REASON });
    const admin = await createAdmin(appwrite);
    const open = await authed(admin.token).get('/api/v1/admin/disputes?status=open');
    const item = open.body.items.find((d: { bookingId: string }) => d.bookingId === w.booking.id);
    expect(item).toMatchObject({ bookingCode: w.booking.code, raisedBy: { role: 'storage_partner' } });
    expect((await authed(admin.token).get('/api/v1/admin/counts')).body.openDisputes).toBeGreaterThanOrEqual(1);
    expect((await authed(admin.token).post(`/api/v1/admin/disputes/${item.id}/resolve`).send({ outcome: 'resolved', resolution: 'short' })).status).toBe(400);
    const res = await authed(admin.token).post(`/api/v1/admin/disputes/${item.id}/resolve`).send({ outcome: 'resolved', resolution: REASON });
    expect(res.body.dispute).toMatchObject({ status: 'resolved', resolution: REASON });
    expect((await authed(admin.token).post(`/api/v1/admin/disputes/${item.id}/resolve`).send({ outcome: 'rejected', resolution: REASON })).status).toBe(409);
    expect((await db.select().from(auditLog).where(eq(auditLog.entityId, item.id)))).toHaveLength(1);
    const [d] = await db.select().from(disputes).where(eq(disputes.id, item.id));
    expect(d?.resolvedBy).toBe(admin.profile.id);
  });

  it('cancels a stored booking as admin with one audit row, and lists it in the audit log', async () => {
    const w = await world('stored');
    const admin = await createAdmin(appwrite);
    expect((await authed(admin.token).post(`/api/v1/admin/bookings/${w.booking.id}/cancel`).send({ reason: 'x' })).status).toBe(400);
    expect((await authed(admin.token).post(`/api/v1/admin/bookings/${w.booking.id}/cancel`).send({ reason: REASON })).status).toBe(200);
    expect((await authed(admin.token).post(`/api/v1/admin/bookings/${w.booking.id}/cancel`).send({ reason: REASON })).status).toBe(409);
    const log = await authed(admin.token).get(`/api/v1/admin/audit?entity=booking&entityId=${w.booking.id}`);
    expect(log.body.items).toHaveLength(1);
    expect(log.body.items[0]).toMatchObject({ action: 'booking.cancel', actor: { id: admin.profile.id } });
  });
});
