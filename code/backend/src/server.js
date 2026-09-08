import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const { Pool } = pg;

const PORT = Number(process.env.PORT ?? 4000);
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET ?? 'potli-dev-secret-change-me';

if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL (see .env.example).');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
const app = express();
app.use(cors());
app.use(express.json());

const toPublicUser = (row) => ({
  id: row.id,
  email: row.email,
  full_name: row.full_name,
  role: row.role,
});

function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role }, JWT_SECRET, {
    expiresIn: '7d',
  });
}

async function authFromHeader(req) {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const { rows } = await pool.query(
      'SELECT id, email, full_name, role FROM users WHERE id = $1',
      [payload.sub],
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

const v1 = express.Router();

v1.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Minimal role login: email + password -> JWT + user (used for post-login redirect).
v1.post('/auth/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [String(email)]);
  const user = rows[0];
  if (!user) return res.status(401).json({ error: 'Invalid email or password.' });

  const ok = await bcrypt.compare(String(password), user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid email or password.' });

  res.json({ token: signToken(user), user: toPublicUser(user) });
});

v1.get('/auth/me', async (req, res) => {
  const user = await authFromHeader(req);
  if (!user) return res.status(401).json({ error: 'Not signed in.' });
  res.json({ user: toPublicUser(user) });
});

app.use('/api/v1', v1);

// Deprecated unversioned aliases; remove after clients migrate.
app.use('/api', (req, res, next) => {
  res.set('Deprecation', 'true');
  res.set('Sunset', 'Sat, 01 Nov 2025 00:00:00 GMT');
  next();
}, v1);

app.listen(PORT, () => console.log(`Potli backend on http://localhost:${PORT}`));
