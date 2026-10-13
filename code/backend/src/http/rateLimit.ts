/** express-rate-limit presets. Create them per app instance so counters never leak between apps. */
import type { Request, RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { HttpError } from './errors.ts';

const FIFTEEN_MINUTES = 15 * 60_000;

function limiter(limit: number, windowMs: number, keyGenerator?: (req: Request) => string): RequestHandler {
  return rateLimit({
    limit,
    windowMs,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    ...(keyGenerator ? { keyGenerator } : {}),
    handler: (_req, _res, next) => next(new HttpError(429, 'RATE_LIMITED', 'Too many requests. Please wait a moment and try again.')),
  });
}

/** 300 requests per 15 minutes per IP across the whole API. */
export const globalLimiter = (): RequestHandler => limiter(300, FIFTEEN_MINUTES);

/** 10 login attempts per 15 minutes per IP. */
export const loginLimiter = (): RequestHandler => limiter(10, FIFTEEN_MINUTES);

/** Per signed-in user (falls back to the IP); mount after `authenticate`. */
export function perUser(limit: number, windowMs: number): RequestHandler {
  return limiter(limit, windowMs, (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ''));
}
