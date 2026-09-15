import './styles.css';
import { arrivingFromRecoveryLink, linkError, supabase, supabaseConfigured } from './supabase';

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

// Session state is owned by Supabase Auth (persisted and refreshed by supabase-js).
let currentUser: CurrentUser | null = null;
// Set when the user asks for a reset link, so the emailed link lands on the
// password form instead of the dashboard.
const RECOVERY_FLAG = 'potli_recovery';

// While a page-level flow (sign-in, password reset) owns the UI, the auth-state
// listener stays out of the way: otherwise it would render the dashboard the
// moment credentials are accepted, before the role check has run.
let authTransition = false;
// One-shot notice for a specific page (role mix-ups, dead reset links). It is
// keyed by route and survives re-renders of that page, because the auth-state
// listener may render again right after a flow sets it; it is cleared when the
// visitor starts a new attempt.
let authNotice: { route: string; text: string } | null = null;

function noticeField(route: string): string {
  const notice = authNotice?.route === route ? authNotice.text : '';
  return `<p class="form-message" role="status">${notice}</p>`;
}

function markRecoveryPending(pending: boolean): void {
  if (pending) sessionStorage.setItem(RECOVERY_FLAG, '1');
  else sessionStorage.removeItem(RECOVERY_FLAG);
}

function recoveryPending(): boolean {
  return sessionStorage.getItem(RECOVERY_FLAG) === '1';
}

// A reset link signs the user in for one password change, so it goes to the
// password form rather than the dashboard.
function showResetForm(): void {
  markRecoveryPending(true);
  if (window.location.hash === '#reset-password') render();
  else window.location.hash = '#reset-password';
}

async function loadProfile(): Promise<CurrentUser | null> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) return null;

  const res = await fetch(`${API_V1}/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { user?: SessionUser };
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
  const accountLink = currentUser
    ? `<a class="login-link" href="#dashboard">${currentUser.full_name}</a><a class="button button-small" href="#dashboard">Dashboard</a>`
    : `<a class="earn-link" href="#partners">Earn with Potli</a>
      <a class="login-link" href="#login">Log in</a>
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
  return `<header class="login-header"><a class="brand" href="#home"><span class="brand-mark">${icon('logo')}</span><span>potli</span></a><a href="#home">Back to home</a></header>
  <main class="login-page"><section class="login-intro"><p class="eyebrow">${isAdmin ? 'Potli administration' : 'Welcome back'}</p><h1>${isAdmin ? 'Keep Potli running smoothly.' : 'Your plans are waiting.'}</h1><p>${isAdmin ? 'Secure access for authorised Potli administrators.' : 'Log in to view bookings, manage a storage location, or pick up where you left off.'}</p><div class="login-quote"><span class="quote-mark quote-open">${icon('quote')}</span><p>Travel is better when the bags aren't deciding the itinerary.</p><span class="quote-mark quote-close">${icon('quote')}</span></div></section>
  <section class="login-panel"><div class="login-card"><h2>${isAdmin ? 'Admin login' : 'Log in to Potli'}</h2><p>${isAdmin ? 'Enter your administrator credentials.' : 'Enter your details to continue.'}</p><form id="login-form" data-expected-role="${kind}"><label>Email address<input type="email" name="email" placeholder="${isAdmin ? 'admin@potli.com' : 'you@example.com'}" autocomplete="email" required /></label><label>Password<span class="password-field"><input type="password" name="password" placeholder="At least 8 characters" autocomplete="current-password" minlength="8" required /><button type="button" class="show-password">Show</button></span></label><div class="form-row"><label class="checkbox"><input type="checkbox" /> Remember me</label><a href="#forgot-password">Forgot password?</a></div><button class="button login-submit" type="submit">${isAdmin ? 'Continue securely' : 'Log in'} ${icon('arrow')}</button>${noticeField(isAdmin ? '#admin-login' : '#login')}</form>${isAdmin ? '<p class="admin-access-link"><a href="#login">Return to traveller login</a></p>' : '<p class="signup-note">New to Potli? <span>Traveller sign-up is coming soon.</span></p><p class="admin-access-link">Potli team member? <a href="#admin-login">Admin login</a></p>'}</div></section></main>`;
}

function forgotPasswordPage(): string {
  return `<header class="login-header"><a class="brand" href="#home"><span class="brand-mark">${icon('logo')}</span><span>potli</span></a><a href="#login">Back to login</a></header>
  <main class="login-page"><section class="login-intro"><p class="eyebrow">Account recovery</p><h1>Forgot your password?</h1><p>Give us the email on your Potli account and we will send a secure link to choose a new password.</p><div class="login-quote"><span class="quote-mark quote-open">${icon('quote')}</span><p>The bags are safe. Your password can be too.</p><span class="quote-mark quote-close">${icon('quote')}</span></div></section>
  <section class="login-panel"><div class="login-card"><h2>Reset password</h2><p>We will email you a link that expires shortly.</p><form id="forgot-form"><label>Email address<input type="email" name="email" placeholder="you@example.com" autocomplete="email" required /></label><button class="button login-submit" type="submit">Send reset link ${icon('arrow')}</button>${noticeField('#forgot-password')}</form><p class="admin-access-link"><a href="#login">Return to traveller login</a></p></div></section></main>`;
}

function resetPasswordPage(): string {
  return `<header class="login-header"><a class="brand" href="#home"><span class="brand-mark">${icon('logo')}</span><span>potli</span></a><a href="#login">Back to login</a></header>
  <main class="login-page"><section class="login-intro"><p class="eyebrow">Account recovery</p><h1>Choose a new password.</h1><p>Pick something you have not used before, then log in again with it.</p></section>
  <section class="login-panel"><div class="login-card"><h2>New password</h2><p>Your reset link signed you in for this one change.</p><form id="reset-form"><label>New password<span class="password-field"><input type="password" name="password" placeholder="At least 8 characters" autocomplete="new-password" minlength="8" required /><button type="button" class="show-password">Show</button></span></label><label>Confirm new password<input type="password" name="confirm" placeholder="Repeat the password" autocomplete="new-password" minlength="8" required /></label><button class="button login-submit" type="submit">Save new password ${icon('arrow')}</button><p class="form-message" role="status"></p></form></div></section></main>`;
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
          </div>
          <label>Email address<input type="email" name="email" placeholder="you@business.com" autocomplete="email" required /></label>
          <label data-signup-only>Phone number<input type="tel" name="phone" placeholder="+91 95803 80494" autocomplete="tel" required /></label>
          <label>Password<span class="password-field"><input type="password" name="password" placeholder="At least 8 characters" autocomplete="new-password" minlength="8" required /><button type="button" class="show-password">Show</button></span></label>
          <label class="partner-terms" data-signup-only><input type="checkbox" required /><span>I agree to Potli's partner terms and verification process.</span></label>
          <button class="button partner-submit" type="submit">Start earning with Potli ${icon('arrow')}</button>
          ${noticeField('#partner-signup')}
        </form>
      </div>
    </section>
  </main>`;
}

function dashboardPage(user: CurrentUser): string {
  const roleCopy: Record<CurrentUser['role'], { eyebrow: string; text: string }> = {
    traveler: {
      eyebrow: 'Traveller dashboard',
      text: 'Search nearby storage, track bookings, and check in with QR or OTP.',
    },
    storage_partner: {
      eyebrow: 'Partner dashboard',
      text: 'Manage availability, confirm drop-offs and pickups, and track earnings.',
    },
    admin: {
      eyebrow: 'Admin dashboard',
      text: 'Verify partners, monitor bookings, and handle disputes.',
    },
  };
  const copy = roleCopy[user.role];
  return `<header class="login-header"><a class="brand" href="#home"><span class="brand-mark">${icon('logo')}</span><span>potli</span></a><button class="button button-small" id="logout-button" type="button">Log out</button></header>
  <main class="login-page"><section class="login-intro"><p class="eyebrow">${copy.eyebrow}</p><h1>Namaste, ${user.full_name}.</h1><p>${copy.text}</p></section>
  <section class="login-panel"><div class="login-card"><h2>Role: ${user.role}</h2><p>${user.email}</p></div></section></main>`;
}

function footer(): string {
  return `<footer><a class="brand brand-light" href="#home"><span class="brand-mark">${icon('logo')}</span><span>potli</span></a><p>Travel light. Explore freely.</p><div><a href="#safety">Safety</a><a href="#partners">Partners</a><a href="#team">Team</a></div><small>© ${new Date().getFullYear()} Potli. Student project.</small></footer>`;
}

function wireInteractions(): void {
  document.querySelector<HTMLFormElement>('.search-box')?.addEventListener('submit', (event) => {
    event.preventDefault();
    document.querySelector<HTMLInputElement>('.search-box input')?.focus();
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
  document.querySelector<HTMLButtonElement>('#logout-button')?.addEventListener('click', () => {
    void supabase.auth.signOut().then(() => {
      currentUser = null;
      window.location.hash = '#home';
    });
  });

  document.querySelectorAll<HTMLButtonElement>('.auth-tab').forEach((tab) => tab.addEventListener('click', () => {
    const isLogin = tab.dataset.authView === 'login';
    document.querySelectorAll<HTMLButtonElement>('.auth-tab').forEach((item) => {
      const active = item === tab;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', String(active));
    });
    // Signup-only fields (name, business, phone, terms) are hidden AND relaxed in
    // login mode, otherwise the browser blocks the submit on hidden required
    // inputs and partner login silently does nothing.
    document.querySelectorAll<HTMLElement>('[data-signup-only]').forEach((field) => {
      field.classList.toggle('is-hidden', isLogin);
      field.querySelectorAll<HTMLInputElement>('input').forEach((input) => { input.required = !isLogin; });
      if (field instanceof HTMLInputElement) field.required = !isLogin;
    });
    const title = document.querySelector<HTMLElement>('.partner-form-title');
    const copy = document.querySelector<HTMLElement>('.partner-form-copy');
    const submit = document.querySelector<HTMLButtonElement>('.partner-submit');
    if (title) title.textContent = isLogin ? 'Welcome back' : 'Become a partner';
    if (copy) copy.textContent = isLogin ? 'Log in to manage your location and bookings.' : 'Tell us a little about you and your business.';
    if (submit) submit.innerHTML = `${isLogin ? 'Log in to partner portal' : 'Start earning with Potli'} ${icon('arrow')}`;
  }));
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
  authTransition = true;
  try {
    const { error } = await supabase.auth.signInWithPassword({
      email: String(data.get('email') ?? ''),
      password: String(data.get('password') ?? ''),
    });
    if (error) throw new Error(error.message);

    const user = await loadProfile();
    if (!user) {
      await supabase.auth.signOut();
      throw new Error('Signed in, but no Potli profile was found for this account.');
    }

    // Each sign-in page accepts only its own role, so an admin cannot walk in
    // through the traveller login, and a traveller cannot use the admin login.
    if (user.role !== expected) {
      await supabase.auth.signOut();
      currentUser = null;
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

    currentUser = user;
    markRecoveryPending(false);
    window.location.hash = '#dashboard';
  } catch (err) {
    if (message) message.textContent = err instanceof Error ? err.message : 'Login failed.';
  } finally {
    authTransition = false;
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
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/`,
    });
    if (error) throw new Error(error.message);
    markRecoveryPending(true);
    // Same wording either way: a different message for unknown emails would let
    // anyone probe which addresses have Potli accounts.
    if (message) message.textContent = 'If that email has a Potli account, a reset link is on its way.';
  } catch (err) {
    if (message) message.textContent = err instanceof Error ? err.message : 'Could not send the reset link.';
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
  authTransition = true;
  try {
    if (password !== confirm) throw new Error('The two passwords do not match.');
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new Error(error.message);
    markRecoveryPending(false);
    currentUser = await loadProfile();
    if (message) message.textContent = 'Password updated. Taking you to your dashboard...';
    window.location.hash = '#dashboard';
  } catch (err) {
    if (message) message.textContent = err instanceof Error ? err.message : 'Could not update the password.';
  } finally {
    authTransition = false;
    if (submit) submit.disabled = false;
  }
}

function handlePartnerAuth(event: SubmitEvent): void {
  const form = event.currentTarget as HTMLFormElement;
  const isLogin = document.querySelector<HTMLButtonElement>('.auth-tab[data-auth-view="login"]')?.classList.contains('active');
  if (!isLogin) {
    event.preventDefault();
    const message = form.querySelector<HTMLElement>('.form-message');
    if (message) message.textContent = 'Partner sign-up is coming soon.';
    return;
  }
  void handleLogin(event);
}

function render(): void {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) throw new Error('App root not found');
  document.body.classList.remove('menu-is-open');
  const hash = window.location.hash;
  if (hash === '#dashboard') {
    app.innerHTML = currentUser ? dashboardPage(currentUser) : loginPage();
    wireInteractions();
    return;
  }
  if ((hash === '#login' || hash === '#admin-login') && currentUser) {
    window.location.hash = '#dashboard';
    return;
  }
  app.innerHTML = hash === '#login'
    ? loginPage()
    : hash === '#admin-login'
      ? loginPage('admin')
      : hash === '#partner-signup'
        ? partnerPage()
        : hash === '#forgot-password'
          ? forgotPasswordPage()
          : hash === '#reset-password'
            ? resetPasswordPage()
            : landingPage();
  wireInteractions();
}

async function init(): Promise<void> {
  if (!supabaseConfigured) {
    const app = document.querySelector<HTMLDivElement>('#app');
    if (app) {
      app.innerHTML = `<section class="login-panel"><div class="login-card"><h2>Supabase is not configured</h2><p>Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in frontend/.env, then restart the dev server.</p></div></section>`;
    }
    return;
  }

  currentUser = await loadProfile();
  if (linkError) {
    // Used or expired reset link: explain it on the request form rather than
    // dropping the visitor on the marketing page.
    authNotice = { route: '#forgot-password', text: 'That reset link is invalid or has expired. Request a new one below.' };
    if (window.location.hash === '#forgot-password') render();
    else window.location.hash = '#forgot-password';
  } else if (currentUser && (arrivingFromRecoveryLink || recoveryPending())) {
    showResetForm();
  } else {
    render();
  }

  // Mirrors sign-in/sign-out/token-refresh events from Supabase Auth.
  supabase.auth.onAuthStateChange((event, session) => {
    // A page-level flow is driving the UI; it renders when it is done.
    if (authTransition) return;
    void (async () => {
      currentUser = session ? await loadProfile() : null;
      if (currentUser && (event === 'PASSWORD_RECOVERY' || arrivingFromRecoveryLink || recoveryPending())) {
        showResetForm();
        return;
      }
      render();
    })();
  });
}

window.addEventListener('hashchange', render);
void init();
