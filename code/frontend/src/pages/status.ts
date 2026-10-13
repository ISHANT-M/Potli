/** Forbidden and not-found pages. */
import type { Me, Role } from '../../../shared/types';
import { html, type SafeHtml } from '../lib/html';
import { homeFor } from '../lib/session';
import { messagePage } from '../ui/layout';

const AREA: Record<Role, string> = { traveler: 'traveller', storage_partner: 'storage partner', admin: 'admin' };

export function forbiddenPage(me: Me, roles: Role[]): SafeHtml {
  const area = roles.map((role) => AREA[role]).join(' or ');
  return messagePage(
    'This area is not for your account',
    `This area is for ${area} accounts. You are signed in as ${me.email}.`,
    html`<a class="button" href="${homeFor(me)}">Go to my dashboard</a><button class="button button-secondary" type="button" data-action="sign-out">Log out</button>`,
  );
}

export function notFoundPage(): SafeHtml {
  return messagePage('Page not found', 'That page does not exist or has moved.', html`<a class="button" href="#/">Back to home</a>`);
}
