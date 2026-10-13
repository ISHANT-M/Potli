/**
 * Storage-partner routes, owned by the Partner agent: application, own listings,
 * handoff lookup/check-in/drop-off/pickup and partner bookings.
 * Foundation only mounts this router; add routes in routes/partner/*.ts.
 */
import { Router } from 'express';
import type { AppDeps } from '../app.ts';
import { applicationRoutes } from './partner/application.ts';
import { bookingRoutes } from './partner/bookings.ts';
import { handoffRoutes } from './partner/handoffs.ts';
import { listingRoutes } from './partner/listings.ts';

export function partnerRouter(deps: AppDeps): Router {
  const router = Router();
  router.use(applicationRoutes(deps), listingRoutes(deps), bookingRoutes(deps), handoffRoutes(deps));
  return router;
}
