/** Sign-in for API clients, the current user and profile edits. */
import { Router } from 'express';
import { z } from 'zod';
import { updateProfile } from '../../../db/profiles.ts';
import { loadPartnerProfile } from '../../../db/partners.ts';
import type { Me } from '../../../shared/types.ts';
import { NAME_MAX, NAME_MIN, PHONE_PATTERN } from '../../../shared/validation.ts';
import type { AppDeps } from '../app.ts';
import { authenticate, currentUser, publicMe, resolveUser } from '../http/auth.ts';
import { HttpError } from '../http/errors.ts';
import { loginLimiter, perUser } from '../http/rateLimit.ts';
import { validate, validated } from '../http/validate.ts';
import { toMe } from '../lib/serialize.ts';

const loginSchemas = {
  body: z.object({ email: z.string().trim().min(3).max(254), password: z.string().min(1).max(200) }),
};

const patchMeSchemas = {
  body: z
    .object({
      fullName: z.string().trim().min(NAME_MIN, `Use ${NAME_MIN}-${NAME_MAX} characters.`).max(NAME_MAX, `Use ${NAME_MIN}-${NAME_MAX} characters.`).optional(),
      phone: z.string().regex(PHONE_PATTERN, 'Use an Indian number such as +919876543210.').optional(),
    })
    .refine((value) => value.fullName !== undefined || value.phone !== undefined, 'Nothing to update.'),
};

/** Existing clients read `full_name`; keep it alongside the camelCase contract fields. */
const withLegacyFields = (me: Me) => ({ ...me, full_name: me.fullName });

export function authRouter(deps: AppDeps): Router {
  const router = Router();

  // Public, rate limited. The browser signs in through the Appwrite SDK instead.
  router.post('/auth/login', loginLimiter(), validate(loginSchemas), async (req, res, next) => {
    try {
      const { body } = validated(req, loginSchemas);
      const result = await deps.appwrite.signInWithPassword(body.email, body.password);
      if ('error' in result) {
        if (result.status === 429) throw new HttpError(429, 'RATE_LIMITED', 'Too many sign-in attempts. Please wait and try again.');
        throw new HttpError(401, 'UNAUTHENTICATED', 'Email or password is incorrect.');
      }
      const account = await deps.appwrite.accountFromJwt(result.jwt);
      if (!account) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign-in did not return a usable token.');
      const user = await resolveUser(deps, account);
      res.json({ token: result.jwt, user: withLegacyFields(publicMe(user)) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/auth/me', authenticate(deps), (req, res) => {
    res.json({ user: withLegacyFields(publicMe(currentUser(req))) });
  });

  router.patch('/me', authenticate(deps), perUser(30, 15 * 60_000), validate(patchMeSchemas), async (req, res, next) => {
    try {
      const user = currentUser(req);
      const { body } = validated(req, patchMeSchemas);
      const profile = await updateProfile(deps.db, user.id, body);
      if (!profile) throw new HttpError(404, 'NOT_FOUND', 'Account not found.');
      const partner = profile.role === 'storage_partner' ? await loadPartnerProfile(deps.db, profile.id) : null;
      res.json({ user: toMe(profile, partner, user.emailVerified) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
