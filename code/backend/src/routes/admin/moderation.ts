/** Listing flag/unflag, dispute resolution, nav counts and the audit log viewer. */
import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../../../../db/audit.ts';
import { and, desc, eq, ilike, sql } from '../../../../db/orm.ts';
import { rows } from '../../../../db/queries/admin.ts';
import { auditLog, bookings, disputes, listings, partnerProfiles, profiles } from '../../../../db/schema.ts';
import type { AppDeps } from '../../app.ts';
import { currentUser } from '../../http/auth.ts';
import { HttpError } from '../../http/errors.ts';
import { validate, validated } from '../../http/validate.ts';
import { toPartnerListing } from '../../lib/serialize.ts';
import { asNonNull, clientIp, idParams, likePattern, pageWindow, pagingShape } from '../partner/common.ts';

const listingList = { query: z.object({ ...pagingShape, status: z.enum(['active', 'paused', 'flagged']).optional(), city: z.string().trim().max(60).optional(), q: z.string().trim().max(80).optional() }) };
const flagSchemas = { params: idParams, body: z.object({ reason: z.string().trim().min(10, 'Use 10-300 characters.').max(300, 'Use 10-300 characters.') }) };
const unflagSchemas = { params: idParams, body: z.object({}) };
const disputeList = { query: z.object({ ...pagingShape, status: z.enum(['open', 'resolved', 'rejected']).optional() }) };
const resolveSchemas = { params: idParams, body: z.object({ outcome: z.enum(['resolved', 'rejected']), resolution: z.string().trim().min(10, 'Use 10-1000 characters.').max(1000, 'Use 10-1000 characters.') }) };
const auditList = {
  query: z.object({
    ...pagingShape,
    entity: z.string().trim().max(40).optional(),
    entityId: z.string().trim().max(80).optional(),
    actorId: z.string().uuid().optional(),
    action: z.string().trim().max(60).optional(),
  }),
};

export function adminModerationRoutes(deps: AppDeps): Router {
  const router = Router();
  const { db } = deps;

  router.get('/admin/counts', async (_req, res, next) => {
    try {
      const [r] = await rows<{ pending: number; disputes: number }>(db, sql`select (select count(*)::int from partner_profiles where status = 'pending') as pending, (select count(*)::int from disputes where status = 'open') as disputes`);
      res.json({ pendingPartners: r?.pending ?? 0, openDisputes: r?.disputes ?? 0 });
    } catch (err) {
      next(err);
    }
  });

  router.get('/admin/listings', validate(listingList), async (req, res, next) => {
    try {
      const { query } = validated(req, listingList);
      const where = and(...asNonNull([
        query.status && eq(listings.status, query.status),
        query.city && sql`lower(${listings.city}) = lower(${query.city})`,
        query.q && ilike(listings.name, likePattern(query.q)),
      ]));
      const [items, [total]] = await Promise.all([
        db.select({ listing: listings, businessName: partnerProfiles.businessName }).from(listings).leftJoin(partnerProfiles, eq(partnerProfiles.userId, listings.partnerId))
          .where(where).orderBy(desc(listings.createdAt)).limit(query.pageSize).offset(pageWindow(query.page, query.pageSize).offset),
        db.select({ n: sql<number>`count(*)::int` }).from(listings).where(where),
      ]);
      res.json({ items: items.map((r) => toPartnerListing({ listing: r.listing, businessName: r.businessName ?? '' })), page: query.page, pageSize: query.pageSize, total: total?.n ?? 0 });
    } catch (err) {
      next(err);
    }
  });

  const flagging = (name: 'flag' | 'unflag', schemas: typeof flagSchemas | typeof unflagSchemas) =>
    router.post(`/admin/listings/:id/${name}`, validate(schemas), async (req, res, next) => {
      try {
        const admin = currentUser(req);
        const { params, body } = validated(req, schemas);
        const reason = (body as { reason?: string }).reason ?? null;
        const row = await db.transaction(async (tx) => {
          const [current] = await tx.select().from(listings).where(eq(listings.id, params.id)).for('update');
          if (!current) throw new HttpError(404, 'NOT_FOUND', 'Listing not found.');
          if ((name === 'flag') === (current.status === 'flagged')) throw new HttpError(409, 'CONFLICT', name === 'flag' ? 'This listing is already flagged.' : 'This listing is not flagged.');
          const [updated] = await tx.update(listings).set({ status: name === 'flag' ? 'flagged' : 'active', flagReason: reason, updatedAt: new Date() }).where(eq(listings.id, current.id)).returning();
          if (!updated) throw new Error('listing not updated');
          await audit(tx, { actorId: admin.id, actorRole: 'admin', action: `listing.${name}`, entity: 'listing', entityId: current.id, metadata: reason ? { reason } : {}, ip: clientIp(req) });
          return updated;
        });
        const [partner] = await db.select({ n: partnerProfiles.businessName }).from(partnerProfiles).where(eq(partnerProfiles.userId, row.partnerId));
        res.json({ listing: toPartnerListing({ listing: row, businessName: partner?.n ?? '' }) });
      } catch (err) {
        next(err);
      }
    });
  flagging('flag', flagSchemas);
  flagging('unflag', unflagSchemas);

  router.get('/admin/disputes', validate(disputeList), async (req, res, next) => {
    try {
      const { query } = validated(req, disputeList);
      const where = query.status ? eq(disputes.status, query.status) : undefined;
      const [items, [total]] = await Promise.all([
        db.select({ d: disputes, code: bookings.code, name: profiles.fullName }).from(disputes).innerJoin(bookings, eq(bookings.id, disputes.bookingId)).innerJoin(profiles, eq(profiles.id, disputes.raisedBy))
          .where(where).orderBy(desc(disputes.createdAt)).limit(query.pageSize).offset(pageWindow(query.page, query.pageSize).offset),
        db.select({ n: sql<number>`count(*)::int` }).from(disputes).where(where),
      ]);
      res.json({
        items: items.map(({ d, code, name }) => ({ id: d.id, bookingId: d.bookingId, bookingCode: code, raisedBy: { name, role: d.raisedByRole }, reason: d.reason, status: d.status, resolution: d.resolution, createdAt: d.createdAt.toISOString() })),
        page: query.page, pageSize: query.pageSize, total: total?.n ?? 0,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/admin/disputes/:id/resolve', validate(resolveSchemas), async (req, res, next) => {
    try {
      const admin = currentUser(req);
      const { params, body } = validated(req, resolveSchemas);
      const dispute = await db.transaction(async (tx) => {
        const [current] = await tx.select().from(disputes).where(eq(disputes.id, params.id)).for('update');
        if (!current) throw new HttpError(404, 'NOT_FOUND', 'Dispute not found.');
        if (current.status !== 'open') throw new HttpError(409, 'CONFLICT', `This dispute is already ${current.status}.`);
        const [updated] = await tx.update(disputes).set({ status: body.outcome, resolution: body.resolution, resolvedBy: admin.id, resolvedAt: new Date() }).where(eq(disputes.id, current.id)).returning();
        if (!updated) throw new Error('dispute not updated');
        await audit(tx, { actorId: admin.id, actorRole: 'admin', action: 'dispute.resolve', entity: 'dispute', entityId: current.id, metadata: { outcome: body.outcome, bookingId: current.bookingId }, ip: clientIp(req) });
        return updated;
      });
      res.json({ dispute: { id: dispute.id, status: dispute.status, resolution: dispute.resolution, resolvedAt: dispute.resolvedAt?.toISOString() ?? null } });
    } catch (err) {
      next(err);
    }
  });

  router.get('/admin/audit', validate(auditList), async (req, res, next) => {
    try {
      const { query } = validated(req, auditList);
      const where = and(...asNonNull([
        query.entity && eq(auditLog.entity, query.entity),
        query.entityId && eq(auditLog.entityId, query.entityId),
        query.actorId && eq(auditLog.actorId, query.actorId),
        query.action && ilike(auditLog.action, likePattern(query.action)),
      ]));
      const [items, [total]] = await Promise.all([
        db.select({ entry: auditLog, actorName: profiles.fullName }).from(auditLog).leftJoin(profiles, eq(profiles.id, auditLog.actorId))
          .where(where).orderBy(desc(auditLog.createdAt)).limit(query.pageSize).offset(pageWindow(query.page, query.pageSize).offset),
        db.select({ n: sql<number>`count(*)::int` }).from(auditLog).where(where),
      ]);
      res.json({
        items: items.map(({ entry, actorName }) => ({
          id: entry.id, actor: entry.actorId && entry.actorRole ? { id: entry.actorId, fullName: actorName ?? '', role: entry.actorRole } : null,
          action: entry.action, entity: entry.entity, entityId: entry.entityId, metadata: entry.metadata, ip: entry.ip, createdAt: entry.createdAt.toISOString(),
        })),
        page: query.page, pageSize: query.pageSize, total: total?.n ?? 0,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
