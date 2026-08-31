import './styles.css';

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
  return `<header class="site-header">
    <a class="brand" href="#home" aria-label="Potli home">
      <span class="brand-mark">${icon('logo')}</span><span>potli</span>
    </a>
    <nav class="header-actions" aria-label="Account and booking navigation">
      <a class="earn-link" href="#partners">Earn with Potli</a>
      <a class="login-link" href="#login">Log in</a>
      <a class="button button-small" href="#search">Find storage</a>
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

function loginPage(): string {
  return `<header class="login-header"><a class="brand" href="#home"><span class="brand-mark">${icon('logo')}</span><span>potli</span></a><a href="#home">Back to home</a></header>
  <main class="login-page"><section class="login-intro"><p class="eyebrow">Welcome back</p><h1>Your plans are waiting.</h1><p>Log in to view bookings, manage a storage location, or pick up where you left off.</p><div class="login-quote"><span class="quote-mark quote-open">${icon('quote')}</span><p>Travel is better when the bags aren't deciding the itinerary.</p><span class="quote-mark quote-close">${icon('quote')}</span></div></section>
  <section class="login-panel"><div class="login-card"><h2>Log in to Potli</h2><p>Enter your details to continue.</p><form id="login-form"><label>Email address<input type="email" name="email" placeholder="you@example.com" autocomplete="email" required /></label><label>Password<span class="password-field"><input type="password" name="password" placeholder="At least 8 characters" autocomplete="current-password" minlength="8" required /><button type="button" class="show-password">Show</button></span></label><div class="form-row"><label class="checkbox"><input type="checkbox" /> Remember me</label><a href="#login">Forgot password?</a></div><button class="button login-submit" type="submit">Log in ${icon('arrow')}</button><p class="form-message" role="status"></p></form><p class="signup-note">New to Potli? <span>Traveller sign-up is coming soon.</span></p></div></section></main>`;
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
        <form id="partner-form">
          <div class="signup-fields">
            <label>Full name<input type="text" name="name" placeholder="Your full name" autocomplete="name" required /></label>
            <label>Business name<input type="text" name="business" placeholder="Shop, hotel or business name" autocomplete="organization" required /></label>
          </div>
          <label>Email address<input type="email" name="email" placeholder="you@business.com" autocomplete="email" required /></label>
          <label>Phone number<input type="tel" name="phone" placeholder="+91 98765 43210" autocomplete="tel" required /></label>
          <label>Password<span class="password-field"><input type="password" name="password" placeholder="At least 8 characters" autocomplete="new-password" minlength="8" required /><button type="button" class="show-password">Show</button></span></label>
          <label class="partner-terms"><input type="checkbox" required /><span>I agree to Potli's partner terms and verification process.</span></label>
          <button class="button partner-submit" type="submit">Start earning with Potli ${icon('arrow')}</button>
          <p class="form-message" role="status"></p>
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
    document.querySelector<HTMLInputElement>('.search-box input')?.focus();
  });
  const password = document.querySelector<HTMLInputElement>('input[name="password"]');
  document.querySelector<HTMLButtonElement>('.show-password')?.addEventListener('click', (event) => {
    if (!password) return;
    const show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    (event.currentTarget as HTMLButtonElement).textContent = show ? 'Hide' : 'Show';
  });
  document.querySelector<HTMLFormElement>('#login-form')?.addEventListener('submit', showBackendMessage);
  document.querySelector<HTMLFormElement>('#partner-form')?.addEventListener('submit', showBackendMessage);

  document.querySelectorAll<HTMLButtonElement>('.auth-tab').forEach((tab) => tab.addEventListener('click', () => {
    const isLogin = tab.dataset.authView === 'login';
    document.querySelectorAll<HTMLButtonElement>('.auth-tab').forEach((item) => {
      const active = item === tab;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', String(active));
    });
    document.querySelector<HTMLElement>('.signup-fields')?.classList.toggle('is-hidden', isLogin);
    document.querySelector<HTMLElement>('.partner-terms')?.classList.toggle('is-hidden', isLogin);
    document.querySelectorAll<HTMLInputElement>('.signup-fields input').forEach((input) => { input.required = !isLogin; });
    const title = document.querySelector<HTMLElement>('.partner-form-title');
    const copy = document.querySelector<HTMLElement>('.partner-form-copy');
    const submit = document.querySelector<HTMLButtonElement>('.partner-submit');
    if (title) title.textContent = isLogin ? 'Welcome back' : 'Become a partner';
    if (copy) copy.textContent = isLogin ? 'Log in to manage your location and bookings.' : 'Tell us a little about you and your business.';
    if (submit) submit.innerHTML = `${isLogin ? 'Log in to partner portal' : 'Start earning with Potli'} ${icon('arrow')}`;
  }));
}

function showBackendMessage(event: SubmitEvent): void {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const message = form.querySelector<HTMLElement>('.form-message');
  if (message) message.textContent = 'Authentication will be connected when the Supabase backend is ready.';
}

function render(): void {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) throw new Error('App root not found');
  document.body.classList.remove('menu-is-open');
  app.innerHTML = window.location.hash === '#login'
    ? loginPage()
    : window.location.hash === '#partner-signup'
      ? partnerPage()
      : landingPage();
  wireInteractions();
}

window.addEventListener('hashchange', render);
render();
