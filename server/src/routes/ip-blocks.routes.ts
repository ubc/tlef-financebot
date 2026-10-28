import { Router } from 'express';
import { z } from 'zod';
import { ensureAdmin } from '../components/auth';
import { validate } from '../middleware/validate';
import { requestNetwork } from '../middleware/request-network';
import { normalizeIp } from '../services/ip-address';
import { listIpBlocks, setIpBlock } from '../services/ip-blocks.service';

export const ipBlocksRouter = Router();
const ip = z.string().max(80).transform(value => normalizeIp(value)).refine((value): value is string => Boolean(value), 'Enter one valid IPv4 or IPv6 address.');
ipBlocksRouter.get('/admin/ip-blocks', ensureAdmin(), validate({ query: z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1), blocked: z.enum(['true', 'false']).optional(), ip: ip.optional(),
}) }), async (req, res) => {
  const query = req.query as unknown as { page: number; blocked?: string; ip?: string };
  const network = requestNetwork(req);
  res.json({ ...await listIpBlocks(query.page, query.blocked === undefined ? undefined : query.blocked === 'true', query.ip),
    currentIp: network.clientIp ?? null, addressSource: network.source });
});
ipBlocksRouter.put('/admin/ip-blocks', ensureAdmin(), validate({ body: z.object({
  ip, blocked: z.boolean(), reason: z.string().trim().max(300).default(''), expectedRevision: z.number().int().min(0).optional(),
}) }), async (req, res) => {
  const network = requestNetwork(req);
  if (!network.clientIp || network.source === 'untrusted-forwarding') throw Object.assign(new Error('Trusted proxy source identification is required before managing IP rules.'), { status: 409 });
  const trust = req.app.get('trust proxy fn');
  const targetIsProxy = typeof trust === 'function' && Boolean(trust(req.body.ip, 0));
  res.json(await setIpBlock(req.body, req.user!, { currentIp: network.clientIp, targetIsProxy }));
});
