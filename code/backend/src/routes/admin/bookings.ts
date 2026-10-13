/** Admin booking search and detail (full timeline, handoffs, payment, rating, disputes, audit trail). */
import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../../../../db/audit.ts';
import { transitionBooking } from '../../../../db/bookings.ts';
import { and, desc, eq, gte, lt, sql } from '../../../../db/orm.ts';
import { countBookingRecords, findBookingRecords, travelerAlias, type BookingRecord } from '../../../../db/queries/partner.ts';
import { auditLog, bookings, disputes, listings, profiles, ratings } from '../../../../db/schema.ts';
import { BOOKING_STATUSES } from '../../../../shared/bookingStatus.ts';
import type { AdminBooking, AuditEntry } from '../../../../shared/types.ts';
import type { AppDeps } from '../../app.ts';
import { currentUser } from '../../http/auth.ts';
import { HttpError } from '../../http/errors.ts';
import { validate, validated } from '../../http/validate.ts';
import { asNonNull, clientIp, handoffsOf, idParams, pageWindow, pagingShape, toPartnerBookings } from '../partner/common.ts';

const listSchemas = {
  query: z.object({
    ...pagingShape,
    q: z.string().trim().min(1).max(254).optional(),
    status: z.enum(BOOKING_STATUSES).optional(),
    city: z.string().trim().min(1).max(60).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  }),
};
const detailSchemas = { params: idParams };
const cancelSchemas = { params: idParams, body: z.object({ reason: z.string().trim().min(10, 'Use 10-300 characters.').max(300, 'Use 10-300 characters.') }) };

async function toAdminBookings(deps: AppDeps, records: BookingRecord[]): Promise<AdminBooking[]> {
  const base = await toPartnerBookings(deps.db, records);
  return base.map((booking, index) => {
    const r = records[index] as BookingRecord;
    return {
      ...booking,
      traveler: { id: r.travelerId, fullName: r.travelerName, phone: r.travelerPhone, email: r.travelerEmail },
      partner: { id: r.partnerId, fullName: r.partnerName, businessName: r.businessName },
      searchStartedAt: r.booking.searchStartedAt?.toISOString() ?? null,
    };
  });
}

export function adminBookingRoutes(deps: AppDeps): Router {
  const router = Router();
  const { db } = deps;

  router.get('/admin/bookings', validate(listSchemas), async (req, res, next) => {
    try {
      const { query } = validated(req, listSchemas);
      const where = and(
        ...asNonNull([
          query.q && sql`(upper(${bookings.code}) = upper(${query.q}) or lower(${travelerAlias.email}) = lower(${query.q}))`,
          query.status && eq(bookings.status, query.status),
          query.city && sql`lower(${listings.city}) = lower(${query.city})`,
          query.from && gte(bookings.createdAt, query.from),
          query.to && lt(bookings.createdAt, query.to),
        ]),
      );
      const [records, total] = await Promise.all([
        findBookingRecords(db, where, pageWindow(query.page, query.pageSize)),
        countBookingRecords(db, where),
      ]);
      res.json({ items: await toAdminBookings(deps, records), page: query.page, pageSize: query.pageSize, total });
    } catch (err) {
      next(err);
    }
  });

  router.get('/admin/bookings/:id', validate(detailSchemas), async (req, res, next) => {
    try {
      const { params } = validated(req, detailSchemas);
      const [record] = await findBookingRecords(db, eq(bookings.id, params.id));
      if (!record) throw new HttpError(404, 'NOT_FOUND', 'Booking not found.');
      const [[booking], handoffs, [rating], disputeRows, auditRows] = await Promise.all([
        toAdminBookings(deps, [record]),
        handoffsOf(db, params.id),
        db.select({ score: ratings.score, comment: ratings.comment, createdAt: ratings.createdAt }).from(ratings).where(eq(ratings.bookingId, params.id)),
        db.select().from(disputes).where(eq(disputes.bookingId, params.id)).orderBy(desc(disputes.createdAt)),
        db
          .select({ entry: auditLog, actorName: profiles.fullName })
          .from(auditLog)
          .leftJoin(profiles, eq(profiles.id, auditLog.actorId))
          .where(and(eq(auditLog.entity, 'booking'), eq(auditLog.entityId, params.id)))
          .orderBy(desc(auditLog.createdAt)),
      ]);
      const payment = record.payment;
      const trail: AuditEntry[] = auditRows.map(({ entry, actorName }) => ({
        id: entry.id,
        actor: entry.actorId && entry.actorRole ? { id: entry.actorId, fullName: actorName ?? '', role: entry.actorRole } : null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        metadata: entry.metadata as Record<string, unknown>,
        ip: entry.ip,
        createdAt: entry.createdAt.toISOString(),
      }));
      res.json({
        booking,
        handoffs,
        payment: payment && {
          method: payment.method,
          status: payment.status,
          amountPaise: payment.amountPaise,
          platformFeePaise: payment.platformFeePaise,
          partnerSharePaise: payment.partnerSharePaise,
          collectedAt: payment.collectedAt?.toISOString() ?? null,
          settled: payment.settlementId !== null,
        },
        rating: rating ? { ...rating, createdAt: rating.createdAt.toISOString() } : null,
        disputes: disputeRows.map((d) => ({ id: d.id, raisedByRole: d.raisedByRole, reason: d.reason, status: d.status, resolution: d.resolution, createdAt: d.createdAt.toISOString() })),
        audit: trail,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/admin/bookings/:id/cancel', validate(cancelSchemas), async (req, res, next) => {
    try {
      const admin = currentUser(req);
      const { params, body } = validated(req, cancelSchemas);
      await db.transaction(async (tx) => {
        await transitionBooking(tx, { bookingId: params.id, from: ['pending_payment', 'booked', 'dropped', 'stored'], to: 'cancelled', actorId: admin.id, patch: { cancelReason: body.reason } });
        await audit(tx, { actorId: admin.id, actorRole: 'admin', action: 'booking.cancel', entity: 'booking', entityId: params.id, metadata: { reason: body.reason, by: 'admin' }, ip: clientIp(req) });
      });
      res.json({ booking: { id: params.id, status: 'cancelled' } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
