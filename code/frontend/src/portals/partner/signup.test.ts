import { beforeEach, expect, it, vi } from 'vitest';
import type { Me } from '../../../../shared/types';
import { account } from '../../appwrite';
import { api, refreshMe } from '../../lib/session';
import { partnerApplyRoute, partnerSignUp } from './signup';
import { signupLocationFields } from './signupLocation';

vi.mock('../../appwrite', () => ({
  ID: { unique: () => 'appwrite-id' },
  account: { deleteSession: vi.fn(), create: vi.fn(), createEmailPasswordSession: vi.fn(), createVerification: vi.fn() },
}));
vi.mock('../../lib/session', () => ({ api: vi.fn(), refreshMe: vi.fn(), resetApiToken: vi.fn(), setMe: vi.fn() }));
vi.mock('./locationPicker', () => ({ mountLocationPicker: vi.fn() }));

const me: Me = { id: 'owner', email: 'owner@example.test', fullName: 'Store Owner', phone: '', role: 'traveler', emailVerified: true, partner: null };
const apply = '#/partner/apply';

beforeEach(() => {
  localStorage.clear();
  window.location.hash = '#/partner';
  vi.resetAllMocks();
  vi.mocked(account.deleteSession).mockResolvedValue({});
  vi.mocked(refreshMe).mockResolvedValue(me);
});

function signupForm(values: Record<string, string> = {}): HTMLFormElement {
  document.body.innerHTML = `<form><input name="name"><input name="business"><input name="businessType"><input name="email"><input name="phone"><input name="password">${signupLocationFields()}<button type="submit"></button><p class="form-message"></p></form>`;
  const form = document.querySelector('form')!;
  for (const [name, value] of Object.entries({
    name: me.fullName, business: 'Corner Shop', businessType: 'shop', email: me.email, phone: '+919876543210',
    password: 'test-password', address: '12 Mall Road', city: 'Patiala', ...values,
  })) {
    (form.elements.namedItem(name) as HTMLInputElement).value = value;
  }
  return form;
}

it('blocks account creation when the store pin is missing or invalid', async () => {
  for (const coordinates of [{}, { latitude: '30.34' }, { latitude: '30.34', longitude: '180' }]) {
    await partnerSignUp(signupForm(coordinates as Record<string, string>));
    expect(document.querySelector('.form-message')?.textContent).toContain('Choose a store location');
  }
  expect(account.create).not.toHaveBeenCalled();
});

it('carries the same store pin through the verification link into the application request', async () => {
  vi.mocked(account.createVerification).mockRejectedValueOnce(new Error('mail unavailable'));
  await partnerSignUp(signupForm({ latitude: '30.34', longitude: '76.39' }));
  expect(account.createVerification).toHaveBeenCalledWith({ url: `${window.location.origin}/?flow=verify&partner=1` });
  expect(window.location.hash).toContain('sendFailed=1');
  expect(JSON.stringify(localStorage)).not.toContain('test-password');
  const mount = (owner: Me) => partnerApplyRoute.mount(document.body, { path: apply.slice(1), params: {}, query: new URLSearchParams(), me: owner });
  await mount({ ...me, id: 'different-owner' });
  expect(api).not.toHaveBeenCalled();
  expect(document.querySelector('#application-details')).not.toBeNull();
  window.location.hash = apply;
  vi.mocked(api).mockResolvedValue({ user: { ...me, role: 'storage_partner' } });
  await mount(me);
  expect(api).toHaveBeenCalledWith('POST', '/partners/apply', {
    body: { businessName: 'Corner Shop', businessType: 'shop', address: '12 Mall Road', city: 'Patiala', phone: '+919876543210', latitude: 30.34, longitude: 76.39 },
    auth: 'required',
  });
  expect(window.location.hash).toBe('#/partner/application');
  expect(localStorage.length).toBe(0);
});
