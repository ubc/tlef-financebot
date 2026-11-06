import type { OutlineCapabilityContext } from '../types/structure-distinctness';
import { estimateAuthoringTokens } from '../components/genai/llm/authoring-budget';
import { prepareOutlineCapabilityTrialRenderer } from './structure-capability-distinctness';

export const OUTLINE_CAPABILITY_PACKING_LIMITS = { candidates: 4, shortlist: 16, trialGroups: 16000, output: 6000 } as const;
export interface CapabilityPackingRenderer {
  wrapPrompt: (capabilityPrompt: string) => string;
  estimateNative: (prompt: string) => number;
  jsonCorrectionSuffix: string;
}
export interface CapabilityPackingMeasurement {
  rawInput: number; nativeInput: number; jsonRetryInput: number;
  reservation: number; fits: boolean;
}
export interface CapabilityPackingPlan {
  version: 'source-overlap-capability-packing-v1';
  strategy: 'recursive' | 'largest-singleton-source-overlap';
  groups: string[][];
  measurements: CapabilityPackingMeasurement[];
  minimumAdditionalUnits: number;
  fallbackMinimumAdditionalUnits: number;
  trialGroups: number;
  searchComplete: boolean;
  searchStopReason?: 'trial-limit';
}
class TrialLimit extends Error {}
function fail(reason: string): never { throw new Error(`structure-capability-packing-${reason}`); }

export function measureCapabilityPackingPrompt(prompt: string, inputLimit: number,
  renderer: Pick<CapabilityPackingRenderer, 'estimateNative' | 'jsonCorrectionSuffix'>): CapabilityPackingMeasurement {
  if (!Number.isSafeInteger(inputLimit) || inputLimit < 4000 || typeof prompt !== 'string' ||
    typeof renderer?.estimateNative !== 'function' || typeof renderer?.jsonCorrectionSuffix !== 'string') fail('input');
  const rawInput = estimateAuthoringTokens(prompt), nativeInput = renderer.estimateNative(prompt);
  const jsonRetryInput = renderer.estimateNative(prompt + renderer.jsonCorrectionSuffix);
  if (![rawInput, nativeInput, jsonRetryInput].every(value => Number.isSafeInteger(value) && value >= 0) || nativeInput < rawInput) fail('estimate');
  const nativeLimit = Math.min(48000, inputLimit + 1500);
  return { rawInput, nativeInput, jsonRetryInput, reservation: nativeInput + OUTLINE_CAPABILITY_PACKING_LIMITS.output,
    fits: rawInput <= inputLimit && nativeInput <= nativeLimit && jsonRetryInput <= nativeLimit };
}

/** Retrieval-based packing only. The prepared shared renderer validates the
 * immutable global context once; no source verdict, point, peer or pair is
 * removed. A trial hash is used only for exact-size estimates. Callers must
 * rebuild real contexts and compare every final size before accepting a plan. */
export function planOutlineCapabilityPacking(context: OutlineCapabilityContext, inputLimit: number,
  fallbackGroups: string[][], renderer: CapabilityPackingRenderer): CapabilityPackingPlan {
  if (typeof renderer?.wrapPrompt !== 'function') fail('input');
  const retained = structuredClone(context);
  const renderTrial = prepareOutlineCapabilityTrialRenderer(retained);
  const ids = retained.candidateIds, index = new Map(ids.map((id, i) => [id, i]));
  const canonical = (group: string[]) => [...group].sort((a, b) => index.get(a)! - index.get(b)!);
  const fallbackIds = Array.isArray(fallbackGroups) ? fallbackGroups.flat() : [];
  if (!Array.isArray(fallbackGroups) || !fallbackGroups.length || fallbackGroups.some(group => !Array.isArray(group) || !group.length ||
    group.some(id => !index.has(id))) || fallbackIds.length !== ids.length || new Set(fallbackIds).size !== ids.length || ids.some(id => !fallbackIds.includes(id))) fail('fallback-identity');
  const sourceBytes = new Map(retained.sources.map(row => [row.alias, Buffer.byteLength(row.text, 'utf8')]));
  const needed = new Map(ids.map(id => {
    const ownAndPeers = [id, ...retained.nominations.find(row => row.objectiveId === id)!.peerIds];
    return [id, new Set(retained.objectives.filter(row => ownAndPeers.includes(row.id)).flatMap(row => row.sourceIds))];
  }));
  const cache = new Map<string, CapabilityPackingMeasurement>();
  const evaluate = (group: string[]): CapabilityPackingMeasurement => {
    const ordered = canonical(group), key = ordered.join(',');
    const prior = cache.get(key); if (prior) return prior;
    if (cache.size >= OUTLINE_CAPABILITY_PACKING_LIMITS.trialGroups) throw new TrialLimit();
    const measured = measureCapabilityPackingPrompt(renderer.wrapPrompt(renderTrial(ordered)), inputLimit, renderer);
    cache.set(key, measured); return measured;
  };
  const fallbackFinalGroups: string[][] = [], fallbackMeasurements: CapabilityPackingMeasurement[] = [];
  const splitFallback = (group: string[]): void => {
    const measured = evaluate(group);
    if (group.length <= OUTLINE_CAPABILITY_PACKING_LIMITS.candidates && measured.fits) {
      fallbackFinalGroups.push(canonical(group)); fallbackMeasurements.push(measured); return;
    }
    if (group.length === 1) fail('singleton-input');
    const middle = Math.ceil(group.length / 2);
    splitFallback(group.slice(0, middle)); splitFallback(group.slice(middle));
  };
  fallbackGroups.forEach(splitFallback);
  const fallbackMinimum = fallbackMeasurements.reduce((sum, row) => sum + row.reservation, 0);
  const fallback = { groups: fallbackFinalGroups, measurements: fallbackMeasurements, minimum: fallbackMinimum };
  let searchComplete = true;
  let greedy: typeof fallback | undefined;
  try {
    for (const id of ids) if (!evaluate([id]).fits) fail('singleton-input');
    const remaining = new Set(ids), groups: string[][] = [];
    while (remaining.size) {
      const seed = [...remaining].sort((a, b) => evaluate([b]).nativeInput - evaluate([a]).nativeInput || index.get(a)! - index.get(b)!)[0]!;
      let group = [seed]; remaining.delete(seed);
      while (group.length < OUTLINE_CAPABILITY_PACKING_LIMITS.candidates && remaining.size) {
        const groupMeasurement = evaluate(group);
        const originals = new Set(group.flatMap(id => [...needed.get(id)!]));
        const ranked = [...remaining].map(id => ({ id,
          overlapBytes: [...needed.get(id)!].reduce((sum, alias) => sum + (originals.has(alias) ? sourceBytes.get(alias)! : 0), 0),
          additionalBytes: [...needed.get(id)!].reduce((sum, alias) => sum + (!originals.has(alias) ? sourceBytes.get(alias)! : 0), 0),
        })).sort((a, b) => b.overlapBytes - a.overlapBytes || a.additionalBytes - b.additionalBytes || index.get(a.id)! - index.get(b.id)!);
        let trials = ranked.slice(0, OUTLINE_CAPABILITY_PACKING_LIMITS.shortlist).map(row => ({ ...row, measured: evaluate([...group, row.id]) }));
        if (!trials.some(row => row.measured.fits)) trials = trials.concat(ranked.slice(OUTLINE_CAPABILITY_PACKING_LIMITS.shortlist).map(row => ({ ...row, measured: evaluate([...group, row.id]) })));
        const feasible = trials.filter(row => row.measured.fits).map(row => ({ ...row,
          avoidedReservation: groupMeasurement.reservation + evaluate([row.id]).reservation - row.measured.reservation,
        })).sort((a, b) => b.avoidedReservation - a.avoidedReservation || b.overlapBytes - a.overlapBytes || index.get(a.id)! - index.get(b.id)!);
        if (!feasible.length) break;
        const chosen = feasible[0]!;
        group = canonical([...group, chosen.id]); remaining.delete(chosen.id);
      }
      groups.push(group);
    }
    const measurements = groups.map(evaluate);
    greedy = { groups, measurements, minimum: measurements.reduce((sum, row) => sum + row.reservation, 0) };
  } catch (error) {
    if (!(error instanceof TrialLimit)) throw error;
    // The original exact recursive plan is already complete and bounded.
    // A partial search can never become a partial review plan.
    searchComplete = false;
  }
  const useGreedy = greedy !== undefined && greedy.minimum < fallback.minimum;
  const selected = useGreedy ? greedy! : fallback;
  return { version: 'source-overlap-capability-packing-v1', strategy: useGreedy ? 'largest-singleton-source-overlap' : 'recursive',
    groups: selected.groups, measurements: selected.measurements, minimumAdditionalUnits: selected.minimum,
    fallbackMinimumAdditionalUnits: fallback.minimum, trialGroups: cache.size, searchComplete,
    ...(!searchComplete ? { searchStopReason: 'trial-limit' as const } : {}) };
}
