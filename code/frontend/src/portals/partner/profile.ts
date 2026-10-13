/** Partner profile: business details, phone/address, password and sign-out everywhere. */
import { ApiRequestError } from '../../lib/api';
import { account } from '../../appwrite';
import { clearFieldErrors, readForm, setBusy, setMessage, showFieldErrors } from '../../lib/forms';
import { html } from '../../lib/html';
import type { RouteDef } from '../../lib/router';
import { api, refreshMe, signOut } from '../../lib/session';
import { errorText, showPartner } from './shell';

export const profileRoute: RouteDef = {
  path: '/partner/profile',
  title: 'Profile',
  guard: { roles: ['storage_partner'] },
  mount(el, ctx) {
    const me = ctx.me;
    const p = me?.partner;
    if (!me || !p) return;
    showPartner(
      el,
      me,
      '#/partner/profile',
      'Profile',
      html`<section class="card"><h2>${p.businessName}</h2><dl class="facts"><dt>Type</dt><dd>${p.businessType}</dd><dt>City</dt><dd>${p.city}</dd><dt>Email</dt><dd>${me.email}</dd></dl>
        <form class="partner-form" id="details" novalidate><label>Phone<input type="tel" name="phone" value="${p.phone}" required /></label><label>Address<input type="text" name="address" value="${p.address}" required /></label>
        <button class="button" type="submit">Save</button><p class="form-message" role="status"></p></form></section>
        <section class="card"><h2>Password</h2><form class="partner-form" id="password" novalidate><label>Current password<input type="password" name="old" autocomplete="current-password" required /></label>
        <label>New password<input type="password" name="next" autocomplete="new-password" minlength="8" required /></label><button class="button" type="submit">Change password</button><p class="form-message" role="status"></p></form></section>
        <section class="card"><h2>Sessions</h2><p>Sign out on every phone and browser where you are logged in.</p><button class="button button-secondary" type="button" id="all">Sign out of all devices</button></section>`,
    );
    const details = el.querySelector<HTMLFormElement>('#details');
    details?.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearFieldErrors(details);
      const submit = details.querySelector<HTMLButtonElement>('[type="submit"]');
      setBusy(submit, true);
      try {
        const { phone, address } = readForm(details);
        await api('PATCH', '/partner/me', { body: { phone, address }, auth: 'required' });
        await refreshMe({ fresh: true });
        setMessage(details, 'Saved.', 'success');
      } catch (err) {
        if (err instanceof ApiRequestError) showFieldErrors(details, err.fields);
        setMessage(details, errorText(err), 'error');
      }
      setBusy(submit, false);
    });
    const pw = el.querySelector<HTMLFormElement>('#password');
    pw?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const { old, next } = readForm(pw);
      const submit = pw.querySelector<HTMLButtonElement>('[type="submit"]');
      setBusy(submit, true);
      try {
        await account.updatePassword({ password: next ?? '', oldPassword: old ?? '' });
        pw.reset();
        setMessage(pw, 'Password changed.', 'success');
      } catch {
        setMessage(pw, 'Could not change the password. Check the current password and use at least 8 characters.', 'error');
      }
      setBusy(submit, false);
    });
    el.querySelector('#all')?.addEventListener('click', async () => {
      await account.deleteSessions().catch(() => undefined);
      await signOut();
    });
  },
};
