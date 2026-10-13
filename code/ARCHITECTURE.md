# Potli architecture

## What is running

Potli is a TypeScript frontend and API backed by a self-hosted Appwrite project and PostgreSQL. **The Potli frontend and API currently run on developers' machines, not as deployed homelab services.** The homelab hosts Appwrite, its PostgreSQL server, the database catcher, and the mail integration. A frontend build is not a deployment.

| Component | Responsibility | Location |
| --- | --- | --- |
| `frontend/` | Vite app, Appwrite browser session, role-specific pages | Local dev server on `localhost:5173` |
| `backend/` | Express API; verifies Appwrite JWTs and reads/writes profiles | Local dev server on `localhost:4000` |
| `db/` | Drizzle schema, Postgres client, SQL migrations and dev seed | Shared by the backend and scripts |
| Appwrite | Potli project: users, passwords, sessions, role labels, recovery mail | Self-hosted Appwrite stack |
| PostgreSQL | Separate `appwrite` and `potli` databases **in the same Appwrite PostgreSQL container** | Internal Docker network; no published Postgres port |
| DB catcher | WebSocket-to-Postgres relay gated by an Appwrite infrastructure JWT | Appwrite stack, alongside PostgreSQL |
| Resend | Outbound SMTP delivery for Appwrite-generated mail | External mail provider |

Appwrite's project isolation applies to accounts, sessions and keys; the instance and PostgreSQL server are shared. The Potli project is not an Appwrite TablesDB application: Drizzle owns the `potli` database. There is no second Potli PostgreSQL container.

## Request pipelines

**Browser login:** The frontend (`frontend/src/main.ts`) calls Appwrite's browser SDK to create an email/password session. Appwrite keeps the session in a cookie. The frontend mints a short-lived JWT with `account.createJWT()` and sends it as a Bearer token to `GET /api/v1/auth/me`. The backend asks Appwrite `GET /account` to verify the JWT, then loads the profile from Postgres (creating a traveler profile on first contact). The response supplies the role used by the frontend to select a dashboard. Each login page checks its expected role and signs out a mismatched account. The API also offers `POST /api/v1/auth/login` for non-browser clients; it carries Appwrite's session cookie into the JWT request before returning a token and user.

**Data access:** The browser does not connect to Postgres. The backend uses `db/client.ts` and Drizzle for profile queries. `profiles.appwrite_user_id` joins an Appwrite account to Potli data by ID across databases; it is not a cross-database foreign key. `profiles` has the role enum `traveler | storage_partner | admin`; `partner_profiles` adds business name and phone. The Appwrite labels are `traveler`, `storagePartner`, `admin` (labels cannot contain `_`). Seeded profiles carry the matching Postgres role. A newly encountered account without a profile starts as a traveler. There is no PostgreSQL RLS; keeping the database private and the API as the browser's data boundary matters.

**Developer database connection:** With `DATABASE_WS_PROXY` set, `createDbWithToken()` signs into the Potli Appwrite project as the separate infrastructure account, mints a short-lived JWT, and substitutes it for the password in `DATABASE_URL`. `@neondatabase/serverless` sends the PostgreSQL protocol over `wss://db.example.com/v1`. The catcher uses `pg-gateway` to accept the connection, asks Appwrite `GET /account` to validate the JWT and current `infra` label, and relays only admitted connections to the internal `potli` database as the `potli` PostgreSQL role. Cloudflare carries the WebSocket bytes; it is not the database identity provider. The catcher holds no PostgreSQL superuser password. Its upstream `pg_hba` trust rule is restricted to the Docker network, which is therefore part of the trust boundary. Without `DATABASE_WS_PROXY`, the same client uses plain TCP and the credentials in `DATABASE_URL`; use this only where PostgreSQL is privately reachable.

The infrastructure account is **not** a Potli user, app admin, Appwrite console owner, or PostgreSQL role. Application role labels do not grant catcher access. `POTLI_DB_EMAIL` and `POTLI_DB_PASSWORD` belong only in private backend configuration; possession grants direct access to the Potli database through the catcher. The seed separately uses the server-only `APPWRITE_API_KEY` to manage dev accounts.

**Password recovery and mail:** The frontend calls Appwrite `createRecovery()` and `updateRecovery()`; the reset link carries a user ID and one-time secret. Appwrite generates the email and sends it through its instance-wide SMTP configuration to Resend. Resend owns the verified sending domain and performs delivery. Mailpit remains installed as a capture-only fallback but is not the active SMTP destination; its messages would contain recovery secrets. No email delivery is performed by the Express API.

## Deployment and configuration

The private homelab workspace owns the infrastructure deployment (`deploy/appwrite/README.md` and `deploy/gateway/Caddyfile` there). The Appwrite guest runs the upstream installer-generated Compose stack; local additions are made through `docker-compose.override.yml`, written only by `deploy/appwrite/write-override.sh`. That override adds the catcher and the Mailpit fallback and keeps PostgreSQL internal. Do not edit the installer-generated Compose file or run `docker compose down -v` on a populated instance: Appwrite and Potli share the PostgreSQL volume.

Public HTTPS terminates at Cloudflare Tunnel. The gateway routes the Appwrite API/console to Appwrite; a separate HTTP tunnel hostname forwards WebSocket upgrades directly to the catcher. Neither endpoint has an interactive Cloudflare Access challenge: browser clients need the Appwrite API and the catcher authenticates via Appwrite itself. The catcher reaches Appwrite over the Docker network, so its identity check does not depend on the public tunnel. The actual hostnames, guest addresses, project IDs and credentials live in private deployment files, not in this repository.

To provision an equivalent environment:

1. Install Appwrite from its upstream Compose distribution, initialize its secrets, and create a Potli project with the required web platforms (including local development origins). Create a server API key for the seed; keep it out of the frontend.
2. Create a separate `potli` database and owning role **inside Appwrite's PostgreSQL server**. Install the local Compose override and catcher. Configure its Potli project ID, `infra` label gate and the scoped upstream `pg_hba` rule; do not publish port 5432. Publish the catcher as an HTTPS/WebSocket endpoint and Appwrite as an HTTPS API endpoint.
3. Create a project-scoped infrastructure account bearing only the `infra` label. Distribute its credentials privately to developers who need database access. Configure Appwrite SMTP with a verified Resend sender and private sending key if real recovery mail is required.
4. Fill `backend/.env` and `frontend/.env` from their examples. The backend needs `APPWRITE_ENDPOINT`, `APPWRITE_PROJECT_ID`, `DATABASE_URL`, `DATABASE_WS_PROXY` and `POTLI_DB_EMAIL`/`POTLI_DB_PASSWORD` for remote DB access; seeding also needs `APPWRITE_API_KEY`. The frontend needs `VITE_APPWRITE_ENDPOINT`, `VITE_APPWRITE_PROJECT_ID` and `VITE_API_URL`. All `VITE_` values are browser-visible; none may be secrets. Do not put the API key, database URL or infrastructure credentials in a `VITE_` variable.
5. From `code/`, run `npm run setup` for dependencies and initial migrations/seed, then `npm run dev` for both local services. `setup` applies the database step when configured; `npm run db:setup` reruns it explicitly. The seed creates/updates the four documented dev accounts and **resets their passwords** to `DEV_SEED_PASSWORD`, so do not run it against real accounts. See `db/README.md` for the dev-account list.

For later schema changes, edit `db/schema.ts`, then run `cd db && npm run generate -- --name <change>` and `npm run migrate`. Generated SQL lives in `db/migrations/`; the migration script records applied filenames in the `migrations` table of the `potli` database in the same transaction. Do not use `drizzle-kit push`. `npm run typecheck` checks every workspace; `npm run build` builds frontend assets but does not host them.

**Not deployed yet:** There is no Potli API service, static frontend host, or public Potli hostname in the homelab deployment. Production deployment would need a backend service with private database reachability and configuration, a static host for `frontend/dist`, `VITE_API_URL` pointing at that API at build time, corresponding browser origins in Appwrite, gateway/tunnel routes, and health/backup/recovery procedures. Do not treat the current local `localhost` URLs as production endpoints. Auth/login, profile lookup and recovery are implemented; storage listings, booking flows and operational dashboards are not backed by those APIs yet.

## Where to look

- `frontend/src/main.ts`, `frontend/src/appwrite.ts`: browser login, role routing and recovery.
- `backend/src/server.ts`, `backend/src/appwrite.ts`, `backend/src/db.ts`: HTTP routes, Appwrite validation and profile access.
- `db/schema.ts`, `db/client.ts`, `db/profiles.ts`, `db/scripts/`: schema, connection transport, migrations and seed.
- Private homelab workspace `deploy/appwrite/`: Compose override, catcher, Appwrite and SMTP operations; `deploy/gateway/`: ingress routing.
