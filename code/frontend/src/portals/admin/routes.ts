/** Admin routes, owned by the Admin agent. The admin login page lives in main.ts; unbuilt screens are placeholders. */
import type { RouteDef } from '../../lib/router';
import { placeholderRoute, type PortalSpec } from '../placeholder';
import '../../styles/admin.css';
import { bookingDetailRoute, bookingsRoute } from './bookings';
import { overviewRoute } from './overview';
import { partnerDetailRoute, partnersRoute } from './partners';
import { ADMIN_NAV } from './shell';

const spec: PortalSpec = { role: 'admin', roleLabel: 'Admin', guard: { roles: ['admin'] }, nav: ADMIN_NAV };

// Listings, users, ledger, disputes and the audit log arrive in the next sprint.
export const adminRoutes: RouteDef[] = [
  overviewRoute,
  partnersRoute,
  partnerDetailRoute,
  bookingsRoute,
  bookingDetailRoute,
  ...['/admin/listings', '/admin/users', '/admin/ledger', '/admin/disputes', '/admin/audit'].map((path, i) =>
    placeholderRoute(spec, path, ['Listings', 'Users', 'Ledger', 'Disputes', 'Audit log'][i] ?? 'Admin'),
  ),
];
