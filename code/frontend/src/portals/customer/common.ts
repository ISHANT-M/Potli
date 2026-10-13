/** Shared helpers for the traveller screens: layouts, query state, toast, dialogs, small formatters. */
import type { Me } from '../../../../shared/types';
import { escapeHtml, html, mount, type SafeHtml } from '../../lib/html';
import { ApiRequestError } from '../../lib/api';
import { getMe, homeFor, signOut } from '../../lib/session';
import { formatClock } from '../../lib/format';
import { icon } from '../../ui/icons';
import { renderPortal, type NavItem } from '../../ui/layout';

export const NAV: NavItem[] = [
  { label: 'Home', href: '#/app', icon: 'home' },
  { label: 'Find storage', href: '#/search', icon: 'search' },
  { label: 'My bookings', href: '#/app/bookings', icon: 'calendar' },
  { label: 'Profile', href: '#/app/profile', icon: 'user' },
];

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const verifyLink = html`<a class="login-link" href="#/verify-email">Verify your email</a>`;

/** Public pages (search, listing): the site header and a main column. */
export function publicPage(el: HTMLElement, content: SafeHtml): HTMLElement {
  const me = getMe();
  const link = me
    ? html`<a class="button button-small" href="${homeFor(me)}">My account</a>`
    : html`<a class="login-link" href="#/login">Log in</a><a class="button button-small" href="#/register">Sign up</a>`;
  mount(
    el,
    html`<header class="site-header"><a class="brand" href="#/" aria-label="Potli home"><span class="brand-mark">${icon('logo')}</span><span>potli</span></a>
    <nav class="header-actions" aria-label="Account">${me && me.role === 'traveler' && !me.emailVerified ? verifyLink : ''}${link}</nav></header>
    <main class="cx-public">${content}</main>`,
  );
  return el.querySelector<HTMLElement>('.cx-public')!;
}

/** A screen inside the traveller portal shell; returns the container to fill. */
export function portalPage(el: HTMLElement, me: Me, active: string, title: string): HTMLElement {
  renderPortal(el, { nav: NAV, active, title, me, roleLabel: 'Traveller', content: html`<div class="cx-body" aria-live="polite"></div>` });
  return el.querySelector<HTMLElement>('.cx-body')!;
}

export const skeleton = (rows = 3): SafeHtml =>
  html`<div class="cx-skeletons" aria-busy="true" aria-label="Loading">${Array.from({ length: rows }, () => html`<div class="cx-skeleton"></div>`)}</div>`;

export const errorBox = (err: unknown): SafeHtml =>
  html`<div class="alert alert-danger" role="alert">${err instanceof ApiRequestError ? err.message : 'Something went wrong. Please try again.'}</div>`;

export function toast(text: string, tone: 'success' | 'error' = 'success'): void {
  const node = document.createElement('div');
  node.className = `cx-toast cx-toast-${tone}`;
  node.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  node.textContent = text;
  document.body.append(node);
  setTimeout(() => node.remove(), 5000);
}

/** Modal yes/no using the native dialog (focus trap and Escape come for free). */
export function confirmDialog(title: string, text: string, confirmLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'cx-dialog';
    dialog.innerHTML = html`<form method="dialog"><h2>${title}</h2><p>${text}</p>
      <div class="cx-actions"><button class="button button-secondary" value="no">Keep it</button><button class="button button-danger" value="yes">${confirmLabel}</button></div></form>`.value;
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'yes');
      dialog.remove();
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

export const stars = (average: number | null, count: number): SafeHtml =>
  average === null ? html`<span class="cx-muted">New</span>` : html`<span class="cx-rating" aria-label="${average} out of 5 from ${count} ratings">★ ${average.toFixed(1)} <span class="cx-muted">(${count})</span></span>`;

export const daysLabel = (days: number[]): string => {
  const sorted = [...days].sort();
  return sorted.length === 7 ? 'Every day' : sorted.map((d) => DAYS[d]).join(', ');
};

export const hoursLabel = (open: string, close: string): string => `${formatClock(open)} – ${formatClock(close)}`;

const IST_OFFSET_MS = 330 * 60_000;

/** `<input type=datetime-local>` value for a Date, shown in Asia/Kolkata. */
export function toLocalInput(date: Date): string {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 16);
}

/** Now rounded up to the next 30 minutes. */
export function nextHalfHour(from = new Date()): Date {
  const step = 30 * 60_000;
  return new Date(Math.ceil((from.getTime() + 1) / step) * step);
}

/** Four hours from the next half hour; late evenings and early mornings (before 7 am, after 8 pm IST) default to 10:00 the next daytime. */
export function defaultWindow(from = new Date()): { start: string; end: string } {
  let start = nextHalfHour(from);
  const ist = new Date(start.getTime() + IST_OFFSET_MS);
  const hour = ist.getUTCHours();
  if (hour >= 20 || hour < 7) {
    const day = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + (hour >= 20 ? 1 : 0), 10, 0);
    start = new Date(day - IST_OFFSET_MS);
  }
  return { start: start.toISOString(), end: new Date(start.getTime() + 4 * 3_600_000).toISOString() };
}

export const validDate = (value: string | null | undefined): string | null => {
  if (!value) return null;
  // A datetime-local value has no zone: read it as Asia/Kolkata.
  const local = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value);
  const parsed = new Date(local ? `${value.length === 16 ? `${value}:00` : value}+05:30` : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

export const clampBags = (value: string | number | null | undefined): number => Math.min(10, Math.max(1, Math.trunc(Number(value)) || 1));

export const qs = (params: Record<string, string | number | null | undefined>): string => {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== null && value !== undefined && value !== '') out.set(key, String(value));
  const text = out.toString();
  return text ? `?${text}` : '';
};

export const directionsUrl = (lat: number, lng: number): string => `https://www.openstreetmap.org/directions?to=${lat}%2C${lng}`;

/** Keeps the page's own cleanup list; the router calls the returned function when leaving. */
export function onLeave(): { add: (fn: () => void) => void; run: () => void } {
  const fns: (() => void)[] = [];
  return { add: (fn) => fns.push(fn), run: () => fns.splice(0).forEach((fn) => fn()) };
}

export { escapeHtml, signOut };
