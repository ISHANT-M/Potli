/**
 * Admin routes, owned by the Admin agent: overview, partner review, listings, bookings,
 * users, the fee ledger and settlements, disputes and the audit log. Every route requires
 * `requireRole('admin')` and every write is audited.
 * Foundation only mounts this router; add routes here and nowhere else.
 */
import { Router } from 'express';
import type { AppDeps } from '../app.ts';

export function adminRouter(_deps: AppDeps): Router {
  return Router();
}
