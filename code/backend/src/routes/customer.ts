/**
 * Customer (traveller) routes, owned by the Customer agent: listing search and detail,
 * quotes, bookings, cancellation, ratings and traveller disputes (02-CONTRACTS section 8).
 * Foundation only mounts this router; add routes here and nowhere else.
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { audit } from '../../../db/audit.ts';
import { availableBags, createBooking, transitionBooking } from '../../../db/bookings.ts';
import { and, eq } from '../../../db/orm.ts';
import {
  findTravelerBookings,
  findVisibleListing,
  findVisibleListings,
  recentRatings,
  type TravelerBookingRow,
} from '../../../db/queries/customer.ts';
import { isUniqueViolation } from '../../../db/errors.ts';
import { bookings, disputes, ratings } from '../../../db/schema.ts';
import { isWithinOpeningHours, MAX_ADVANCE_DAYS, MAX_BAGS, MAX_DAYS, quote } from '../../../shared/pricing.ts';
import type { Booking, ListingSummary } from '../../../shared/types.ts';
import type { AppDeps } from '../app.ts';
import { authenticate, currentUser, requireRole, requireVerifiedEmail } from '../http/auth.ts';
import { HttpError } from '../http/errors.ts';
import { perUser } from '../http/rateLimit.ts';
import { validate, validated } from '../http/validate.ts';
import { toBooking, toListingDetail, toListingSummary } from '../lib/serialize.ts';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const SKEW_MS = 5 * 60_000;

const instant = z.iso.datetime({ offset: true, message: 'Use a valid date and time.' }).transform((value) => new Date(value));
const bags = z.coerce.number().int().min(1, `Choose 1-${MAX_BAGS} bags.`).max(MAX_BAGS, `Choose 1-${MAX_BAGS} bags.`);
const page = z.coerce.number().int().min(1).default(1);
const pageSize = z.coerce.number().int().min(1).max(50).default(20);
const idParams = { params: z.object({ id: z.uuid('Not found.') }) };

const listingsSchemas = {
  query: z
    .object({
      q: z.string().trim().max(80).optional(),
      city: z.string().trim().max(80).optional(),
      lat: z.coerce.number().min(-90).max(90).optional(),
      lng: z.coerce.number().min(-180).max(180).optional(),
      radiusKm: z.coerce.number().min(1).max(50).optional(),
      start: instant.optional(),
      end: instant.optional(),
      bags: bags.optional(),
      sort: z.enum(['distance', 'price', 'rating']).optional(),
      page,
      pageSize,
    })
    .refine((v) => (v.lat === undefined) === (v.lng === undefined), { message: 'Send lat and lng together.', path: ['lat'] })
    .refine((v) => [v.start, v.end, v.bags].filter((x) => x !== undefined).length % 3 === 0, { message: 'Send start, end and bags together.', path: ['start'] })
    .refine((v) => !v.start || !v.end || v.end > v.start, { message: 'The end must be after the start.', path: ['end'] }),
};

const quoteSchemas = { ...idParams, query: z.object({ start: instant, end: instant, bags }) };

const createSchemas = {
  body: z.object({
    listingId: z.uuid('Choose a listing.'),
    bags,
    slotStart: instant,
    slotEnd: instant,
    paymentMethod: z.enum(['cod', 'upi', 'card']),
    searchStartedAt: z.iso.datetime({ offset: true }).optional().catch(undefined),
  }),
};

const listBookingsSchemas = { query: z.object({ scope: z.enum(['upcoming', 'past', 'all']).default('all'), page, pageSize }) };
const cancelSchemas = { ...idParams, body: z.object({ reason: z.string().trim().max(300).optional() }) };

const ratingSchemas = {
  ...idParams,
  body: z.object({ score: z.number().int().min(1, 'Choose 1-5 stars.').max(5, 'Choose 1-5 stars.'), comment: z.string().trim().max(500).default('') }),
};
const disputeSchemas = {
  ...idParams,
  body: z.object({ reason: z.string().trim().min(10, 'Tell us a little more (10+ characters).').max(1000, 'Keep it under 1000 characters.') }),
};

type SlotProblem = 'SLOT_INVALID' | 'OUTSIDE_OPENING_HOURS';

/** The slot rules of 02-CONTRACTS section 3, as a reason code instead of an exception. */
function slotProblem(
  hours: { openTime: string; closeTime: string; openDays: readonly number[] },
  start: Date,
  end: Date,
  now: Date,
): { code: SlotProblem; message: string } | null {
  if (!(end > start)) return { code: 'SLOT_INVALID', message: 'The end time must be after the start time.' };
  if (start.getTime() < now.getTime() - SKEW_MS) return { code: 'SLOT_INVALID', message: 'The start time is in the past.' };
  if (start.getTime() > now.getTime() + MAX_ADVANCE_DAYS * DAY_MS) {
    return { code: 'SLOT_INVALID', message: `Bookings open ${MAX_ADVANCE_DAYS} days ahead at most.` };
  }
  if (end.getTime() - start.getTime() > MAX_DAYS * DAY_MS) {
    return { code: 'SLOT_INVALID', message: `Storage is limited to ${MAX_DAYS} days per booking.` };
  }
  if (!isWithinOpeningHours(start, hours) || !isWithinOpeningHours(end, hours)) {
    return { code: 'OUTSIDE_OPENING_HOURS', message: 'Drop-off and pickup must fall within opening hours.' };
  }
  return null;
}

const asKey = (value: unknown): string | null =>
  typeof value === 'string' && z.uuid().safeParse(value).success ? value : null;

export function customerRouter(deps: AppDeps): Router {
  const router = Router();
  const { db } = deps;
  const traveller = [authenticate(deps), requireRole('traveler')];

  const present = (row: TravelerBookingRow, withCode: boolean): Booking =>
    toBooking({
      booking: row.booking,
      listing: row.listing,
      businessName: row.businessName,
      partnerPhone: row.partnerPhone,
      payment: row.payment,
      dropOffPhotoIds: row.dropOffPhotoIds,
      rating: row.rating,
      handoffCode: withCode ? deps.handoff.codeFor(row.booking) : null,
    });

  const ownBooking = async (req: Request, id: string): Promise<TravelerBookingRow> => {
    const { rows } = await findTravelerBookings(db, currentUser(req).id, { id, limit: 1 });
    const row = rows[0];
    if (!row) throw new HttpError(404, 'NOT_FOUND', 'Booking not found.');
    return row;
  };

  router.get('/listings', validate(listingsSchemas), async (req, res, next) => {
    try {
      const { query } = validated(req, listingsSchemas);
      const hasLatLng = query.lat !== undefined && query.lng !== undefined;
      const found = await findVisibleListings(db, {
        ...(query.q ? { q: query.q } : {}),
        ...(query.city ? { city: query.city } : {}),
        ...(hasLatLng ? { lat: query.lat, lng: query.lng, radiusKm: query.radiusKm ?? 10 } : {}),
        ...(query.sort ? { sort: query.sort } : {}),
      });

      const window = query.start && query.end && query.bags ? { start: query.start, end: query.end } : null;
      const items: ListingSummary[] = [];
      for (const row of found) {
        let available: number | null = null;
        if (window) {
          // Closed at drop-off or pickup: not bookable for this window, so hide it.
          if (!isWithinOpeningHours(window.start, row.listing) || !isWithinOpeningHours(window.end, row.listing)) continue;
          available = await availableBags(db, row.listing.id, window.start, window.end);
        }
        items.push(toListingSummary({ ...row, available }));
      }
      const start = (query.page - 1) * query.pageSize;
      res.json({ items: items.slice(start, start + query.pageSize), page: query.page, pageSize: query.pageSize, total: items.length });
    } catch (err) {
      next(err);
    }
  });

  router.get('/listings/:id', validate(idParams), async (req, res, next) => {
    try {
      const { params } = validated(req, idParams);
      const row = await findVisibleListing(db, params.id);
      if (!row) throw new HttpError(404, 'NOT_FOUND', 'Listing not found.');
      res.json({ listing: toListingDetail(row), recentRatings: await recentRatings(db, row.listing.id) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/listings/:id/quote', validate(quoteSchemas), async (req, res, next) => {
    try {
      const { params, query } = validated(req, quoteSchemas);
      const row = await findVisibleListing(db, params.id);
      if (!row) throw new HttpError(404, 'NOT_FOUND', 'Listing not found.');
      const { listing } = row;
      const problem = slotProblem(listing, query.start, query.end, new Date());
      const priced = query.end > query.start ? quote(listing, query.bags, query.start, query.end) : null;
      const remaining = priced ? await availableBags(db, listing.id, query.start, query.end) : 0;
      const reason = problem?.code ?? (priced && remaining < query.bags ? 'CAPACITY_UNAVAILABLE' : undefined);
      res.json({
        available: reason === undefined,
        remaining,
        quotedPaise: priced?.totalPaise ?? 0,
        hours: priced?.hours ?? Math.max(1, Math.ceil((query.end.getTime() - query.start.getTime()) / HOUR_MS)),
        ...(reason ? { reason, message: problem?.message ?? 'Not enough space is free for those bags in that window.' } : {}),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/bookings',
    ...traveller,
    requireVerifiedEmail,
    perUser(20, 60 * 60_000),
    validate(createSchemas),
    async (req, res, next) => {
      try {
        const user = currentUser(req);
        const { body } = validated(req, createSchemas);
        const key = asKey(req.header('Idempotency-Key'));
        if (!key) throw new HttpError(400, 'VALIDATION_FAILED', 'Send an Idempotency-Key header (a UUID).', { 'Idempotency-Key': 'Required.' });
        if (body.paymentMethod !== 'cod') {
          throw new HttpError(422, 'PAYMENT_METHOD_UNAVAILABLE', 'UPI and card payments are coming soon. Choose Cash on pickup.');
        }

        // Accept the BFT start only when it is within the last 24 h and not in the future.
        const now = Date.now();
        const started = body.searchStartedAt ? new Date(body.searchStartedAt) : null;
        const searchStartedAt = started && started.getTime() <= now && now - started.getTime() <= DAY_MS ? started : null;

        const { booking, created } = await createBooking(db, {
          travelerId: user.id,
          listingId: body.listingId,
          bagCount: body.bags,
          slotStart: body.slotStart,
          slotEnd: body.slotEnd,
          searchStartedAt,
          idempotencyKey: key,
        });
        if (created) {
          await audit(db, {
            actorId: user.id,
            actorRole: user.role,
            action: 'booking.create',
            entity: 'booking',
            entityId: booking.id,
            ip: req.ip ?? null,
          });
        }
        res.status(created ? 201 : 200).json({ booking: present(await ownBooking(req, booking.id), true) });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get('/bookings', ...traveller, validate(listBookingsSchemas), async (req, res, next) => {
    try {
      const { query } = validated(req, listBookingsSchemas);
      const { rows, total } = await findTravelerBookings(db, currentUser(req).id, {
        scope: query.scope,
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
      });
      res.json({ items: rows.map((row) => present(row, false)), page: query.page, pageSize: query.pageSize, total });
    } catch (err) {
      next(err);
    }
  });

  router.get('/bookings/:id', ...traveller, validate(idParams), async (req, res, next) => {
    try {
      const { params } = validated(req, idParams);
      res.json({ booking: present(await ownBooking(req, params.id), true) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/bookings/:id/cancel', ...traveller, validate(cancelSchemas), async (req, res, next) => {
    try {
      const user = currentUser(req);
      const { params, body } = validated(req, cancelSchemas);
      await transitionBooking(db, {
        bookingId: params.id,
        from: ['booked'],
        to: 'cancelled',
        actorId: user.id,
        patch: { cancelReason: body.reason ?? null },
        visibleWhere: and(eq(bookings.travelerId, user.id)),
      });
      await audit(db, {
        actorId: user.id,
        actorRole: user.role,
        action: 'booking.cancel',
        entity: 'booking',
        entityId: params.id,
        ip: req.ip ?? null,
      });
      res.json({ booking: present(await ownBooking(req, params.id), true) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/bookings/:id/rating', ...traveller, validate(ratingSchemas), async (req, res, next) => {
    try {
      const user = currentUser(req);
      const { params, body } = validated(req, ratingSchemas);
      const { booking } = await ownBooking(req, params.id);
      if (booking.status !== 'completed') throw new HttpError(409, 'INVALID_TRANSITION', 'You can rate a booking once it is completed.');
      try {
        const [rating] = await db
          .insert(ratings)
          .values({ bookingId: booking.id, travelerId: user.id, listingId: booking.listingId, score: body.score, comment: body.comment })
          .returning({ score: ratings.score, comment: ratings.comment });
        res.status(201).json({ rating });
      } catch (err) {
        if (isUniqueViolation(err) || isUniqueViolation((err as { cause?: unknown }).cause)) throw new HttpError(409, 'ALREADY_RATED', 'You have already rated this booking.');
        throw err;
      }
    } catch (err) {
      next(err);
    }
  });

  router.post('/bookings/:id/disputes', ...traveller, perUser(10, 60 * 60_000), validate(disputeSchemas), async (req, res, next) => {
    try {
      const user = currentUser(req);
      const { params, body } = validated(req, disputeSchemas);
      const { booking } = await ownBooking(req, params.id);
      if (booking.status === 'booked') throw new HttpError(409, 'INVALID_TRANSITION', 'You can report a problem once your bags have been handed over.');
      if (Date.now() - booking.updatedAt.getTime() > 14 * DAY_MS) {
        throw new HttpError(409, 'DISPUTE_WINDOW_CLOSED', 'Problems can be reported within 14 days of the last update.');
      }
      try {
        const [dispute] = await db
          .insert(disputes)
          .values({ bookingId: booking.id, raisedBy: user.id, raisedByRole: user.role, reason: body.reason })
          .returning({ id: disputes.id, status: disputes.status, createdAt: disputes.createdAt });
        await audit(db, { actorId: user.id, actorRole: user.role, action: 'dispute.create', entity: 'booking', entityId: booking.id, ip: req.ip ?? null });
        res.status(201).json({ dispute });
      } catch (err) {
        if (isUniqueViolation(err) || isUniqueViolation((err as { cause?: unknown }).cause)) throw new HttpError(409, 'ALREADY_DISPUTED', 'You already have an open report for this booking.');
        throw err;
      }
    } catch (err) {
      next(err);
    }
  });

  return router;
}
