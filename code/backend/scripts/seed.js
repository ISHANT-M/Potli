import 'dotenv/config';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const { Client } = pg;

// Dev accounts: 2 travelers, 1 storage partner, 1 admin. Shared dev password.
const DEV_PASSWORD = process.env.DEV_SEED_PASSWORD ?? 'Potli123!';
const users = [
  { email: 'anshaj@potli.dev', full_name: 'Anshaj', role: 'traveler' },
  { email: 'aayush@potli.dev', full_name: 'Aayush Bindal', role: 'traveler' },
  {
    email: 'satyam@potli.dev',
    full_name: 'Satyam Tiwari',
    role: 'storage_partner',
    business: 'Satyam Storage',
    phone: '+91 90000 00001',
  },
  { email: 'ishant@potli.dev', full_name: 'Ishant Mehndiratta', role: 'admin' },
];

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
const password_hash = await bcrypt.hash(DEV_PASSWORD, 10);
for (const u of users) {
  const { rows } = await client.query(
    `INSERT INTO users (email, password_hash, full_name, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash,
       full_name = EXCLUDED.full_name, role = EXCLUDED.role
     RETURNING id`,
    [u.email, password_hash, u.full_name, u.role],
  );
  if (u.role === 'storage_partner') {
    await client.query(
      `INSERT INTO partner_profiles (user_id, business_name, phone)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET business_name = EXCLUDED.business_name,
         phone = EXCLUDED.phone`,
      [rows[0].id, u.business ?? '', u.phone ?? ''],
    );
  }
  console.log(`seeded ${u.email} (${u.role})`);
}
await client.end();
