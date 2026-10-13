/** Admin routes, owned by the Admin agent. The admin login page lives in main.ts; every screen is built. */
import type { RouteDef } from '../../lib/router';
import '../../styles/admin.css';
import { bookingDetailRoute, bookingsRoute } from './bookings';
import { ledgerRoute } from './ledger';
import { auditRoute, disputesRoute, listingsRoute } from './moderation';
import { overviewRoute } from './overview';
import { partnerDetailRoute, partnersRoute } from './partners';
import { usersRoute } from './users';

export const adminRoutes: RouteDef[] = [
  overviewRoute,
  partnersRoute,
  partnerDetailRoute,
  bookingsRoute,
  bookingDetailRoute,
  listingsRoute,
  usersRoute,
  ledgerRoute,
  disputesRoute,
  auditRoute,
];
