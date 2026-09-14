# Potli application

- `frontend/` — TypeScript, HTML5, Tailwind CSS, Vite (dev server on :5173)
- `backend/` — Express API on Neon Postgres, plain `pg` + bcrypt + JWT (:4000)
- `db/` — plain SQL schema for Neon Postgres (no ORM, no npm dependencies)
- `scripts/` — dev bootstrap (`setup.mjs`) and launcher (`dev.mjs`)

## First-time setup

Requires Node 20+ and npm.

```bash
cd code
npm run setup
```

`setup` installs dependencies in `frontend/` and `backend/`, creates
`frontend/.env` and `backend/.env` from the checked-in `.env.example` files
(existing `.env` files are never overwritten), and applies `db/schema.sql` plus
the dev seed data when `backend/.env` contains a real `DATABASE_URL`. It is
idempotent — re-running is safe, and the database step is skipped with a warning
until you supply the connection string.

| Flag | Effect |
| --- | --- |
| `--ci` | clean lockfile-exact `npm ci` instead of `npm install` |
| `--force-env` | regenerate `.env` from `.env.example` |
| `--with-db` | fail the run if the database step cannot execute |
| `--skip-db` | install dependencies only |
| `--only <list>` | subset of `frontend`, `backend`, `db` |

### Database

`db/` has no npm dependencies — the schema is applied through the backend, which
already carries the `pg` client. Put the Neon connection string in
`backend/.env`, then:

```bash
npm run db:setup   # db:migrate + db:seed
```

The four dev accounts (password `Potli123!`) are documented in
[db/README.md](db/README.md).

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
answer `Y`. Running `node scripts/dev.mjs` directly avoids that prompt.

## Build

```bash
npm run build   # from code/ — type-checks and builds frontend/dist
```
