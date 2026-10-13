import './styles.css';
import './styles/tokens.css';
import './styles/portal.css';
import type { Me } from '../../shared/types';
import { account, appwriteConfigured, clearRecoveryLink, recoveryLink, verifyLink } from './appwrite';
import { escapeHtml, mount } from './lib/html';
import { focusHeading, leaveRoute, mountRoute, parseHash, sanitizeNext } from './lib/router';
import { getMe, homeFor, resetApiToken, setMe, signOut } from './lib/session';
import { forbiddenPage, notFoundPage } from './pages/status';
import { takeAdminIdleFlag } from './portals/admin/idle';
import { partnerSignUp } from './portals/partner/signup';
import { routes } from './routes';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
const API_V1 = `${API_BASE}/api/v1`;

interface SessionUser {
  id: string;
  email: string;
  full_name: string;
  role: Role;
}


type Role = 'traveler' | 'storage_partner' | 'admin';

interface CurrentUser {
  email: string;
  full_name: string;
  role: Role;
}

// Each role has its own sign-in page, and a page only accepts its own role.
const LOGIN_PAGE: Record<Role, string> = {
  traveler: 'traveller login',
  storage_partner: 'partner login',
  admin: 'admin login',
};

const ROLE_NOUN: Record<Role, string> = {
  traveler: 'Traveller',
  storage_partner: 'Storage partner',
  admin: 'Admin',
};


// Route-scoped notices survive unrelated renders.
let authNotice: { route: string; text: string } | null = null;

function noticeField(route: string): string {
  const notice = authNotice?.route === route ? authNotice.text : '';
  return `<p class="form-message" role="status">${escapeHtml(notice)}</p>`;
}

function showResetForm(): void {
  if (window.location.hash === '#reset-password') render();
  else window.location.hash = '#reset-password';
}

async function loadProfile(): Promise<CurrentUser | null> {
  let jwt: string;
  try {
    jwt = (await account.createJWT()).jwt;
  } catch {
    return null; // no session cookie: signed out
  }

  const res = await fetch(`${API_V1}/auth/me`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) {
    const failure = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    if (failure?.error?.code === 'ACCOUNT_DISABLED') throw new Error(failure.error.message ?? 'This account has been disabled.');
    setMe(null);
    return null;
  }
  const body = (await res.json()) as { user?: SessionUser };
  setMe((body.user as unknown as Me | undefined) ?? null);
  return body.user ?? null;
}

type IconName = 'arrow' | 'bag' | 'check' | 'clock' | 'location' | 'logo' | 'quote' | 'shield' | 'store';

const icons: Record<IconName, string> = {
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  bag: '<path d="M8 8V6a4 4 0 0 1 8 0v2M5 8h14l-1 12H6L5 8Z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  location: '<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  logo: '<path d="M9 6V4.8c0-1 .8-1.8 1.8-1.8h2.4c1 0 1.8.8 1.8 1.8V6M6.5 6h11A2.5 2.5 0 0 1 20 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5v-9A2.5 2.5 0 0 1 6.5 6Z"/><path d="M8 6v14M16 6v14M9.5 12.5l1.7 1.7 3.5-3.7"/>',
  quote: '<path d="M9.5 7.5H6.8A2.8 2.8 0 0 0 4 10.3V13h5.5v4.5H5.2M20 7.5h-2.7a2.8 2.8 0 0 0-2.8 2.8V13H20v4.5h-4.3"/>',
  shield: '<path d="M12 3 5 6v5c0 4.6 2.8 8.2 7 10 4.2-1.8 7-5.4 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
  store: '<path d="M4 10v10h16V10M3 10l2-6h14l2 6M8 20v-6h8v6"/><path d="M3 10c0 2 4 2 4 0 0 2 5 2 5 0 0 2 5 2 5 0 0 2 4 2 4 0"/>',
};

const icon = (name: IconName, className = '') =>
  `<svg class="${className}" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;

const team = [
  ['Satyam Tiwari', '1024030088'],
  ['Ishant Mehndiratta', '1024030525'],
  ['Anshaj', '1024030494'],
  ['Aayush Bindal', '1024030498'],
];

function header(): string {
  const me = getMe();
  const accountLink = me
    ? `${me.role === 'traveler' && !me.emailVerified ? '<a class="login-link" href="#/verify-email">Verify your email</a>' : ''}<a class="login-link" href="${homeFor(me)}">${escapeHtml(me.fullName.split(' ')[0] || 'Account')}</a><a class="button button-small" href="${homeFor(me)}">Go to dashboard</a>`
    : `<a class="earn-link" href="#partners">Earn with Potli</a>
      <a class="login-link" href="#/login">Log in</a>
      <a class="button button-small" href="#search">Find storage</a>`;
  return `<header class="site-header">
    <a class="brand" href="#home" aria-label="Potli home">
      <span class="brand-mark">${icon('logo')}</span><span>potli</span>
    </a>
    <nav class="header-actions" aria-label="Account and booking navigation">
      ${accountLink}
    </nav>
  </header>`;
}

function landingPage(): string {
  return `${header()}<main>
    <section class="hero" id="home">
      <div class="hero-copy">
        <p class="eyebrow"><span></span> Trusted storage, right around the corner</p>
        <h1>Leave the bags.<br><em>Keep the day.</em></h1>
        <p class="hero-text">Potli connects you with verified local shops and hotels, so your luggage stays safe while you explore the city freely.</p>
        <form class="search-box" id="search">
          <label><span>Where do you need storage?</span><span class="search-input">${icon('location')}<input type="text" placeholder="Railway station, landmark or city" aria-label="Storage location" /></span></label>
          <button class="button" type="submit">Search nearby ${icon('arrow')}</button>
        </form>
        <p class="search-note">${icon('check')} No booking fee &nbsp; ${icon('check')} Free cancellation</p>
      </div>
      <div class="hero-visual" aria-label="Traveller enjoying the city without carrying luggage">
        <div class="sun"></div><div class="arch arch-one"></div><div class="arch arch-two"></div>
        <div class="luggage"><span class="handle"></span><span class="case"></span><span class="tag">P</span></div>
        <div class="trust-card">${icon('shield')}<span><strong>Verified & secure</strong><small>Every partner is checked by us</small></span></div>
        <div class="city-card"><span>Storage from</span><strong>₹49<small>/ hour</small></strong></div>
      </div>
    </section>

    <section class="proof-strip" aria-label="Potli service highlights">
      <div><strong>20+</strong><span>partner locations</span></div><div><strong>₹49</strong><span>starting hourly rate</span></div><div><strong>100%</strong><span>verified partners</span></div><div><strong>Easy</strong><span>QR & OTP check-in</span></div>
    </section>

    <section class="section how" id="how-it-works">
      <div class="section-heading"><p class="eyebrow">Simple by design</p><h2>From bags to freedom<br>in three small steps.</h2><p>No queues, confusing counters, or long forms. Find a place, book it, and get on with your plans.</p></div>
      <div class="steps">
        <article><span class="step-number">01</span><span class="step-icon">${icon('location')}</span><h3>Find your spot</h3><p>Search near your station, hotel, or the neighbourhood you want to explore.</p></article>
        <article><span class="step-number">02</span><span class="step-icon">${icon('clock')}</span><h3>Book in a minute</h3><p>Pick your time and reserve online. Your QR code is ready instantly.</p></article>
        <article><span class="step-number">03</span><span class="step-icon">${icon('bag')}</span><h3>Drop & wander</h3><p>Show your code, leave your bags safely, and enjoy the lighter side of travel.</p></article>
      </div>
    </section>

    <section class="safety section" id="safety">
      <div class="safety-art"><div class="safe-door">${icon('shield')}<span>Checked in<br><strong>09:42 AM</strong></span></div><div class="safe-bag">${icon('bag')}</div></div>
      <div class="safety-copy"><p class="eyebrow">Peace of mind, packed in</p><h2>Your luggage is never just left behind.</h2><p>From verified businesses to photographed handoffs, every part of a Potli booking is designed to feel dependable.</p>
        <ul><li>${icon('check')}<span><strong>Partners we know</strong>Identity and business details are reviewed before a listing goes live.</span></li><li>${icon('check')}<span><strong>A clear handoff</strong>QR or OTP verification records every drop-off and pickup.</span></li><li>${icon('check')}<span><strong>Help when you need it</strong>Booking details and support stay close at hand throughout.</span></li></ul>
      </div>
    </section>

    <section class="partner section" id="partners">
      <div><p class="eyebrow">A little space goes a long way</p><h2>Have spare room?<br>Put it to good use.</h2><p>Join a growing network of local businesses helping travellers experience your city with ease—and earn from space you already have.</p><a class="text-link" href="#partner-signup">Become a Potli partner ${icon('arrow')}</a></div>
      <div class="partner-points"><p>${icon('store')}<span><strong>You stay in control</strong>Set your own hours, capacity, and availability.</span></p><p>${icon('clock')}<span><strong>Simple daily operations</strong>Manage bookings and handoffs from one place.</span></p><p>${icon('shield')}<span><strong>Built around trust</strong>Clear records protect you and every traveller.</span></p></div>
    </section>

    <section class="team section" id="team">
      <div class="section-heading"><p class="eyebrow">Made with care</p><h2>Developed by</h2><p>A student team from the Department of Computer Science and Engineering, Thapar Institute of Engineering and Technology.</p></div>
      <div class="team-grid">${team.map(([name, roll], index) => `<article><span>${String(index + 1).padStart(2, '0')}</span><h3>${name}</h3><p>Roll no. ${roll}</p></article>`).join('')}</div>
    </section>
  </main>${footer()}`;
}

function loginPage(kind: Role = 'traveler'): string {
  const isAdmin = kind === 'admin';
  if (isAdmin && takeAdminIdleFlag()) authNotice = { route: '#admin-login', text: 'You were signed out after 15 minutes of inactivity.' };
  return `<header class="login-header"><a class="brand" href="#home"><span class="brand-mark">${icon('logo')}</span><span>potli</span></a><a href="#home">Back to home</a></header>
  <main class="login-page"><section class="login-intro"><p class="eyebrow">${isAdmin ? 'Potli administration' : 'Welcome back'}</p><h1>${isAdmin ? 'Keep Potli running smoothly.' : 'Your plans are waiting.'}</h1><p>${isAdmin ? 'Secure access for authorised Potli administrators.' : 'Log in to view bookings, manage a storage location, or pick up where you left off.'}</p><div class="login-quote"><span class="quote-mark quote-open">${icon('quote')}</span><p>Travel is better when the bags aren't deciding the itinerary.</p><span class="quote-mark quote-close">${icon('quote')}</span></div></section>
  <section class="login-panel"><div class="login-card"><h2>${isAdmin ? 'Admin login' : 'Log in to Potli'}</h2><p>${isAdmin ? 'Enter your administrator credentials.' : 'Enter your details to continue.'}</p><form id="login-form" data-expected-role="${kind}"><label>Email address<input type="email" name="email" placeholder="${isAdmin ? 'admin@potli.com' : 'you@example.com'}" autocomplete="email" required /></label><label>Password<span class="password-field"><input type="password" name="password" placeholder="At least 8 characters" autocomplete="current-password" minlength="8" required /><button type="button" class="show-password">Show</button></span></label><div class="form-row form-row-end"><a href="#forgot-password?role=${kind}">Forgot password?</a></div><button class="button login-submit" type="submit">${isAdmin ? 'Continue securely' : 'Log in'} ${icon('arrow')}</button>${noticeField(isAdmin ? '#admin-login' : '#login')}</form>${isAdmin ? '<p class="field-hint">For security, admin sessions sign out after 15 minutes of inactivity.</p><p class="admin-access-link"><a href="#login">Return to traveller login</a></p>' : '<p class="signup-note">New to Potli? <a href="#/register">Create an account</a></p><p class="admin-access-link">Potli team member? <a href="#admin-login">Admin login</a></p>'}</div></section></main>`;
}

function forgotPasswordPage(role: Role): string {
  const loginHash = role === 'admin' ? '#admin-login' : role === 'storage_partner' ? '#partner-signup' : '#login';
  return `<header class="login-header"><a class="brand" href="#home"><span class="brand-mark">${icon('logo')}</span><span>potli</span></a><a href="${loginHash}">Back to login</a></header>
  <main class="login-page"><section class="login-intro"><p class="eyebrow">Account recovery</p><h1>Forgot your password?</h1><p>Give us the email on your Potli account and we will send a secure link to choose a new password.</p><div class="login-quote"><span class="quote-mark quote-open">${icon('quote')}</span><p>The bags are safe. Your password can be too.</p><span class="quote-mark quote-close">${icon('quote')}</span></div></section>
  <section class="login-panel"><div class="login-card"><h2>Reset password</h2><p>We will email you a link that expires shortly.</p><form id="forgot-form"><label>Email address<input type="email" name="email" placeholder="you@example.com" autocomplete="email" required /></label><button class="button login-submit" type="submit">Send reset link ${icon('arrow')}</button>${noticeField('#forgot-password')}</form><p class="admin-access-link"><a href="${loginHash}">Return to login</a></p></div></section></main>`;
}

function resetPasswordPage(): string {
  return `<header class="login-header"><a class="brand" href="#home"><span class="brand-mark">${icon('logo')}</span><span>potli</span></a><a href="#login">Back to login</a></header>
  <main class="login-page"><section class="login-intro"><p class="eyebrow">Account recovery</p><h1>Choose a new password.</h1><p>Pick something you have not used before, then log in again with it.</p></section>
  <section class="login-panel"><div class="login-card"><h2>New password</h2><p>Pick something you have not used before.</p><form id="reset-form"><label>New password<span class="password-field"><input type="password" name="password" placeholder="At least 8 characters" autocomplete="new-password" minlength="8" required /><button type="button" class="show-password">Show</button></span></label><label>Confirm new password<input type="password" name="confirm" placeholder="Repeat the password" autocomplete="new-password" minlength="8" required /></label><button class="button login-submit" type="submit">Save new password ${icon('arrow')}</button>${noticeField('#reset-password')}</form></div></section></main>`;
}

function partnerPage(): string {
  return `<header class="login-header"><a class="brand" href="#home"><span class="brand-mark">${icon('logo')}</span><span>potli</span></a><a href="#home">Back to home</a></header>
  <main class="partner-auth-page">
    <section class="partner-auth-intro">
      <p class="eyebrow">Earn with us</p>
      <h1>Turn spare space into steady income.</h1>
      <p>Join Potli as a trusted storage partner. Help travellers explore your neighbourhood freely while earning from space you already have.</p>
      <div class="partner-benefits">
        <p>${icon('clock')}<span><strong>Work on your schedule</strong>Choose your opening hours and daily capacity.</span></p>
        <p>${icon('store')}<span><strong>Simple to manage</strong>See bookings and verify every handoff in one place.</span></p>
        <p>${icon('shield')}<span><strong>Support at every step</strong>We help you get listed and stay ready for guests.</span></p>
      </div>
    </section>
    <section class="partner-auth-panel">
      <div class="partner-auth-card">
        <div class="auth-tabs" role="tablist" aria-label="Partner account">
          <button class="auth-tab active" type="button" data-auth-view="signup" role="tab" aria-selected="true">Create account</button>
          <button class="auth-tab" type="button" data-auth-view="login" role="tab" aria-selected="false">Partner login</button>
        </div>
        <div class="auth-heading"><p class="eyebrow">Potli for business</p><h2 class="partner-form-title">Become a partner</h2><p class="partner-form-copy">Tell us a little about you and your business.</p></div>
        <form id="partner-form" data-expected-role="storage_partner">
          <div class="signup-fields" data-signup-only>
            <label>Full name<input type="text" name="name" placeholder="Your full name" autocomplete="name" required /></label>
            <label>Business name<input type="text" name="business" placeholder="Shop, hotel or business name" autocomplete="organization" required /></label>
            <label>Business type<select name="businessType" required><option value="shop">Shop</option><option value="hotel">Hotel</option><option value="cafe">Cafe</option><option value="other">Other</option></select></label>
            <label>City<input type="text" name="city" placeholder="Patiala" autocomplete="address-level2" required /></label>
          </div>
          <label data-signup-only>Business address<input type="text" name="address" placeholder="Street, area" autocomplete="street-address" required /></label>
          <label>Email address<input type="email" name="email" placeholder="you@business.com" autocomplete="email" required /></label>
          <label data-signup-only>Phone number<input type="tel" name="phone" placeholder="+91 95803 80494" autocomplete="tel" required /></label>
          <label>Password<span class="password-field"><input type="password" name="password" placeholder="At least 8 characters" autocomplete="new-password" minlength="8" required /><button type="button" class="show-password">Show</button></span></label>
          <div class="form-row form-row-end is-hidden" data-login-only><a href="#forgot-password?role=storage_partner">Forgot password?</a></div>
          <label class="partner-terms" data-signup-only><input type="checkbox" required /><span>I agree to Potli's partner terms and verification process.</span></label>
          <button class="button partner-submit" type="submit">Start earning with Potli ${icon('arrow')}</button>
          ${noticeField('#partner-signup')}
        </form>
      </div>
    </section>
  </main>`;
}

function footer(): string {
  return `<footer><a class="brand brand-light" href="#home"><span class="brand-mark">${icon('logo')}</span><span>potli</span></a><p>Travel light. Explore freely.</p><div><a href="#safety">Safety</a><a href="#partners">Partners</a><a href="#team">Team</a></div><small>© ${new Date().getFullYear()} Potli. Student project.</small></footer>`;
}

function wireInteractions(): void {
  document.querySelector<HTMLFormElement>('.search-box')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = document.querySelector<HTMLInputElement>('.search-box input');
    const query = input?.value.trim() ?? '';
    if (!query) {
      input?.focus();
      return;
    }
    // Start of the booking-flow-time (BFT) measurement.
    try {
      sessionStorage.setItem('potli.searchStartedAt', new Date().toISOString());
    } catch {
      /* storage can be blocked; the measurement is optional */
    }
    window.location.hash = `#/search?q=${encodeURIComponent(query)}`;
  });
  const password = document.querySelector<HTMLInputElement>('input[name="password"]');
  document.querySelector<HTMLButtonElement>('.show-password')?.addEventListener('click', (event) => {
    if (!password) return;
    const show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    (event.currentTarget as HTMLButtonElement).textContent = show ? 'Hide' : 'Show';
  });
  document.querySelector<HTMLFormElement>('#login-form')?.addEventListener('submit', handleLogin);
  document.querySelector<HTMLFormElement>('#forgot-form')?.addEventListener('submit', handleForgotPassword);
  document.querySelector<HTMLFormElement>('#reset-form')?.addEventListener('submit', handleResetPassword);
  document.querySelector<HTMLFormElement>('#partner-form')?.addEventListener('submit', handlePartnerAuth);
  document.querySelectorAll<HTMLButtonElement>('.auth-tab').forEach((tab) => tab.addEventListener('click', () => {
    const isLogin = tab.dataset.authView === 'login';
    document.querySelectorAll<HTMLButtonElement>('.auth-tab').forEach((item) => {
      const active = item === tab;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', String(active));
    });
    // Hidden required inputs still block submission; relax them in login mode.

    document.querySelectorAll<HTMLElement>('[data-signup-only]').forEach((field) => {
      field.classList.toggle('is-hidden', isLogin);
      field.querySelectorAll<HTMLInputElement>('input').forEach((input) => { input.required = !isLogin; });
      if (field instanceof HTMLInputElement) field.required = !isLogin;
    });
    document.querySelectorAll<HTMLElement>('[data-login-only]').forEach((field) => field.classList.toggle('is-hidden', !isLogin));
    const title = document.querySelector<HTMLElement>('.partner-form-title');
    const copy = document.querySelector<HTMLElement>('.partner-form-copy');
    const submit = document.querySelector<HTMLButtonElement>('.partner-submit');
    if (title) title.textContent = isLogin ? 'Welcome back' : 'Become a partner';
    if (copy) copy.textContent = isLogin ? 'Log in to manage your location and bookings.' : 'Tell us a little about you and your business.';
    if (submit) submit.innerHTML = `${isLogin ? 'Log in to partner portal' : 'Start earning with Potli'} ${icon('arrow')}`;
  }));
}

function loginErrorMessage(err: unknown): string {
  const code = (err as { code?: number } | null)?.code;
  if (code === 429) return 'Too many attempts. Please wait a few minutes and try again.';
  if (code === 401 || code === 400) return 'Email or password is incorrect.';
  if (err instanceof TypeError || code === 0) return 'Could not reach Potli. Check your connection and try again.';
  return err instanceof Error && err.message ? err.message : 'Login failed. Please try again.';
}

async function handleLogin(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const message = form.querySelector<HTMLElement>('.form-message');
  const data = new FormData(form);
  const submit = form.querySelector<HTMLButtonElement>('[type="submit"]');
  const expected = (form.dataset.expectedRole ?? 'traveler') as Role;
  authNotice = null;
  if (message) message.textContent = 'Signing in...';
  if (submit) submit.disabled = true;
  try {
    // Discard stale sessions before checking the new account's role.
    await account.deleteSession({ sessionId: 'current' }).catch(() => undefined);
    await account.createEmailPasswordSession({
      email: String(data.get('email') ?? ''),
      password: String(data.get('password') ?? ''),
    });
    resetApiToken();

    const user = await loadProfile();
    if (!user) {
      await account.deleteSession({ sessionId: 'current' }).catch(() => undefined);
      throw new Error('Signed in, but we could not load your Potli account. Please try again.');
    }

    if (user.role !== expected) {
      await account.deleteSession({ sessionId: 'current' }).catch(() => undefined);
      const ownHash =
        expected === 'admin' ? '#admin-login' : expected === 'storage_partner' ? '#partner-signup' : '#login';
      authNotice = {
        route: ownHash,
        text: `${ROLE_NOUN[user.role]} accounts sign in through the ${LOGIN_PAGE[user.role]}.`,
      };
      if (window.location.hash === ownHash) render();
      else window.location.hash = ownHash;
      return;
    }

    const me = getMe();
    const next = sanitizeNext(parseHash(window.location.hash).query.get('next'));
    window.location.hash =
      me && !me.emailVerified && me.role !== 'admin' ? '#/verify-email' : (next ?? (me ? homeFor(me) : '#/'));
  } catch (err) {
    await account.deleteSession({ sessionId: 'current' }).catch(() => undefined);
    setMe(null);
    if (message) message.textContent = loginErrorMessage(err);
  } finally {
    if (submit) submit.disabled = false;
  }
}

async function handleForgotPassword(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const message = form.querySelector<HTMLElement>('.form-message');
  const submit = form.querySelector<HTMLButtonElement>('[type="submit"]');
  const email = String(new FormData(form).get('email') ?? '');
  authNotice = null;
  if (message) message.textContent = 'Sending...';
  if (submit) submit.disabled = true;
  try {
    await account.createRecovery({
      email,
      url: window.location.origin,
    });
    // Avoid revealing whether the address has an account.
    if (message) message.textContent = 'If that email has a Potli account, a reset link is on its way.';
  } catch (err) {
    // Only rate-limit and network problems are shown; anything else must not reveal whether the account exists.
    const code = (err as { code?: number } | null)?.code;
    if (!message) return;
    if (code === 429) message.textContent = 'Too many requests. Please wait a few minutes and try again.';
    else if (err instanceof TypeError || code === 0) message.textContent = 'Could not reach Potli. Check your connection and try again.';
    else message.textContent = 'If that email has a Potli account, a reset link is on its way.';
  } finally {
    if (submit) submit.disabled = false;
  }
}

async function handleResetPassword(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const message = form.querySelector<HTMLElement>('.form-message');
  const submit = form.querySelector<HTMLButtonElement>('[type="submit"]');
  const data = new FormData(form);
  const password = String(data.get('password') ?? '');
  const confirm = String(data.get('confirm') ?? '');
  authNotice = null;
  if (message) message.textContent = 'Saving...';
  if (submit) submit.disabled = true;
  try {
    if (password !== confirm) throw new Error('The two passwords do not match.');
    if (!recoveryLink) throw new Error('This reset link is missing its secret. Request a new one.');
    await account.updateRecovery({
      userId: recoveryLink.userId,
      secret: recoveryLink.secret,
      password,
    });
    clearRecoveryLink();
    authNotice = { route: '#login', text: 'Password updated. Log in with your new password.' };
    window.location.hash = '#login';
  } catch (err) {
    if (message) {
      message.textContent = err instanceof Error ? err.message : 'Could not update the password.';
      if (!form.querySelector('.new-link') && recoveryLink) {
        const link = document.createElement('a');
        link.className = 'new-link';
        link.href = '#forgot-password';
        link.textContent = 'Request a new link';
        message.insertAdjacentElement('afterend', link);
      }
    }
  } finally {
    if (submit) submit.disabled = false;
  }
}

function handlePartnerAuth(event: SubmitEvent): void {
  const form = event.currentTarget as HTMLFormElement;
  const isLogin = document.querySelector<HTMLButtonElement>('.auth-tab[data-auth-view="login"]')?.classList.contains('active');
  if (!isLogin) {
    event.preventDefault();
    void partnerSignUp(form);
    return;
  }
  void handleLogin(event);
}

// The contract's `#/…` URLs for the original pages map onto the existing page renderers.
const PAGE_ALIASES: Record<string, string> = {
  '#/': '',
  '#/login': '#login',
  '#/admin/login': '#admin-login',
  '#/partner': '#partner-signup',
  '#/forgot-password': '#forgot-password',
  '#/reset-password': '#reset-password',
};

function showStatusPage(app: HTMLElement, content: ReturnType<typeof notFoundPage>): void {
  mount(app, content);
  app.querySelector('[data-action="sign-out"]')?.addEventListener('click', () => void signOut());
  focusHeading(app);
}

function render(): void {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) throw new Error('App root not found');
  document.body.classList.remove('menu-is-open');
  leaveRoute();
  const fullHash = window.location.hash;
  const bare = fullHash.split('?')[0] ?? '';
  const query = parseHash(fullHash).query;

  if (bare === '#dashboard') {
    const me = getMe();
    window.location.hash = me ? homeFor(me) : '#login';
    return;
  }
  if (bare.startsWith('#/') && !(bare in PAGE_ALIASES)) {
    void mountRoute(app, routes, fullHash, getMe(), {
      forbidden: (me, roles) => showStatusPage(app, forbiddenPage(me, roles)),
      notFound: () => showStatusPage(app, notFoundPage()),
    }).then(() => focusHeading(app));
    return;
  }

  const hash = PAGE_ALIASES[bare] ?? bare;
  const me = getMe();
  if ((hash === '#login' || hash === '#admin-login') && me) {
    window.location.hash = sanitizeNext(query.get('next')) ?? homeFor(me);
    return;
  }
  const forgotRole = query.get('role');
  app.innerHTML = hash === '#login'
    ? loginPage()
    : hash === '#admin-login'
      ? loginPage('admin')
      : hash === '#partner-signup'
        ? partnerPage()
        : hash === '#forgot-password'
          ? forgotPasswordPage(forgotRole === 'admin' || forgotRole === 'storage_partner' ? forgotRole : 'traveler')
          : hash === '#reset-password'
            ? resetPasswordPage()
            : landingPage();
  wireInteractions();
  if (bare.startsWith('#/') || !bare) focusHeading(app);
}

async function init(): Promise<void> {
  if (!appwriteConfigured) {
    const app = document.querySelector<HTMLDivElement>('#app');
    if (app) {
      app.innerHTML = `<section class="login-panel"><div class="login-card"><h2>Appwrite is not configured</h2><p>Set VITE_APPWRITE_ENDPOINT and VITE_APPWRITE_PROJECT_ID in frontend/.env, then restart the dev server.</p></div></section>`;
    }
    return;
  }

  try {
    await loadProfile();
  } catch {
    // a disabled account or an unreachable API reads as signed out
  }
  if (verifyLink) {
    window.location.hash = '#/verify-email';
    render();
    return;
  }
  if (recoveryLink) {
    showResetForm();
    return;
  }
  render();
}

window.addEventListener('hashchange', render);
void init();
