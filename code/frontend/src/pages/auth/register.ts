/** Traveller sign-up: Appwrite account, session, verification mail, then the profile. */
import { PASSWORD_MIN, isValidName, normalizePhone } from '../../../../shared/validation';
import { account, ID } from '../../appwrite';
import { clearFieldErrors, passwordStrength, readForm, setBusy, setMessage, showFieldErrors } from '../../lib/forms';
import { html, mount } from '../../lib/html';
import type { RouteDef } from '../../lib/router';
import { api, refreshMe, resetApiToken } from '../../lib/session';
import { icon } from '../../ui/icons';
import { authLayout } from '../../ui/layout';

export function friendlySignUpError(err: unknown): string {
  const code = (err as { code?: number } | null)?.code;
  if (code === 409) return 'An account with this email already exists. Log in or reset your password.';
  if (code === 429) return 'Too many attempts. Please wait a few minutes and try again.';
  if (code === 400) return 'That password is too weak or commonly used. Choose a longer, less predictable one.';
  if (err instanceof TypeError || code === 0) return 'Could not reach Potli. Check your connection and try again.';
  return 'We could not create your account. Please try again.';
}

export function validateRegistration(values: Record<string, string>, termsAccepted: boolean): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!isValidName(values.name ?? '')) errors.name = 'Enter your full name (2 to 80 characters).';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((values.email ?? '').trim())) errors.email = 'Enter a valid email address.';
  if (values.phone && !normalizePhone(values.phone)) errors.phone = 'Use an Indian mobile number, for example +91 98765 43210.';
  if ((values.password ?? '').length < PASSWORD_MIN) errors.password = `Use at least ${PASSWORD_MIN} characters.`;
  if (values.password !== values.confirm) errors.confirm = 'The two passwords do not match.';
  if (!termsAccepted) errors.terms = 'Please accept the terms to continue.';
  return errors;
}

function view() {
  return authLayout({
    backHref: '#/',
    backLabel: 'Back to home',
    eyebrow: 'Join Potli',
    title: 'Travel light, starting now.',
    text: 'Create a free traveller account to book safe luggage storage near you.',
    quote: "Travel is better when the bags aren't deciding the itinerary.",
    card: html`<h2>Create account</h2><p>It takes a minute.</p>
    <form id="register-form" novalidate>
      <label>Full name<input type="text" name="name" autocomplete="name" required /></label>
      <label>Email address<input type="email" name="email" autocomplete="email" required /></label>
      <label>Phone number (optional)<input type="tel" name="phone" placeholder="+91 98765 43210" autocomplete="tel" /></label>
      <label>Password<span class="password-field"><input type="password" name="password" autocomplete="new-password" minlength="8" required /><button type="button" class="show-password">Show</button></span><small class="field-hint" id="strength" aria-live="polite"></small></label>
      <label>Confirm password<input type="password" name="confirm" autocomplete="new-password" required /></label>
      <label class="checkbox terms"><input type="checkbox" name="terms" /> <span>I have read the <a href="#/privacy" target="_blank" rel="noopener">Privacy Policy</a> and agree to Potli's terms of use.</span></label>
      <button class="button login-submit" type="submit">Create account ${icon('arrow')}</button>
      <p class="field-hint">Verify your email within 15 days. Accounts that are not verified by then are deleted automatically.</p>
      <p class="form-message" role="status" aria-live="polite"></p>
    </form>
    <p class="admin-access-link">Already have an account? <a href="#/login">Log in</a></p>`,
  });
}

export const registerRoute: RouteDef = {
  path: '/register',
  title: 'Create account',
  guard: { guestOnly: true },
  mount(el) {
    mount(el, view());
    const form = el.querySelector<HTMLFormElement>('#register-form');
    if (!form) return;
    const password = form.querySelector<HTMLInputElement>('input[name="password"]');
    password?.addEventListener('input', () => {
      const hint = el.querySelector('#strength');
      if (hint) hint.textContent = password.value ? passwordStrength(password.value).label : '';
    });
    el.querySelector('.show-password')?.addEventListener('click', (event) => {
      if (!password) return;
      const show = password.type === 'password';
      password.type = show ? 'text' : 'password';
      (event.currentTarget as HTMLElement).textContent = show ? 'Hide' : 'Show';
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearFieldErrors(form);
      const values = readForm(form);
      const errors = validateRegistration(values, form.querySelector<HTMLInputElement>('input[name="terms"]')?.checked ?? false);
      if (Object.keys(errors).length > 0) {
        showFieldErrors(form, errors);
        setMessage(form, 'Please fix the highlighted fields.', 'error');
        return;
      }
      const submit = form.querySelector<HTMLButtonElement>('[type="submit"]');
      setBusy(submit, true, 'Creating account…');
      try {
        const email = (values.email ?? '').trim();
        await account.deleteSession({ sessionId: 'current' }).catch(() => undefined);
        await account.create({ userId: ID.unique(), email, password: values.password ?? '', name: (values.name ?? '').trim() });
        await account.createEmailPasswordSession({ email, password: values.password ?? '' });
        // A failed mail send must not strand the user; the verify page says so and offers a resend.
        let mailFailed = false;
        await account.createVerification({ url: `${window.location.origin}/?flow=verify` }).catch(() => {
          mailFailed = true;
        });
        resetApiToken();
        await refreshMe({ fresh: true });
        const phone = values.phone ? normalizePhone(values.phone) : null;
        if (phone) {
          await api('PATCH', '/me', { body: { phone }, auth: 'required' }).catch(() => undefined);
          await refreshMe();
        }
        window.location.hash = mailFailed ? '#/verify-email?sendFailed=1' : '#/verify-email';
      } catch (err) {
        setMessage(form, friendlySignUpError(err), 'error');
        setBusy(submit, false);
      }
    });
  },
};
