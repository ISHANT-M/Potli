/**
 * Customer (traveller) routes, owned by the Customer agent: listing search and detail,
 * quotes, bookings, cancellation, ratings and traveller disputes (02-CONTRACTS section 8).
 * Foundation only mounts this router; add routes here and nowhere else.
 */
import { Router } from 'express';
import type { AppDeps } from '../app.ts';

export function customerRouter(_deps: AppDeps): Router {
  return Router();
}
