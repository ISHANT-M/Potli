/** Admin chrome: shell, route wrapper (guard, idle sign-out) and the confirm dialog. */
import type { Me } from '../../../../shared/types';
import { ApiRequestError } from '../../lib/api';
import { html, mount, type SafeHtml } from '../../lib/html';
import { api } from '../../lib/session';
import type { RouteContext, RouteDef } from '../../lib/router';
import type { NavItem } from '../../ui/layout';
import { renderPortal } from '../../ui/layout';
import { startIdleWatch } from './idle';

export const ADMIN_NAV: NavItem[] = [
  { label: 'Overview', href: '#/admin', icon: 'dashboard' },
  { label: 'Partners', href: '#/admin/partners', icon: 'store' },
  { label: 'Listings', href: '#/admin/listings', icon: 'map' },
  { label: 'Bookings', href: '#/admin/bookings', icon: 'calendar' },
  { label: 'Users', href: '#/admin/users', icon: 'user' },
  { label: 'Ledger', href: '#/admin/ledger', icon: 'rupee' },
  { label: 'Disputes', href: '#/admin/disputes', icon: 'alert' },
  { label: 'Audit', href: '#/admin/audit', icon: 'list' },
];

export const errorText = (err: unknown): string => (err instanceof ApiRequestError || err instanceof Error ? err.message : 'Something went wrong.');

export function showAdmin(el: HTMLElement, me: Me, active: string, title: string, content: SafeHtml): void {
  renderPortal(el, { nav: ADMIN_NAV, active, title, me, roleLabel: 'Admin', content });
  void addBadges(el);
}

/** Pending-partner and open-dispute counts on the nav, refreshed at most every 5 seconds. */
let counts: { at: number; value: { pendingPartners: number; openDisputes: number } } | null = null;
async function addBadges(el: HTMLElement): Promise<void> {
  try {
    if (!counts || Date.now() - counts.at > 5_000) counts = { at: Date.now(), value: await api('GET', '/admin/counts', { auth: 'required' }) };
    const { pendingPartners, openDisputes } = counts.value;
    for (const [href, n] of [['#/admin/partners', pendingPartners], ['#/admin/disputes', openDisputes]] as const) {
      const link = el.querySelector(`.portal-nav a[href="${href}"]`);
      if (!link || n <= 0) continue;
      const tag = document.createElement('span');
      tag.className = 'nav-badge';
      tag.textContent = String(n);
      link.append(tag);
    }
  } catch {
    // counts are a convenience; the nav works without them
  }
}

type Mount = (el: HTMLElement, ctx: RouteContext & { me: Me }) => void | (() => void) | Promise<void | (() => void)>;

/** An admin-only route that signs out after 15 idle minutes. */
export function adminRoute(path: string, title: string, run: Mount): RouteDef {
  return {
    path,
    title,
    guard: { roles: ['admin'] },
    async mount(el, ctx) {
      if (!ctx.me) return;
      const stop = startIdleWatch();
      const out = await run(el, { ...ctx, me: ctx.me });
      return () => {
        stop();
        if (typeof out === 'function') out();
      };
    },
  };
}

export interface ConfirmOptions {
  title: string;
  text: string;
  confirmLabel: string;
  /** Ask for a reason of at least 10 characters. */
  reason?: boolean;
  danger?: boolean;
}

/** Resolves to the reason ('' when none was asked for), or null when cancelled. */
export function confirmDialog(options: ConfirmOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'confirm-dialog';
    mount(
      dialog,
      html`<form method="dialog"><h2>${options.title}</h2><p>${options.text}</p>
        ${options.reason ? html`<label>Reason<textarea name="reason" rows="3" maxlength="500" required></textarea></label><small class="field-error" id="reason-error" hidden>Give a reason of at least 10 characters.</small>` : ''}
        <div class="dialog-actions"><button class="button button-secondary" value="cancel" type="button" data-cancel>Cancel</button><button class="button ${options.danger ? 'button-danger' : ''}" type="submit">${options.confirmLabel}</button></div></form>`,
    );
    const form = dialog.querySelector('form');
    const finish = (value: string | null): void => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    dialog.querySelector('[data-cancel]')?.addEventListener('click', () => finish(null));
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(null);
    });
    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      const reason = (dialog.querySelector<HTMLTextAreaElement>('textarea')?.value ?? '').trim();
      if (options.reason && reason.length < 10) {
        dialog.querySelector<HTMLElement>('#reason-error')?.removeAttribute('hidden');
        return;
      }
      finish(reason);
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}
