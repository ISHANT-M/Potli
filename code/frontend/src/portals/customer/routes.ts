/** Traveller routes, owned by the Customer agent. */
import type { RouteDef } from '../../lib/router';
import '../../styles/customer.css';
import { bookingDetailRoute, bookingsRoute, homeRoute } from './bookings';
import { checkoutRoute } from './checkout';
import { profileRoute } from './profile';
import { listingRoute } from './listing';
import { searchRoute } from './search';

export const customerRoutes: RouteDef[] = [
  searchRoute,
  listingRoute,
  checkoutRoute,
  homeRoute,
  bookingsRoute,
  bookingDetailRoute,
  profileRoute,
];
