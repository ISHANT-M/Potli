/**
 * Admin routes, owned by the Admin agent: overview, partner review and bookings (Sprint 2).
 * Every route requires `requireRole('admin')` and every write is audited.
 * Foundation only mounts this router; add routes in routes/admin/*.ts.
 */
import { Router } from 'express';
import { z } from 'zod';
import { overviewMetrics } from '../../../db/queries/admin.ts';
import type { AppDeps } from '../app.ts';
import { authenticate, requireRole } from '../http/auth.ts';
import { validate, validated } from '../http/validate.ts';
import { adminBookingRoutes } from './admin/bookings.ts';
import { adminPartnerRoutes } from './admin/partners.ts';

const overviewSchemas = { query: z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() }) };

export function adminRouter(deps: AppDeps): Router {
  const router = Router();
  // One guard for everything under /admin, so no route can be exposed by accident.
  router.use('/admin', authenticate(deps), requireRole('admin'));

  router.get('/admin/overview', validate(overviewSchemas), async (req, res, next) => {
    try {
      const { query } = validated(req, overviewSchemas);
      const to = query.to ?? new Date();
      const from = query.from ?? new Date(to.getTime() - 30 * 86_400_000);
      res.json(await overviewMetrics(deps.db, from, to));
    } catch (err) {
      next(err);
    }
  });

  router.use(adminPartnerRoutes(deps), adminBookingRoutes(deps));
  return router;
}
