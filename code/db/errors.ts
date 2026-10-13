/**
 * Turns Postgres and connection failures into something a reader can act on,
 * shared by the API routes and the db scripts.
 */
export function describeDbError(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  switch (code) {
    case '28P01':
      return 'Database rejected the credentials in backend/.env (password authentication failed).';
    case '3D000':
      return 'Database does not exist on that host.';
    case '42P01':
      return 'Database schema is missing; run "npm run db:setup".';
    case 'ENOTFOUND':
    case 'ECONNREFUSED':
      return 'Database host is unreachable.';
    default:
      return 'Database is unavailable.';
  }
}

/** True when an error came from the database rather than from our own code. */
export function isDatabaseError(err: unknown): boolean {
  const candidate = err as { code?: string; severity?: string } | null;
  if (!candidate) return false;
  return (
    Boolean(candidate.severity) ||
    ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET'].includes(candidate.code ?? '')
  );
}

export type DomainErrorCode =
  | 'NOT_FOUND'
  | 'CAPACITY_UNAVAILABLE'
  | 'INVALID_TRANSITION'
  | 'SLOT_INVALID'
  | 'OUTSIDE_OPENING_HOURS';

/** A rule violation raised by the domain modules; the API maps it onto the error envelope. */
export class DomainError extends Error {
  code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}

/** True for a unique-constraint violation, optionally on a named constraint. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const candidate = err as { code?: string; constraint?: string } | null;
  if (candidate?.code !== '23505') return false;
  return constraint === undefined || candidate.constraint === constraint;
}
