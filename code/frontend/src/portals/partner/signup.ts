/** Partner sign-up from the `#/partner` page and the `#/partner/apply` step that follows email verification. */
import type { Me } from '../../../../shared/types';
import { BUSINESS_TYPES, isValidName, normalizePhone, PASSWORD_MIN } from '../../../../shared/validation';
import { account, ID } from '../../appwrite';
import { ApiRequestError } from '../../lib/api';
import { html, mount } from '../../lib/html';
import type { RouteDef } from '../../lib/router';
import { api, refreshMe, resetApiToken, setMe } from '../../lib/session';
import { authLayout, messagePage } from '../../ui/layout';
import { inIndia } from './geo';
import { mountSignupLocation, readStorePin, signupLocationFields } from './signupLocation';

const DRAFT_KEY = 'potli.partnerLocationDraft';
const DRAFT_MAX_AGE = 15 * 24 * 60 * 60 * 1000;
const APPLY = '#/partner/apply';
const verifyPath = `#/verify-email?next=${encodeURIComponent(APPLY)}`;

type ApplyDraft = {
  businessName: string;
  businessType: string;
  phone: string;
  address: string;
  city: string;
  latitude: number;
  longitude: number;
};

function saveDraft(userId: string, details: ApplyDraft): void {
  try {
    // Verification links often open in a new tab. Never store credentials.
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ userId, details, expires: Date.now() + DRAFT_MAX_AGE }));
  } catch {
    // The application form can collect these details again.
  }
}

function readDraft(): { userId: string; details: ApplyDraft; expires: number } | null {
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null');
    if (!draft) return null;
    if (draft.expires <= Date.now()) {
      localStorage.removeItem(DRAFT_KEY);
      return null;
    }
    return draft.details && inIndia(draft.details.latitude, draft.details.longitude) ? draft : null;
  } catch {
    return null;
  }
}

function clearDraft(userId: string): void {
  try {
    if (readDraft()?.userId === userId) localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing to clear.
  }
}

function applicationDetails(form: HTMLFormElement, data: FormData): ApplyDraft | null {
  const say = (text: string): null => {
    const message = form.querySelector<HTMLElement>('.form-message');
    if (message) message.textContent = text;
    return null;
  };
  const text = (name: string) => String(data.get(name) ?? '').trim();
  const businessName = text('business');
  const businessType = text('businessType');
  const phone = normalizePhone(text('phone'));
  const address = text('address');
  const city = text('city');
  if (businessName.length < 2 || businessName.length > 80) return say('Enter a business name of 2–80 characters.');
  if (!phone) return say('Enter an Indian mobile number such as +91 98765 43210.');
  if (address.length < 5 || city.length < 2) return say('Enter the business address and city.');
  const pin = readStorePin(data);
  if (!pin) {
    const status = form.querySelector<HTMLElement>('[data-location-status]');
    if (status) status.textContent = 'Pin your store entrance in India or enter valid coordinates below.';
    status?.focus();
    return say('Choose a store location before continuing.');
  }
  return { businessName, businessType, phone, address, city, ...pin };
}

function signUpError(err: unknown): string {
  const code = (err as { code?: number } | null)?.code;
  if (code === 409) return 'An account with that email already exists. Use the Partner login tab.';
  if (code === 429) return 'Too many attempts. Please wait a few minutes and try again.';
  if (err instanceof TypeError || code === 0) return 'Could not reach Potli. Check your connection and try again.';
  return err instanceof Error && err.message ? err.message : 'Could not create the account. Please try again.';
}

/** Create the Appwrite account, remember the business details, then send the owner to verify their email. */
export async function partnerSignUp(form: HTMLFormElement): Promise<void> {
  const message = form.querySelector<HTMLElement>('.form-message');
  const submit = form.querySelector<HTMLButtonElement>('[type="submit"]');
  const say = (text: string): void => {
    if (message) message.textContent = text;
  };
  const data = new FormData(form);
  const text = (name: string): string => String(data.get(name) ?? '').trim();
  const password = String(data.get('password') ?? '');

  if (!isValidName(text('name'))) return say('Enter your full name (2-80 characters).');
  if (password.length < PASSWORD_MIN) return say(`Use a password of at least ${PASSWORD_MIN} characters.`);
  const draft = applicationDetails(form, data);
  if (!draft) return;

  if (submit) submit.disabled = true;
  say('Creating your account...');
  try {
    const email = text('email');
    await account.deleteSession({ sessionId: 'current' }).catch(() => undefined);
    await account.create({ userId: ID.unique(), email, password, name: text('name') });
    await account.createEmailPasswordSession({ email, password });
    resetApiToken();
    const me = await refreshMe({ fresh: true });
    if (!me) throw new Error('Sign in again to finish your partner application.');
    saveDraft(me.id, draft);
    let sendFailed = false;
    await account.createVerification({ url: `${window.location.origin}/?flow=verify&partner=1` }).catch(() => { sendFailed = true; });
    window.location.hash = `${verifyPath}${sendFailed ? '&sendFailed=1' : ''}`;
  } catch (err) {
    say(signUpError(err));
  } finally {
    if (submit) submit.disabled = false;
  }
}

async function submitApplication(userId: string, draft: ApplyDraft): Promise<void> {
  const { user } = await api<{ user: Me }>('POST', '/partners/apply', { body: draft, auth: 'required' });
  clearDraft(userId);
  setMe(user);
  if (window.location.hash === APPLY) window.location.hash = '#/partner/application';
}

/** Submit the saved business details once the email is verified. */
export const partnerApplyRoute: RouteDef = {
  path: '/partner/apply',
  title: 'Finish your partner application',
  guard: { roles: ['traveler', 'storage_partner'], verified: true },
  async mount(el, ctx) {
    const me = ctx.me;
    if (!me) return;
    if (me.role === 'storage_partner') {
      clearDraft(me.id);
      window.location.hash = '#/partner/application';
      return;
    }
    const saved = readDraft();
    if (saved?.userId === me.id) {
      mount(el, messagePage('Submitting your application', 'One moment...', html``));
      try {
        await submitApplication(me.id, saved.details);
      } catch (err) {
        if (window.location.hash !== APPLY) return;
        if (err instanceof ApiRequestError && err.code === 'EMAIL_NOT_VERIFIED') {
          window.location.hash = verifyPath;
          return;
        }
        mount(el, messagePage('We could not submit your application', err instanceof Error ? err.message : 'Please try again.', html`<button class="button" type="button" id="retry-application">Try again</button>`));
        el.querySelector('#retry-application')?.addEventListener('click', () => window.location.reload());
      }
      return;
    }

    mount(el, authLayout({
      backHref: '#/', backLabel: 'Back to home', eyebrow: 'Potli for business', title: 'Finish your application',
      text: 'Add your store details so we can review your application.',
      card: html`<h2>Store details</h2><p>Your saved details aren’t available in this browser. Enter them here to continue.</p>
        <form id="application-details">
          <label>Business name<input type="text" name="business" maxlength="80" autocomplete="organization" required /></label>
          <label>Business type<select name="businessType">${BUSINESS_TYPES.map((type) => html`<option value="${type}">${type.charAt(0).toUpperCase() + type.slice(1)}</option>`)}</select></label>
          ${signupLocationFields()}
          <label>Phone number<input type="tel" name="phone" autocomplete="tel" required /></label>
          <label class="checkbox terms"><input type="checkbox" required /> <span>I have read the <a href="#/privacy" target="_blank" rel="noopener">Privacy Policy</a> and agree to Potli’s partner terms and verification process.</span></label>
          <button class="button" type="submit">Submit application</button><p class="form-message" role="status"></p>
        </form>`,
    }));
    const form = el.querySelector<HTMLFormElement>('#application-details');
    if (!form) return;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const draft = applicationDetails(form, new FormData(form));
      if (!draft) return;
      const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (button) button.disabled = true;
      try {
        await submitApplication(me.id, draft);
      } catch (err) {
        const message = form.querySelector<HTMLElement>('.form-message');
        if (message) message.textContent = err instanceof Error ? err.message : 'Please try again.';
      } finally {
        if (button) button.disabled = false;
      }
    });
    const picker = await mountSignupLocation(form);
    return () => picker?.destroy();
  },
};
