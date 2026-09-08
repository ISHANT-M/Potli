import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { Client } = pg;

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const schema = fs.readFileSync(path.join(__dirname, '../../db/schema.sql'), 'utf8');
await client.connect();
await client.query(schema);
console.log('schema applied');
await client.end();
