/** Partner listings CRUD, always scoped to the signed-in partner (cover photo comes later). */
import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../../../../db/audit.ts';
import { and, eq } from '../../../../db/orm.ts';
import { peakFutureBags } from '../../../../db/queries/partner.ts';
import { listings, type ListingRow } from '../../../../db/schema.ts';
import type { AppDeps } from '../../app.ts';
import { authenticate, currentUser, requireApprovedPartner, requireRole } from '../../http/auth.ts';
import { HttpError } from '../../http/errors.ts';
import { validate, validated } from '../../http/validate.ts';
import { clock, toPartnerListing } from '../../lib/serialize.ts';
import { clientIp, idParams } from './common.ts';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const rupees = (paise: number) => `₹${paise / 100}`;

const shape = {
  name: z.string().trim().min(1, 'Required.').max(80, 'At most 80 characters.'),
  description: z.string().trim().max(600, 'At most 600 characters.'),
  address: z.string().trim().min(5, 'Use 5-200 characters.').max(200, 'Use 5-200 characters.'),
  area: z.string().trim().max(80, 'At most 80 characters.'),
  city: z.string().trim().min(2, 'Use 2-60 characters.').max(60, 'Use 2-60 characters.'),
  latitude: z.number().min(6, 'Pin must be in India.').max(37, 'Pin must be in India.'),
  longitude: z.number().min(68, 'Pin must be in India.').max(98, 'Pin must be in India.'),
  capacity: z.number().int('Whole bags only.').min(1, 'Use 1-200.').max(200, 'Use 1-200.'),
  hourlyRatePaise: z.number().int().min(1000, 'Rate must be ₹10 to ₹1000.').max(100000, 'Rate must be ₹10 to ₹1000.'),
  dailyCapPaise: z.number().int(),
  openTime: z.string().regex(TIME, 'Use HH:MM.'),
  closeTime: z.string().regex(TIME, 'Use HH:MM.'),
  openDays: z.array(z.number().int().min(0).max(6)).min(1, 'Pick at least one day.'),
  status: z.enum(['active', 'paused']),
};
const createSchemas = {
  body: z.object({ ...shape, description: shape.description.default(''), area: shape.area.default(''), status: shape.status.default('active') }),
};
const patchSchemas = {
  params: idParams,
  body: z.object(shape).partial().refine((v) => Object.keys(v).length > 0, 'Nothing to update.'),
};

type Candidate = Pick<ListingRow, 'hourlyRatePaise' | 'dailyCapPaise' | 'openTime' | 'closeTime' | 'openDays'>;

/** Cross-field rules from the schema contract; returns field messages (empty when valid). */
export function listingRuleErrors(v: Candidate): Record<string, string> {
  const errors: Record<string, string> = {};
  if (v.dailyCapPaise < v.hourlyRatePaise || v.dailyCapPaise > 24 * v.hourlyRatePaise) {
    errors.dailyCapPaise = `Daily cap must be between ${rupees(v.hourlyRatePaise)} and ${rupees(24 * v.hourlyRatePaise)}.`;
  }
  if (clock(v.closeTime) <= clock(v.openTime)) errors.closeTime = 'Closing time must be after opening time.';
  if (new Set(v.openDays).size !== v.openDays.length) errors.openDays = 'Days must be unique.';
  return errors;
}

function assertRules(v: Candidate): void {
  const errors = listingRuleErrors(v);
  if (Object.keys(errors).length > 0) throw new HttpError(400, 'VALIDATION_FAILED', 'Some details need fixing.', errors);
}

export function listingRoutes(deps: AppDeps): Router {
  const router = Router();
  const { db } = deps;
  const guard = [authenticate(deps), requireRole('storage_partner')];
  const dto = (listing: ListingRow, businessName: string) => toPartnerListing({ listing, businessName });

  router.get('/partner/listings', ...guard, async (req, res, next) => {
    try {
      const me = currentUser(req);
      const rows = await db.select().from(listings).where(eq(listings.partnerId, me.id)).orderBy(listings.createdAt);
      res.json({ items: rows.map((row) => dto(row, me.partner?.businessName ?? '')) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/partner/listings', ...guard, requireApprovedPartner, validate(createSchemas), async (req, res, next) => {
    try {
      const me = currentUser(req);
      const { body } = validated(req, createSchemas);
      assertRules(body);
      const row = await db.transaction(async (tx) => {
        const [created] = await tx.insert(listings).values({ ...body, partnerId: me.id }).returning();
        if (!created) throw new Error('listing not created');
        await audit(tx, { actorId: me.id, actorRole: 'storage_partner', action: 'listing.create', entity: 'listing', entityId: created.id, ip: clientIp(req) });
        return created;
      });
      res.status(201).json({ listing: dto(row, me.partner?.businessName ?? '') });
    } catch (err) {
      next(err);
    }
  });

  router.get('/partner/listings/:id', ...guard, validate({ params: idParams }), async (req, res, next) => {
    try {
      const me = currentUser(req);
      const { params } = validated(req, { params: idParams });
      const [row] = await db.select().from(listings).where(and(eq(listings.id, params.id), eq(listings.partnerId, me.id))).limit(1);
      if (!row) throw new HttpError(404, 'NOT_FOUND', 'Listing not found.');
      res.json({ listing: dto(row, me.partner?.businessName ?? '') });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/partner/listings/:id', ...guard, requireApprovedPartner, validate(patchSchemas), async (req, res, next) => {
    try {
      const me = currentUser(req);
      const { params, body } = validated(req, patchSchemas);
      const row = await db.transaction(async (tx) => {
        // The row lock also serialises this edit against new bookings of the listing.
        const [current] = await tx.select().from(listings).where(and(eq(listings.id, params.id), eq(listings.partnerId, me.id))).for('update');
        if (!current) throw new HttpError(404, 'NOT_FOUND', 'Listing not found.');
        if (current.status === 'flagged' && body.status !== undefined) {
          throw new HttpError(409, 'CONFLICT', 'This listing was flagged by Potli. Contact support to change its status.');
        }
        assertRules({ ...current, ...body, openTime: body.openTime ?? current.openTime, closeTime: body.closeTime ?? current.closeTime });
        if (body.capacity !== undefined && body.capacity < current.capacity) {
          const peak = await peakFutureBags(tx, current.id);
          if (peak > body.capacity) {
            throw new HttpError(409, 'CONFLICT', `Upcoming bookings need room for ${peak} bags at once, so capacity cannot go below ${peak}.`, { capacity: `At least ${peak}.` });
          }
        }
        const [updated] = await tx.update(listings).set({ ...body, updatedAt: new Date() }).where(eq(listings.id, current.id)).returning();
        if (!updated) throw new Error('listing not updated');
        await audit(tx, { actorId: me.id, actorRole: 'storage_partner', action: 'listing.update', entity: 'listing', entityId: current.id, metadata: { fields: Object.keys(body) }, ip: clientIp(req) });
        return updated;
      });
      res.json({ listing: dto(row, me.partner?.businessName ?? '') });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
