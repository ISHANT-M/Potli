# Potli application

TypeScript throughout; Node runs the `.ts` files directly through native type
stripping, so nothing is compiled for development.

- `frontend/` — TypeScript, HTML5, Tailwind CSS, Vite (dev server on :5173)
- `backend/` — Express API on Supabase Auth + Supabase Postgres (:4000)
- `db/` — database workspace: Drizzle schema, migrations, dev seed
- `scripts/` — dev bootstrap (`setup.ts`) and launcher (`dev.ts`)

## First-time setup

Requires Node 22.18+ or 24+ (native TypeScript support), npm, and a Supabase
project (free tier is fine).

```bash
cd code
npm run setup
```

`setup` installs dependencies for the launcher and every workspace, creates
`frontend/.env` and `backend/.env` from the checked-in `.env.example` files
(existing `.env` files are never overwritten), and applies `db/supabase/migrations`
plus the dev seed data when `backend/.env` contains a real Supabase connection
string. It is idempotent: re-running is safe, and the database step is skipped
with a warning until you supply the connection string.

| Flag | Effect |
| --- | --- |
| `--ci` | clean lockfile-exact `npm ci` instead of `npm install` |
| `--force-env` | regenerate `.env` from `.env.example` |
| `--with-db` | fail the run if the database step cannot execute |
| `--skip-db` | install dependencies only |
| `--only <list>` | subset of `frontend`, `backend`, `db` |

### Supabase

Everything account-related runs on Supabase:

| Concern | Where |
| --- | --- |
| Credentials, sessions, tokens | Supabase Auth (`auth.users`) |
| Roles, profile data | `public.profiles` (see [db/README.md](db/README.md)) |
| Typed data access | Drizzle ORM over `pg`, schema in `db/schema.ts` |
| App data queries | Supabase Postgres through the backend |

Fill from the Supabase dashboard, then `npm run db:setup`:

| Env (backend/.env) | Dashboard location |
| --- | --- |
| `SUPABASE_URL` | Project Settings -> API |
| `SUPABASE_ANON_KEY` | Project Settings -> API (publishable key) |
| `SUPABASE_DB_URL` | Connect -> **Session pooler** (the project's own region) |

And in `frontend/.env`: `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (the
same URL and publishable key; row level security protects the data).

Credentials live only in `backend/.env`, which is gitignored; the `db` workspace
reads them from there, so there is no second copy. The four dev accounts
(password `Potli123!`) are documented in [db/README.md](db/README.md).

Changing the schema:

```bash
cd db
npm run generate -- --name <change>   # drizzle-kit writes supabase/migrations/<timestamp>_<name>.sql
npm run migrate                       # applies it and records the version
```

## Run locally

```bash
cd code
npm run dev
```

The launcher starts both processes, waits until each answers, then prints:

| App | URL |
| --- | --- |
| backend | http://localhost:4000 — health at `/api/v1/health` |
| frontend | http://localhost:5173 |

Ctrl+C stops both; if either process dies, the launcher stops the other one too
and exits non-zero. `npm run dev -- --only backend` runs a single app.

On Windows the interrupt travels through `npm`/`cmd`, which may print
`Terminate batch job (Y/N)?` — both servers are already shut down at that point;
answer `Y`. Running `node scripts/dev.ts` directly avoids that prompt.

## Checks

```bash
npm run typecheck   # launcher + frontend + backend + db, all with tsc --noEmit
npm run build       # type-checks and builds frontend/dist
```
