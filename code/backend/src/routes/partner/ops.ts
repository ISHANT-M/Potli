/** Partner dashboard stats, earnings, settlements, booking cancel, disputes and listing cover photo. */
import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../../../../db/audit.ts';
import { transitionBooking } from '../../../../db/bookings.ts';
import { and, desc, eq, sql } from '../../../../db/orm.ts';
import { rows } from '../../../../db/queries/admin.ts';
import { bookings, disputes, feeSettlements, listings } from '../../../../db/schema.ts';
import type { AppDeps } from '../../app.ts';
import { authenticate, currentUser, requireApprovedPartner, requireRole } from '../../http/auth.ts';
import { HttpError } from '../../http/errors.ts';
import { detectImageMime, EXTENSION_FOR, uploadPhoto } from '../../http/upload.ts';
import { validate, validated } from '../../http/validate.ts';
import { toPartnerListing } from '../../lib/serialize.ts';
import { clientIp, idParams, pageWindow, pagingShape } from './common.ts';
import { loadOwnedBooking } from './bookings.ts';

const earningsSchemas = { query: z.object({ ...pagingShape, from: z.coerce.date().optional(), to: z.coerce.date().optional() }) };
const pagedSchemas = { query: z.object(pagingShape) };
const reasonBody = z.object({ reason: z.string().trim().min(10, 'Use 10-300 characters.').max(300, 'Use 10-300 characters.') });
const cancelSchemas = { params: idParams, body: reasonBody };
const disputeSchemas = { params: idParams, body: z.object({ reason: z.string().trim().min(10, 'Use 10-1000 characters.').max(1000, 'Use 10-1000 characters.') }) };
const IST = sql.raw(`'Asia/Kolkata'`);

export function opsRoutes(deps: AppDeps): Router {
  const router = Router();
  const { db } = deps;
  const guard = [authenticate(deps), requireRole('storage_partner')];

  router.get('/partner/stats', ...guard, async (req, res, next) => {
    try {
      const me = currentUser(req).id;
      const own = sql`l.partner_id = ${me}`;
      const [counts] = await rows<Record<string, number>>(db, sql`
        select
          (select coalesce(sum(b.bag_count), 0)::int from bookings b join listings l on l.id = b.listing_id where ${own} and b.status in ('dropped','stored')) as in_storage,
          (select count(*)::int from bookings b join listings l on l.id = b.listing_id where ${own} and b.status = 'stored' and b.slot_end < now()) as overdue,
          (select count(*)::int from bookings b join listings l on l.id = b.listing_id where ${own} and b.status = 'booked' and b.slot_start >= now() and b.slot_start < now() + interval '7 days') as upcoming,
          (select count(*)::int from bookings b join listings l on l.id = b.listing_id where ${own} and b.status = 'completed' and b.completed_at >= now() - interval '30 days') as completed30,
          (select coalesce(sum(p.partner_share_paise), 0)::int from payments p join bookings b on b.id = p.booking_id join listings l on l.id = b.listing_id where ${own} and p.status = 'captured' and p.collected_at >= now() - interval '30 days') as earnings30,
          (select coalesce(sum(p.platform_fee_paise), 0)::int from payments p join bookings b on b.id = p.booking_id join listings l on l.id = b.listing_id where ${own} and p.status = 'captured' and p.settlement_id is null) as due`);
      const today = (column: string) => sql`(${sql.raw(column)} at time zone ${IST})::date = (now() at time zone ${IST})::date`;
      const list = (statuses: string, column: string) => rows<{ id: string; code: string; bagCount: number; at: Date; travelerName: string }>(db, sql`
        select b.id, b.code, b.bag_count as "bagCount", ${sql.raw(column)} as at, t.full_name as "travelerName"
        from bookings b join listings l on l.id = b.listing_id join profiles t on t.id = b.traveler_id
        where ${own} and b.status in (${sql.raw(statuses)}) and ${today(column)} order by ${sql.raw(column)}`);
      const [dropOffs, pickups] = await Promise.all([list(`'booked'`, 'b.slot_start'), list(`'dropped','stored'`, 'b.slot_end')]);
      const view = (r: { id: string; code: string; bagCount: number; at: Date; travelerName: string }) => ({
        id: r.id, code: r.code, bagCount: r.bagCount, at: new Date(r.at).toISOString(), travelerName: r.travelerName.split(' ')[0] ?? '',
      });
      res.json({
        today: { dropOffs: dropOffs.length, pickups: pickups.length, inStorage: counts?.in_storage ?? 0, dropOffList: dropOffs.map(view), pickupList: pickups.map(view) },
        overdue: counts?.overdue ?? 0,
        upcoming7d: counts?.upcoming ?? 0,
        completed30d: counts?.completed30 ?? 0,
        earnings30dPaise: counts?.earnings30 ?? 0,
        feesDuePaise: counts?.due ?? 0,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/partner/earnings', ...guard, validate(earningsSchemas), async (req, res, next) => {
    try {
      const me = currentUser(req).id;
      const { query } = validated(req, earningsSchemas);
      const range = sql`l.partner_id = ${me} and p.status = 'captured'
        ${query.from ? sql`and p.collected_at >= ${query.from.toISOString()}::timestamptz` : sql``}
        ${query.to ? sql`and p.collected_at < ${query.to.toISOString()}::timestamptz` : sql``}`;
      const from = sql`from payments p join bookings b on b.id = p.booking_id join listings l on l.id = b.listing_id`;
      const { limit, offset } = pageWindow(query.page, query.pageSize);
      const [[s], items] = await Promise.all([
        rows<Record<string, number>>(db, sql`select coalesce(sum(p.amount_paise),0)::int as gross, coalesce(sum(p.platform_fee_paise),0)::int as fee, coalesce(sum(p.partner_share_paise),0)::int as share,
          coalesce(sum(p.platform_fee_paise) filter (where p.settlement_id is null),0)::int as due,
          coalesce(sum(p.platform_fee_paise) filter (where p.settlement_id is not null),0)::int as settled, count(*)::int as n ${from} where ${range}`),
        rows<Record<string, unknown>>(db, sql`select b.id as "bookingId", b.code, b.completed_at as "completedAt", p.amount_paise as "amountPaise", p.platform_fee_paise as "feePaise",
          p.partner_share_paise as "sharePaise", (p.settlement_id is not null) as settled ${from} where ${range} order by p.collected_at desc limit ${limit} offset ${offset}`),
      ]);
      res.json({
        summary: { grossPaise: s?.gross ?? 0, feePaise: s?.fee ?? 0, sharePaise: s?.share ?? 0, feesDuePaise: s?.due ?? 0, feesSettledPaise: s?.settled ?? 0 },
        items: items.map((i) => ({ ...i, completedAt: i.completedAt ? new Date(i.completedAt as string).toISOString() : null })),
        page: query.page, pageSize: query.pageSize, total: s?.n ?? 0,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/partner/settlements', ...guard, validate(pagedSchemas), async (req, res, next) => {
    try {
      const me = currentUser(req).id;
      const { query } = validated(req, pagedSchemas);
      const where = eq(feeSettlements.partnerId, me);
      const [items, [total]] = await Promise.all([
        db.select().from(feeSettlements).where(where).orderBy(desc(feeSettlements.createdAt)).limit(query.pageSize).offset(pageWindow(query.page, query.pageSize).offset),
        db.select({ n: sql<number>`count(*)::int` }).from(feeSettlements).where(where),
      ]);
      res.json({
        items: items.map((s) => ({ id: s.id, amountPaise: s.amountPaise, paymentCount: s.paymentCount, reference: s.reference, createdAt: s.createdAt.toISOString() })),
        page: query.page, pageSize: query.pageSize, total: total?.n ?? 0,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/partner/bookings/:id/cancel', ...guard, requireApprovedPartner, validate(cancelSchemas), async (req, res, next) => {
    try {
      const me = currentUser(req);
      const { params, body } = validated(req, cancelSchemas);
      await loadOwnedBooking(deps, me.id, params.id);
      await db.transaction(async (tx) => {
        await transitionBooking(tx, { bookingId: params.id, from: ['booked'], to: 'cancelled', actorId: me.id, patch: { cancelReason: body.reason } });
        await audit(tx, { actorId: me.id, actorRole: 'storage_partner', action: 'booking.cancel', entity: 'booking', entityId: params.id, metadata: { reason: body.reason, by: 'partner' }, ip: clientIp(req) });
      });
      res.json({ booking: { id: params.id, status: 'cancelled' } });
    } catch (err) {
      next(err);
    }
  });

  router.post('/partner/bookings/:id/disputes', ...guard, validate(disputeSchemas), async (req, res, next) => {
    try {
      const me = currentUser(req);
      const { params, body } = validated(req, disputeSchemas);
      const record = await loadOwnedBooking(deps, me.id, params.id);
      if (record.booking.status === 'booked' || record.booking.status === 'pending_payment') {
        throw new HttpError(409, 'CONFLICT', 'You can report a problem once the bags have been handed over.');
      }
      const dispute = await db.transaction(async (tx) => {
        const [open] = await tx.select({ id: disputes.id }).from(disputes).where(and(eq(disputes.bookingId, params.id), eq(disputes.raisedBy, me.id), eq(disputes.status, 'open')));
        if (open) throw new HttpError(409, 'CONFLICT', 'You already have an open report for this booking.');
        const [created] = await tx.insert(disputes).values({ bookingId: params.id, raisedBy: me.id, raisedByRole: 'storage_partner', reason: body.reason }).returning();
        if (!created) throw new Error('dispute not created');
        await audit(tx, { actorId: me.id, actorRole: 'storage_partner', action: 'dispute.create', entity: 'booking', entityId: params.id, metadata: { disputeId: created.id }, ip: clientIp(req) });
        return created;
      });
      res.status(201).json({ dispute: { id: dispute.id, status: dispute.status, createdAt: dispute.createdAt.toISOString() } });
    } catch (err) {
      next(err);
    }
  });

  router.post('/partner/listings/:id/cover', ...guard, requireApprovedPartner, uploadPhoto('photo'), validate({ params: idParams }), async (req, res, next) => {
    try {
      const me = currentUser(req);
      const { params } = validated(req, { params: idParams });
      const file = req.file;
      if (!file) throw new HttpError(400, 'VALIDATION_FAILED', 'Choose a photo to upload.');
      const [current] = await db.select().from(listings).where(and(eq(listings.id, params.id), eq(listings.partnerId, me.id)));
      if (!current) throw new HttpError(404, 'NOT_FOUND', 'Listing not found.');
      if (current.status === 'flagged') throw new HttpError(409, 'CONFLICT', 'This listing was flagged by Potli and is read-only.');
      const mime = detectImageMime(file.buffer) ?? 'image/jpeg';
      const fileId = await deps.appwrite.uploadFile(deps.config.buckets.listing, file.buffer, `${current.id}.${EXTENSION_FOR[mime]}`, mime);
      const row = await db.transaction(async (tx) => {
        const [updated] = await tx.update(listings).set({ coverFileId: fileId, updatedAt: new Date() }).where(eq(listings.id, current.id)).returning();
        if (!updated) throw new Error('listing not updated');
        await audit(tx, { actorId: me.id, actorRole: 'storage_partner', action: 'listing.cover', entity: 'listing', entityId: current.id, ip: clientIp(req) });
        return updated;
      });
      res.json({ listing: toPartnerListing({ listing: row, businessName: me.partner?.businessName ?? '' }) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
