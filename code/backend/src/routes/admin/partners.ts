/** Partner review: list, detail and the approve/reject/suspend/reinstate state changes. */
import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../../../../db/audit.ts';
import { and, desc, eq, ilike, or, sql } from '../../../../db/orm.ts';
import { setPartnerStatus } from '../../../../db/partners.ts';
import { rows as sqlRows } from '../../../../db/queries/admin.ts';
import { listings, partnerProfiles, profiles } from '../../../../db/schema.ts';
import type { PartnerStatus } from '../../../../shared/types.ts';
import type { AppDeps } from '../../app.ts';
import { currentUser } from '../../http/auth.ts';
import { HttpError } from '../../http/errors.ts';
import { validate, validated } from '../../http/validate.ts';
import { toPartnerListing } from '../../lib/serialize.ts';
import { asNonNull, clientIp, likePattern, pageWindow, pagingShape } from '../partner/common.ts';

const STATUSES = ['pending', 'approved', 'rejected', 'suspended'] as const;
const userParams = z.object({ userId: z.string().uuid() });
const listSchemas = { query: z.object({ ...pagingShape, status: z.enum(STATUSES).optional(), q: z.string().trim().max(80).optional() }) };
const reasonBody = z.object({ reason: z.string().trim().min(10, 'Use 10-500 characters.').max(500, 'Use 10-500 characters.') });
const emptyBody = z.object({});

/** Legal moves: action -> [from, to]. */
const ACTIONS = {
  approve: { from: 'pending', to: 'approved', body: emptyBody },
  reject: { from: 'pending', to: 'rejected', body: reasonBody },
  suspend: { from: 'approved', to: 'suspended', body: reasonBody },
  reinstate: { from: 'suspended', to: 'approved', body: emptyBody },
} as const satisfies Record<string, { from: PartnerStatus; to: PartnerStatus; body: z.ZodType }>;

const listingCount = sql<number>`(select count(*)::int from listings where listings.partner_id = ${partnerProfiles.userId})`;

const columns = {
  userId: partnerProfiles.userId,
  fullName: profiles.fullName,
  email: profiles.email,
  phone: partnerProfiles.phone,
  businessName: partnerProfiles.businessName,
  businessType: partnerProfiles.businessType,
  city: partnerProfiles.city,
  status: partnerProfiles.status,
  submittedAt: partnerProfiles.submittedAt,
  listingCount,
};

const summary = <T extends { submittedAt: Date }>(row: T) => ({ ...row, submittedAt: row.submittedAt.toISOString() });

export function adminPartnerRoutes(deps: AppDeps): Router {
  const router = Router();
  const { db } = deps;

  const detail = async (userId: string) => {
    const [row] = await db
      .select({ ...columns, address: partnerProfiles.address, rejectionReason: partnerProfiles.rejectionReason, reviewedAt: partnerProfiles.reviewedAt, reviewedBy: partnerProfiles.reviewedBy })
      .from(partnerProfiles)
      .innerJoin(profiles, eq(profiles.id, partnerProfiles.userId))
      .where(eq(partnerProfiles.userId, userId))
      .limit(1);
    if (!row) throw new HttpError(404, 'NOT_FOUND', 'Partner not found.');
    const [reviewer] = row.reviewedBy ? await db.select({ id: profiles.id, fullName: profiles.fullName }).from(profiles).where(eq(profiles.id, row.reviewedBy)) : [];
    return { ...summary(row), reviewedAt: row.reviewedAt?.toISOString() ?? null, reviewedBy: reviewer ?? null };
  };

  router.get('/admin/partners', validate(listSchemas), async (req, res, next) => {
    try {
      const { query } = validated(req, listSchemas);
      const search = query.q ? likePattern(query.q) : null;
      const where = and(
        ...asNonNull([
          query.status && eq(partnerProfiles.status, query.status),
          search && or(ilike(partnerProfiles.businessName, search), ilike(profiles.fullName, search), ilike(profiles.email, search)),
        ]),
      );
      const [items, [total]] = await Promise.all([
        db.select(columns).from(partnerProfiles).innerJoin(profiles, eq(profiles.id, partnerProfiles.userId)).where(where).orderBy(desc(partnerProfiles.submittedAt)).limit(query.pageSize).offset(pageWindow(query.page, query.pageSize).offset),
        db.select({ n: sql<number>`count(*)::int` }).from(partnerProfiles).innerJoin(profiles, eq(profiles.id, partnerProfiles.userId)).where(where),
      ]);
      res.json({ items: items.map(summary), page: query.page, pageSize: query.pageSize, total: total?.n ?? 0 });
    } catch (err) {
      next(err);
    }
  });

  router.get('/admin/partners/:userId', validate({ params: userParams }), async (req, res, next) => {
    try {
      const { params } = validated(req, { params: userParams });
      const partner = await detail(params.userId);
      const rows = await db.select().from(listings).where(eq(listings.partnerId, params.userId)).orderBy(listings.createdAt);
      const stat = await sqlRows<Record<string, number | null>>(db, sql`
        select
          (select count(*)::int from bookings b join listings l on l.id = b.listing_id where l.partner_id = ${params.userId} and b.status = 'completed') as completed,
          (select count(*)::int from bookings b join listings l on l.id = b.listing_id where l.partner_id = ${params.userId} and b.status = 'cancelled') as cancelled,
          (select count(*)::int from bookings b join listings l on l.id = b.listing_id where l.partner_id = ${params.userId} and b.status in ('booked','dropped','stored')) as upcoming,
          (select count(*)::int from disputes d join bookings b on b.id = d.booking_id join listings l on l.id = b.listing_id where l.partner_id = ${params.userId}) as disputes,
          (select avg(r.score)::float from ratings r join listings l on l.id = r.listing_id where l.partner_id = ${params.userId}) as rating,
          (select coalesce(sum(p.platform_fee_paise), 0)::int from payments p join bookings b on b.id = p.booking_id join listings l on l.id = b.listing_id
             where l.partner_id = ${params.userId} and p.status = 'captured' and p.settlement_id is null) as due`);
      const s = stat[0] ?? {};
      res.json({
        partner,
        listings: rows.map((listing) => toPartnerListing({ listing, businessName: partner.businessName })),
        stats: { completed: s.completed ?? 0, cancelled: s.cancelled ?? 0, disputes: s.disputes ?? 0, ratingAverage: s.rating ?? null, feesDuePaise: s.due ?? 0, upcomingBookings: s.upcoming ?? 0 },
      });
    } catch (err) {
      next(err);
    }
  });

  for (const [name, rule] of Object.entries(ACTIONS)) {
    const schemas = { params: userParams, body: rule.body };
    router.post(`/admin/partners/:userId/${name}`, validate(schemas), async (req, res, next) => {
      try {
        const admin = currentUser(req);
        const { params, body } = validated(req, schemas);
        const reason = (body as { reason?: string }).reason ?? null;
        const impact = await db.transaction(async (tx) => {
          const [current] = await tx.select().from(partnerProfiles).where(eq(partnerProfiles.userId, params.userId)).for('update');
          if (!current) throw new HttpError(404, 'NOT_FOUND', 'Partner not found.');
          if (current.status !== rule.from) {
            throw new HttpError(409, 'INVALID_TRANSITION', `This partner is ${current.status}; only ${rule.from} partners can be ${name}${name.endsWith('e') ? 'd' : 'ed'}.`);
          }
          await setPartnerStatus(tx, { userId: params.userId, status: rule.to, reviewerId: admin.id, reason });
          await audit(tx, {
            actorId: admin.id,
            actorRole: 'admin',
            action: `partner.${name}`,
            entity: 'partner',
            entityId: params.userId,
            metadata: { from: current.status, to: rule.to, ...(reason ? { reason } : {}) },
            ip: clientIp(req),
          });
          const rows = await sqlRows<Record<string, number>>(tx, sql`
            select (select count(*)::int from listings where partner_id = ${params.userId}) as listings,
                   (select count(*)::int from bookings b join listings l on l.id = b.listing_id where l.partner_id = ${params.userId} and b.status in ('booked','dropped','stored')) as upcoming`);
          return { listings: Number(rows[0]?.listings ?? 0), upcomingBookings: Number(rows[0]?.upcoming ?? 0) };
        });
        res.json({ partner: await detail(params.userId), ...(name === 'suspend' ? { impact } : {}) });
      } catch (err) {
        next(err);
      }
    });
  }

  return router;
}
