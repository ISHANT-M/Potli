/** Public system routes. */
import { sql } from '../../../db/orm.ts';
import { Router } from 'express';
import { describeDbError } from '../../../db/errors.ts';
import type { AppDeps } from '../app.ts';
import { isProduction } from '../config.ts';

export function systemRouter(deps: AppDeps): Router {
  const router = Router();

  // Public: used by the dev launcher and uptime checks.
  router.get('/health', async (_req, res, next) => {
    try {
      try {
        await deps.db.execute(sql`select 1`);
      } catch (err) {
        res.status(503).json({
          ok: false,
          db: false,
          error: describeDbError(err),
          ...(isProduction(deps.config) ? {} : { detail: (err as Error).message }),
        });
        return;
      }
      const auth = await deps.appwrite.authReachable();
      res.json({ ok: auth, db: true, auth });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
