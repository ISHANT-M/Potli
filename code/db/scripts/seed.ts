/**
 * Creates the dev accounts and their roles.
 *
 * Accounts are written straight into auth.users, the way the Supabase CLI's
 * seed.sql does: the Auth admin API would need the service-role key, and the
 * public signup path would email real @thapar.edu addresses and hit its rate
 * limit. Passwords are bcrypt-hashed with pgcrypto, exactly what GoTrue verifies.
 *
 * This is TypeScript executed by Node's native type stripping.
 */
import { createDb } from '../client.ts';
import { DEV_SEED_PASSWORD, SUPABASE_DB_URL, requireDatabaseUrl } from '../env.ts';
import { upsertPartnerProfile, upsertProfile } from '../profiles.ts';
import type { Role } from '../schema.ts';
import type pg from 'pg';

interface DevUser {
  email: string;
  fullName: string;
  role: Role;
  businessName?: string;
  phone?: string;
}

// Dev accounts: 2 travellers, 1 storage partner, 1 admin. Shared dev password.
const DEV_USERS: DevUser[] = [
  {
    email: 'aanshaj_be24@thapar.edu',
    fullName: 'Anshaj',
    role: 'traveler',
  },
  {
    email: 'abindal1_be24@thapar.edu',
    fullName: 'Aayush Bindal',
    role: 'traveler',
  },
  {
    email: 'stiwari1_be24@thapar.edu',
    fullName: 'Satyam Tiwari',
    role: 'storage_partner',
    businessName: 'Satyam Storage',
    phone: '+91 95803 80494',
  },
  {
    email: 'imehndiratta_be24@thapar.edu',
    fullName: 'Ishant Mehndiratta',
    role: 'admin',
  },
];

async function upsertAuthUser(pool: pg.Pool, user: DevUser): Promise<string> {
  const inserted = await pool.query<{ id: string }>(
    `insert into auth.users (
       instance_id, id, aud, role, email, encrypted_password,
       email_confirmed_at, created_at, updated_at,
       raw_app_meta_data, raw_user_meta_data,
       confirmation_token, recovery_token, email_change, email_change_token_new,
       is_sso_user, is_anonymous
     )
     select
       '00000000-0000-0000-0000-000000000000'::uuid,
       gen_random_uuid(),
       'authenticated', 'authenticated', $1::text,
       extensions.crypt($2, extensions.gen_salt('bf')),
       now(), now(), now(),
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('full_name', $3::text),
       '', '', '', '',
       false, false
      where not exists (select 1 from auth.users where email = $1::text)
     returning id`,
    [user.email, DEV_SEED_PASSWORD, user.fullName],
  );
  const created = inserted.rows[0];
  if (created) return created.id;

  // Existing account: refresh the password, confirmation and display name.
  const updated = await pool.query<{ id: string }>(
    `update auth.users
        set encrypted_password = extensions.crypt($2, extensions.gen_salt('bf')),
            email_confirmed_at = coalesce(email_confirmed_at, now()),
            raw_user_meta_data = raw_user_meta_data || jsonb_build_object('full_name', $3::text),
            updated_at = now()
      where email = $1::text
     returning id`,
    [user.email, DEV_SEED_PASSWORD, user.fullName],
  );
  const existing = updated.rows[0];
  if (!existing) throw new Error(`could not seed ${user.email}`);
  return existing.id;
}

async function ensureIdentity(pool: pg.Pool, userId: string, email: string): Promise<void> {
  await pool.query(
    `insert into auth.identities (
       provider_id, user_id, identity_data, provider,
       last_sign_in_at, created_at, updated_at
     )
     values (
       $1::text, $2::uuid,
       jsonb_build_object('sub', $1::text, 'email', $3::text, 'email_verified', true, 'phone_verified', false),
       'email', now(), now(), now()
     )
     on conflict (provider_id, provider) do nothing`,
    [userId, userId, email],
  );
}

async function main(): Promise<void> {
  requireDatabaseUrl();
  const { pool, db } = createDb(SUPABASE_DB_URL);

  try {
    for (const user of DEV_USERS) {
      const userId = await upsertAuthUser(pool, user);
      await ensureIdentity(pool, userId, user.email);
      const profile = await upsertProfile(db, {
        id: userId,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      });
      if (profile.role === 'storage_partner') {
        await upsertPartnerProfile(db, {
          userId: profile.id,
          businessName: user.businessName ?? '',
          phone: user.phone ?? '',
        });
      }
      console.log(`seeded ${user.email} (${profile.role})`);
    }

    console.log(`\n${DEV_USERS.length} dev accounts ready in Supabase Auth; password: ${DEV_SEED_PASSWORD}`);
  } finally {
    await pool.end();
  }
}

try {
  await main();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
