import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { AuthoringBudgetLimits, AuthoringBudgetReceipt } from '../types/authoring-budget';
import type { OutlineGroundingFinding, StructureResult } from '../types/structure';
import type { OutlineCapabilityContext } from '../types/structure-distinctness';
import type { OutlineConsolidationDraft } from '../types/structure-consolidation';
import { deriveOutlineConsolidationPlan, outlineConsolidationProtocolHash, validateOutlineConsolidationProposal } from './structure-outline-consolidation';
import { assessOutlineCapabilityAdmission, renderOutlineCapabilityDistinctness, selectOutlineCapabilityContext } from './structure-capability-distinctness';
import { capabilityReviewAdmissionPlan, estimateCapabilityReviewSend, selectCapabilityOutlineGroundingBatch,
  structureOutlineReviewProtocolHash, type CapabilityOutlineGroundingBatch } from './structure-capability-grounding';
import { measureCapabilityPackingPrompt, planOutlineCapabilityPacking, type CapabilityPackingPlan } from './structure-capability-packing';
import { reviewCapabilityStructureProposal, type ReviewProgress } from './structure-capability-review';
import { outlineGroundingReceipt, type OutlineGroundingRowFailure } from './structure-outline-grounding';

export const OUTLINE_CONSOLIDATION_REVIEW = 'source-preserving-outline-consolidation-review-v1' as const;
const JSON_CORRECTION_SUFFIX = '\n\nYour previous reply was not valid JSON. Respond with ONLY the JSON value — no prose, no explanation, no code fences.';
const digestPattern = /^[a-f0-9]{64}$/;
function fail(reason: string): never { throw new Error(`structure-consolidation-review-${reason}`); }
/** Plain JSON data only. BSON can change prototypes but cannot change any
 * retained value. Undefined, sparse arrays and nonfinite values are refused. */
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (Array.from({ length: value.length }, (_, i) => Object.hasOwn(value, i)).some(present => !present)) fail('non-json-data');
    return `[${value.map(canonical).join(',')}]`;
  }
  if (value && typeof value === 'object' && Object.prototype.toString.call(value) === '[object Object]') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return fail('non-json-data');
}
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const same = (left: unknown, right: unknown) => canonical(left) === canonical(right);
const clone = <T>(value: T): T => structuredClone(value);

export interface PrepareConsolidationReviewInput {
  parentContext: OutlineCapabilityContext;
  parentSourceFindings: OutlineGroundingFinding[];
  selectedIds: string[];
  proposal: unknown;
  /** Authenticated terminal allowance must be supplied by the future durable
   * service. This pure layer never refreshes or grants an allowance. */
  terminalBudget: AuthoringBudgetReceipt;
  expectedBudgetLimits: AuthoringBudgetLimits;
  inputLimit: number;
}
export interface ConsolidationReviewPlan {
  version: typeof OUTLINE_CONSOLIDATION_REVIEW; protocolHash: string;
  input: PrepareConsolidationReviewInput;
  draft: OutlineConsolidationDraft;
  batches: CapabilityOutlineGroundingBatch[];
  packing: CapabilityPackingPlan;
  admission: ReturnType<typeof capabilityReviewAdmissionPlan>;
  sourceReviewScope: 'all-child-objectives-fresh-no-parent-row-reuse';
  freshSourceTargetIds: string[];
  freshComparisons: OutlineConsolidationDraft['comparisonClosure']['allChildComparisons'];
  creditObligations: ConsolidationReviewCreditObligation[];
  authority: 'pure-plan-not-durable-spending-or-apply-authority';
  planHash: string;
}
/** A completed logical review dispatch. Native JSON retries/usage/reservations
 * still require the later durable service's separate authenticated ledger. */
export interface ConsolidationReviewDispatch {
  planHash: string; item: number; attempt: number; ids: string[];
  promptHash: string; rawHash: string; raw: unknown;
  findings: OutlineGroundingFinding[]; failures: OutlineGroundingRowFailure[];
}
export interface ConsolidationReviewReplay {
  version: typeof OUTLINE_CONSOLIDATION_REVIEW; planHash: string; historyHash: string;
  complete: boolean; dispatches: number; findings: OutlineGroundingFinding[];
  failures: OutlineGroundingRowFailure[]; attempts: Record<string, number>;
  /** Known minimum for these logical sends, not provider usage or a ledger. */
  minimumDispatchUnits: number;
  terminalError?: string;
  authority: 'raw-replay-only-no-durable-history-authentication';
  bindingHash: string;
}
export interface ConsolidationReviewCreditObligation {
  scope: 'selected-lineage' | 'unchanged-parent';
  previousId: string; evidenceId: string; assignedSuccessorIds: string[];
}
export interface ConsolidationCreditPreservation extends ConsolidationReviewCreditObligation {
  coveredBy: string[];
  successors: Array<{ id: string; status: 'missing' | 'unsupported' | 'uncertain' | 'capability-held' | 'credit-not-covered' | 'covered' }>;
}
export interface ConsolidationStableIndex {
  id: string; originalThemeIndex: number; originalLoIndex: number; themeIndex: number; loIndex: number;
}

export function outlineConsolidationReviewProtocolHash(): string {
  return createHash('sha256').update(OUTLINE_CONSOLIDATION_REVIEW).update(readFileSync(__filename))
    .update(outlineConsolidationProtocolHash()).update(structureOutlineReviewProtocolHash('outline-capability-distinctness-v1')).digest('hex');
}

function validateBudget(input: PrepareConsolidationReviewInput): void {
  const budget = input.terminalBudget, limits = input.expectedBudgetLimits;
  const whole = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  const limitKeys = ['maxSends', 'maxInputTokens', 'maxOutputTokens', 'maxEstimatedTokens'] as const;
  if (!budget || !limits || !budget.limits || limitKeys.some(key => !whole(limits[key]) || limits[key] === 0) ||
    !same(Object.keys(limits).sort(), [...limitKeys].sort()) || !same(limits, budget.limits)) fail('inherited-limits');
  const counters = ['observedSends', 'estimatedInputTokens', 'reservedOutputTokens', 'admissionTokens', 'pendingSends',
    'settledSends', 'conservativeFinishedSends', 'queueWaitMs', 'executionMs', 'rejectedSends'] as const;
  if (budget.version !== 1 || budget.estimator !== 'utf8-bytes-conservative-v1' || budget.retryVisibility !== 'unknown' ||
    budget.limitScope !== 'process' || budget.accounting !== 'conservative-reservations-v1' ||
    counters.some(key => !whole(budget[key])) || budget.pendingSends !== 0 || budget.settledSends !== 0 ||
    budget.conservativeFinishedSends !== budget.observedSends ||
    !whole(budget.estimatedInputTokens + budget.reservedOutputTokens) ||
    budget.admissionTokens !== budget.estimatedInputTokens + budget.reservedOutputTokens ||
    budget.observedSends > limits.maxSends || budget.admissionTokens! > limits.maxEstimatedTokens) fail('terminal-budget');
  const work = ['generatorAttempts', 'repairCycles', 'evidenceExpansions'] as const;
  if (!budget.logical?.limits || work.some(key => !whole(budget.logical[key]) || !whole(budget.logical.limits[key]) ||
    budget.logical[key] > budget.logical.limits[key]) || !['complete', 'partial', 'unknown'].includes(budget.usageCompleteness) ||
    [budget.reportedInputTokens, budget.reportedOutputTokens].some(value => value !== null && !whole(value))) fail('terminal-budget');
  if (!Number.isSafeInteger(input.inputLimit) || input.inputLimit < 4000 ||
    input.inputLimit > Math.min(48000, limits.maxInputTokens - 1500)) fail('budget-input');
}

function lazyBatch(context: OutlineCapabilityContext, ids: string[]): CapabilityOutlineGroundingBatch {
  const selected = selectOutlineCapabilityContext(context, ids);
  return { objectives: selected.objectives.filter(row => selected.candidateIds.includes(row.id)),
    sources: [], prompt: '', capabilityContext: selected };
}

/** Derive the exact existing public renderer prefix, rather than maintaining a
 * second schema/instruction copy or editing the frozen renderer. Every final
 * group is independently rendered and measured again using real context IDs. */
function renderer(context: OutlineCapabilityContext) {
  const first = lazyBatch(context, [context.candidateIds[0]!]);
  const actual = selectCapabilityOutlineGroundingBatch(first, first.objectives.map(row => row.id));
  const suffix = renderOutlineCapabilityDistinctness(first.capabilityContext);
  if (!actual.prompt.endsWith(suffix)) fail('renderer-binding');
  const prefix = actual.prompt.slice(0, -suffix.length);
  return { wrapPrompt: (packet: string) => prefix + packet, estimateNative: estimateCapabilityReviewSend,
    jsonCorrectionSuffix: JSON_CORRECTION_SUFFIX };
}

/** Fresh source AND capability review for every child objective, including
 * unchanged peers. Parent observations are obligations/diagnostics only. */
export function prepareConsolidationReview(input: PrepareConsolidationReviewInput): ConsolidationReviewPlan {
  canonical(input);
  validateBudget(input);
  const retained = clone(input);
  const obligations = deriveOutlineConsolidationPlan(retained.parentContext, retained.parentSourceFindings, retained.selectedIds);
  const draft = validateOutlineConsolidationProposal(retained.proposal, retained.parentContext, retained.parentSourceFindings, obligations);
  const context = draft.childContext, coordinates = new Set<string>(), topics = new Map<number, string>();
  for (const objective of context.objectives) {
    const key = `${objective.themeIndex}:${objective.loIndex}`;
    if (![objective.themeIndex, objective.loIndex].every(value => Number.isSafeInteger(value) && value >= 0) || coordinates.has(key) ||
      topics.has(objective.themeIndex) && topics.get(objective.themeIndex) !== objective.topic) fail('objective-coordinates');
    coordinates.add(key); topics.set(objective.themeIndex, objective.topic);
  }
  const shared = renderer(context);
  const fallback: string[][] = [];
  for (let i = 0; i < context.candidateIds.length; i += 4) fallback.push(context.candidateIds.slice(i, i + 4));
  const packing = planOutlineCapabilityPacking(context, input.inputLimit, fallback, shared);
  const batches = packing.groups.map((ids, index) => {
    const batch = lazyBatch(context, ids), actual = selectCapabilityOutlineGroundingBatch(batch, ids);
    const suffix = renderOutlineCapabilityDistinctness(batch.capabilityContext);
    if (actual.prompt !== shared.wrapPrompt(suffix)) fail('renderer-binding');
    const measured = measureCapabilityPackingPrompt(actual.prompt, input.inputLimit, shared);
    if (!measured.fits || !same(measured, packing.measurements[index])) fail('packing-size-changed');
    return batch;
  });
  const admission = capabilityReviewAdmissionPlan(batches, retained.terminalBudget);
  if (admission.minimumAdditionalUnits !== packing.minimumAdditionalUnits) fail('reservation-changed');
  const creditObligations: ConsolidationReviewCreditObligation[] = [
    ...draft.memberCreditObligations.map(row => ({ scope: 'selected-lineage' as const, ...clone(row) })),
    ...retained.parentSourceFindings.filter(row => draft.unchangedObjectiveIds.includes(row.id)).flatMap(row =>
      row.coveredEvidenceIds.map(evidenceId => ({ scope: 'unchanged-parent' as const, previousId: row.id,
        evidenceId, assignedSuccessorIds: [row.id] }))),
  ];
  const content: Omit<ConsolidationReviewPlan, 'planHash'> = { version: OUTLINE_CONSOLIDATION_REVIEW,
    protocolHash: outlineConsolidationReviewProtocolHash(), input: retained, draft, batches, packing, admission,
    sourceReviewScope: 'all-child-objectives-fresh-no-parent-row-reuse', freshSourceTargetIds: [...context.candidateIds],
    freshComparisons: clone(draft.comparisonClosure.allChildComparisons), creditObligations,
    authority: 'pure-plan-not-durable-spending-or-apply-authority' };
  return { ...content, planHash: hash(content) };
}

function checkedPlan(plan: ConsolidationReviewPlan): ConsolidationReviewPlan {
  if (!plan || plan.version !== OUTLINE_CONSOLIDATION_REVIEW || !digestPattern.test(plan.planHash)) fail('plan-binding');
  const expected = prepareConsolidationReview(plan.input);
  if (!same(plan, expected)) fail('plan-changed');
  return expected;
}

const dispatchSchema = z.object({ planHash: z.string().regex(digestPattern), item: z.number().int().nonnegative(),
  attempt: z.number().int().min(0).max(1), ids: z.array(z.string()).min(1).max(4), promptHash: z.string().regex(digestPattern),
  rawHash: z.string().regex(digestPattern), raw: z.unknown(), findings: z.array(z.unknown()), failures: z.array(z.unknown()),
}).strict();
class MissingDispatch extends Error {}

/** Replay the ACTUAL existing driver from empty child progress. It reconstructs
 * the exact correction prompt and retained cross-batch comparisons. A stored
 * finding array alone can never substitute for this raw-history step. This is
 * mechanical replay, not authentication of a durable model dispatch or usage. */
export async function replayConsolidationReviewDispatches(plan: ConsolidationReviewPlan,
  history: ConsolidationReviewDispatch[]): Promise<ConsolidationReviewReplay> {
  const retained = checkedPlan(plan);
  if (!retained.admission.fits) fail('budget-shortfall');
  if (!Array.isArray(history) || history.length > retained.freshSourceTargetIds.length * 2) fail('history-shape');
  canonical(history);
  const rows = clone(history);
  for (const row of rows) {
    if (!dispatchSchema.safeParse(row).success || row.planHash !== retained.planHash || !Object.hasOwn(row, 'raw') ||
      row.rawHash !== hash(row.raw) || new Set(row.ids).size !== row.ids.length) fail('dispatch-binding');
  }
  const progress: ReviewProgress = { findings: [], attempts: {}, unresolvedDispatchIds: [], failures: [] };
  let index = 0, active: ConsolidationReviewDispatch | undefined, terminalError: string | undefined;
  let minimumDispatchUnits = 0;
  try {
    await reviewCapabilityStructureProposal({ batches: retained.batches, progress, assertCurrent: async () => {},
      beforeDispatch: async (ids, attempt, item) => {
        active = rows[index];
        if (!active) throw new MissingDispatch();
        if (!same({ ids, attempt, item }, { ids: active.ids, attempt: active.attempt, item: active.item })) fail('dispatch-order');
      },
      complete: async (prompt, item, attempt) => {
        if (!active || active.item !== item || active.attempt !== attempt || active.promptHash !== hash(prompt)) fail('dispatch-prompt');
        const nativeInput = estimateCapabilityReviewSend(prompt), budget = retained.input.terminalBudget;
        minimumDispatchUnits += nativeInput + 6000;
        const alreadyUsed = budget.admissionTokens ?? budget.estimatedInputTokens + budget.reservedOutputTokens;
        if (nativeInput > Math.min(48000, budget.limits.maxInputTokens) ||
          budget.observedSends + index + 1 > budget.limits.maxSends || alreadyUsed + minimumDispatchUnits > budget.limits.maxEstimatedTokens) fail('dispatch-budget');
        return clone(active.raw);
      },
      afterValidation: async checked => {
        if (!active || !same(checked.findings, active.findings) || !same(checked.failures, active.failures)) fail('dispatch-result');
        index++; active = undefined;
      } });
  } catch (error) {
    if (error instanceof MissingDispatch) terminalError = 'structure-consolidation-review-history-incomplete';
    else if (error instanceof Error && !active && progress.unresolvedDispatchIds.length === 0 &&
      progress.failures!.some(failure => failure.reason === error.message)) terminalError = error.message;
    else throw error;
  }
  if (index !== rows.length) fail('history-extra');
  const complete = !terminalError && progress.unresolvedDispatchIds.length === 0 && progress.failures!.length === 0 &&
    progress.findings.length === retained.freshSourceTargetIds.length;
  const content: Omit<ConsolidationReviewReplay, 'bindingHash'> = { version: OUTLINE_CONSOLIDATION_REVIEW,
    planHash: retained.planHash, historyHash: hash(rows), complete, dispatches: index,
    findings: clone(progress.findings), failures: clone(progress.failures!), attempts: clone(progress.attempts),
    minimumDispatchUnits,
    ...(terminalError ? { terminalError } : {}), authority: 'raw-replay-only-no-durable-history-authentication' };
  return { ...content, bindingHash: hash(content) };
}

/** A compact projection is possible only after raw child replay. Fresh source
 * support alone does not admit duplicates or discharge old credit. No durable
 * run, transaction, source-currentness, spending or Apply authority is granted. */
export async function finalizeConsolidationReview(plan: ConsolidationReviewPlan, history: ConsolidationReviewDispatch[]) {
  const retained = checkedPlan(plan);
  const replay = await replayConsolidationReviewDispatches(retained, history);
  const context = retained.draft.childContext;
  const capability = assessOutlineCapabilityAdmission(context, replay.findings);
  const eligible = new Set(capability.eligibleIds);
  const creditPreservation: ConsolidationCreditPreservation[] = retained.creditObligations.map(obligation => {
    const successors: ConsolidationCreditPreservation['successors'] = obligation.assignedSuccessorIds.map(id => {
      const finding = replay.findings.find(row => row.id === id);
      const status = !finding ? 'missing' : finding.status !== 'supported' ? finding.status : !eligible.has(id) ? 'capability-held'
        : !finding.coveredEvidenceIds.includes(obligation.evidenceId) ? 'credit-not-covered' : 'covered';
      return { id, status };
    });
    return { ...clone(obligation), coveredBy: successors.filter(row => row.status === 'covered').map(row => row.id), successors };
  });
  const shortfalls = creditPreservation.filter(row => !row.coveredBy.length);
  const complete = replay.complete && capability.complete;
  const status = !complete ? 'incomplete' as const : shortfalls.length || !eligible.size ? 'shortfall' as const : 'reviewed-projection' as const;
  const themes: StructureResult['themes'] = [], stableIndex: ConsolidationStableIndex[] = [];
  // Projection follows original curriculum order, not the packing/send order.
  const themeMap = new Map<number, number>();
  const curriculum = [...context.objectives].sort((left, right) => left.themeIndex - right.themeIndex || left.loIndex - right.loIndex);
  if (status === 'reviewed-projection') for (const objective of curriculum) {
    if (!eligible.has(objective.id)) continue;
    const finding = replay.findings.find(row => row.id === objective.id)!;
    if (!themeMap.has(objective.themeIndex)) {
      themeMap.set(objective.themeIndex, themes.length); themes.push({ name: objective.topic, los: [] });
    }
    const themeIndex = themeMap.get(objective.themeIndex)!, theme = themes[themeIndex]!;
    stableIndex.push({ id: objective.id, originalThemeIndex: objective.themeIndex, originalLoIndex: objective.loIndex,
      themeIndex, loIndex: theme.los.length });
    theme.los.push({ name: objective.name, evidenceIds: [...finding.coveredEvidenceIds],
      materialIds: [...new Set(finding.coveredEvidenceIds.map(id => objective.learningPoints.find(point => point.id === id)!.materialId))] });
  }
  const result = { version: OUTLINE_CONSOLIDATION_REVIEW, planHash: retained.planHash, status, replay,
    grounding: { ...outlineGroundingReceipt(replay.findings, context.candidateIds.length), capabilityDistinctness: capability },
    creditPreservation, shortfalls, themes, stableIndex, retiredIds: [...retained.draft.retiredIds],
    lineage: clone(retained.draft.proposal.lineage),
    authority: 'fresh-raw-review-projection-not-durable-or-apply-authority' as const };
  return { ...result, bindingHash: hash(result) };
}
