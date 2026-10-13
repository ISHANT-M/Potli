import { eq } from '../../db/orm.ts';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { profiles } from '../../db/schema.ts';
import { loadConfig } from '../src/config.ts';
import { authenticate, requireApprovedPartner, requireRole, requireVerifiedEmail } from '../src/http/auth.ts';
import { HttpError } from '../src/http/errors.ts';
import { validate, validated } from '../src/http/validate.ts';
import { createAdmin, createPartner, createTraveler, makeApp, makeMiniApp, TEST_SECRET } from './helpers.ts';
import { testDb } from './testDb.ts';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('authentication', () => {
  it('rejects a missing token with the error envelope', async () => {
    const { anon } = makeApp();
    const res = await anon().get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects an unknown token', async () => {
    const { authed } = makeApp();
    const res = await authed('not-a-real-jwt').get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('refuses an infra-labelled account and creates no profile', async () => {
    const { appwrite, authed } = makeApp();
    const token = appwrite.register({ $id: 'aw_infra', email: 'infra@test.potli', name: 'Infra', labels: ['infra'], emailVerification: true });
    const res = await authed(token).get('/api/v1/auth/me');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    const rows = await testDb().db.select().from(profiles).where(eq(profiles.appwriteUserId, 'aw_infra'));
    expect(rows).toHaveLength(0);
  });

  it('creates a traveller profile on first contact and returns camelCase Me', async () => {
    const { appwrite, authed } = makeApp();
    const token = appwrite.register({ $id: 'aw_new', email: 'new@test.potli', name: 'New Person', labels: ['admin'], emailVerification: false });
    const res = await authed(token).get('/api/v1/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      email: 'new@test.potli',
      fullName: 'New Person',
      phone: '',
      role: 'traveler', // Postgres is the authority; a label never grants a role
      emailVerified: false,
      partner: null,
    });
    expect(res.body.user.appwriteId).toBeUndefined();
    expect(res.body.user.full_name).toBe('New Person'); // kept for existing clients
  });

  it('includes partner details for a partner', async () => {
    const { appwrite, authed } = makeApp();
    const partner = await createPartner(appwrite, { status: 'pending', businessName: 'Chai Corner' });
    const res = await authed(partner.token).get('/api/v1/auth/me');
    expect(res.body.user.role).toBe('storage_partner');
    expect(res.body.user.partner).toMatchObject({ status: 'pending', businessName: 'Chai Corner', city: 'Patiala' });
  });

  it('rejects a disabled account', async () => {
    const { appwrite, authed } = makeApp();
    const user = await createTraveler(appwrite, { disabled: true });
    const res = await authed(user.token).get('/api/v1/auth/me');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });
});

describe('POST /auth/login', () => {
  it('returns a token and the user for good credentials', async () => {
    const { appwrite, authed } = makeApp();
    const user = await createTraveler(appwrite);
    const res = await authed().post('/api/v1/auth/login').send({ email: user.account.email, password: 'Password123!' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBe(user.token);
    expect(res.body.user.email).toBe(user.account.email);
  });

  it('gives one generic message for bad credentials', async () => {
    const { appwrite, authed } = makeApp();
    const user = await createTraveler(appwrite);
    const wrongPassword = await authed().post('/api/v1/auth/login').send({ email: user.account.email, password: 'nope-nope' });
    const unknownEmail = await authed().post('/api/v1/auth/login').send({ email: 'ghost@test.potli', password: 'nope-nope' });
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.body.error.message).toBe(wrongPassword.body.error.message);
  });

  it('validates the body', async () => {
    const { authed } = makeApp();
    const res = await authed().post('/api/v1/auth/login').send({ email: 'a@b.co' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.fields.password).toBeTruthy();
  });

  it('is rate limited after 10 attempts', async () => {
    const { authed } = makeApp();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      const res = await authed().post('/api/v1/auth/login').send({ email: 'ghost@test.potli', password: 'wrong-pass' });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe('PATCH /me', () => {
  it('updates name and phone', async () => {
    const { appwrite, authed } = makeApp();
    const user = await createTraveler(appwrite);
    const res = await authed(user.token).patch('/api/v1/me').send({ fullName: '  Asha Rao ', phone: '+919876543210' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ fullName: 'Asha Rao', phone: '+919876543210' });
  });

  it('rejects a bad phone, short name, unknown keys and an empty body', async () => {
    const { appwrite, authed } = makeApp();
    const user = await createTraveler(appwrite);
    const api = authed(user.token);
    const phone = await api.patch('/api/v1/me').send({ phone: '12345' });
    expect(phone.status).toBe(400);
    expect(phone.body.error.fields.phone).toBeTruthy();
    expect((await api.patch('/api/v1/me').send({ fullName: 'A' })).status).toBe(400);
    expect((await api.patch('/api/v1/me').send({ role: 'admin' })).status).toBe(400);
    expect((await api.patch('/api/v1/me').send({})).status).toBe(400);
  });

  it('requires sign-in', async () => {
    const { anon } = makeApp();
    expect((await anon().patch('/api/v1/me').send({ fullName: 'Someone' })).status).toBe(401);
  });
});

describe('system', () => {
  it('reports health', async () => {
    const { anon, appwrite } = makeApp();
    const ok = await anon().get('/api/v1/health');
    expect(ok.body).toEqual({ ok: true, db: true, auth: true });
    appwrite.reachable = false;
    expect((await anon().get('/api/v1/health')).body.ok).toBe(false);
  });

  it('returns the 404 envelope for unknown routes', async () => {
    const { anon } = makeApp();
    const res = await anon().get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('mounts the three portal routers without routes', async () => {
    const { anon } = makeApp();
    // Partner and admin routers now exist and require sign-in; the customer one is still empty.
    expect((await anon().get('/api/v1/listings')).status).toBe(404);
    for (const path of ['/api/v1/partner/me', '/api/v1/admin/overview']) {
      expect((await anon().get(path)).status).toBe(401);
    }
  });

  it('sends security headers and hides the framework', async () => {
    const { anon } = makeApp();
    const res = await anon().get('/api/v1/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-request-id']).toBeTruthy();
  });
});

describe('CORS', () => {
  it('answers allowed origins only', async () => {
    const { anon } = makeApp();
    const allowed = await anon().get('/api/v1/health').set('Origin', 'http://localhost:5173');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const denied = await anon().get('/api/v1/health').set('Origin', 'https://evil.example');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('error envelope', () => {
  it('includes detail outside production', async () => {
    const { appwrite, authed } = makeApp();
    appwrite.accountFromJwt = async () => {
      throw new Error('boom: select * from secrets');
    };
    const res = await authed('anything').get('/api/v1/auth/me');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL');
    expect(res.body.error.detail).toContain('boom');
  });

  it('hides internals in production', async () => {
    const { appwrite, authed } = makeApp({ nodeEnv: 'production' });
    appwrite.accountFromJwt = async () => {
      throw new Error('boom: select * from secrets');
    };
    const res = await authed('anything').get('/api/v1/auth/me');
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('boom');
    expect(res.body.error.detail).toBeUndefined();
  });

  it('rejects malformed JSON and oversized bodies', async () => {
    const { authed } = makeApp();
    const malformed = await authed().post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"email":');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('VALIDATION_FAILED');
    const huge = await authed().post('/api/v1/auth/login').send({ email: 'a@b.co', password: 'x'.repeat(150_000) });
    expect(huge.status).toBe(413);
  });
});

describe('role middleware', () => {
  function build() {
    const ctx = makeApp();
    const mini = makeMiniApp((app) => {
      app.get('/admin', authenticate(ctx.deps), requireRole('admin'), (_req, res) => res.json({ ok: true }));
      app.get('/verified', authenticate(ctx.deps), requireVerifiedEmail, (_req, res) => res.json({ ok: true }));
      app.get('/approved', authenticate(ctx.deps), requireApprovedPartner, (_req, res) => res.json({ ok: true }));
    });
    return { ...ctx, mini };
  }
  const get = async (mini: express.Express, path: string, token: string) => {
    const { default: request } = await import('supertest');
    return request(mini).get(path).set('Authorization', `Bearer ${token}`);
  };

  it('enforces roles', async () => {
    const { appwrite, mini } = build();
    const admin = await createAdmin(appwrite);
    const traveler = await createTraveler(appwrite);
    expect((await get(mini, '/admin', admin.token)).status).toBe(200);
    const denied = await get(mini, '/admin', traveler.token);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');
  });

  it('requires a verified email', async () => {
    const { appwrite, mini } = build();
    const unverified = await createTraveler(appwrite, { verified: false });
    const verified = await createTraveler(appwrite);
    const denied = await get(mini, '/verified', unverified.token);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    expect((await get(mini, '/verified', verified.token)).status).toBe(200);
  });

  it('requires an approved partner', async () => {
    const { appwrite, mini } = build();
    const approved = await createPartner(appwrite, { status: 'approved' });
    const pending = await createPartner(appwrite, { status: 'pending' });
    const traveler = await createTraveler(appwrite);
    expect((await get(mini, '/approved', approved.token)).status).toBe(200);
    expect((await get(mini, '/approved', pending.token)).body.error.code).toBe('PARTNER_NOT_APPROVED');
    expect((await get(mini, '/approved', traveler.token)).body.error.code).toBe('FORBIDDEN');
  });
});

describe('validate middleware', () => {
  const schemas = { query: z.object({ page: z.coerce.number().int().min(1).default(1) }), body: z.object({ name: z.string().min(2) }) };

  it('parses, coerces and rejects unknown keys', async () => {
    const mini = makeMiniApp((app) => {
      app.post('/x', validate(schemas), (req, res) => {
        const { query, body } = validated(req, schemas);
        res.json({ page: query.page, name: body.name });
      });
    });
    const { default: request } = await import('supertest');
    const ok = await request(mini).post('/x?page=3').send({ name: 'Asha' });
    expect(ok.body).toEqual({ page: 3, name: 'Asha' });
    const unknownBody = await request(mini).post('/x').send({ name: 'Asha', extra: 1 });
    expect(unknownBody.status).toBe(400);
    const unknownQuery = await request(mini).post('/x?bogus=1').send({ name: 'Asha' });
    expect(unknownQuery.status).toBe(400);
    const missing = await request(mini).post('/x').send({});
    expect(missing.body.error.fields.name).toBeTruthy();
  });

  it('turns HttpError into the envelope', async () => {
    const mini = makeMiniApp((app) => {
      app.get('/teapot', (_req, _res, next) => next(new HttpError(418, 'TEAPOT', 'Short and stout.')));
    });
    const { default: request } = await import('supertest');
    const res = await request(mini).get('/teapot');
    expect(res.status).toBe(418);
    expect(res.body).toEqual({ error: { code: 'TEAPOT', message: 'Short and stout.' } });
  });
});

describe('config', () => {
  const valid = {
    APPWRITE_ENDPOINT: 'https://appwrite.example.com/v1/',
    APPWRITE_PROJECT_ID: 'proj',
    APPWRITE_API_KEY: 'key',
    DATABASE_URL: 'postgres://u:p@h/db',
    HANDOFF_SECRET: TEST_SECRET,
  };

  it('applies defaults and trims the endpoint', () => {
    const config = loadConfig(valid);
    expect(config.appwriteEndpoint).toBe('https://appwrite.example.com/v1');
    expect(config.port).toBe(4000);
    expect(config.corsOrigins).toContain('http://localhost:5173');
    expect(config.buckets).toEqual({ handoff: 'handoff-photos', listing: 'listing-photos' });
  });

  it('fails fast naming variables but never values', () => {
    expect(() => loadConfig({ ...valid, HANDOFF_SECRET: 'c2hvcnQ=', APPWRITE_API_KEY: '' })).toThrow(/HANDOFF_SECRET.*APPWRITE_API_KEY|APPWRITE_API_KEY.*HANDOFF_SECRET/);
    try {
      loadConfig({ ...valid, HANDOFF_SECRET: 'c2hvcnQ=' });
    } catch (err) {
      expect((err as Error).message).not.toContain('c2hvcnQ=');
    }
  });
});
