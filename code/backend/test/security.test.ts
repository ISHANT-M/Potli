import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createAdmin, createPartner, createTraveler, makeApp } from './helpers.ts';

type Method = 'get' | 'post' | 'patch';
type Role = 'traveler' | 'storage_partner' | 'admin';

const id = randomUUID();

// [method, path, required role]. Every protected route must reject anonymous (401) and wrong-role (403/404) callers.
const PROTECTED: [Method, string, Role][] = [
  ['post', '/bookings', 'traveler'],
  ['get', '/bookings', 'traveler'],
  ['get', `/bookings/${id}`, 'traveler'],
  ['post', `/bookings/${id}/cancel`, 'traveler'],
  ['post', `/bookings/${id}/rating`, 'traveler'],
  ['post', `/bookings/${id}/disputes`, 'traveler'],
  ['get', '/partner/me', 'storage_partner'],
  ['patch', '/partner/me', 'storage_partner'],
  ['get', '/partner/listings', 'storage_partner'],
  ['post', '/partner/listings', 'storage_partner'],
  ['get', `/partner/listings/${id}`, 'storage_partner'],
  ['patch', `/partner/listings/${id}`, 'storage_partner'],
  ['post', `/partner/listings/${id}/cover`, 'storage_partner'],
  ['get', '/partner/bookings', 'storage_partner'],
  ['get', `/partner/bookings/${id}`, 'storage_partner'],
  ['post', `/partner/bookings/${id}/cancel`, 'storage_partner'],
  ['post', `/partner/bookings/${id}/disputes`, 'storage_partner'],
  ['post', `/partner/bookings/${id}/check-in`, 'storage_partner'],
  ['post', `/partner/bookings/${id}/drop-off`, 'storage_partner'],
  ['post', `/partner/bookings/${id}/pickup`, 'storage_partner'],
  ['post', '/partner/handoffs/lookup', 'storage_partner'],
  ['get', '/partner/stats', 'storage_partner'],
  ['get', '/partner/earnings', 'storage_partner'],
  ['get', '/partner/settlements', 'storage_partner'],
  ['get', '/admin/overview', 'admin'],
  ['get', '/admin/counts', 'admin'],
  ['get', '/admin/partners', 'admin'],
  ['get', `/admin/partners/${id}`, 'admin'],
  ['post', `/admin/partners/${id}/approve`, 'admin'],
  ['get', '/admin/bookings', 'admin'],
  ['get', `/admin/bookings/${id}`, 'admin'],
  ['post', `/admin/bookings/${id}/cancel`, 'admin'],
  ['get', '/admin/ledger', 'admin'],
  ['get', '/admin/ledger/settlements', 'admin'],
  ['post', '/admin/ledger/settlements', 'admin'],
  ['get', '/admin/users', 'admin'],
  ['post', `/admin/users/${id}/disable`, 'admin'],
  ['post', `/admin/users/${id}/enable`, 'admin'],
  ['get', '/admin/listings', 'admin'],
  ['post', `/admin/listings/${id}/flag`, 'admin'],
  ['get', '/admin/disputes', 'admin'],
  ['post', `/admin/disputes/${id}/resolve`, 'admin'],
  ['get', '/admin/audit', 'admin'],
  ['get', '/auth/me', 'traveler'],
];

describe('route authorization matrix', () => {
  it.each(PROTECTED)('%s %s rejects anonymous callers', async (method, path) => {
    const { anon } = makeApp();
    const res = await anon()[method](`/api/v1${path}`).send({});
    expect(res.status).toBe(401);
  });

  it.each(PROTECTED.filter(([, path]) => path !== '/auth/me'))('%s %s rejects a wrong-role caller', async (method, path, role) => {
    const { authed, appwrite } = makeApp();
    const tokens: Record<Role, string> = {
      traveler: (await createTraveler(appwrite)).token,
      storage_partner: (await createPartner(appwrite)).token,
      admin: (await createAdmin(appwrite)).token,
    };
    for (const other of Object.keys(tokens) as Role[]) {
      if (other === role) continue;
      const res = await authed(tokens[other])[method](`/api/v1${path}`).send({});
      expect([403, 404], `${other} -> ${method} ${path} gave ${res.status}`).toContain(res.status);
    }
  });
});

describe('error responses', () => {
  it('does not leak internals for unknown routes', async () => {
    const { anon } = makeApp();
    const res = await anon().get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/stack|select |at .*\.ts/i);
  });
});
