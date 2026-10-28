import { ipBlocksCol } from '../components/mongodb/collections';
import { normalizeIp, reservedIp } from './ip-address';
import { exceptionDiagnostics } from './exception-diagnostics';
import type { IpBlockEntry, IpBlockChange } from '../types/ip-block';

let cached = new Set<string>(), validUntil = 0, version = 0;
let loading: Promise<Set<string>> | undefined;

/** Existing rules survive refresh faults; a cold lookup fault does not block everyone. */
async function activeRules(): Promise<Set<string>> {
  if (Date.now() < validUntil) return cached;
  if (loading) return loading;
  const ownVersion = version;
  const work = (async () => {
    try {
      const rows = await ipBlocksCol().find({ blocked: true }, { projection: { ip: 1 }, timeoutMS: 1000 }).toArray();
      if (version === ownVersion) { cached = new Set(rows.map(row => normalizeIp(row.ip)).filter((ip): ip is string => Boolean(ip))); validUntil = Date.now() + 5000; }
    } catch (error) {
      if (version === ownVersion) validUntil = Date.now() + 5000;
      console.error('[security.ip_block_refresh_failed]', JSON.stringify({ exception: exceptionDiagnostics(error) }));
    }
    return cached;
  })();
  loading = work;
  try { return await work; } finally { if (loading === work) loading = undefined; }
}
export async function isIpBlocked(ip: string): Promise<boolean> { return (await activeRules()).has(ip); }

/** Also used by isolated tests; no public endpoint clears rules through this cache. */
export function clearIpBlockCache(): void { cached = new Set(); validUntil = 0; version++; loading = undefined; }
function applyLocalRule(ip: string, blocked: boolean): void {
  cached = new Set(cached); if (blocked) cached.add(ip); else cached.delete(ip);
  version++; validUntil = 0; loading = undefined;
}
export async function listIpBlocks(page: number, blocked?: boolean, ip?: string) {
  const filter = { ...(blocked !== undefined ? { blocked } : {}), ...(ip ? { ip } : {}) };
  const [items, total] = await Promise.all([
    ipBlocksCol().find(filter).sort({ updatedAt: -1, ip: 1 }).skip((page - 1) * 25).limit(25).toArray(),
    ipBlocksCol().countDocuments(filter),
  ]);
  return { items, total, page, limit: 25, refreshSeconds: 5 };
}

export async function setIpBlock(input: { ip: string; blocked: boolean; reason: string; expectedRevision?: number },
  actor: { puid: string; displayName: string }, safety: { currentIp?: string; targetIsProxy: boolean }) {
  const ip = normalizeIp(input.ip);
  if (!ip) throw Object.assign(new Error('Enter one valid IPv4 or IPv6 address.'), { status: 400 });
  if (input.blocked && (ip === safety.currentIp || reservedIp(ip) || safety.targetIsProxy)) {
    throw Object.assign(new Error('The current administrator address, loopback and trusted proxy addresses cannot be blocked.'), { status: 409 });
  }
  const current = await ipBlocksCol().findOne({ ip });
  if (input.expectedRevision !== undefined && input.expectedRevision !== (current?.revision ?? 0)) throw Object.assign(new Error('This IP rule changed. Refresh before retrying.'), { status: 409 });
  if (current?.blocked === input.blocked) { applyLocalRule(ip, input.blocked); return current; }
  const at = new Date();
  const change: IpBlockChange = { blocked: input.blocked, at, actorPuid: actor.puid, actorName: actor.displayName, reason: input.reason.trim() };
  let result: IpBlockEntry;
  if (!current) {
    if (!input.blocked) throw Object.assign(new Error('IP rule not found.'), { status: 404 });
    result = { ip, blocked: true, revision: 1, reason: change.reason, updatedAt: at, updatedByPuid: actor.puid, updatedByName: actor.displayName, history: [change] };
    try { await ipBlocksCol().insertOne(result); }
    catch (error) {
      if ((error as { code?: number }).code === 11000) throw Object.assign(new Error('This IP rule changed. Refresh before retrying.'), { status: 409 });
      throw error;
    }
  } else {
    const updated = await ipBlocksCol().findOneAndUpdate({ ip, revision: current.revision }, {
      $set: { blocked: input.blocked, reason: change.reason, updatedAt: at, updatedByPuid: actor.puid, updatedByName: actor.displayName },
      $inc: { revision: 1 }, $push: { history: { $each: [change], $slice: -50 } },
    }, { returnDocument: 'after' });
    if (!updated) throw Object.assign(new Error('This IP rule changed. Refresh before retrying.'), { status: 409 });
    result = updated;
  }
  applyLocalRule(ip, input.blocked);
  return result;
}
