/**
 * Storage-partner routes, owned by the Partner agent: application, own listings and photos,
 * handoff lookup/check-in/drop-off/pickup, partner bookings, earnings and settlements.
 * Foundation only mounts this router; add routes here and nowhere else.
 */
import { Router } from 'express';
import type { AppDeps } from '../app.ts';

export function partnerRouter(_deps: AppDeps): Router {
  return Router();
}
