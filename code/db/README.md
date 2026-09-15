# Potli database workspace

Supabase Postgres through Drizzle ORM (`pg` driver). This workspace owns the
database: the schema, the migrations, the dev seed, and the shared client and
queries the backend imports. TypeScript, run directly by Node's native type
stripping.

| File | Responsibility |
| --- | --- |
| `schema.ts` | Drizzle schema: tables, `user_role` enum, index, foreign keys |
| `client.ts` | `createDb(url)`: one place to build the `pg` pool and Drizzle client |
| `profiles.ts` | `loadProfile` / `upsertProfile` / `upsertPartnerProfile`, used by the API and the seed |
| `errors.ts` | Postgres/connection error translation shared with the API |
| `env.ts` | Finds the connection string: `db/.env` first, then `backend/.env` |
| `drizzle.config.ts` | drizzle-kit config, writes into `supabase/migrations` |
| `scripts/migrate.ts` | Applies migrations in filename order, records versions |
| `scripts/seed.ts` | Creates/updates the four dev accounts and their roles |

Credentials stay in `backend/.env` (gitignored); `db/.env` can override them
without copying the file. The **session pooler** string is the one to use,
because the transaction pooler (`:6543`) is meant for short serverless requests.

## Commands

```bash
npm run generate -- --name <change>   # drizzle-kit generate
npm run migrate                       # apply supabase/migrations
npm run seed                          # create/refresh the dev accounts
npm run typecheck
```

`supabase/migrations/*.sql` is the schema, applied in filename order and tracked
in `supabase_migrations.schema_migrations` — the same table the Supabase CLI
uses, so `supabase db push` and `npm run migrate` are interchangeable.

`supabase/migrations/meta/` is drizzle-kit's journal and snapshot. It is not
migrations: the CLI and `scripts/migrate.ts` ignore it, but it is committed so
`drizzle-kit generate` can diff against the last known state. Without it the
next `generate` re-emits the whole schema as a new migration, which would fail
against a database that already has those tables.

The pre-Supabase Neon schema (a single `users` table carrying a bcrypt
`password_hash`) is gone from the working tree; it is still readable in history
via `git show 4d511c2:code/db/schema.sql`.

## Generating a migration

Drizzle writes the table, enum, index and foreign-key statements. Add the
hand-written parts (triggers, RLS policies, grants, functions) by editing the
generated file before applying it, as the initial migration does, or with
`npx drizzle-kit generate --custom` for a SQL-only migration.

The generated file declares a foreign key to `auth.users`, so the
`CREATE TABLE "auth"."users"` statement drizzle-kit emits for it is stripped
out: that table belongs to Supabase Auth and is declared in `schema.ts` only so
`profiles.id` can reference it. `drizzle-kit push` is deliberately not used — it
diffs against the live database and would try to manage that schema.

## What the schema creates

| Object | Purpose |
| --- | --- |
| `auth.users` | Supabase Auth accounts: email, password hash, confirmation, tokens |
| `public.profiles` | App account data: `id` (= `auth.users.id`), `email`, `full_name`, `role` |
| `public.partner_profiles` | Extra row for `storage_partner` accounts: business name, phone |
| `user_role` enum | `traveler` \| `storage_partner` \| `admin` |
| `handle_new_user()` trigger | Creates a `traveler` profile for every new auth user |
| `is_admin()` + RLS policies | `authenticated` may read their own profile, or any profile if admin |

Roles are server-controlled: the signup trigger always creates a `traveler`, and
no RLS policy lets an account change its own role. The seed sets roles through
the database connection.

## Seeding

The seed writes `auth.users` + `auth.identities` directly, the pattern Supabase's
own `seed.sql` uses: the Auth admin API would need the service-role key, and the
public signup path would email real @thapar.edu addresses and hit its rate limit.
Passwords are bcrypt-hashed with `pgcrypto`, exactly what GoTrue verifies, so the
accounts sign in normally through Supabase Auth.

Dev accounts (password `Potli123!`), created as confirmed Supabase Auth users:

| Email | Name | Role |
| --- | --- | --- |
| aanshaj_be24@thapar.edu | Anshaj | traveler |
| abindal1_be24@thapar.edu | Aayush Bindal | traveler |
| stiwari1_be24@thapar.edu | Satyam Tiwari | storage_partner |
| imehndiratta_be24@thapar.edu | Ishant Mehndiratta | admin |

The `public` schema is also reachable from the Supabase dashboard (Table editor,
SQL editor), which is the quickest way to confirm the seed landed.

## Optional: Supabase CLI

The layout matches the CLI's expectations if it is initialised here:

```bash
cd code/db
supabase init          # creates supabase/config.toml next to migrations/
supabase login
supabase link --project-ref <project-ref>
supabase db push       # applies the same migrations
```
