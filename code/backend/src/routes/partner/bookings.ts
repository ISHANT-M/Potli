/** Partner booking list and detail, limited to bookings on the partner's own listings. */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { and, eq, ilike, or, sql, type SQL } from '../../../../db/orm.ts';
import { countBookingRecords, findBookingRecords, type BookingRecord } from '../../../../db/queries/partner.ts';
import { bookings, listings } from '../../../../db/schema.ts';
import { BOOKING_STATUSES } from '../../../../shared/bookingStatus.ts';
import type { AppDeps } from '../../app.ts';
import { authenticate, currentUser, requireRole } from '../../http/auth.ts';
import { HttpError } from '../../http/errors.ts';
import { validate, validated } from '../../http/validate.ts';
import { asNonNull, handoffsOf, idParams, likePattern, pageWindow, pagingShape, toPartnerBookings } from './common.ts';

const listSchemas = {
  query: z.object({
    ...pagingShape,
    status: z.enum(BOOKING_STATUSES).optional(),
    listingId: z.string().uuid().optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    q: z.string().trim().max(20).optional(),
  }),
};
const detailSchemas = { params: idParams };

/** Bookings of the signed-in partner's listings. */
export const ownedBy = (partnerId: string): SQL => eq(listings.partnerId, partnerId);

export async function loadOwnedBooking(deps: AppDeps, partnerId: string, bookingId: string): Promise<BookingRecord> {
  const [record] = await findBookingRecords(deps.db, and(eq(bookings.id, bookingId), ownedBy(partnerId)));
  if (!record) throw new HttpError(404, 'NOT_FOUND', 'Booking not found.');
  return record;
}

export const partnerOf = (req: Request) => currentUser(req);

export function bookingRoutes(deps: AppDeps): Router {
  const router = Router();
  const { db } = deps;
  const guard = [authenticate(deps), requireRole('storage_partner')];

  router.get('/partner/bookings', ...guard, validate(listSchemas), async (req, res, next) => {
    try {
      const me = currentUser(req);
      const { query } = validated(req, listSchemas);
      const day = query.date;
      const where = and(
        ...asNonNull([
          ownedBy(me.id),
          query.status && eq(bookings.status, query.status),
          query.listingId && eq(bookings.listingId, query.listingId),
          query.q && ilike(bookings.code, likePattern(query.q)),
          day &&
            or(
              sql`(${bookings.slotStart} at time zone 'Asia/Kolkata')::date = ${day}::date`,
              sql`(${bookings.slotEnd} at time zone 'Asia/Kolkata')::date = ${day}::date`,
            ),
        ]),
      );
      const [records, total] = await Promise.all([
        findBookingRecords(db, where, pageWindow(query.page, query.pageSize)),
        countBookingRecords(db, where),
      ]);
      res.json({ items: await toPartnerBookings(db, records), page: query.page, pageSize: query.pageSize, total });
    } catch (err) {
      next(err);
    }
  });

  router.get('/partner/bookings/:id', ...guard, validate(detailSchemas), async (req, res, next) => {
    try {
      const { params } = validated(req, detailSchemas);
      const record = await loadOwnedBooking(deps, currentUser(req).id, params.id);
      const [booking] = await toPartnerBookings(db, [record]);
      res.json({ booking, handoffs: await handoffsOf(db, record.booking.id) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
