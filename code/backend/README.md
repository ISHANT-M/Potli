# Potli backend

Minimal Express API on Neon Postgres (plain `pg`, bcrypt, JWT). No ORM.

## Setup

```bash
cp .env.example .env   # put the Neon DATABASE_URL in .env, never commit it
npm install
npm run db:migrate
npm run db:seed        # creates the 4 dev accounts (password Potli123!)
npm run dev            # http://localhost:4000
```

## Endpoints

- `GET /api/v1/health`
- `POST /api/v1/auth/login` `{ email, password }` -> `{ token, user }`
- `GET /api/v1/auth/me` (Bearer token) -> `{ user }`

Unversioned `/api/*` aliases still work but send `Deprecation`/`Sunset` headers.

Frontend stores the JWT in `localStorage` and redirects to `#dashboard`,
which renders a minimal placeholder per role.
