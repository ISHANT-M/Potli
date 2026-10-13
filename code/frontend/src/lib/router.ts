/** Hash router for `#/…` routes: params, guards, ?next= handling and per-route cleanup. */
import type { Me, PartnerStatus, Role } from '../../../shared/types';
import { homeFor } from './session';

export interface Guard {
  /** Signed-in roles allowed; a signed-out visitor is sent to the matching login. */
  roles?: Role[];
  /** Only signed-out visitors (login, register). */
  guestOnly?: boolean;
  /** Partner pages that need one of these statuses; others go to the application page. */
  partnerStatus?: PartnerStatus[];
  /** Require a verified email; others go to the verify page. */
  verified?: boolean;
}

export interface RouteContext {
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  me: Me | null;
}

export interface RouteDef {
  path: string;
  title?: string;
  guard?: Guard;
  /** Render into `el`; the returned function (optional) runs when leaving the route. */
  mount: (el: HTMLElement, ctx: RouteContext) => void | (() => void) | Promise<void | (() => void)>;
}

export interface ParsedHash {
  path: string;
  query: URLSearchParams;
}

export function parseHash(hash: string): ParsedHash {
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  const [path = '/', search = ''] = body.split('?');
  return { path: path || '/', query: new URLSearchParams(search) };
}

/** A `next` target is only honoured when it is an in-app route: `#/…`, never `#//` or a URL. */
export function sanitizeNext(next: string | null | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith('#/') || next.startsWith('#//')) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f]/.test(next) || /^#\/+[a-z][a-z0-9+.-]*:/i.test(next)) return null;
  return next;
}

export function compilePattern(pattern: string): { regex: RegExp; names: string[] } {
  const names: string[] = [];
  const source = pattern
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) {
        names.push(segment.slice(1));
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp(`^${source}/?$`), names };
}

export function matchRoute(routes: RouteDef[], path: string): { route: RouteDef; params: Record<string, string> } | null {
  for (const route of routes) {
    const { regex, names } = compilePattern(route.path);
    const match = regex.exec(path);
    if (!match) continue;
    const params: Record<string, string> = {};
    names.forEach((name, index) => {
      params[name] = decodeURIComponent(match[index + 1] ?? '');
    });
    return { route, params };
  }
  return null;
}

export function loginRouteFor(role: Role | undefined): string {
  if (role === 'admin') return '#/admin/login';
  if (role === 'storage_partner') return '#/partner';
  return '#/login';
}

export type GuardResult = { type: 'ok' } | { type: 'redirect'; to: string } | { type: 'forbidden' };

/** Pure guard evaluation so it can be tested without a DOM. */
export function evaluateGuard(guard: Guard | undefined, me: Me | null, currentHash: string): GuardResult {
  if (!guard) return { type: 'ok' };
  const withNext = (to: string) => {
    const join = to.includes('?') ? '&' : '?';
    return `${to}${join}next=${encodeURIComponent(currentHash)}`;
  };

  if (guard.guestOnly) {
    if (!me) return { type: 'ok' };
    return { type: 'redirect', to: sanitizeNext(new URLSearchParams(currentHash.split('?')[1] ?? '').get('next')) ?? homeFor(me) };
  }
  if (guard.roles) {
    if (!me) return { type: 'redirect', to: withNext(loginRouteFor(guard.roles[0])) };
    if (!guard.roles.includes(me.role)) return { type: 'forbidden' };
    if (guard.verified && !me.emailVerified) return { type: 'redirect', to: withNext('#/verify-email') };
    if (guard.partnerStatus && !guard.partnerStatus.includes(me.partner?.status ?? 'pending')) {
      return currentHash.startsWith('#/partner/application') ? { type: 'ok' } : { type: 'redirect', to: '#/partner/application' };
    }
  }
  return { type: 'ok' };
}

let cleanup: (() => void) | null = null;

/** Run the previous route's cleanup (call before any re-render, including non-router pages). */
export function leaveRoute(): void {
  cleanup?.();
  cleanup = null;
}

export async function mountRoute(
  el: HTMLElement,
  routes: RouteDef[],
  hash: string,
  me: Me | null,
  fallback: { forbidden: (me: Me, roles: Role[]) => void; notFound: () => void },
): Promise<void> {
  leaveRoute();
  const { path, query } = parseHash(hash);
  const matched = matchRoute(routes, path);
  if (!matched) {
    fallback.notFound();
    return;
  }
  const result = evaluateGuard(matched.route.guard, me, hash);
  if (result.type === 'redirect') {
    window.location.hash = result.to;
    return;
  }
  if (result.type === 'forbidden' && me) {
    fallback.forbidden(me, matched.route.guard?.roles ?? []);
    return;
  }
  if (matched.route.title) document.title = `${matched.route.title} · Potli`;
  const out = await matched.route.mount(el, { path, params: matched.params, query, me });
  cleanup = typeof out === 'function' ? out : null;
}

/** Make the page heading the focus target after navigation (keyboard and screen-reader users). */
export function focusHeading(root: ParentNode = document): void {
  const heading = root.querySelector<HTMLElement>('h1');
  if (!heading) return;
  heading.setAttribute('tabindex', '-1');
  heading.focus({ preventScroll: true });
}
