/** Admin routes, owned by the Admin agent. The admin login page lives in main.ts; placeholders only here. */
import type { RouteDef } from '../../lib/router';
import { placeholderRoute, type PortalSpec } from '../placeholder';
import '../../styles/admin.css';

const spec: PortalSpec = {
  role: 'admin',
  roleLabel: 'Admin',
  guard: { roles: ['admin'] },
  nav: [
    { label: 'Overview', href: '#/admin', icon: 'dashboard' },
    { label: 'Partners', href: '#/admin/partners', icon: 'store' },
    { label: 'Listings', href: '#/admin/listings', icon: 'map' },
    { label: 'Bookings', href: '#/admin/bookings', icon: 'calendar' },
    { label: 'Users', href: '#/admin/users', icon: 'user' },
    { label: 'Ledger', href: '#/admin/ledger', icon: 'rupee' },
    { label: 'Disputes', href: '#/admin/disputes', icon: 'alert' },
    { label: 'Audit', href: '#/admin/audit', icon: 'list' },
  ],
};

export const adminRoutes: RouteDef[] = [
  placeholderRoute(spec, '/admin', 'Overview', true),
  ...spec.nav.slice(1).map((item) => placeholderRoute(spec, item.href.slice(1), item.label)),
];
