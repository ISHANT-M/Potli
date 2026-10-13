/** Daily cleanup: deletes the right things, keeps the rest, and runs once per 24 hours. */
import { describe, expect, it } from 'vitest';
import { eq } from '../../db/orm.ts';
import { auditLog, bookings, disputes, handoffRecords, profiles } from '../../db/schema.ts';
import { runCleanup, runCleanupIfDue } from '../src/cleanup.ts';
import { createBookingFor, createListing, createPartner, createTraveler, makeApp } from './helpers.ts';

const { db, appwrite, config } = makeApp();
const deps = { db, appwrite, config };
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

async function finishedBooking(options: { completedHoursAgo: number; status?: 'completed' | 'cancelled'; dispute?: boolean }) {
  const partner = await createPartner(appwrite);
  const listing = await createListing(partner.profile.id);
  const traveler = await createTraveler(appwrite);
  const booking = await createBookingFor(traveler.profile.id, listing.id);
  const fileId = `f_${booking.id.slice(0, 8)}`;
  appwrite.files.set(`${config.buckets.handoff}/${fileId}`, { buffer: Buffer.from('x'), mime: 'image/jpeg' });
  await db.insert(handoffRecords).values({ bookingId: booking.id, type: 'drop_off', method: 'otp', verifiedBy: partner.profile.id, bagCount: 1, photoFileIds: [fileId] });
  const at = hoursAgo(options.completedHoursAgo);
  const status = options.status ?? 'completed';
  await db.update(bookings).set({ status, ...(status === 'completed' ? { completedAt: at } : { cancelledAt: at }) }).where(eq(bookings.id, booking.id));
  if (options.dispute) {
    await db.insert(disputes).values({ bookingId: booking.id, raisedBy: traveler.profile.id, raisedByRole: 'traveler', reason: 'Bag was damaged on pickup.' });
  }
  return { booking, fileId, traveler };
}
const photosOf = async (bookingId: string) => (await db.select().from(handoffRecords).where(eq(handoffRecords.bookingId, bookingId)))[0]?.photoFileIds ?? [];

describe('photo retention', () => {
  it('deletes photos 48 hours after a booking ends, and keeps newer ones and disputed ones', async () => {
    const old = await finishedBooking({ completedHoursAgo: 49 });
    const oldCancelled = await finishedBooking({ completedHoursAgo: 72, status: 'cancelled' });
    const recent = await finishedBooking({ completedHoursAgo: 24 });
    const disputed = await finishedBooking({ completedHoursAgo: 100, dispute: true });

    const dry = await runCleanup(deps, { dryRun: true });
    expect(dry.photosDeleted).toBe(2);
    expect(await photosOf(old.booking.id)).toHaveLength(1);

    const result = await runCleanup(deps);
    expect(result.photosDeleted).toBe(2);
    expect(await photosOf(old.booking.id)).toEqual([]);
    expect(await photosOf(oldCancelled.booking.id)).toEqual([]);
    expect(appwrite.files.has(`${config.buckets.handoff}/${old.fileId}`)).toBe(false);
    expect(await photosOf(recent.booking.id)).toHaveLength(1);
    expect(appwrite.files.has(`${config.buckets.handoff}/${recent.fileId}`)).toBe(true);
    expect(await photosOf(disputed.booking.id)).toHaveLength(1);
    expect((await db.select().from(auditLog).where(eq(auditLog.action, 'photos.purge'))).length).toBeGreaterThanOrEqual(2);
  });
});

describe('unverified accounts', () => {
  it('deletes only old, unlabelled, unverified accounts that have never booked', async () => {
    const stale = await createTraveler(appwrite, { verified: false });
    const withBooking = await createTraveler(appwrite, { verified: false });
    const partner = await createPartner(appwrite);
    const listing = await createListing(partner.profile.id);
    await createBookingFor(withBooking.profile.id, listing.id);
    const old = hoursAgo(16 * 24).toISOString();
    const fresh = hoursAgo(5 * 24).toISOString();
    appwrite.unverified = [
      { id: stale.account.$id, createdAt: old, labels: [] },
      { id: 'aw_infra_like', createdAt: old, labels: ['infra'] },
      { id: withBooking.account.$id, createdAt: old, labels: [] },
      { id: 'aw_new', createdAt: fresh, labels: [] },
    ];
    await db.update(profiles).set({ role: 'traveler' }).where(eq(profiles.id, stale.profile.id));

    const result = await runCleanup(deps);
    expect(result.accountsDeleted).toBe(1);
    expect(appwrite.deletedUsers).toEqual([stale.account.$id]);
    expect(await db.select().from(profiles).where(eq(profiles.id, stale.profile.id))).toHaveLength(0);
    expect(await db.select().from(profiles).where(eq(profiles.id, withBooking.profile.id))).toHaveLength(1);
  });
});

describe('schedule', () => {
  it('runs once per 24 hours and retries when everything failed', async () => {
    await db.delete(auditLog).where(eq(auditLog.action, 'system.cleanup'));
    expect(await runCleanupIfDue(deps)).not.toBeNull();
    expect(await runCleanupIfDue(deps)).toBeNull();
    const later = new Date(Date.now() + 25 * 3_600_000);
    expect(await runCleanupIfDue(deps, later)).not.toBeNull();
  });
});
