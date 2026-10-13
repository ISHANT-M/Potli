/** Authorized image delivery: GET /files/:fileId (02-CONTRACTS section 6). */
import { eq, sql } from '../../../db/orm.ts';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { bookings, handoffRecords, listings, partnerProfiles, profiles } from '../../../db/schema.ts';
import type { AppDeps } from '../app.ts';
import { optionalAuth } from '../http/auth.ts';
import { HttpError } from '../http/errors.ts';
import { validate, validated } from '../http/validate.ts';

const schemas = { params: z.object({ fileId: z.string().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/) }) };

const SERVED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

type Viewer = { id: string; role: string } | null;

async function canSeeListingCover(deps: AppDeps, fileId: string, viewer: Viewer): Promise<boolean> {
  const [row] = await deps.db
    .select({
      partnerId: listings.partnerId,
      status: listings.status,
      partnerStatus: partnerProfiles.status,
      partnerDisabled: profiles.isDisabled,
    })
    .from(listings)
    .innerJoin(partnerProfiles, eq(partnerProfiles.userId, listings.partnerId))
    .innerJoin(profiles, eq(profiles.id, listings.partnerId))
    .where(eq(listings.coverFileId, fileId))
    .limit(1);
  if (!row) return false;
  if (row.status === 'active' && row.partnerStatus === 'approved' && !row.partnerDisabled) return true;
  return viewer !== null && (viewer.role === 'admin' || viewer.id === row.partnerId);
}

async function canSeeHandoffPhoto(deps: AppDeps, fileId: string, viewer: Viewer): Promise<boolean> {
  if (!viewer) return false;
  const [row] = await deps.db
    .select({ travelerId: bookings.travelerId, partnerId: listings.partnerId })
    .from(handoffRecords)
    .innerJoin(bookings, eq(bookings.id, handoffRecords.bookingId))
    .innerJoin(listings, eq(listings.id, bookings.listingId))
    .where(sql`${fileId} = any(${handoffRecords.photoFileIds})`)
    .limit(1);
  if (!row) return false;
  return viewer.role === 'admin' || viewer.id === row.travelerId || viewer.id === row.partnerId;
}

export function filesRouter(deps: AppDeps): Router {
  const router = Router();

  // Auth is optional: listing covers of visible listings are public, everything else needs a viewer.
  router.get('/files/:fileId', optionalAuth(deps), validate(schemas), async (req, res: Response, next) => {
    try {
      const { params } = validated(req, schemas);
      const viewer: Viewer = req.user ? { id: req.user.id, role: req.user.role } : null;
      const notFound = new HttpError(404, 'NOT_FOUND', 'File not found.');

      let bucket: string;
      if (await canSeeListingCover(deps, params.fileId, viewer)) {
        bucket = deps.config.buckets.listing;
      } else if (await canSeeHandoffPhoto(deps, params.fileId, viewer)) {
        bucket = deps.config.buckets.handoff;
      } else {
        // Unknown and unauthorized files look identical.
        throw notFound;
      }

      const file = await deps.appwrite.downloadFile(bucket, params.fileId);
      if (!file) throw notFound;

      res.setHeader('Content-Type', SERVED_TYPES.has(file.mime) ? file.mime : 'application/octet-stream');
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.setHeader('Content-Disposition', 'inline');
      res.send(file.buffer);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
