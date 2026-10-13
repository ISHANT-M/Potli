import { describe, expect, it } from 'vitest';
import { handoffRecords } from '../../db/schema.ts';
import { createAdmin, createBookingFor, createListing, createPartner, createTraveler, makeApp } from './helpers.ts';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

let sceneCount = 0;

// Appwrite file ids are unique, so each scene gets its own.
async function scene() {
  const n = (sceneCount += 1);
  const ids = { visible: `cover_visible_${n}`, hidden: `cover_hidden_${n}`, photo: `photo_${n}` };
  const ctx = makeApp();
  const { appwrite, db, config } = ctx;
  const owner = await createPartner(appwrite);
  const otherPartner = await createPartner(appwrite);
  const traveler = await createTraveler(appwrite);
  const otherTraveler = await createTraveler(appwrite);
  const admin = await createAdmin(appwrite);

  const visible = await createListing(owner.profile.id, { coverFileId: ids.visible });
  const hidden = await createListing(owner.profile.id, { coverFileId: ids.hidden, status: 'paused' });
  const booking = await createBookingFor(traveler.profile.id, visible.id);
  await db.insert(handoffRecords).values({
    bookingId: booking.id,
    type: 'drop_off',
    method: 'otp',
    verifiedBy: owner.profile.id,
    bagCount: 1,
    photoFileIds: [ids.photo],
  });

  appwrite.files.set(`${config.buckets.listing}/${ids.visible}`, { buffer: PNG, mime: 'image/png' });
  appwrite.files.set(`${config.buckets.listing}/${ids.hidden}`, { buffer: PNG, mime: 'image/png' });
  appwrite.files.set(`${config.buckets.handoff}/${ids.photo}`, { buffer: PNG, mime: 'image/png' });
  return { ...ctx, ids, owner, otherPartner, traveler, otherTraveler, admin };
}

describe('GET /files/:fileId authorization', () => {
  it('serves the cover of a visible listing to everyone', async () => {
    const { anon, authed, otherTraveler, ids } = await scene();
    const res = await anon().get(`/api/v1/files/${ids.visible}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.headers['cache-control']).toBe('private, max-age=300');
    expect((await authed(otherTraveler.token).get(`/api/v1/files/${ids.visible}`)).status).toBe(200);
  });

  it('serves the cover of a hidden listing only to its partner and admins', async () => {
    const { anon, authed, owner, otherPartner, otherTraveler, admin, ids } = await scene();
    const path = `/api/v1/files/${ids.hidden}`;
    expect((await anon().get(path)).status).toBe(404);
    expect((await authed(otherTraveler.token).get(path)).status).toBe(404);
    expect((await authed(otherPartner.token).get(path)).status).toBe(404);
    expect((await authed(owner.token).get(path)).status).toBe(200);
    expect((await authed(admin.token).get(path)).status).toBe(200);
  });

  it('serves handoff photos only to the traveller, the partner and admins', async () => {
    const { anon, authed, owner, otherPartner, traveler, otherTraveler, admin, ids } = await scene();
    const path = `/api/v1/files/${ids.photo}`;
    expect((await anon().get(path)).status).toBe(404);
    expect((await authed(otherTraveler.token).get(path)).status).toBe(404);
    expect((await authed(otherPartner.token).get(path)).status).toBe(404);
    expect((await authed(traveler.token).get(path)).status).toBe(200);
    expect((await authed(owner.token).get(path)).status).toBe(200);
    expect((await authed(admin.token).get(path)).status).toBe(200);
  });

  it('treats unknown files and bad ids alike', async () => {
    const { anon, authed, admin } = await scene();
    expect((await authed(admin.token).get('/api/v1/files/does_not_exist')).status).toBe(404);
    expect((await anon().get('/api/v1/files/..%2Fsecret')).status).toBe(400);
  });

  it('does not let a stale or invalid token break public covers', async () => {
    const { authed, ids } = await scene();
    expect((await authed('expired-token').get(`/api/v1/files/${ids.visible}`)).status).toBe(200);
  });

  it('returns 404 when the bucket no longer holds the file', async () => {
    const { anon, appwrite, config, ids } = await scene();
    appwrite.files.delete(`${config.buckets.listing}/${ids.visible}`);
    expect((await anon().get(`/api/v1/files/${ids.visible}`)).status).toBe(404);
  });
});
