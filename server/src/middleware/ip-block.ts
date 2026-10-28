import type { RequestHandler } from 'express';
import { requestNetwork } from './request-network';
import { isIpBlocked } from '../services/ip-blocks.service';

export const enforceIpBlock: RequestHandler = async (req, res, next) => {
  const ip = requestNetwork(req).clientIp;
  if (ip && await isIpBlocked(ip)) {
    res.locals.ipBlocked = true;
    res.status(403).json({ error: 'API requests from this address are blocked.', code: 'ip-blocked' });
    return;
  }
  next();
};
