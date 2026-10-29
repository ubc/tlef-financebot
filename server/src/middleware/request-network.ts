import type { Request } from 'express';
import { normalizeIp } from '../services/ip-address';
import type { OperationRequestDiagnostics } from '../types/domain';

export function requestNetwork(req: Request): NonNullable<OperationRequestDiagnostics['network']> {
  const rawPeer = req.socket?.remoteAddress;
  const peerIp = normalizeIp(rawPeer);
  const trust = req.app?.get('trust proxy fn');
  const trusted = Boolean(rawPeer && typeof trust === 'function' && trust(rawPeer, 0));
  const forwarded = Boolean(req.get('x-forwarded-for'));
  const clientIp = trusted && forwarded ? normalizeIp(req.ip) : peerIp;
  return { ...(peerIp ? { peerIp } : {}), ...(clientIp ? { clientIp } : {}),
    source: !clientIp ? 'unavailable' : trusted && forwarded ? 'trusted-proxy' : forwarded ? 'untrusted-forwarding' : 'direct-peer' };
}
