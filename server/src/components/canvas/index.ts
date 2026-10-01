import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { canvas, type TokenStore } from '@ubc/ubc-genai-toolkit-lms-integration';
import { getDb } from '../mongodb';
import { env } from '../../config/env';

export { canvas };
export const canvasEnabled = (): boolean => Boolean(env.canvasDomain && env.canvasClientId && env.canvasClientSecret && env.canvasTokenKey);
export const canvasConfig = () => ({ canvasDomain: env.canvasDomain, clientId: env.canvasClientId, clientSecret: env.canvasClientSecret, redirectUri: env.canvasRedirectUri });
export const CANVAS_SCOPES = [
  'url:GET|/api/v1/courses',
  'url:GET|/api/v1/courses/:course_id/users',
  'url:GET|/api/v1/courses/:course_id/enrollments',
  'url:GET|/api/v1/courses/:course_id/sections',
  'url:GET|/api/v1/courses/:course_id/files',
  'url:GET|/api/v1/courses/:course_id/files/:id',
  'url:GET|/api/v1/files/:id/public_url',
];
interface StoredTokens { _id: string; encrypted: string; }
const tokenId = (puid: string): string => `${env.canvasDomain}|${puid}`;
function key(): Buffer {
  const value = Buffer.from(env.canvasTokenKey, 'hex');
  if (value.length !== 32) throw new Error('CANVAS_TOKEN_KEY must be 64 hexadecimal characters.');
  return value;
}
function encrypt(puid: string, tokens: canvas.Tokens): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(tokenId(puid)));
  const data = Buffer.concat([cipher.update(JSON.stringify(tokens)), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(v => v.toString('base64')).join('.');
}
function decrypt(puid: string, encrypted: string): canvas.Tokens {
  const [iv, tag, data] = encrypted.split('.').map(v => Buffer.from(v, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAAD(Buffer.from(tokenId(puid)));
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString()) as canvas.Tokens;
}
const tokensCol = () => getDb().collection<StoredTokens>('canvasTokens');
export const tokenStore: TokenStore<canvas.Tokens> = {
  async get(puid) {
    const row = await tokensCol().findOne({ _id: tokenId(puid) });
    return row ? decrypt(puid, row.encrypted) : null;
  },
  async set(puid, tokens) {
    await tokensCol().updateOne({ _id: tokenId(puid) }, { $set: { encrypted: encrypt(puid, tokens) } }, { upsert: true });
  },
  async delete(puid) { await tokensCol().deleteOne({ _id: tokenId(puid) }); },
};
const refreshing = new Map<string, Promise<canvas.Tokens>>();
async function refresh(puid: string): Promise<canvas.Tokens> {
  let pending = refreshing.get(puid);
  if (!pending) {
    pending = (async () => {
      const row = await tokensCol().findOne({ _id: tokenId(puid) });
      if (!row) throw new Error('Canvas connection required.');
      const old = decrypt(puid, row.encrypted);
      const updated = await canvas.refreshTokens(canvasConfig(), old.refreshToken);
      const tokens = { ...old, ...updated, refreshToken: updated.refreshToken || old.refreshToken };
      // A disconnect during the request must not recreate the connection.
      const replaced = await tokensCol().updateOne({ _id: row._id, encrypted: row.encrypted }, { $set: { encrypted: encrypt(puid, tokens) } });
      if (replaced.matchedCount) return tokens;
      const current = await tokenStore.get(puid);
      if (!current) throw new Error('Canvas disconnected.');
      return current;
    })();
    refreshing.set(puid, pending);
  }
  try { return await pending; } finally { refreshing.delete(puid); }
}
export async function canvasApi(puid: string): Promise<canvas.ApiClient> {
  if (!canvasEnabled()) throw new Error('Canvas integration is not configured.');
  let tokens = await tokenStore.get(puid);
  if (!tokens) throw new Error('Connect your Canvas account first.');
  if (tokens.expiresAt < Date.now() + 60000) tokens = await refresh(puid);
  return canvas.createApiClient({ canvasDomain: env.canvasDomain, accessToken: tokens.accessToken,
    onUnauthorized: async () => (await refresh(puid)).accessToken });
}
