# Potli application

TypeScript throughout; Node runs the `.ts` files directly through native type
stripping, so nothing is compiled for development.

- `frontend/` — TypeScript, HTML5, Tailwind CSS, Vite (dev server on :5173)
- `backend/` — Express API on Appwrite (auth) + Postgres (:4000)
- `db/` — database workspace: Drizzle schema, migrations, dev seed
- `scripts/` — dev bootstrap (`setup.ts`) and launcher (`dev.ts`)

## First-time setup

Requires Node 22.18+ or 24+, npm, and the shared env files. Database access uses
the HTTPS catcher; no SSH or VPN client is needed.

```bash
cd code
npm run setup
```

`setup` installs dependencies for the launcher and every workspace, creates
`frontend/.env` and `backend/.env` from the checked-in `.env.example` files
(existing `.env` files are never overwritten), and applies `db/migrations` plus
the dev seed when `backend/.env` has a real `DATABASE_URL`. It is idempotent:
re-running is safe, and the database step is skipped with a warning until you
supply the connection string.

| Flag | Effect |
| --- | --- |
| `--ci` | clean lockfile-exact `npm ci` instead of `npm install` |
| `--force-env` | regenerate `.env` from `.env.example` |
| `--with-db` | fail the run if the database step cannot execute |
| `--skip-db` | install dependencies only |
| `--only <list>` | subset of `frontend`, `backend`, `db` |

### Appwrite + Postgres

One PostgreSQL container serves both Appwrite and Potli. Appwrite owns the
`appwrite` database; Drizzle manages Potli's tables in the `potli` database on
that same instance. There is no separate Potli PostgreSQL container.

| Concern | Where |
| --- | --- |
| Credentials, sessions, tokens | Appwrite (configured project) |
| Account identities and roles | Appwrite labels (`traveler`, `storagePartner`, `admin`) |
| Roles, profile and partner data | Postgres `profiles` / `partner_profiles` |
| Typed data access | Drizzle ORM over `pg`, schema in `db/schema.ts` |

| Env (backend/.env) | Value |
| --- | --- |
| `APPWRITE_ENDPOINT` | `https://appwrite.example.com/v1` |
| `APPWRITE_PROJECT_ID` | the `potli` project id |
| `APPWRITE_API_KEY` | server-side key, used by the seed to create accounts |
| `DATABASE_URL` | Postgres: `potli` database inside Appwrite's Postgres |
| `POTLI_DB_EMAIL` / `POTLI_DB_PASSWORD` | the infrastructure account, used only to mint the database token below |

And in `frontend/.env`: `VITE_APPWRITE_ENDPOINT` + `VITE_APPWRITE_PROJECT_ID`
(the project id is public; no key belongs in the frontend).

Appwrite and the database catcher are reachable over HTTPS. Postgres remains
internal; the catcher carries the Postgres wire protocol over WebSocket.

```bash
# backend/.env
DATABASE_URL=postgresql://potli:unused-over-the-catcher@db.example.com:443/potli
DATABASE_WS_PROXY=wss://db.example.com/v1          # omit to use plain TCP
POTLI_DB_EMAIL=infra@example.com                    # the infrastructure account
POTLI_DB_PASSWORD=...                             # its password; kept private
```

`db/client.ts` mints an infrastructure-account JWT and uses it as the connection
password. The catcher verifies it with Appwrite and connects to Postgres as
`potli`; the actual database password is not sent. Disabling the account blocks
new authenticated connections.

The same code uses plain TCP when `DATABASE_WS_PROXY` is unset — a local Postgres,
or the backend running next to the database in the homelab.

### Access boundaries

| Plane | Identity | Reaches the database? |
| --- | --- | --- |
| Application | the four accounts, each with a Potli role label (`traveler`, `storagePartner`, `admin`) | no — the catcher admits only `infra` |
| Infrastructure | `infra@example.com`, label `infra` | yes; that is its only purpose |

App roles do not grant infrastructure access. The infrastructure account has no
Potli role or profile row.

Hosting the catcher, and the pg_hba rule it needs, are described in
`deploy/appwrite/README.md` of the homelab repository.

Share the gitignored `backend/.env` privately with the team. It grants database
access and account-seeding privileges; never copy it into the frontend. Rotating
the infrastructure password prevents new logins, not existing sessions.
Dev accounts are listed in [db/README.md](db/README.md).

Changing the schema:

```bash
cd db
npm run generate -- --name <change>   # drizzle-kit writes migrations/0001_<name>.sql
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
