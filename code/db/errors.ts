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
