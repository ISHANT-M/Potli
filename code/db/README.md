# Potli database

Two systems, one job each:

| Concern | Where |
| --- | --- |
| Accounts, passwords, sessions | **Appwrite** (self-hosted, its own store) |
| App data: profiles, partner profiles | **Postgres**, schema owned by `schema.ts` |

Both databases use Appwrite's PostgreSQL container: `appwrite` stores Appwrite's
accounts, and `potli` stores our Drizzle-managed tables. No second PostgreSQL
container is used. `profiles.appwrite_user_id` links accounts across these
databases without a foreign key.

## Commands

```bash
npm run generate -- --name <change>   # drizzle-kit writes migrations/0001_<change>.sql
npm run migrate                       # applies pending migrations, records them in `migrations`
npm run seed                          # creates/updates the dev accounts and their profiles
npm run typecheck                     # tsc --noEmit
```

All three read `backend/.env` (a `db/.env` overrides it): `DATABASE_URL` for
Postgres, `APPWRITE_ENDPOINT` / `APPWRITE_PROJECT_ID` / `APPWRITE_API_KEY` for the
account half.

Use generated migrations, not `drizzle-kit push`, for schema changes.

## Dev accounts

Password `Potli123!` for all four; the seed marks their email verified and applies
the role label, so nothing depends on outbound mail.

| Email | Name | Role | Appwrite label |
| --- | --- | --- | --- |
| aanshaj_be24@thapar.edu | Anshaj | traveler | `traveler` |
| abindal1_be24@thapar.edu | Aayush Bindal | traveler | `traveler` |
| stiwari1_be24@thapar.edu | Satyam Tiwari | storage_partner | `storagePartner` |
| imehndiratta_be24@thapar.edu | Ishant Mehndiratta | admin | `admin` |

Labels accept alphanumerics only, hence the camelCase mirror of
`storage_partner`; the Postgres enum keeps the underscore form.

The seed uses `APPWRITE_API_KEY` to create verified accounts without sending mail.
Re-running it restores `DEV_SEED_PASSWORD` on existing accounts.

## Schema

```
profiles          id uuid pk, appwrite_user_id text unique, email, full_name,
                  role user_role ('traveler' | 'storage_partner' | 'admin'),
                  created_at, updated_at
partner_profiles  user_id uuid pk -> profiles.id, business_name, phone, created_at
```

`profiles` rows are created on first contact: Appwrite signups do not notify this
database, so the API materialises the row when an account first calls `/auth/me`
(new accounts start as travellers).

## Notes

- `DATABASE_URL` points at the `potli` database inside Appwrite's Postgres. On a
developer machine it is reached through the **catcher**, which the Cloudflare tunnel
publishes as an HTTPS hostname: `DATABASE_WS_PROXY` selects the WebSocket transport
(Neon's serverless driver), and the same code uses plain TCP when that setting is
absent. See [../README.md](../README.md).
- Over the catcher, the password is a short-lived **Appwrite JWT** for the
infrastructure account, minted by `mintDatabaseToken()` on each run and verified by
Appwrite before any byte reaches Postgres. `createDbWithToken()` is the entry point
callers use; the transport decision stays in one place.
- The catcher holds no superuser credential. It connects as `potli` through a
  docker-network-scoped `pg_hba` trust rule.
- No RLS is defined. Browsers use the API; infrastructure credentials grant direct
  database access and must stay private.
