/** Environment parsing and validation; the server fails fast on anything missing or malformed. */
import { z } from 'zod';
import { PLATFORM_FEE_BPS } from '../../shared/pricing.ts';

const DEFAULT_CORS_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:5176',
].join(',');

const emptyToUndefined = (value: unknown): unknown => (typeof value === 'string' && value.trim() === '' ? undefined : value);
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(emptyToUndefined, schema.optional());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  APPWRITE_ENDPOINT: z.string().min(1, 'is required').transform((value) => value.trim().replace(/\/$/, '')),
  APPWRITE_PROJECT_ID: z.string().min(1, 'is required'),
  APPWRITE_API_KEY: z.string().min(1, 'is required'),
  DATABASE_URL: z.string().min(1, 'is required'),
  HANDOFF_SECRET: z
    .string()
    .min(1, 'is required')
    .refine((value) => Buffer.from(value, 'base64').length >= 32, 'must be at least 32 random bytes, base64-encoded'),
  CORS_ORIGINS: optional(z.string()),
  APP_ORIGIN: optional(z.string().url()),
  TRUST_PROXY: optional(z.string()),
  APPWRITE_BUCKET_HANDOFF: optional(z.string()),
  APPWRITE_BUCKET_LISTING: optional(z.string()),
});

export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  appwriteEndpoint: string;
  appwriteProjectId: string;
  appwriteApiKey: string;
  databaseUrl: string;
  handoffSecret: string;
  corsOrigins: string[];
  appOrigin: string;
  /** Platform fee in basis points; fixed by the shared pricing rules. */
  platformFeeBps: number;
  trustProxy: boolean | number | string;
  buckets: { handoff: string; listing: string };
}

function parseTrustProxy(value: string | undefined): boolean | number | string {
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  return /^\d+$/.test(value) ? Number(value) : value;
}

export function isProduction(config: Pick<Config, 'nodeEnv'>): boolean {
  return config.nodeEnv === 'production';
}

/** Parse process.env into a Config; throws an Error naming the offending variables, never their values. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`);
    throw new Error(`Invalid backend configuration (see backend/.env.example): ${problems.join('; ')}`);
  }
  const parsed = result.data;
  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    appwriteEndpoint: parsed.APPWRITE_ENDPOINT,
    appwriteProjectId: parsed.APPWRITE_PROJECT_ID,
    appwriteApiKey: parsed.APPWRITE_API_KEY,
    databaseUrl: parsed.DATABASE_URL,
    handoffSecret: parsed.HANDOFF_SECRET,
    corsOrigins: (parsed.CORS_ORIGINS ?? DEFAULT_CORS_ORIGINS)
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    appOrigin: parsed.APP_ORIGIN ?? 'http://localhost:5173',
    platformFeeBps: PLATFORM_FEE_BPS,
    trustProxy: parseTrustProxy(parsed.TRUST_PROXY),
    buckets: {
      handoff: parsed.APPWRITE_BUCKET_HANDOFF ?? 'handoff-photos',
      listing: parsed.APPWRITE_BUCKET_LISTING ?? 'listing-photos',
    },
  };
}
