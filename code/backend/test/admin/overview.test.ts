import { eq } from '../../../db/orm.ts';
import { describe, expect, it } from 'vitest';
import { bookings, disputes, feeSettlements, payments, ratings } from '../../../db/schema.ts';
import { createAdmin, createBookingFor, createListing, createPartner, createTraveler, makeApp } from '../helpers.ts';

const { db, appwrite, authed } = makeApp();
const HOUR = 3_600_000;

describe('GET /admin/overview', () => {
  it('returns nulls, never NaN, when there is no data', async () => {
    const admin = await createAdmin(appwrite);
    const res = await authed(admin.token).get('/api/v1/admin/overview');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      bft: { medianSeconds: null, sampleSize: 0 },
      handoffSuccessRate: null,
      utilization: null,
      averageRating: null,
      openDisputes: 0,
      revenue: { grossPaise: 0, feesEarnedPaise: 0, feesDuePaise: 0, feesSettledPaise: 0 },
    });
    expect(res.body.bookings.byStatus.booked).toBe(0);
  });

  it('computes the metrics on a fixed fixture', async () => {
    const admin = await createAdmin(appwrite);
    const partner = await createPartner(appwrite, { status: 'pending' });
    const approved = await createPartner(appwrite);
    const listing = await createListing(approved.profile.id, { capacity: 10, openTime: '08:00', closeTime: '22:00' });
    const [t1, t2, t3, t4] = await Promise.all([1, 2, 3, 4].map(() => createTraveler(appwrite)));
    const now = Date.now();
    const slotStart = new Date(now - 6 * HOUR);
    const slotEnd = new Date(now - 2 * HOUR);

    const make = async (traveler: typeof t1, bags: number, status: 'completed' | 'stored' | 'cancelled', bftSeconds: number | null) => {
      const b = await createBookingFor(traveler!.profile.id, listing.id, { bagCount: bags });
      const bookedAt = new Date(now - 7 * HOUR);
      await db
        .update(bookings)
        .set({
          status,
          slotStart,
          slotEnd,
          bookedAt,
          searchStartedAt: bftSeconds === null ? null : new Date(bookedAt.getTime() - bftSeconds * 1000),
          droppedAt: status === 'cancelled' ? null : new Date(now - 5 * HOUR),
          completedAt: status === 'completed' ? new Date(now - HOUR) : null,
        })
        .where(eq(bookings.id, b.id));
      return b;
    };
    const a = await make(t1, 2, 'completed', 60);
    const b = await make(t2, 1, 'completed', 120);
    await make(t3, 1, 'stored', 300);
    await make(t4, 1, 'cancelled', null);

    const [settlement] = await db.insert(feeSettlements).values({ partnerId: approved.profile.id, amountPaise: 3000, paymentCount: 1, reference: 'UPI-1', recordedBy: admin.profile.id }).returning();
    await db.update(payments).set({ status: 'captured', amountPaise: 10000, platformFeePaise: 1500, partnerSharePaise: 8500, collectedAt: new Date(now - HOUR) }).where(eq(payments.bookingId, a.id));
    await db.update(payments).set({ status: 'captured', amountPaise: 20000, platformFeePaise: 3000, partnerSharePaise: 17000, collectedAt: new Date(now - HOUR), settlementId: settlement?.id }).where(eq(payments.bookingId, b.id));
    await db.insert(ratings).values([
      { bookingId: a.id, travelerId: t1!.profile.id, listingId: listing.id, score: 4 },
      { bookingId: b.id, travelerId: t2!.profile.id, listingId: listing.id, score: 5 },
    ]);
    await db.insert(disputes).values({ bookingId: b.id, raisedBy: t2!.profile.id, raisedByRole: 'traveler', reason: 'Bag was damaged on pickup' });

    const from = new Date(now - 24 * HOUR).toISOString();
    const to = new Date(now + 24 * HOUR).toISOString();
    const res = await authed(admin.token).get(`/api/v1/admin/overview?from=${from}&to=${to}`);
    expect(res.status).toBe(200);
    expect(res.body.bft).toEqual({ medianSeconds: 120, sampleSize: 3 });
    expect(res.body.handoffSuccessRate).toBeCloseTo(1 / 3, 6); // 3 reached dropped; only A completed without a dispute
    expect(res.body.utilization).toBeCloseTo(16 / 280, 6); // (2+1+1 bags) x 4 h over 10 bags x 14 h x 2 days
    expect(res.body.revenue).toEqual({ grossPaise: 30000, feesEarnedPaise: 4500, feesDuePaise: 1500, feesSettledPaise: 3000 });
    expect(res.body.bookings).toMatchObject({ created: 4, completed: 2, byStatus: { completed: 2, stored: 1, cancelled: 1, booked: 0 } });
    expect(res.body.averageRating).toBe(4.5);
    expect(res.body.openDisputes).toBe(1);
    expect(res.body.partners).toMatchObject({ pending: 1, approved: 1 });
    expect(res.body.users).toMatchObject({ admins: 2, partners: 2, travelers: 4 });
    expect(partner.profile.id).toBeTruthy();
  });

  it('validates the date range', async () => {
    const admin = await createAdmin(appwrite);
    expect((await authed(admin.token).get('/api/v1/admin/overview?from=banana')).status).toBe(400);
  });
});
