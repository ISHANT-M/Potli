/** Admin user list with disable/enable (also flips the Appwrite account status). */
import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../../../../db/audit.ts';
import { and, desc, eq, ilike, or, sql } from '../../../../db/orm.ts';
import { profiles } from '../../../../db/schema.ts';
import type { AppDeps } from '../../app.ts';
import { currentUser } from '../../http/auth.ts';
import { HttpError } from '../../http/errors.ts';
import { validate, validated } from '../../http/validate.ts';
import { asNonNull, clientIp, idParams, likePattern, pageWindow, pagingShape } from '../partner/common.ts';

const listSchemas = {
  query: z.object({
    ...pagingShape,
    q: z.string().trim().max(80).optional(),
    role: z.enum(['traveler', 'storage_partner', 'admin']).optional(),
    disabled: z.enum(['true', 'false']).optional(),
  }),
};
const disableSchemas = { params: idParams, body: z.object({ reason: z.string().trim().min(10, 'Use 10-300 characters.').max(300, 'Use 10-300 characters.') }) };
const enableSchemas = { params: idParams, body: z.object({}) };

const columns = {
  id: profiles.id, email: profiles.email, fullName: profiles.fullName, phone: profiles.phone, role: profiles.role,
  isDisabled: profiles.isDisabled, disabledReason: profiles.disabledReason, createdAt: profiles.createdAt,
  bookingCount: sql<number>`(select count(*)::int from bookings where bookings.traveler_id = ${profiles.id})`,
};
const view = <T extends { createdAt: Date }>(row: T) => ({ ...row, createdAt: row.createdAt.toISOString() });

export function adminUserRoutes(deps: AppDeps): Router {
  const router = Router();
  const { db } = deps;

  router.get('/admin/users', validate(listSchemas), async (req, res, next) => {
    try {
      const { query } = validated(req, listSchemas);
      const search = query.q ? likePattern(query.q) : null;
      const where = and(...asNonNull([
        query.role && eq(profiles.role, query.role),
        query.disabled && eq(profiles.isDisabled, query.disabled === 'true'),
        search && or(ilike(profiles.email, search), ilike(profiles.fullName, search)),
      ]));
      const [items, [total]] = await Promise.all([
        db.select(columns).from(profiles).where(where).orderBy(desc(profiles.createdAt)).limit(query.pageSize).offset(pageWindow(query.page, query.pageSize).offset),
        db.select({ n: sql<number>`count(*)::int` }).from(profiles).where(where),
      ]);
      res.json({ items: items.map(view), page: query.page, pageSize: query.pageSize, total: total?.n ?? 0 });
    } catch (err) {
      next(err);
    }
  });

  const change = (name: 'disable' | 'enable', schemas: typeof disableSchemas | typeof enableSchemas) =>
    router.post(`/admin/users/:id/${name}`, validate(schemas), async (req, res, next) => {
      try {
        const admin = currentUser(req);
        const { params, body } = validated(req, schemas);
        const reason = (body as { reason?: string }).reason ?? null;
        const disabling = name === 'disable';
        await db.transaction(async (tx) => {
          const [user] = await tx.select().from(profiles).where(eq(profiles.id, params.id)).for('update');
          if (!user) throw new HttpError(404, 'NOT_FOUND', 'User not found.');
          if (disabling && (user.id === admin.id || user.role === 'admin')) throw new HttpError(403, 'FORBIDDEN', 'Admin accounts cannot be disabled.');
          if (user.isDisabled === disabling) throw new HttpError(409, 'CONFLICT', `This user is already ${disabling ? 'disabled' : 'enabled'}.`);
          await tx.update(profiles).set({ isDisabled: disabling, disabledReason: disabling ? reason : null, updatedAt: new Date() }).where(eq(profiles.id, user.id));
          // Inside the transaction: if Appwrite refuses, the database change rolls back.
          await deps.appwrite.setUserStatus(user.appwriteUserId, !disabling);
          await audit(tx, { actorId: admin.id, actorRole: 'admin', action: `user.${name}`, entity: 'user', entityId: user.id, metadata: reason ? { reason } : {}, ip: clientIp(req) });
        });
        const [row] = await db.select(columns).from(profiles).where(eq(profiles.id, params.id));
        res.json({ user: row && view(row) });
      } catch (err) {
        next(err);
      }
    });
  change('disable', disableSchemas);
  change('enable', enableSchemas);

  return router;
}
