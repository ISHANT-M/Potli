/** Traveller profile: details, email verification, password and sessions. */
import { PASSWORD_MIN, isValidName, normalizePhone } from '../../../../shared/validation';
import { account } from '../../appwrite';
import { html, mount } from '../../lib/html';
import type { RouteDef } from '../../lib/router';
import { api, getMe, refreshMe, resetApiToken, signOut } from '../../lib/session';
import { portalPage, toast } from './common';

const say = (e: unknown, fallback: string): string => (e instanceof Error && e.message ? e.message : fallback);

export const profileRoute: RouteDef = {
  path: '/app/profile',
  title: 'Profile',
  guard: { roles: ['traveler'] },
  mount(el, ctx) {
    const me = getMe();
    if (!ctx.me || !me) return;
    const body = portalPage(el, me, '#/app/profile', 'Profile');
    mount(
      body,
      html`<div class="cx-profile">
      <section class="card"><h2>Your details</h2>
        <form id="details"><label>Full name<input name="name" value="${me.fullName}" autocomplete="name" required /></label>
          <label>Phone<input name="phone" type="tel" value="${me.phone}" autocomplete="tel" placeholder="+91 98765 43210" /></label>
          <button class="button" type="submit">Save</button> <span class="form-message" role="status"></span></form></section>
      <section class="card"><h2>Email</h2><p>${me.email} · ${me.emailVerified ? 'Verified' : 'Not verified'}</p>
        ${me.emailVerified ? '' : html`<button class="button button-secondary" type="button" id="resend">Resend verification email</button>`}</section>
      <section class="card"><h2>Change password</h2>
        <form id="password"><label>Current password<input type="password" name="old" autocomplete="current-password" required /></label>
          <label>New password<input type="password" name="next" autocomplete="new-password" minlength="${PASSWORD_MIN}" required /></label>
          <button class="button" type="submit">Change password</button> <span class="form-message" role="status"></span></form></section>
      <section class="card"><h2>Sessions</h2>
        <p><button class="button button-secondary" type="button" id="all">Sign out of all devices</button></p>
        <p><button class="button button-secondary" type="button" id="out">Sign out</button></p></section></div>`,
    );
    const note = (form: HTMLFormElement, text: string) => {
      const m = form.querySelector('.form-message');
      if (m) m.textContent = text;
    };

    const details = body.querySelector<HTMLFormElement>('#details')!;
    details.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(details);
      const fullName = String(data.get('name') ?? '').trim();
      const rawPhone = String(data.get('phone') ?? '').trim();
      const phone = rawPhone ? normalizePhone(rawPhone) : null;
      if (!isValidName(fullName)) return note(details, 'Enter your full name (2 to 80 characters).');
      if (rawPhone && !phone) return note(details, 'Use an Indian mobile number, for example +91 98765 43210.');
      try {
        await api('PATCH', '/me', { auth: 'required', body: { fullName, ...(phone ? { phone } : {}) } });
        await refreshMe({ fresh: true });
        note(details, 'Saved.');
      } catch (err) {
        note(details, say(err, 'Could not save.'));
      }
    });

    body.querySelector('#resend')?.addEventListener('click', async () => {
      try {
        await account.createVerification({ url: `${window.location.origin}/?flow=verify` });
        toast('Verification email sent.');
      } catch {
        toast("We couldn't send the email. Try again shortly.", 'error');
      }
    });

    const password = body.querySelector<HTMLFormElement>('#password')!;
    password.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(password);
      const next = String(data.get('next') ?? '');
      if (next.length < PASSWORD_MIN) return note(password, `Use at least ${PASSWORD_MIN} characters.`);
      try {
        await account.updatePassword({ password: next, oldPassword: String(data.get('old') ?? '') });
        password.reset();
        note(password, 'Password changed.');
      } catch (err) {
        note(password, say(err, 'Could not change your password. Check your current password.'));
      }
    });

    body.querySelector('#all')?.addEventListener('click', async () => {
      try {
        await account.deleteSessions();
        resetApiToken();
        await signOut();
      } catch (err) {
        toast(say(err, 'Could not sign out of all devices.'), 'error');
      }
    });
    body.querySelector('#out')?.addEventListener('click', () => void signOut());
  },
};
