/** Page chrome: auth layout for new auth pages and the signed-in portal shell. */
import type { Me } from '../../../shared/types';
import { html, mount, type SafeHtml } from '../lib/html';
import { signOut } from '../lib/session';
import { icon, type IconName } from './icons';

export interface NavItem {
  label: string;
  href: string;
  icon: IconName;
}

const brand = html`<a class="brand" href="#/"><span class="brand-mark">${icon('logo')}</span><span>potli</span></a>`;

/** Split auth layout used by register and verify pages (same classes as the login page). */
export function authLayout(options: { backHref: string; backLabel: string; eyebrow: string; title: string; text: string; quote?: string; card: SafeHtml }): SafeHtml {
  return html`<header class="login-header">${brand}<a href="${options.backHref}">${options.backLabel}</a></header>
  <main class="login-page"><section class="login-intro"><p class="eyebrow">${options.eyebrow}</p><h1>${options.title}</h1><p>${options.text}</p>${options.quote ? html`<div class="login-quote"><span class="quote-mark quote-open">${icon('quote')}</span><p>${options.quote}</p><span class="quote-mark quote-close">${icon('quote')}</span></div>` : ''}</section>
  <section class="login-panel"><div class="login-card">${options.card}</div></section></main>`;
}

export function portalShell(options: { nav: NavItem[]; active: string; title: string; me: Me; content: SafeHtml; roleLabel: string }): SafeHtml {
  const firstName = options.me.fullName.split(' ')[0] || 'there';
  return html`<div class="portal">
    <header class="login-header portal-topbar">${brand}
      <div class="portal-user"><span class="portal-role">${options.roleLabel}</span><span class="portal-name">${firstName}</span>
        <button class="button button-secondary button-small" type="button" data-action="sign-out">${icon('logout')} Log out</button></div>
    </header>
    <div class="portal-body">
      <nav class="portal-nav" aria-label="${options.roleLabel} navigation">
        ${options.nav.map((item) => html`<a href="${item.href}" ${item.href === options.active ? html`aria-current="page"` : ''}>${icon(item.icon)}<span>${item.label}</span></a>`)}
      </nav>
      <main class="portal-main"><h1 class="portal-title">${options.title}</h1>${options.content}</main>
    </div>
  </div>`;
}

/** Render a portal screen into `el` and wire the shell's sign-out button. */
export function renderPortal(el: HTMLElement, options: Parameters<typeof portalShell>[0]): void {
  mount(el, portalShell(options));
  el.querySelector('[data-action="sign-out"]')?.addEventListener('click', () => void signOut());
}

/** The standalone message pages (forbidden, not found) use the plain login chrome. */
export function messagePage(title: string, text: string, actions: SafeHtml): SafeHtml {
  return html`<header class="login-header">${brand}<a href="#/">Back to home</a></header>
  <main class="message-page"><div class="message-card"><h1>${title}</h1><p>${text}</p><div class="message-actions">${actions}</div></div></main>`;
}
