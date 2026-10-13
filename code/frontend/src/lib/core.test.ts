import { describe, expect, it, vi } from 'vitest';
import type { Me } from '../../../shared/types';
import { createApiClient, parseErrorBody } from './api';
import { formatINR, formatDateTime, formatDuration } from './format';
import { escapeHtml, html, raw, telHref } from './html';
import { evaluateGuard, matchRoute, parseHash, sanitizeNext, type RouteDef } from './router';
import { validateRegistration } from '../pages/auth/register';

const me = (overrides: Partial<Me> = {}): Me => ({
  id: '1', email: 'a@b.co', fullName: 'A', phone: '', role: 'traveler', emailVerified: true, partner: null, ...overrides,
});

describe('html escaping', () => {
  it('escapes interpolated values, including attributes and quotes', () => {
    const evil = `<script>alert(1)</script>" onmouseover="x' \``;
    const out = html`<p title="${evil}">${evil}</p>`.value;
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('" onmouseover');
    expect(out).toContain('&lt;script&gt;');
  });

  it('keeps raw() markup and renders arrays and empty values', () => {
    expect(html`${raw('<b>ok</b>')}`.value).toBe('<b>ok</b>');
    expect(html`${['<i>', raw('<u>')]}${null}${undefined}${false}`.value).toBe('&lt;i&gt;<u>');
    expect(escapeHtml(5)).toBe('5');
  });
});

describe('router', () => {
  it('parses hashes and matches params', () => {
    expect(parseHash('#/search?q=a%20b').query.get('q')).toBe('a b');
    const routes: RouteDef[] = [{ path: '/app/bookings/:id', mount: () => undefined }];
    expect(matchRoute(routes, '/app/bookings/abc')?.params).toEqual({ id: 'abc' });
    expect(matchRoute(routes, '/app/bookings')).toBeNull();
  });

  it('only accepts in-app next targets', () => {
    expect(sanitizeNext('#/app/bookings')).toBe('#/app/bookings');
    for (const bad of ['https://evil.example', '//evil.example', '#//evil.example', 'javascript:alert(1)', '#/\\evil', '', null]) {
      expect(sanitizeNext(bad)).toBeNull();
    }
  });

  it('guards by sign-in, role, verification and partner status', () => {
    const traveler = me();
    expect(evaluateGuard({ roles: ['traveler'] }, null, '#/app')).toEqual({ type: 'redirect', to: '#/login?next=%23%2Fapp' });
    expect(evaluateGuard({ roles: ['admin'] }, null, '#/admin')).toEqual({ type: 'redirect', to: '#/admin/login?next=%23%2Fadmin' });
    expect(evaluateGuard({ roles: ['admin'] }, traveler, '#/admin')).toEqual({ type: 'forbidden' });
    expect(evaluateGuard({ roles: ['traveler'], verified: true }, me({ emailVerified: false }), '#/app').type).toBe('redirect');
    const pending = me({ role: 'storage_partner', partner: { status: 'pending', businessName: '', businessType: '', phone: '', address: '', city: '', rejectionReason: null } });
    expect(evaluateGuard({ roles: ['storage_partner'], partnerStatus: ['approved'] }, pending, '#/partner/dashboard')).toEqual({ type: 'redirect', to: '#/partner/application' });
    expect(evaluateGuard({ guestOnly: true }, traveler, '#/login?next=%23%2Fapp%2Fbookings')).toEqual({ type: 'redirect', to: '#/app/bookings' });
    expect(evaluateGuard({ guestOnly: true }, traveler, '#/login?next=https://evil.example')).toEqual({ type: 'redirect', to: '#/app' });
  });
});

describe('format', () => {
  it('formats rupees from paise', () => {
    expect(formatINR(4000)).toBe('₹40');
    expect(formatINR(123456)).toBe('₹1,234.56');
  });
  it('formats dates in Asia/Kolkata and durations', () => {
    expect(formatDateTime('2030-01-01T04:30:00Z')).toContain('10:00');
    expect(formatDuration(90 * 60_000)).toBe('1 h 30 min');
  });
});

describe('api client', () => {
  const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  it('parses the error envelope', () => {
    const err = parseErrorBody(409, { error: { code: 'CAPACITY_UNAVAILABLE', message: 'Full.', fields: { bags: 'x' } } });
    expect([err.status, err.code, err.fields.bags]).toEqual([409, 'CAPACITY_UNAVAILABLE', 'x']);
    expect(parseErrorBody(500, '<html>').code).toBe('INTERNAL');
  });

  it('sends the token, retries once on 401 with a fresh one, and surfaces envelope errors', async () => {
    let n = 0;
    const mintToken = vi.fn(async () => `t${(n += 1)}`);
    const fetchFn = vi.fn(async (_url: unknown, init?: RequestInit) =>
      (init?.headers as Record<string, string>).Authorization === 'Bearer t1' ? ok({}, 401) : ok({ hello: 'x' }));
    const client = createApiClient({ baseUrl: 'http://api', mintToken, fetchFn: fetchFn as unknown as typeof fetch });
    expect(await client.api('GET', '/x', { auth: 'required' })).toEqual({ hello: 'x' });
    expect(mintToken).toHaveBeenCalledTimes(2);

    const failing = createApiClient({ baseUrl: 'http://api', mintToken, fetchFn: (async () => ok({ error: { code: 'NOT_FOUND', message: 'No.' } }, 404)) as unknown as typeof fetch });
    await expect(failing.api('GET', '/x', { auth: 'none' })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('turns network failures into a friendly error and skips tokens when signed out', async () => {
    const mintToken = vi.fn(async () => 't');
    const client = createApiClient({ baseUrl: 'http://api', mintToken, fetchFn: (async () => { throw new TypeError('x'); }) as unknown as typeof fetch });
    await expect(client.api('GET', '/x')).rejects.toMatchObject({ code: 'NETWORK' });
    expect(mintToken).not.toHaveBeenCalled();
  });
});

describe('registration validation', () => {
  it('flags every bad field', () => {
    const errors = validateRegistration({ name: 'A', email: 'nope', phone: '123', password: 'short', confirm: 'other' }, false);
    expect(Object.keys(errors).sort()).toEqual(['confirm', 'email', 'name', 'password', 'phone', 'terms']);
    expect(validateRegistration({ name: 'Asha Rao', email: 'a@b.co', phone: '', password: 'longenough1', confirm: 'longenough1' }, true)).toEqual({});
  });
});

describe('telHref', () => {
  it('accepts plain numbers and rejects script or markup', () => {
    expect(telHref('+91 98765-43210')).toBe('tel:+919876543210');
    expect(telHref('javascript:alert(1)')).toBe('#');
    expect(telHref('1"><script>')).toBe('#');
    expect(telHref(null)).toBe('#');
  });
});
