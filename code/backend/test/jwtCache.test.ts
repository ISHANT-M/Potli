/** The adapter remembers verified tokens briefly and shares concurrent lookups. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppwriteAdapter } from '../src/appwrite.ts';

const config = { appwriteEndpoint: 'http://appwrite.test/v1', appwriteProjectId: 'p', appwriteApiKey: 'k' };
const account = { $id: 'u1', email: 'a@b.test', name: 'A', labels: [], emailVerification: true };

afterEach(() => vi.unstubAllGlobals());

describe('accountFromJwt cache', () => {
  it('asks Appwrite once for repeated and concurrent lookups of one token', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(account), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const adapter = createAppwriteAdapter(config);
    const results = await Promise.all([adapter.accountFromJwt('t1'), adapter.accountFromJwt('t1'), adapter.accountFromJwt('t1')]);
    await adapter.accountFromJwt('t1');
    expect(results.every((r) => r?.$id === 'u1')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await adapter.accountFromJwt('t2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not cache failures', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const adapter = createAppwriteAdapter(config);
    expect(await adapter.accountFromJwt('bad')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await adapter.accountFromJwt('bad')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
