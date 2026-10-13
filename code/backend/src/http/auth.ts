/** Authentication and authorization middleware; every route declares what it needs. */
import type { Request, RequestHandler } from 'express';
import { ensureProfile, type Profile } from '../../../db/profiles.ts';
import { loadPartnerProfile } from '../../../db/partners.ts';
import type { Role } from '../../../db/schema.ts';
import type { Me } from '../../../shared/types.ts';
import type { AppDeps } from '../app.ts';
import { INFRA_LABEL, type AppwriteAccount } from '../appwrite.ts';
import { toMe } from '../lib/serialize.ts';
import { HttpError } from './errors.ts';

/** The signed-in user as every router sees it. */
export type AuthUser = Me & { appwriteId: string };

export function bearerToken(req: Request): string | null {
  const [scheme, token] = (req.headers.authorization ?? '').split(' ');
  return scheme === 'Bearer' && token ? token : null;
}

async function buildUser(deps: AppDeps, profile: Profile, account: AppwriteAccount): Promise<AuthUser> {
  const partner = profile.role === 'storage_partner' ? await loadPartnerProfile(deps.db, profile.id) : null;
  return { ...toMe(profile, partner, account.emailVerification === true), appwriteId: account.$id };
}

/**
 * Turn a verified Appwrite account into a Potli user. The infrastructure account is
 * refused before any profile exists, and disabled accounts are refused after.
 */
export async function resolveUser(deps: AppDeps, account: AppwriteAccount): Promise<AuthUser> {
  if (account.labels?.includes(INFRA_LABEL)) {
    throw new HttpError(403, 'FORBIDDEN', 'This account cannot use Potli.');
  }
  // Postgres is the authority for the role; the label only seeds a brand-new profile as a traveller.
  const profile = await ensureProfile(deps.db, {
    appwriteUserId: account.$id,
    email: account.email,
    fullName: account.name ?? '',
    role: 'traveler',
  });
  if (profile.isDisabled) throw new HttpError(403, 'ACCOUNT_DISABLED', 'This account has been disabled. Contact support.');
  return buildUser(deps, profile, account);
}

/** Requires a valid Bearer JWT and sets req.user. */
export function authenticate(deps: AppDeps): RequestHandler {
  return async (req, _res, next) => {
    try {
      const token = bearerToken(req);
      if (!token) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
      const account = await deps.appwrite.accountFromJwt(token);
      if (!account) throw new HttpError(401, 'UNAUTHENTICATED', 'Your session has expired. Please sign in again.');
      req.user = await resolveUser(deps, account);
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Public routes that personalise when signed in; an invalid token is treated as anonymous. */
export function optionalAuth(deps: AppDeps): RequestHandler {
  return async (req, _res, next) => {
    try {
      const token = bearerToken(req);
      if (token) {
        const account = await deps.appwrite.accountFromJwt(token);
        if (account) req.user = await resolveUser(deps, account);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** The signed-in user; only call behind `authenticate`. */
export function currentUser(req: Request): AuthUser {
  return signedIn(req);
}

/** The API shape of the user: `Me` without the internal Appwrite id. */
export function publicMe(user: AuthUser): Me {
  const { appwriteId: _appwriteId, ...me } = user;
  return me;
}

function signedIn(req: Request): AuthUser {
  if (!req.user) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
  return req.user;
}

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    try {
      const user = signedIn(req);
      if (!roles.includes(user.role)) throw new HttpError(403, 'FORBIDDEN', 'You do not have access to this.');
      next();
    } catch (err) {
      next(err);
    }
  };
}

export const requireVerifiedEmail: RequestHandler = (req, _res, next) => {
  try {
    if (!signedIn(req).emailVerified) {
      throw new HttpError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email address to continue.');
    }
    next();
  } catch (err) {
    next(err);
  }
};

export const requireApprovedPartner: RequestHandler = (req, _res, next) => {
  try {
    const user = signedIn(req);
    if (user.role !== 'storage_partner') throw new HttpError(403, 'FORBIDDEN', 'You do not have access to this.');
    if (user.partner?.status !== 'approved') {
      throw new HttpError(403, 'PARTNER_NOT_APPROVED', 'Your partner application has not been approved yet.');
    }
    next();
  } catch (err) {
    next(err);
  }
};
