/** Privacy Policy: a public, printable legal page that states what Potli stores, why, and for how long. */
import { html, mount, type SafeHtml } from '../lib/html';
import type { RouteDef } from '../lib/router';
import { icon } from '../ui/icons';
import '../styles/legal.css';

/** Where privacy requests and complaints are sent. Change it here and the whole page follows. */
export const PRIVACY_EMAIL = 'privacy@potli.dev';
const UPDATED = '27 October 2026';

interface Section {
  id: string;
  title: string;
  body: SafeHtml;
}

const mailLink = html`<a href="mailto:${PRIVACY_EMAIL}">${PRIVACY_EMAIL}</a>`;

const SECTIONS: Section[] = [
  {
    id: 'who',
    title: 'Who we are',
    body: html`<p>Potli (“<strong>Potli</strong>”, “<strong>we</strong>”, “<strong>us</strong>”) is a web platform that connects travellers who need short-term luggage storage with verified local businesses that have spare space. Potli is currently run as an academic project by students of the Department of Computer Science and Engineering, Thapar Institute of Engineering and Technology, Patiala, Punjab, India.</p>
    <p>For the purposes of the Digital Personal Data Protection Act, 2023 (the “<strong>DPDP Act</strong>”), Potli is the <strong>Data Fiduciary</strong> for the personal data described in this policy. You can reach us at ${mailLink}.</p>`,
  },
  {
    id: 'scope',
    title: 'Scope and acceptance',
    body: html`<p>This policy applies to everyone who uses the Potli website: travellers who search and book storage, storage partners who list space and handle luggage, and administrators who oversee the platform. By creating an account or using the service you confirm that you have read this policy. Where the law requires your consent, we ask for it at the point we collect the data, and you may withdraw it at any time as described in section 10.</p>`,
  },
  {
    id: 'collect',
    title: 'Information we collect',
    body: html`<p>We collect only what is needed to run the service.</p>
    <div class="legal-table-wrap"><table class="legal-table">
      <thead><tr><th>Category</th><th>What it includes</th><th>Where it comes from</th></tr></thead>
      <tbody>
        <tr><td>Account details</td><td>Full name, email address, optional phone number, email verification status, and your role (traveller, storage partner or administrator).</td><td>You, when you register or edit your profile.</td></tr>
        <tr><td>Password</td><td>We never see or store your password. It is held by our authentication service (Appwrite) as a salted, one-way hash.</td><td>You.</td></tr>
        <tr><td>Booking records</td><td>The storage location, number of bags, time slot, price, booking code, status history, any rating or comment you leave, and the text of any problem report you file.</td><td>You and the storage partner.</td></tr>
        <tr><td>Luggage photographs</td><td>One to four photographs of your luggage taken by the storage partner when your bags are handed over.</td><td>The storage partner.</td></tr>
        <tr><td>Partner business details</td><td>Business name and type, address, city, phone number, the map location of each listing, opening hours, capacity, rates, cash collected and platform fees owed.</td><td>The storage partner.</td></tr>
        <tr><td>Approximate location</td><td>If you tap “Use my location”, your browser shares your coordinates so we can sort places by distance. They are used for that search only and are not saved in our database.</td><td>Your device, with your permission.</td></tr>
        <tr><td>Search timing</td><td>The moment you start a search is kept with a resulting booking so we can measure how long booking takes.</td><td>Your browser.</td></tr>
        <tr><td>Security and technical data</td><td>IP address (held in rate-limiting counters and recorded with some audit entries, such as cancellations and problem reports), timestamps, the actions taken (for example handoff verification, approvals and cancellations), and failed-attempt counters. These are written to our audit and security logs.</td><td>Generated automatically.</td></tr>
      </tbody>
    </table></div>
    <p>We do not knowingly collect sensitive categories of data such as financial account numbers, government identity numbers or biometrics. Payment is made in cash directly to the storage partner, and Potli does not process card or UPI payments at this time.</p>`,
  },
  {
    id: 'use',
    title: 'How and why we use your information',
    body: html`<p>We use personal data to:</p>
    <ul>
      <li>create and secure your account, verify your email address and let you recover your password;</li>
      <li>show you available storage, take bookings and prevent a space being booked twice;</li>
      <li>verify the drop-off and pickup of luggage with one-time codes and, where needed, record its condition in photographs;</li>
      <li>calculate prices and the platform fee that storage partners owe, and keep accounting records;</li>
      <li>let administrators approve partners, resolve disputes and keep the platform safe;</li>
      <li>detect and prevent fraud, abuse and security incidents; and</li>
      <li>comply with the law and respond to lawful requests.</li>
    </ul>
    <p>We process personal data on the basis of your consent and for the “certain legitimate uses” recognised by the DPDP Act, such as providing the service you asked for, meeting legal obligations and protecting against misuse. We do not use your data for advertising, we do not sell it, and we do not make decisions about you by automated profiling.</p>`,
  },
  {
    id: 'share',
    title: 'Who we share it with',
    body: html`<p><strong>Other users, only as far as the booking needs.</strong> A storage partner sees the traveller’s name, phone number and booking details for bookings at their listings, but not the traveller’s email address. A traveller sees the partner’s business name, address and phone number for their own active bookings. Administrators can see account, booking and audit information to run the platform.</p>
    <p><strong>Service providers that process data for us.</strong></p>
    <ul>
      <li><strong>Appwrite</strong> (self-hosted by the Potli team): accounts, sessions and file storage, including luggage photographs.</li>
      <li><strong>Resend</strong>: delivers the emails Appwrite sends on our behalf, such as email verification and password reset. It receives your email address and the message.</li>
      <li><strong>Cloudflare</strong>: carries network traffic to our servers and may process IP addresses for that purpose.</li>
      <li><strong>OpenStreetMap</strong>: when you view a map, your browser requests map tiles directly from OpenStreetMap servers, which receive your IP address and the area you are viewing. If a partner searches for a place or selects a store pin, the browser sends that search or pin coordinates to OpenStreetMap’s Nominatim service to find an address. Map and address lookup requests do not set Potli cookies.</li>
    </ul>
    <p><strong>Legal and safety disclosures.</strong> We may disclose information if required by law, court order or a competent authority, or to protect the rights, safety and property of users and of Potli. We do not otherwise disclose your personal data to third parties.</p>`,
  },
  {
    id: 'cookies',
    title: 'Cookies and similar technologies',
    body: html`<p>Potli uses <strong>only strictly necessary</strong> storage, without which the site cannot work. We do not use analytics, advertising, social media or tracking cookies. Because everything we store is strictly necessary, we do not show a cookie consent banner.</p>
    <div class="legal-table-wrap"><table class="legal-table">
      <thead><tr><th>Name</th><th>Type</th><th>Purpose</th><th>Lifetime</th></tr></thead>
      <tbody>
        <tr><td><code>a_session_…</code></td><td>Cookie, set by our authentication service</td><td>Keeps you signed in.</td><td>Until you log out or the session expires.</td></tr>
        <tr><td><code>cookieFallback</code></td><td>Browser local storage, written by the sign-in library</td><td>Keeps you signed in when your browser blocks third-party cookies.</td><td>Until you log out or the session expires.</td></tr>
        <tr><td><code>potli.searchStartedAt</code></td><td>Session storage</td><td>Remembers when your search began so booking time can be measured.</td><td>Until you close the tab.</td></tr>
        <tr><td><code>potli.partnerApplyDraft</code></td><td>Session storage</td><td>Holds a partner application while you verify your email.</td><td>Until you close the tab or submit.</td></tr>
        <tr><td>Admin activity flag</td><td>Session storage</td><td>Shows a notice after an administrator is signed out for inactivity.</td><td>Until you close the tab.</td></tr>
      </tbody>
    </table></div>
    <p>You can delete or block cookies and site data in your browser settings, but you will then be signed out and will not be able to log in. If we ever add a cookie that is not strictly necessary, we will ask for your consent first and update this section.</p>`,
  },
  {
    id: 'retention',
    title: 'How long we keep your information',
    body: html`<p>We keep personal data only as long as it is needed for the purposes above. Some data is deleted automatically by a job that runs once every 24 hours.</p>
    <div class="legal-table-wrap"><table class="legal-table">
      <thead><tr><th>Data</th><th>Retention</th></tr></thead>
      <tbody>
        <tr><td>Luggage photographs</td><td><strong>Deleted automatically 48 hours</strong> after the booking is completed or cancelled. If a dispute about that booking is still open, the photographs are kept until it is resolved and are then deleted on the next daily run.</td></tr>
        <tr><td>Accounts that never verify their email</td><td><strong>Deleted automatically 15 days</strong> after sign-up, together with the details you entered. Verify your email to keep your account.</td></tr>
        <tr><td>Account and profile</td><td>For as long as your account exists. You can ask us to delete it (section 10).</td></tr>
        <tr><td>Booking, payment and fee records</td><td>For as long as needed to resolve disputes, keep accounting records of platform fees, and meet legal obligations.</td></tr>
        <tr><td>Audit and security logs</td><td>For as long as needed for security, accountability and the resolution of incidents.</td></tr>
      </tbody>
    </table></div>
    <p>Backups, if any, are overwritten in the normal course of operation. When we delete data we remove it from the live system; where the law requires us to retain a record, we keep only what is necessary.</p>`,
  },
  {
    id: 'security',
    title: 'How we protect your information',
    body: html`<p>We use reasonable security safeguards appropriate to the data we hold, including: hashing of passwords by the authentication service; encrypted connections between the website, our servers and our service providers; role-based access so that each person sees only what their role requires; private storage for photographs, served only to the traveller, the partner and the administrators involved in a booking; one-time handoff codes with attempt limits; rate limiting; and an audit trail of sensitive actions.</p>
    <p>No system is completely secure. If a personal data breach affects you, we will notify you and the Data Protection Board of India as required by law.</p>`,
  },
  {
    id: 'transfers',
    title: 'Where your data is processed',
    body: html`<p>Account, booking and photograph data is stored on servers operated by the Potli team. Email delivery through Resend, and traffic carried by Cloudflare, may involve processing outside India. We do not otherwise transfer personal data abroad, and we will do so only to countries or services permitted under the DPDP Act.</p>`,
  },
  {
    id: 'rights',
    title: 'Your rights and choices',
    body: html`<p>Under the DPDP Act you have the right to:</p>
    <ul>
      <li>obtain a summary of the personal data we process about you and how we use it;</li>
      <li>have inaccurate or incomplete data corrected, and have data that is no longer needed erased;</li>
      <li>withdraw your consent at any time (withdrawal does not affect processing done before it);</li>
      <li>have your grievances redressed; and</li>
      <li>nominate another person to exercise these rights on your behalf if you die or become unable to.</li>
    </ul>
    <p>You can correct your name and phone number yourself from your profile page. For anything else, including erasure of your account, write to ${mailLink} from the email address on your account. We may need to confirm your identity first, and we aim to respond within 30 days. We may keep data we are legally required to keep.</p>`,
  },
  {
    id: 'children',
    title: 'Children',
    body: html`<p>Potli is intended for people aged 18 and over. We do not knowingly collect personal data of children. If you believe a child has given us personal data, contact us at ${mailLink} and we will delete it.</p>`,
  },
  {
    id: 'grievance',
    title: 'Grievance redressal and contact',
    body: html`<p>If you have a question, concern or complaint about how your personal data is handled, contact the Potli Privacy Team at ${mailLink}. We will acknowledge your complaint and work to resolve it promptly. If you are not satisfied with our response, you may complain to the Data Protection Board of India once the law provides for it.</p>`,
  },
  {
    id: 'changes',
    title: 'Changes to this policy',
    body: html`<p>We may update this policy as the service changes or the law requires. The date at the top shows when it last changed. If a change is significant, we will tell you in the app or by email before it takes effect.</p>`,
  },
];

const toc = html`<nav class="legal-toc" aria-label="Contents"><h2>Contents</h2><ol>${SECTIONS.map((s) => html`<li><button type="button" data-target="legal-${s.id}">${s.title}</button></li>`)}</ol></nav>`;

export const privacyRoute: RouteDef = {
  path: '/privacy',
  title: 'Privacy Policy',
  mount(el) {
    mount(
      el,
      html`<header class="site-header"><a class="brand" href="#/" aria-label="Potli home"><span class="brand-mark">${icon('logo')}</span><span>potli</span></a>
        <nav class="header-actions" aria-label="Page"><a class="login-link" href="#/">Back to home</a></nav></header>
      <main class="legal">
        <div class="legal-head"><p class="eyebrow">Legal</p><h1>Privacy Policy</h1>
          <p class="legal-meta">Last updated ${UPDATED}</p>
          <p class="legal-lead">This policy explains what personal data Potli collects, why we collect it, who sees it, how long we keep it, and the choices you have. It is written to be read, so we have kept it plain.</p></div>
        <div class="legal-layout">${toc}
          <article class="legal-body">${SECTIONS.map((s, i) => html`<section id="legal-${s.id}"><h2><span>${String(i + 1)}.</span> ${s.title}</h2>${s.body}</section>`)}
            <p class="legal-end">Questions about this policy? Write to ${mailLink}.</p></article></div>
      </main>
      <footer class="legal-footer"><small>© ${String(new Date().getFullYear())} Potli. Student project, Thapar Institute of Engineering and Technology.</small></footer>`,
    );
    el.querySelectorAll<HTMLButtonElement>('.legal-toc button').forEach((button) =>
      button.addEventListener('click', () => document.getElementById(button.dataset.target ?? '')?.scrollIntoView({ behavior: 'smooth', block: 'start' })),
    );
    window.scrollTo(0, 0);
  },
};
