/** Platform-fee ledger: dues per partner and recorded settlements. */
import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../../../../db/audit.ts';
import { desc, eq, sql } from '../../../../db/orm.ts';
import { rows } from '../../../../db/queries/admin.ts';
import { feeSettlements, partnerProfiles, profiles } from '../../../../db/schema.ts';
import type { Settlement } from '../../../../shared/types.ts';
import type { AppDeps } from '../../app.ts';
import { currentUser } from '../../http/auth.ts';
import { HttpError } from '../../http/errors.ts';
import { validate, validated } from '../../http/validate.ts';
import { clientIp, likePattern, pageWindow, pagingShape } from '../partner/common.ts';

const ledgerSchemas = { query: z.object({ ...pagingShape, q: z.string().trim().max(80).optional() }) };
const listSchemas = { query: z.object({ ...pagingShape, partnerId: z.string().uuid().optional() }) };
const createSchemas = {
  body: z.object({
    partnerId: z.string().uuid(),
    reference: z.string().trim().min(3, 'Use 3-80 characters.').max(80, 'Use 3-80 characters.'),
    note: z.string().trim().max(300, 'At most 300 characters.').default(''),
    expectedAmountPaise: z.number().int().min(0),
  }),
};

export function adminLedgerRoutes(deps: AppDeps): Router {
  const router = Router();
  const { db } = deps;

  router.get('/admin/ledger', validate(ledgerSchemas), async (req, res, next) => {
    try {
      const { query } = validated(req, ledgerSchemas);
      const { limit, offset } = pageWindow(query.page, query.pageSize);
      const search = query.q ? sql`and pp.business_name ilike ${likePattern(query.q)}` : sql``;
      const base = sql`from payments p join bookings b on b.id = p.booking_id join listings l on l.id = b.listing_id
        join partner_profiles pp on pp.user_id = l.partner_id where p.status = 'captured' ${search}`;
      const [items, [total]] = await Promise.all([
        rows<Record<string, unknown>>(db, sql`select pp.user_id as "partnerId", pp.business_name as "businessName", count(*)::int as "completedCount",
          coalesce(sum(p.amount_paise),0)::int as "grossPaise",
          coalesce(sum(p.platform_fee_paise) filter (where p.settlement_id is null),0)::int as "feesDuePaise",
          coalesce(sum(p.platform_fee_paise) filter (where p.settlement_id is not null),0)::int as "feesSettledPaise",
          min(p.collected_at) filter (where p.settlement_id is null) as "oldestDueAt"
          ${base} group by pp.user_id, pp.business_name order by "feesDuePaise" desc, "oldestDueAt" asc nulls last limit ${limit} offset ${offset}`),
        rows<{ n: number }>(db, sql`select count(distinct pp.user_id)::int as n ${base}`),
      ]);
      res.json({
        items: items.map((i) => ({ ...i, oldestDueAt: i.oldestDueAt ? new Date(i.oldestDueAt as string).toISOString() : null })),
        page: query.page, pageSize: query.pageSize, total: total?.n ?? 0,
      });
    } catch (err) {
      next(err);
    }
  });

  const toSettlement = (r: { s: typeof feeSettlements.$inferSelect; businessName: string | null; adminName: string | null }): Settlement => ({
    id: r.s.id, partnerId: r.s.partnerId, businessName: r.businessName ?? '', amountPaise: r.s.amountPaise, paymentCount: r.s.paymentCount,
    reference: r.s.reference, note: r.s.note, recordedBy: { id: r.s.recordedBy, fullName: r.adminName ?? '' }, createdAt: r.s.createdAt.toISOString(),
  });
  const selectSettlements = () =>
    db.select({ s: feeSettlements, businessName: partnerProfiles.businessName, adminName: profiles.fullName }).from(feeSettlements)
      .leftJoin(partnerProfiles, eq(partnerProfiles.userId, feeSettlements.partnerId)).leftJoin(profiles, eq(profiles.id, feeSettlements.recordedBy));

  router.get('/admin/ledger/settlements', validate(listSchemas), async (req, res, next) => {
    try {
      const { query } = validated(req, listSchemas);
      const where = query.partnerId ? eq(feeSettlements.partnerId, query.partnerId) : undefined;
      const [items, [total]] = await Promise.all([
        selectSettlements().where(where).orderBy(desc(feeSettlements.createdAt)).limit(query.pageSize).offset(pageWindow(query.page, query.pageSize).offset),
        db.select({ n: sql<number>`count(*)::int` }).from(feeSettlements).where(where),
      ]);
      res.json({ items: items.map(toSettlement), page: query.page, pageSize: query.pageSize, total: total?.n ?? 0 });
    } catch (err) {
      next(err);
    }
  });

  router.post('/admin/ledger/settlements', validate(createSchemas), async (req, res, next) => {
    try {
      const admin = currentUser(req);
      const { body } = validated(req, createSchemas);
      const id = await db.transaction(async (tx) => {
        const [partner] = await tx.select({ id: partnerProfiles.userId }).from(partnerProfiles).where(eq(partnerProfiles.userId, body.partnerId));
        if (!partner) throw new HttpError(404, 'NOT_FOUND', 'Partner not found.');
        // Lock the due rows so two admins cannot settle the same payments.
        const due = await rows<{ id: string; fee: number }>(tx, sql`
          select p.id, p.platform_fee_paise as fee from payments p join bookings b on b.id = p.booking_id join listings l on l.id = b.listing_id
          where l.partner_id = ${body.partnerId} and p.status = 'captured' and p.settlement_id is null for update of p`);
        const total = due.reduce((sum, r) => sum + Number(r.fee), 0);
        if (due.length === 0) throw new HttpError(409, 'CONFLICT', 'This partner has no dues to settle.');
        if (total !== body.expectedAmountPaise) {
          throw new HttpError(409, 'CONFLICT', `Dues changed: the current total is ${total} paise, not ${body.expectedAmountPaise}. Refresh and try again.`);
        }
        const [created] = await tx.insert(feeSettlements).values({ partnerId: body.partnerId, amountPaise: total, paymentCount: due.length, reference: body.reference, note: body.note, recordedBy: admin.id }).returning({ id: feeSettlements.id });
        if (!created) throw new Error('settlement not created');
        await tx.execute(sql`update payments set settlement_id = ${created.id}, updated_at = now() where id in (${sql.join(due.map((r) => sql`${r.id}::uuid`), sql`, `)})`);
        await audit(tx, { actorId: admin.id, actorRole: 'admin', action: 'ledger.settle', entity: 'partner', entityId: body.partnerId, metadata: { settlementId: created.id, amountPaise: total, paymentCount: due.length, reference: body.reference }, ip: clientIp(req) });
        return created.id;
      });
      const [row] = await selectSettlements().where(eq(feeSettlements.id, id));
      res.status(201).json({ settlement: row && toSettlement(row) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
