/** Counter workflow: lookup, check-in, drop-off photos and pickup with cash. */
import { Router } from 'express';
import type { RequestHandler } from 'express';
import { z } from 'zod';
import { audit } from '../../../../db/audit.ts';
import { transitionBooking } from '../../../../db/bookings.ts';
import { and, eq, sql } from '../../../../db/orm.ts';
import { findBookingRecords } from '../../../../db/queries/partner.ts';
import { auditLog, bookings, handoffRecords, payments } from '../../../../db/schema.ts';
import { computeFee, quote } from '../../../../shared/pricing.ts';
import { OTP_PATTERN } from '../../../../shared/validation.ts';
import type { PartnerBooking } from '../../../../shared/types.ts';
import type { AppDeps } from '../../app.ts';
import { authenticate, currentUser, requireRole } from '../../http/auth.ts';
import { HttpError } from '../../http/errors.ts';
import { perUser } from '../../http/rateLimit.ts';
import { detectImageMime, EXTENSION_FOR, uploadPhotos } from '../../http/upload.ts';
import { validate, validated } from '../../http/validate.ts';
import { checkOtpAttempt } from '../../lib/handoff.ts';
import { clientIp, idParams, toPartnerBookings } from './common.ts';
import { loadOwnedBooking, ownedBy } from './bookings.ts';

const CHECK_IN_EARLY_MS = 30 * 60_000;

const lookupSchemas = { body: z.object({ code: z.string().trim().min(3).max(20) }) };
const checkInSchemas = { params: idParams, body: z.object({ otp: z.string().regex(OTP_PATTERN, 'Enter the 6-digit code.'), method: z.enum(['qr', 'otp']) }) };
const dropOffSchemas = {
  params: idParams,
  body: z.object({
    bagCount: z.coerce.number().int().min(1).max(10),
    note: z.string().trim().max(300).optional(),
  }),
};
const pickupSchemas = {
  params: idParams,
  body: z.object({
    otp: z.string().regex(OTP_PATTERN, 'Enter the 6-digit code.'),
    method: z.enum(['qr', 'otp']),
    cashCollectedPaise: z.number().int().min(0),
  }),
};

/** Approved partners and suspended ones (who may still finish existing handoffs). */
const requireHandoffPartner: RequestHandler = (req, _res, next) => {
  const status = req.user?.partner?.status;
  if (status !== 'approved' && status !== 'suspended') {
    next(new HttpError(403, 'PARTNER_NOT_APPROVED', 'Your partner application has not been approved yet.'));
    return;
  }
  next();
};

export function handoffRoutes(deps: AppDeps): Router {
  const router = Router();
  const { db } = deps;
  const guard = [authenticate(deps), requireRole('storage_partner'), requireHandoffPartner];

  const reload = async (partnerId: string, bookingId: string): Promise<PartnerBooking> => {
    const record = await loadOwnedBooking(deps, partnerId, bookingId);
    const [booking] = await toPartnerBookings(db, [record]);
    if (!booking) throw new HttpError(404, 'NOT_FOUND', 'Booking not found.');
    return booking;
  };

  router.post('/partner/handoffs/lookup', ...guard, perUser(30, 15 * 60_000), validate(lookupSchemas), async (req, res, next) => {
    try {
      const me = currentUser(req);
      const { body } = validated(req, lookupSchemas);
      const [record] = await findBookingRecords(db, and(sql`upper(${bookings.code}) = ${body.code.toUpperCase()}`, ownedBy(me.id)));
      if (!record) throw new HttpError(404, 'NOT_FOUND', 'No booking with that code at your locations.');
      const [booking] = await toPartnerBookings(db, [record]);
      const status = record.booking.status;
      const expected = status === 'booked' || status === 'dropped' ? 'drop_off' : status === 'stored' ? 'pickup' : null;
      res.json({ booking, expected });
    } catch (err) {
      next(err);
    }
  });

  router.post('/partner/bookings/:id/check-in', ...guard, validate(checkInSchemas), async (req, res, next) => {
    try {
      const me = currentUser(req);
      const { params, body } = validated(req, checkInSchemas);
      const { booking } = await loadOwnedBooking(deps, me.id, params.id);
      if (booking.status !== 'booked') {
        throw new HttpError(409, 'INVALID_TRANSITION', `This booking is ${booking.status.replace('_', ' ')} and cannot be checked in.`);
      }
      const now = Date.now();
      if (now < booking.slotStart.getTime() - CHECK_IN_EARLY_MS) {
        throw new HttpError(400, 'SLOT_INVALID', 'Check-in opens 30 minutes before the booked slot.');
      }
      if (now > booking.slotEnd.getTime()) throw new HttpError(400, 'SLOT_INVALID', 'The booked slot has ended.');

      await checkOtpAttempt(db, deps.handoff, {
        bookingId: booking.id,
        type: 'drop_off',
        candidate: body.otp,
        actor: { id: me.id, role: 'storage_partner' },
        ip: clientIp(req),
      });
      await db.transaction(async (tx) => {
        await transitionBooking(tx, { bookingId: booking.id, from: ['booked'], to: 'dropped', actorId: me.id });
        await audit(tx, { actorId: me.id, actorRole: 'storage_partner', action: 'handoff.check_in', entity: 'booking', entityId: booking.id, metadata: { method: body.method }, ip: clientIp(req) });
      });
      res.json({ booking: await reload(me.id, booking.id) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/partner/bookings/:id/drop-off', ...guard, uploadPhotos('photos'), validate(dropOffSchemas), async (req, res, next) => {
    try {
      const me = currentUser(req);
      const { params, body } = validated(req, dropOffSchemas);
      const { booking } = await loadOwnedBooking(deps, me.id, params.id);

      const [existing] = await db.select({ id: handoffRecords.id }).from(handoffRecords).where(and(eq(handoffRecords.bookingId, booking.id), eq(handoffRecords.type, 'drop_off')));
      if (existing) {
        res.json({ booking: await reload(me.id, booking.id) }); // a retry of a request that already succeeded
        return;
      }
      if (booking.status !== 'dropped') {
        throw new HttpError(409, 'INVALID_TRANSITION', `This booking is ${booking.status.replace('_', ' ')}; check it in first.`);
      }
      const files = Array.isArray(req.files) ? req.files : [];
      if (files.length < 1) throw new HttpError(400, 'VALIDATION_FAILED', 'Add at least one photo of the bags.', { photos: 'Add 1-4 photos.' });
      const note = body.note ?? '';
      if (body.bagCount !== booking.bagCount && note.length === 0) {
        throw new HttpError(400, 'VALIDATION_FAILED', `The booking says ${booking.bagCount} bags. Add a note to explain the difference.`, { note: 'Explain the different bag count.' });
      }

      const [checkIn] = await db
        .select({ metadata: auditLog.metadata })
        .from(auditLog)
        .where(and(eq(auditLog.entity, 'booking'), eq(auditLog.entityId, booking.id), eq(auditLog.action, 'handoff.check_in')))
        .limit(1);
      const method = (checkIn?.metadata as { method?: string } | undefined)?.method === 'qr' ? 'qr' : 'otp';

      const fileIds: string[] = [];
      for (const file of files) {
        const mime = detectImageMime(file.buffer) ?? 'image/jpeg';
        fileIds.push(await deps.appwrite.uploadFile(deps.config.buckets.handoff, file.buffer, `${booking.code}-${fileIds.length + 1}.${EXTENSION_FOR[mime]}`, mime));
      }

      await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(handoffRecords)
          .values({ bookingId: booking.id, type: 'drop_off', method, verifiedBy: me.id, bagCount: body.bagCount, photoFileIds: fileIds, note })
          .onConflictDoNothing()
          .returning({ id: handoffRecords.id });
        if (inserted.length === 0) return; // lost a race with an identical request
        await transitionBooking(tx, { bookingId: booking.id, from: ['dropped'], to: 'stored', actorId: me.id });
        await audit(tx, { actorId: me.id, actorRole: 'storage_partner', action: 'handoff.drop_off', entity: 'booking', entityId: booking.id, metadata: { bagCount: body.bagCount, photos: fileIds.length }, ip: clientIp(req) });
      });
      res.json({ booking: await reload(me.id, booking.id) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/partner/bookings/:id/pickup', ...guard, validate(pickupSchemas), async (req, res, next) => {
    try {
      const me = currentUser(req);
      const { params, body } = validated(req, pickupSchemas);
      const { booking, listing } = await loadOwnedBooking(deps, me.id, params.id);
      if (booking.status !== 'stored') {
        throw new HttpError(409, 'INVALID_TRANSITION', `This booking is ${booking.status.replace('_', ' ')} and cannot be picked up.`);
      }
      await checkOtpAttempt(db, deps.handoff, {
        bookingId: booking.id,
        type: 'pickup',
        candidate: body.otp,
        actor: { id: me.id, role: 'storage_partner' },
        ip: clientIp(req),
      });

      const now = new Date();
      const end = booking.slotEnd > now ? booking.slotEnd : now;
      const { totalPaise: finalPaise } = quote(listing, booking.bagCount, booking.slotStart, end);
      if (body.cashCollectedPaise !== finalPaise) {
        throw new HttpError(400, 'VALIDATION_FAILED', `The amount to collect is ${finalPaise / 100} rupees.`, {
          cashCollectedPaise: `Collect exactly ${finalPaise / 100} rupees (${finalPaise} paise).`,
        });
      }
      const feePaise = computeFee(finalPaise);

      await db.transaction(async (tx) => {
        await transitionBooking(tx, { bookingId: booking.id, from: ['stored'], to: 'picked_up', actorId: me.id, patch: { finalPaise } });
        await tx.insert(handoffRecords).values({ bookingId: booking.id, type: 'pickup', method: body.method, verifiedBy: me.id, bagCount: booking.bagCount });
        await transitionBooking(tx, { bookingId: booking.id, from: ['picked_up'], to: 'completed', actorId: me.id });
        const captured = await tx
          .update(payments)
          .set({ status: 'captured', amountPaise: finalPaise, platformFeePaise: feePaise, partnerSharePaise: finalPaise - feePaise, collectedAt: now, collectedBy: me.id, updatedAt: now })
          .where(and(eq(payments.bookingId, booking.id), eq(payments.status, 'pending')))
          .returning({ id: payments.id });
        if (captured.length === 0) throw new HttpError(409, 'CONFLICT', 'This booking has no pending payment to collect.');
        await audit(tx, { actorId: me.id, actorRole: 'storage_partner', action: 'handoff.pickup', entity: 'booking', entityId: booking.id, metadata: { finalPaise, feePaise, method: body.method }, ip: clientIp(req) });
      });
      res.json({ booking: await reload(me.id, booking.id) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
