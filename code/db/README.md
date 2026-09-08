# Potli database

Neon Postgres dev schema. No ORM; plain SQL applied with `pg`.

- `schema.sql` — `users` (email, bcrypt `password_hash`, `full_name`, role
  `traveler` | `storage_partner` | `admin`) + minimal `partner_profiles`.
- Seed via backend: `npm run db:migrate && npm run db:seed` with
  `DATABASE_URL` set (see `../backend/.env.example`). Never commit the real URL.

Dev accounts (password `Potli123!`):

| Email | Name | Role |
| --- | --- | --- |
| anshaj@potli.dev | Anshaj | traveler |
| aayush@potli.dev | Aayush Bindal | traveler |
| satyam@potli.dev | Satyam Tiwari | storage_partner |
| ishant@potli.dev | Ishant Mehndiratta | admin |
