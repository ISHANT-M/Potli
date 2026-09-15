import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { PORT, SUPABASE_REQUIRED, requireEnv } from './config.ts';
import { describeDbError, isDatabaseError, loadProfile, pool, query } from './db.ts';
import { authReachable, supabaseAuth, toPublicUser, userFromAccessToken } from './supabase.ts';
import type { PublicUser } from './supabase.ts';

requireEnv(SUPABASE_REQUIRED);

const app = express();
app.use(cors());
app.use(express.json());

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown;

// Async route handlers: without this a rejected promise becomes an unhandled
// rejection and Node kills the process, which reads as "the backend is down".
const asyncHandler =
  (handler: Handler) => (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };

function bearerToken(req: Request): string | null {
  const [scheme, token] = (req.headers.authorization ?? '').split(' ');
  return scheme === 'Bearer' && token ? token : null;
}

async function authenticatedUser(req: Request): Promise<PublicUser | null> {
  const authUser = await userFromAccessToken(bearerToken(req));
  if (!authUser) return null;
  const profile = await loadProfile(authUser.id);
  return toPublicUser(profile, authUser);
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

// Server-side sign-in for API clients; the browser uses supabase-js directly.
v1.post('/auth/login', asyncHandler(async (req, res) => {
  const { email, password } = (req.body ?? {}) as { email?: unknown; password?: unknown };
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const { data, error } = await supabaseAuth.auth.signInWithPassword({
    email: String(email),
    password: String(password),
  });
  if (error) return res.status(401).json({ error: error.message });
  if (!data.session) return res.status(401).json({ error: 'Sign-in did not return a session.' });

  const profile = await loadProfile(data.user.id);
  res.json({
    token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
    user: toPublicUser(profile, data.user),
  });
}));

v1.get('/auth/me', asyncHandler(async (req, res) => {
  const user = await authenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Not signed in.' });
  res.json({ user });
}));

app.use('/api/v1', v1);

// Deprecated unversioned aliases; remove after clients migrate.
app.use('/api', (_req: Request, res: Response, next: NextFunction) => {
  res.set('Deprecation', 'true');
  res.set('Sunset', 'Sat, 01 Nov 2025 00:00:00 GMT');
  next();
}, v1);

// Keep the process alive on request failures: async handler errors land here.
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
