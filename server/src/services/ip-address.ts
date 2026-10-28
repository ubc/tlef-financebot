import { isIP } from 'node:net';

/** Canonical exact-address keys; no hostnames, ports, ranges or forwarding lists. */
export function normalizeIp(input: string | undefined): string | undefined {
  if (!input || input.length > 80 || input.includes('%')) return;
  const value = input.trim();
  const version = isIP(value);
  if (version === 4) return value;
  if (version !== 6) return;
  const normalized = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([a-f\d]{1,4}):([a-f\d]{1,4})$/i.exec(normalized);
  if (!mapped) return normalized;
  const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}
export function reservedIp(ip: string): boolean {
  return /^127\./.test(ip) || ip === '::1' || ip === '0.0.0.0' || ip === '::';
}
