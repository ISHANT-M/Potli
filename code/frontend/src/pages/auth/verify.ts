/** "Check your inbox" page: resend with a cooldown, and the return-from-email handler. */
import { account, clearVerifyLink, verifyLink } from '../../appwrite';
import { setBusy } from '../../lib/forms';
import { html, mount, type SafeHtml } from '../../lib/html';
import { sanitizeNext, type RouteDef } from '../../lib/router';
import { getMe, homeFor, refreshMe, resetApiToken, signOut } from '../../lib/session';
import { authLayout } from '../../ui/layout';
import { icon } from '../../ui/icons';

const COOLDOWN_SECONDS = 60;

const layout = (title: string, card: SafeHtml) =>
  authLayout({
    backHref: '#/',
    backLabel: 'Back to home',
    eyebrow: 'Verify your email',
    title,
    text: 'Verifying your email keeps your bookings and your bags safe.',
    card,
  });

export const verifyRoute: RouteDef = {
  path: '/verify-email',
  title: 'Verify your email',
  async mount(el, ctx) {
    const next = sanitizeNext(ctx.query.get('next'));

    if (verifyLink) {
      const { userId, secret } = verifyLink;
      try {
        await account.updateVerification({ userId, secret });
        clearVerifyLink();
        resetApiToken();
        const me = await refreshMe({ fresh: true }).catch(() => null);
        const target = me ? (next ?? homeFor(me)) : '#/login';
        mount(el, layout('Email verified.', html`<h2>You're all set</h2><p>Your email address is confirmed.</p><a class="button login-submit" href="${target}">${me ? 'Continue' : 'Log in'} ${icon('arrow')}</a>`));
      } catch {
        clearVerifyLink();
        mount(el, layout('That link did not work.', html`<h2>Link expired or already used</h2><p>Log in and ask for a fresh verification email.</p><a class="button login-submit" href="#/login">Log in</a>`));
      }
      return;
    }

    const me = getMe();
    if (!me) {
      window.location.hash = '#/login?next=%23%2Fverify-email';
      return;
    }
    if (me.emailVerified) {
      window.location.hash = next ?? homeFor(me);
      return;
    }

    mount(el, layout('Check your inbox.', html`<h2>Verify your email</h2><p>We sent a link to <strong>${me.email}</strong>. Open it to finish. If the email isn't verified within 15 days, the account is deleted automatically.</p>
      <button class="button login-submit" type="button" id="resend">Resend email</button>
      <p class="form-message" role="status" aria-live="polite"></p>
      <p class="admin-access-link">Wrong address? <a href="#/register" id="change-email">Sign out and register again</a></p>`));

    const resend = el.querySelector<HTMLButtonElement>('#resend');
    const message = el.querySelector<HTMLElement>('.form-message');
    const sendFailed = ctx.query.get('sendFailed') === '1';
    if (sendFailed && message) message.textContent = "We couldn't send the email. Use Resend.";
    let timer: number | undefined;
    const startCooldown = () => {
      let left = COOLDOWN_SECONDS;
      if (resend) resend.disabled = true;
      timer = window.setInterval(() => {
        left -= 1;
        if (resend) resend.textContent = left > 0 ? `Resend in ${left}s` : 'Resend email';
        if (left <= 0) {
          window.clearInterval(timer);
          if (resend) resend.disabled = false;
        }
      }, 1000);
    };
    if (!sendFailed) startCooldown();
    resend?.addEventListener('click', async () => {
      setBusy(resend, true, 'Sending…');
      try {
        await account.createVerification({ url: `${window.location.origin}/?flow=verify` });
        if (message) message.textContent = 'Sent. It can take a minute to arrive; check spam too.';
      } catch {
        if (message) message.textContent = 'We could not send the email right now. Please try again shortly.';
      }
      setBusy(resend, false);
      startCooldown();
    });
    el.querySelector('#change-email')?.addEventListener('click', (event) => {
      event.preventDefault();
      void signOut().then(() => {
        window.location.hash = '#/register';
      });
    });
    return () => window.clearInterval(timer);
  },
};
