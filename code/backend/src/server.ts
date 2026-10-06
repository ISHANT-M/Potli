import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { PORT, REQUIRED, requireEnv } from './config.ts';
import { ensureProfile, describeDbError, isDatabaseError, loadProfile, pool, query } from './db.ts';
import { accountFromJwt, authReachable, signInWithPassword, toPublicUser } from './appwrite.ts';
import type { PublicUser } from './appwrite.ts';

requireEnv(REQUIRED);

const app = express();
app.use(cors());
app.use(express.json());

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown;

// Forward rejected handlers to Express error middleware.
const asyncHandler =
  (handler: Handler) => (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };

function bearerToken(req: Request): string | null {
  const [scheme, token] = (req.headers.authorization ?? '').split(' ');
  return scheme === 'Bearer' && token ? token : null;
}

/** Verify identity in Appwrite; resolve or create the profile in Postgres. */
async function authenticatedUser(req: Request): Promise<PublicUser | null> {
  const account = await accountFromJwt(bearerToken(req));
  if (!account) return null;
  const profile = await ensureProfile({
    appwriteUserId: account.$id,
    email: account.email,
    fullName: account.name ?? '',
    role: 'traveler',
  });
  return toPublicUser(profile, account);
}

const v1 = express.Router();

v1.get('/health', asyncHandler(async (_req, res) => {
  try {
    await query('select 1');
  } catch (err) {
    return res.status(503).json({
      ok: false,
      db: false,
      error: describeDbError(err),
      detail: (err as Error).message,
      code: (err as { code?: string }).code,
    });
  }
  const auth = await authReachable();
  res.json({ ok: auth, db: true, auth });
}));

// API-client login; the browser uses Appwrite's SDK.
v1.post('/auth/login', asyncHandler(async (req, res) => {
  const { email, password } = (req.body ?? {}) as { email?: unknown; password?: unknown };
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const result = await signInWithPassword(String(email), String(password));
  if ('error' in result) return res.status(401).json({ error: result.error });

  const account = await accountFromJwt(result.jwt);
  if (!account) return res.status(401).json({ error: 'Sign-in did not return a usable token.' });

  const profile = await loadProfile(account.$id);
  res.json({ token: result.jwt, user: toPublicUser(profile, account) });
}));

v1.get('/auth/me', asyncHandler(async (req, res) => {
  const user = await authenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Not signed in.' });
  res.json({ user });
}));

app.use('/api/v1', v1);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('api error:', err.message);
  if (res.headersSent) return;
  const dbError = isDatabaseError(err);
  res.status(dbError ? 503 : 500).json({
    error: dbError ? describeDbError(err) : 'Internal server error.',
    detail: err.message,
  });
});

const server = app.listen(PORT, () => console.log(`Potli backend on http://localhost:${PORT}`));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      void pool.end().then(() => process.exit(0));
    });
  });
}
