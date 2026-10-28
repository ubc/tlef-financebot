import { createHash } from 'node:crypto';
import type { OperationEvent } from '../types/domain';
import { historicalPaths } from './request-probe.service';

const publicPaths = [...historicalPaths, '/api/mcp', '/api/version', '/api/v1/version', '/api/config', '/api'];
const publicDigests = new Map(publicPaths.map(path => [createHash('sha256').update(path).digest('hex'), path]));

/** Query-free request path, preserving encoding, case and repeated slashes. */
export function originalRequestPath(url: string): { originalPath: string; originalPathTruncated: boolean } {
  const target = url.split(/[?#]/, 1)[0].replace(/^[a-z][a-z\d+.-]*:\/\/[^/]*/i, '');
  const path = target.startsWith('/') ? target : '/';
  return { originalPath: path.slice(0, 4096), originalPathTruncated: path.length > 4096 };
}

/** Recognition never modifies stored history or assigns a sender/probe verdict. */
export function withRetainedPath<T extends Pick<OperationEvent, 'route' | 'statusCode' | 'request'>>(event: T): T {
  if (event.route !== '/unmatched' || !event.request) return event;
  if (typeof event.request.originalPath === 'string') {
    const path = originalRequestPath(event.request.originalPath);
    return { ...event, request: { ...event.request, ...path, originalPathTruncated: Boolean(event.request.originalPathTruncated || path.originalPathTruncated) } };
  }
  if (event.statusCode !== 404 || event.request.pathTruncated) return event;
  const path = publicDigests.get(event.request.pathHash);
  return path ? { ...event, request: { ...event.request, recognizedPath: { path, evidence: 'retained-path-hash' as const } } } : event;
}

export function publicPathSearchHashes(query: string): string[] {
  return [...publicDigests].filter(([, path]) => path.toLowerCase().includes(query.toLowerCase())).map(([hash]) => hash);
}
