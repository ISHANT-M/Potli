/** Create the private Appwrite Storage buckets (02-CONTRACTS section 6) if they are missing. */
import { APPWRITE_BUCKET_HANDOFF, APPWRITE_BUCKET_LISTING } from '../env.ts';
import { appwriteCall, appwriteConfig, readJson, type AppwriteConfig } from './appwriteAdmin.ts';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];

const BUCKETS = [
  { id: APPWRITE_BUCKET_HANDOFF, name: 'Handoff photos' },
  { id: APPWRITE_BUCKET_LISTING, name: 'Listing photos' },
];

async function ensureBucket(config: AppwriteConfig, bucket: { id: string; name: string }): Promise<void> {
  const existing = await appwriteCall(config, 'GET', `/storage/buckets/${bucket.id}`);
  if (existing.ok) {
    console.log(`exists  bucket ${bucket.id}`);
    return;
  }
  if (existing.status !== 404) {
    throw new Error(`checking bucket ${bucket.id} failed (${existing.status}): ${(await existing.text()).slice(0, 200)}`);
  }

  // No client permissions: every read and write goes through the API with the server key.
  const created = await appwriteCall(config, 'POST', '/storage/buckets', {
    bucketId: bucket.id,
    name: bucket.name,
    permissions: [],
    fileSecurity: false,
    enabled: true,
    maximumFileSize: MAX_FILE_BYTES,
    allowedFileExtensions: EXTENSIONS,
    encryption: true,
    antivirus: false,
  });
  if (!created.ok) {
    const body = await readJson<{ message?: string }>(created).catch(() => ({ message: 'unknown error' }));
    throw new Error(
      `creating bucket ${bucket.id} failed (${created.status}): ${body.message ?? ''}. ` +
        'The API key needs the buckets.write scope.',
    );
  }
  console.log(`created bucket ${bucket.id}`);
}

async function main(): Promise<void> {
  const config = appwriteConfig();
  for (const bucket of BUCKETS) await ensureBucket(config, bucket);
}

try {
  await main();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
