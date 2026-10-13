/** Traveller routes, owned by the Customer agent. */
import type { RouteDef } from '../../lib/router';
import { placeholderRoute, type PortalSpec } from '../placeholder';
import '../../styles/customer.css';
import { bookingDetailRoute, bookingsRoute, homeRoute } from './bookings';
import { checkoutRoute } from './checkout';
import { NAV } from './common';
import { listingRoute } from './listing';
import { searchRoute } from './search';

const spec: PortalSpec = { role: 'traveler', roleLabel: 'Traveller', guard: { roles: ['traveler'] }, nav: NAV };

export const customerRoutes: RouteDef[] = [
  searchRoute,
  listingRoute,
  checkoutRoute,
  homeRoute,
  bookingsRoute,
  bookingDetailRoute,
  // Sprint 3: profile
  placeholderRoute(spec, '/app/profile', 'Profile'),
];
