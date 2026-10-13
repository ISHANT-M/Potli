/**
 * Storage-partner routes, owned by the Partner agent. The public `#/partner` sign-up and
 * login page lives in main.ts and calls portals/partner/signup.ts.
 */
import type { RouteDef } from '../../lib/router';
import { placeholderRoute, type PortalSpec } from '../placeholder';
import '../../styles/partner.css';
import { applicationRoute } from './application';
import { bookingsRoute } from './bookings';
import { handoffRoute } from './handoff';
import { listingRoutes } from './listings';
import { FULL_NAV } from './shell';
import { partnerApplyRoute } from './signup';

const spec: PortalSpec = {
  role: 'storage_partner',
  roleLabel: 'Storage partner',
  guard: { roles: ['storage_partner'], partnerStatus: ['approved', 'suspended'] },
  nav: FULL_NAV,
};

// Dashboard, earnings and profile arrive in the next sprint.
export const partnerRoutes: RouteDef[] = [
  partnerApplyRoute,
  applicationRoute,
  placeholderRoute(spec, '/partner/dashboard', 'Dashboard', true),
  ...listingRoutes,
  bookingsRoute,
  handoffRoute,
  placeholderRoute(spec, '/partner/earnings', 'Earnings'),
  placeholderRoute(spec, '/partner/profile', 'Profile'),
];
