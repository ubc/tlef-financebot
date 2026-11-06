import { createHash } from 'node:crypto';
import type { StructureEvidence, StructureResult } from '../types/structure';
import type { GroundingSection, OutlineGroundingBatch } from './structure-outline-grounding';

/** Volatile cache of a deterministic plan, never a source or model verdict.
 * Exact inputs and the current complete protocol hash own every entry. */
export interface CapabilityPlanCacheInput {
  protocolHash: string;
  themes: StructureResult['themes'];
  evidence: StructureEvidence[];
  sections: GroundingSection[];
  inputLimit: number;
}

const MAX_ENTRIES = 4;
const MAX_SERIALIZED_BYTES = 16_000_000;

/** Deterministic graph encoding. Native V8 bytes can change solely because an
 * array moved between packed/holey representations after structuredClone.
 * Keep property order, own undefined, holes and shared references because the
 * historical planner can observe them. This cache never serializes methods. */
function encode(value: unknown): string {
  const seen = new Map<object, number>();
  const visit = (item: unknown): string => {
    if (item === undefined) return 'u';
    if (item === null) return 'n';
    if (typeof item === 'string') return `s${JSON.stringify(item)}`;
    if (typeof item === 'boolean') return item ? 't' : 'f';
    if (typeof item === 'number') return `d${Object.is(item, -0) ? '-0' : String(item)};`;
    if (typeof item !== 'object') throw new Error('structure-capability-plan-cache-value');
    const prior = seen.get(item);
    if (prior !== undefined) return `r${prior};`;
    const id = seen.size; seen.set(item, id);
    if (Array.isArray(item)) return `a${id}[${Array.from({ length: item.length }, (_, index) =>
      Object.hasOwn(item, index) ? visit(item[index]) : 'h').join(',')}]`;
    if (Object.prototype.toString.call(item) !== '[object Object]') throw new Error('structure-capability-plan-cache-value');
    return `o${id}{${Object.keys(item).map(key => `${JSON.stringify(key)}:${visit((item as Record<string, unknown>)[key])}`).join(',')}}`;
  };
  return visit(value);
}

function bounded(value: number | undefined, maximum: number): number {
  if (value === undefined) return maximum;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error('structure-capability-plan-cache-limit');
  return value;
}

export function createCapabilityPlanCache(limits: { entries?: number; serializedBytes?: number } = {}) {
  const maxEntries = bounded(limits.entries, MAX_ENTRIES);
  const maxBytes = bounded(limits.serializedBytes, MAX_SERIALIZED_BYTES);
  const entries = new Map<string, { plan: OutlineGroundingBatch[]; bytes: number }>();
  let bytes = 0, hits = 0, misses = 0;

  function run(input: CapabilityPlanCacheInput, build: () => OutlineGroundingBatch[]): OutlineGroundingBatch[] {
    if (!/^[a-f0-9]{64}$/.test(input.protocolHash) || !Number.isSafeInteger(input.inputLimit) || input.inputLimit < 1) {
      throw new Error('structure-capability-plan-cache-identity');
    }
    const key = createHash('sha256').update('capability-plan-cache-v1').update(encode(input)).digest('hex');
    const cached = entries.get(key);
    if (cached) {
      hits++;
      entries.delete(key); entries.set(key, cached);
      return structuredClone(cached.plan);
    }
    misses++;
    // A thrown build never occupies an entry; the caller owns complete-plan
    // validation. No provider work belongs in this synchronous callback.
    const plan = build();
    const retained = structuredClone(plan);
    const storedBytes = Buffer.byteLength(encode(retained), 'utf8');
    if (storedBytes <= maxBytes) {
      while (entries.size >= maxEntries || bytes + storedBytes > maxBytes) {
        const oldest = entries.entries().next().value;
        if (!oldest) break;
        entries.delete(oldest[0]); bytes -= oldest[1].bytes;
      }
      entries.set(key, { plan: retained, bytes: storedBytes }); bytes += storedBytes;
    }
    // Neither the builder's references nor caller mutation can reach the
    // stored snapshot. Serialized-byte bounds are not an RSS-memory claim.
    return structuredClone(plan);
  }

  return { run, stats: () => ({ entries: entries.size, serializedBytes: bytes, hits, misses }) };
}

const cache = createCapabilityPlanCache();
export const withCapabilityPlanCache = cache.run;
