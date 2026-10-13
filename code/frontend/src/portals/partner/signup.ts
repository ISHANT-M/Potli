/** Partner sign-up from the `#/partner` page and the `#/partner/apply` step that follows email verification. */
import type { Me } from '../../../../shared/types';
import { isValidName, normalizePhone, PASSWORD_MIN } from '../../../../shared/validation';
import { account, ID } from '../../appwrite';
import { ApiRequestError } from '../../lib/api';
import { html, mount } from '../../lib/html';
import type { RouteDef } from '../../lib/router';
import { api, refreshMe, resetApiToken } from '../../lib/session';
import { messagePage } from '../../ui/layout';

const DRAFT_KEY = 'potli.partnerApplyDraft';

export interface ApplyDraft {
  businessName: string;
  businessType: string;
  phone: string;
  address: string;
  city: string;
}

function saveDraft(draft: ApplyDraft): void {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // without storage the owner re-enters the details on the application page
  }
}

function loadDraft(): ApplyDraft | null {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? 'null');
    const d = parsed as Partial<ApplyDraft> | null;
    return d && typeof d.businessName === 'string' && typeof d.phone === 'string' ? (d as ApplyDraft) : null;
  } catch {
    return null;
  }
}

const clearDraft = (): void => {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // nothing stored
  }
};

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
  const phone = normalizePhone(text('phone'));
  const password = String(data.get('password') ?? '');

  if (!isValidName(text('name'))) return say('Enter your full name (2-80 characters).');
  if (!phone) return say('Enter an Indian mobile number such as +91 98765 43210.');
  if (password.length < PASSWORD_MIN) return say(`Use a password of at least ${PASSWORD_MIN} characters.`);
  if (text('address').length < 5 || text('city').length < 2) return say('Enter the business address and city.');

  const draft: ApplyDraft = { businessName: text('business'), businessType: text('businessType') || 'shop', phone, address: text('address'), city: text('city') };
  if (draft.businessName.length < 2) return say('Enter the business name.');

  if (submit) submit.disabled = true;
  say('Creating your account...');
  try {
    const email = text('email');
    await account.deleteSession({ sessionId: 'current' }).catch(() => undefined);
    await account.create({ userId: ID.unique(), email, password, name: text('name') });
    await account.createEmailPasswordSession({ email, password });
    await account.createVerification({ url: `${window.location.origin}/?flow=verify` }).catch(() => undefined);
    resetApiToken();
    await refreshMe({ fresh: true });
    saveDraft(draft);
    window.location.hash = `#/verify-email?next=${encodeURIComponent('#/partner/apply')}`;
  } catch (err) {
    say(signUpError(err));
  } finally {
    if (submit) submit.disabled = false;
  }
}

/** Submit the saved business details once the email is verified. */
export const partnerApplyRoute: RouteDef = {
  path: '/partner/apply',
  title: 'Submitting your application',
  guard: { roles: ['traveler', 'storage_partner'] },
  async mount(el, ctx) {
    mount(el, messagePage('Submitting your application', 'One moment...', html``));
    const done = (): void => {
      window.location.hash = '#/partner/application';
    };
    const show = (title: string, text: string): void =>
      mount(el, messagePage(title, text, html`<a class="button" href="#/partner/application">Open application</a>`));
    if (ctx.me?.role === 'storage_partner') return done();
    const draft = loadDraft();
    if (!draft) return show('Application details missing', 'Open the partner sign-up page and enter your business details.');
    try {
      await api<{ user: Me }>('POST', '/partners/apply', { body: draft, auth: 'required' });
      clearDraft();
      await refreshMe({ fresh: true });
      done();
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'EMAIL_NOT_VERIFIED') {
        window.location.hash = `#/verify-email?next=${encodeURIComponent('#/partner/apply')}`;
        return;
      }
      show('We could not submit your application', err instanceof Error ? err.message : 'Please try again.');
    }
  },
};
