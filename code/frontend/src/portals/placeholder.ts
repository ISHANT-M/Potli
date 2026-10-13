/** Placeholder portal screens so guards and the shell work before the portal agents build the real ones. */
import type { Role } from '../../../shared/types';
import { html } from '../lib/html';
import type { Guard, RouteDef } from '../lib/router';
import { partnerStatusBadge } from '../ui/components';
import type { NavItem } from '../ui/layout';
import { renderPortal } from '../ui/layout';

export interface PortalSpec {
  roleLabel: string;
  role: Role;
  nav: NavItem[];
  guard: Guard;
}

/** A route inside the portal shell; `home` shows a welcome, others a "coming next" note. */
export function placeholderRoute(spec: PortalSpec, path: string, title: string, home = false, guard: Guard = spec.guard): RouteDef {
  return {
    path,
    title,
    guard,
    mount(el, ctx) {
      const me = ctx.me;
      if (!me) return;
      const status = me.partner ? html`<p>Application status: ${partnerStatusBadge(me.partner.status)}</p>` : '';
      renderPortal(el, {
        nav: spec.nav,
        active: `#${path}`,
        title,
        me,
        roleLabel: spec.roleLabel,
        content: html`<section class="card"><h2>${home ? `Namaste, ${me.fullName}.` : 'Coming next'}</h2><p>${home ? 'Your workspace is ready. The tools for this area are being built.' : 'This screen is being built.'}</p>${status}</section>`,
      });
    },
  };
}
