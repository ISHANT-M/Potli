/** HttpError, the error envelope and the Express error middleware. */
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { DomainError, describeDbError, isDatabaseError, type DomainErrorCode } from '../../../db/errors.ts';
import type { ApiError } from '../../../shared/types.ts';
import { isProduction, type Config } from '../config.ts';

export class HttpError extends Error {
  status: number;
  code: string;
  fields: Record<string, string> | undefined;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

const DOMAIN_STATUS: Record<DomainErrorCode, number> = {
  NOT_FOUND: 404,
  CAPACITY_UNAVAILABLE: 409,
  INVALID_TRANSITION: 409,
  SLOT_INVALID: 400,
  OUTSIDE_OPENING_HOURS: 400,
};

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new HttpError(404, 'NOT_FOUND', 'Not found.'));
};

function envelope(code: string, message: string, fields?: Record<string, string>, detail?: string): ApiError {
  return { error: { code, message, ...(fields ? { fields } : {}), ...(detail ? { detail } : {}) } };
}

/** Never leaks stack traces, SQL or upstream messages; `detail` appears only outside production. */
export function errorHandler(config: Pick<Config, 'nodeEnv'>): ErrorRequestHandler {
  return (err: unknown, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }

    if (err instanceof HttpError) {
      res.status(err.status).json(envelope(err.code, err.message, err.fields));
      return;
    }
    if (err instanceof DomainError) {
      res.status(DOMAIN_STATUS[err.code]).json(envelope(err.code, err.message));
      return;
    }

    const bodyError = err as { type?: string; status?: number } | null;
    if (bodyError?.type === 'entity.too.large') {
      res.status(413).json(envelope('VALIDATION_FAILED', 'The request body is too large.'));
      return;
    }
    if (bodyError?.type === 'entity.parse.failed') {
      res.status(400).json(envelope('VALIDATION_FAILED', 'The request body is not valid JSON.'));
      return;
    }

    const message = err instanceof Error ? err.message : 'unknown error';
    console.error(`[${req.id ?? '-'}] ${req.method} ${req.path} failed: ${message}`);
    const detail = isProduction(config) ? undefined : message;

    if (isDatabaseError(err)) {
      res.status(503).json(envelope('SERVICE_UNAVAILABLE', describeDbError(err), undefined, detail));
      return;
    }
    res.status(500).json(envelope('INTERNAL', 'Something went wrong on our side. Please try again.', undefined, detail));
  };
}
