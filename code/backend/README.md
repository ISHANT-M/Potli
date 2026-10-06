# Potli backend

Express API with Appwrite auth and Postgres data. Node runs TypeScript directly;
server-side Appwrite calls use `fetch`.

## Setup

```bash
cp .env.example .env   # fill in the Appwrite + Postgres values, never commit them
npm install
npm run dev            # http://localhost:4000
```

Apply migrations and seed from the db workspace (see [../db/README.md](../db/README.md)):

```bash
cd ../db && npm run migrate && npm run seed
```

Or let the root bootstrap do everything: `npm run setup` from `code/`.

Required env (see `.env.example`): `APPWRITE_ENDPOINT`, `APPWRITE_PROJECT_ID`,
`DATABASE_URL`, and - only when `DATABASE_WS_PROXY` is set - `POTLI_DB_EMAIL` /
`POTLI_DB_PASSWORD`, the infrastructure account whose short-lived token is used as
the database password. `APPWRITE_API_KEY` is not needed to serve traffic - only the
seed uses it, to create accounts through the Users API.

`DATABASE_URL` points at the `potli` database inside Appwrite's Postgres, which is
not published to the internet. On a developer machine it is reached through the
catcher over `wss://db.example.com/v1`; on the server next to the database the same
code uses plain TCP. `src/db.ts` builds the pool from the shared db workspace, so
the transport choice lives in one place. See [../README.md](../README.md).

## Layout

| File | Responsibility |
| --- | --- |
| `src/config.ts` | Reads and validates env (`.env` via dotenv) |
| `src/db.ts` | Composes the shared db client into the API's pool, re-exports profile queries |
| `src/appwrite.ts` | Account lookups by JWT, server-side sign-in, reachability, public user shape |
| `src/server.ts` | HTTP routes and error handling |

The schema, the Drizzle client, the profile queries and the migration/seed
scripts live in the `db` workspace (`../db`) so the API and the scripts share one
definition. `src/db.ts` is only the wiring: it creates the single pool the API
uses and exposes `loadProfile` / `ensureProfile`.

## Endpoints

- `GET /api/v1/health` -> `{ ok, db, auth }`; 503 with a readable reason when
  Postgres is unreachable, so a broken connection string is obvious.
- `POST /api/v1/auth/login` `{ email, password }` -> `{ token, user }`; 401 with
  Appwrite's message on bad credentials. The browser signs in through Appwrite's
  SDK directly; this exists for API clients.
- `GET /api/v1/auth/me` (Bearer JWT) -> `{ user }` with the role from
  `profiles.role`.

## Auth model

Appwrite owns credentials, sessions and tokens. The backend holds no signing
secret: it asks Appwrite whose JWT the caller sent (`GET /account` with
`X-Appwrite-JWT`) and then reads the role from Postgres. The frontend keeps its
session with Appwrite and mints a short-lived JWT for each call to `/auth/me`,
which drives the role-specific redirect after login.

Appwrite 2.x constraints:

- Appwrite does not return a session's secret in the login response (2.x keeps it
  in an HttpOnly cookie). Server-side sign-in therefore carries the `Set-Cookie`
  value it just received into `POST /account/jwts` to mint the JWT.
- `GET /users` answers 500 if the request carries `Content-Type: application/json`
  with an empty body; only send that header when there is a body.

Each sign-in page accepts one role only, so the admin login rejects traveller
credentials (and vice versa) instead of letting them through.

## Checks

```bash
npm run typecheck   # tsc --noEmit
```
