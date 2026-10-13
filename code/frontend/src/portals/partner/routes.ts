/**
 * Storage-partner routes, owned by the Partner agent. The public `#/partner` sign-up and
 * login page lives in main.ts and calls portals/partner/signup.ts.
 */
import type { RouteDef } from '../../lib/router';
import '../../styles/partner.css';
import { applicationRoute } from './application';
import { bookingDetailRoute } from './bookingDetail';
import { bookingsRoute } from './bookings';
import { dashboardRoute } from './dashboard';
import { earningsRoute } from './earnings';
import { profileRoute } from './profile';
import { handoffRoute } from './handoff';
import { listingRoutes } from './listings';
import { partnerApplyRoute } from './signup';

export const partnerRoutes: RouteDef[] = [
  partnerApplyRoute,
  applicationRoute,
  dashboardRoute,
  ...listingRoutes,
  bookingsRoute,
  bookingDetailRoute,
  handoffRoute,
  earningsRoute,
  profileRoute,
];
