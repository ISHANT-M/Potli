# Potli backend

Express API on Supabase (Auth + Postgres). TypeScript, run directly by Node's
native type stripping; `@supabase/supabase-js` for Auth, Drizzle ORM for data.

## Setup

```bash
cp .env.example .env   # fill in the Supabase values, never commit them
npm install
npm run dev            # http://localhost:4000
```

Apply migrations and seed from the db workspace (see [../db/README.md](../db/README.md)):

```bash
cd ../db && npm run migrate && npm run seed
```

Or let the root bootstrap do everything: `npm run setup` from `code/`.

Required env (see `.env.example`): `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
`SUPABASE_DB_URL`. The newer Supabase name `SUPABASE_PUBLISHABLE_KEY` is
accepted as an alias for the anon key. The pre-Supabase `DATABASE_URL` remains a
fallback for the database connection and is ignored once `SUPABASE_DB_URL` is
set. No secret/service key is needed: the backend never makes privileged Auth
calls — it verifies user tokens with the anon key.

## Layout

| File | Responsibility |
| --- | --- |
| `src/config.ts` | Reads and validates env (`.env` via dotenv) |
| `src/db.ts` | Composes the shared db client into the API's pool, re-exports profile queries |
| `src/supabase.ts` | Supabase Auth client, access-token verification, public user shape |
| `src/server.ts` | HTTP routes, versioning, error handling |

The schema, the Drizzle client, the profile queries and the migration/seed
scripts live in the `db` workspace (`../db`) so the API and the scripts share one
definition. `src/db.ts` is only the wiring: it creates the single pool the API
uses and exposes `loadProfile` for the version this process runs.

## Endpoints

- `GET /api/v1/health` -> `{ ok, db, auth }`; 503 with a readable reason when
  Postgres is unreachable, so a broken connection string is obvious.
- `POST /api/v1/auth/login` `{ email, password }` -> `{ token, refresh_token,
  expires_at, user }`; 401 with Supabase's message on bad credentials. The
  browser signs in with supabase-js directly; this exists for API clients.
- `GET /api/v1/auth/me` (Bearer access token) -> `{ user }` with the role from
  `public.profiles`.

Unversioned `/api/*` aliases still work but send `Deprecation`/`Sunset` headers.

## Auth model

Supabase Auth owns credentials and session tokens. The backend holds no secret
for signing them: it verifies each request's access token with Supabase
(`auth.getUser`) and then reads the role from `public.profiles`. The frontend
keeps its session in the supabase-js client and sends the access token to
`/api/v1/auth/me`, which drives the role-specific redirect after login. Each
sign-in page accepts one role only, so the admin login rejects traveller
credentials (and vice versa) instead of letting them through.

## Checks

```bash
npm run typecheck   # tsc --noEmit
```
