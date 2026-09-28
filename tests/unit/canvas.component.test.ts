import { tokenStore, canvasApi } from '../../server/src/components/canvas';
import { canvas } from '@ubc/ubc-genai-toolkit-lms-integration';
import { getDb } from '../../server/src/components/mongodb';
jest.mock('../../server/src/config/env', () => ({ env: { canvasDomain: 'https://canvas.test', canvasClientId: 'test', canvasClientSecret: 'test', canvasRedirectUri: 'https://finance.test/api/canvas/callback', canvasTokenKey: 'ab'.repeat(32) } }));
jest.mock('../../server/src/components/mongodb', () => ({ getDb: jest.fn() }));
jest.mock('@ubc/ubc-genai-toolkit-lms-integration', () => ({ canvas: { refreshTokens: jest.fn(), createApiClient: jest.fn(options => options) } }));
const rows = new Map<string, { _id: string; encrypted: string }>();
const tokens = { accessToken: 'secret-access', refreshToken: 'secret-refresh', expiresAt: Date.now() + 3600000, canvasUserId: '1' };
beforeEach(() => {
  rows.clear(); jest.clearAllMocks();
  (getDb as jest.Mock).mockReturnValue({ collection: () => ({
    findOne: async (q: { _id: string }) => rows.get(q._id) ? { ...rows.get(q._id) } : null,
    deleteOne: async (q: { _id: string }) => rows.delete(q._id),
    updateOne: async (q: { _id: string; encrypted?: string }, update: { $set: { encrypted: string } }, options?: { upsert?: boolean }) => {
      const old = rows.get(q._id);
      if ((!old && !options?.upsert) || (q.encrypted && q.encrypted !== old?.encrypted)) return { matchedCount: 0 };
      rows.set(q._id, { _id: q._id, encrypted: update.$set.encrypted }); return { matchedCount: 1 };
    },
  }) });
});
test('tokens are encrypted at rest, round-trip, and isolated per PUID', async () => {
  await tokenStore.set('A', tokens);
  expect(JSON.stringify([...rows.values()])).not.toContain(tokens.accessToken);
  expect(await tokenStore.get('A')).toEqual(tokens); expect(await tokenStore.get('B')).toBeNull();
});
test('authenticated encryption rejects moving a token to another identity', async () => {
  await tokenStore.set('A', tokens);
  rows.set('https://canvas.test|B', { ...rows.get('https://canvas.test|A')!, _id: 'https://canvas.test|B' });
  await expect(tokenStore.get('B')).rejects.toThrow();
});
test('refresh persists new access token and preserves refresh token when Canvas omits it', async () => {
  await tokenStore.set('A', { ...tokens, expiresAt: 0 });
  jest.mocked(canvas.refreshTokens).mockResolvedValue({ accessToken: 'new-access', expiresAt: Date.now() + 3600000 });
  await canvasApi('A');
  expect(await tokenStore.get('A')).toEqual({ ...tokens, accessToken: 'new-access', expiresAt: expect.any(Number) });
});
test('disconnect during refresh cannot resurrect encrypted credentials', async () => {
  await tokenStore.set('A', { ...tokens, expiresAt: 0 });
  jest.mocked(canvas.refreshTokens).mockImplementation(async () => { await tokenStore.delete('A'); return { accessToken: 'new-access', expiresAt: Date.now() + 3600000 }; });
  await expect(canvasApi('A')).rejects.toThrow('disconnected'); expect(await tokenStore.get('A')).toBeNull();
});
