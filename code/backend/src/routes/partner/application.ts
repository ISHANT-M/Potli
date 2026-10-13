/** Partner application: apply, read and edit the business profile (rejected partners resubmit). */
import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../../../../db/audit.ts';
import { and, eq, sql } from '../../../../db/orm.ts';
import { setPartnerStatus } from '../../../../db/partners.ts';
import { bookings, partnerProfiles, profiles } from '../../../../db/schema.ts';
import { BUSINESS_TYPES, PHONE_PATTERN } from '../../../../shared/validation.ts';
import type { AppDeps } from '../../app.ts';
import { authenticate, currentUser, publicMe, requireRole, requireVerifiedEmail } from '../../http/auth.ts';
import { HttpError } from '../../http/errors.ts';
import { perUser } from '../../http/rateLimit.ts';
import { validate, validated } from '../../http/validate.ts';
import { toMe } from '../../lib/serialize.ts';
import { clientIp } from './common.ts';

const fields = {
  businessName: z.string().trim().min(2, 'Use 2-80 characters.').max(80, 'Use 2-80 characters.'),
  businessType: z.enum(BUSINESS_TYPES),
  phone: z.string().regex(PHONE_PATTERN, 'Use an Indian number such as +919876543210.'),
  address: z.string().trim().min(5, 'Use 5-200 characters.').max(200, 'Use 5-200 characters.'),
  city: z.string().trim().min(2, 'Use 2-60 characters.').max(60, 'Use 2-60 characters.'),
};
const applySchemas = { body: z.object(fields) };
const patchSchemas = {
  body: z.object(fields).partial().refine((v) => Object.keys(v).length > 0, 'Nothing to update.'),
};

const ALREADY = 'You already have a partner application, or this account is not a traveller account.';

export function applicationRoutes(deps: AppDeps): Router {
  const router = Router();
  const { db } = deps;

  router.post('/partners/apply', authenticate(deps), requireVerifiedEmail, perUser(5, 3_600_000), validate(applySchemas), async (req, res, next) => {
    try {
      const user = currentUser(req);
      const { body } = validated(req, applySchemas);
      const converted = await db.transaction(async (tx) => {
        const [profile] = await tx.select().from(profiles).where(eq(profiles.id, user.id)).for('update');
        if (!profile) throw new HttpError(404, 'NOT_FOUND', 'Account not found.');
        let convertedNow = false;
        if (profile.role === 'traveler') {
          const [row] = await tx.select({ n: sql<number>`count(*)::int` }).from(bookings).where(eq(bookings.travelerId, profile.id));
          if ((row?.n ?? 0) > 0) throw new HttpError(409, 'ALREADY_APPLIED', 'Accounts with bookings cannot become partners. Use a separate email for your business.');
          await tx.update(profiles).set({ role: 'storage_partner', updatedAt: new Date() }).where(eq(profiles.id, profile.id));
          await tx
            .insert(partnerProfiles)
            .values({ userId: profile.id, ...body, status: 'pending', submittedAt: new Date() })
            .onConflictDoUpdate({ target: partnerProfiles.userId, set: { ...body, status: 'pending', rejectionReason: null, submittedAt: new Date(), updatedAt: new Date() } });
          convertedNow = true;
        } else if (profile.role === 'storage_partner') {
          const [partner] = await tx.select().from(partnerProfiles).where(eq(partnerProfiles.userId, profile.id)).for('update');
          if (!partner || partner.status !== 'rejected') throw new HttpError(409, 'ALREADY_APPLIED', ALREADY);
          await tx.update(partnerProfiles).set({ ...body, updatedAt: new Date() }).where(eq(partnerProfiles.userId, profile.id));
          await setPartnerStatus(tx, { userId: profile.id, status: 'pending', reviewerId: null });
        } else {
          throw new HttpError(409, 'ALREADY_APPLIED', ALREADY);
        }
        await audit(tx, {
          actorId: profile.id,
          actorRole: 'storage_partner',
          action: convertedNow ? 'partner.apply' : 'partner.resubmit',
          entity: 'partner',
          entityId: profile.id,
          metadata: { businessType: body.businessType, city: body.city },
          ip: clientIp(req),
        });
        return { convertedNow, appwriteId: user.appwriteId };
      });

      if (converted.convertedNow) {
        // Postgres is the authority for the role; a failed label only affects Appwrite-side tooling.
        await deps.appwrite.setLabels(converted.appwriteId, ['storagePartner']).catch((err: unknown) => {
          console.error(`[${req.id ?? '-'}] could not set the storagePartner label: ${err instanceof Error ? err.message : 'unknown error'}`);
        });
      }
      const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id));
      const [partner] = await db.select().from(partnerProfiles).where(eq(partnerProfiles.userId, user.id));
      if (!profile || !partner) throw new HttpError(404, 'NOT_FOUND', 'Account not found.');
      res.status(201).json({ user: toMe(profile, partner, user.emailVerified) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/partner/me', authenticate(deps), requireRole('storage_partner'), (req, res) => {
    res.json({ user: publicMe(currentUser(req)) });
  });

  router.patch('/partner/me', authenticate(deps), requireRole('storage_partner'), perUser(30, 15 * 60_000), validate(patchSchemas), async (req, res, next) => {
    try {
      const user = currentUser(req);
      const { body } = validated(req, patchSchemas);
      await db.transaction(async (tx) => {
        const [partner] = await tx.select().from(partnerProfiles).where(eq(partnerProfiles.userId, user.id)).for('update');
        if (!partner) throw new HttpError(404, 'NOT_FOUND', 'Partner profile not found.');
        const locked = partner.status === 'approved' || partner.status === 'suspended';
        if (locked && Object.keys(body).some((key) => key !== 'phone' && key !== 'address')) {
          throw new HttpError(403, 'FORBIDDEN', 'Business name, type and city can only be changed by Potli support.');
        }
        await tx.update(partnerProfiles).set({ ...body, updatedAt: new Date() }).where(eq(partnerProfiles.userId, user.id));
        const resubmit = partner.status === 'rejected';
        if (resubmit) await setPartnerStatus(tx, { userId: user.id, status: 'pending', reviewerId: null });
        await audit(tx, {
          actorId: user.id,
          actorRole: 'storage_partner',
          action: resubmit ? 'partner.resubmit' : 'partner.update',
          entity: 'partner',
          entityId: user.id,
          metadata: { fields: Object.keys(body) },
          ip: clientIp(req),
        });
      });
      const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id));
      const [partner] = await db.select().from(partnerProfiles).where(and(eq(partnerProfiles.userId, user.id)));
      if (!profile) throw new HttpError(404, 'NOT_FOUND', 'Account not found.');
      res.json({ user: toMe(profile, partner ?? null, user.emailVerified) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
