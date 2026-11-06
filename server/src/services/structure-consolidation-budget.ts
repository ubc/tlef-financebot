import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AuthoringBudgetLimits, AuthoringBudgetReceipt } from '../types/authoring-budget';
import type { OutlineGroundingFinding } from '../types/structure';
import type { OutlineCapabilityContext } from '../types/structure-distinctness';
import type { OutlineConsolidationDraft, OutlineConsolidationPlan } from '../types/structure-consolidation';
import { OUTLINE_CAPABILITY_DISTINCTNESS, renderOutlineCapabilityDistinctness } from './structure-capability-distinctness';
import { estimateCapabilityReviewSend, structureOutlineReviewProtocolHash } from './structure-capability-grounding';
import { OUTLINE_CAPABILITY_PACKING_LIMITS } from './structure-capability-packing';
import { deriveOutlineConsolidationPlan, outlineConsolidationProtocolHash, validateOutlineConsolidationProposal } from './structure-outline-consolidation';

const VERSION = 'source-preserving-consolidation-budget-floor-v1' as const;
function fail(reason: string): never { throw new Error(`structure-consolidation-budget-${reason}`); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const same = (first: unknown, second: unknown) => canonical(first) === canonical(second);
const whole = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const bytes = (value: string) => Buffer.byteLength(value, 'utf8');
function sum(values: number[]): number {
  const total = values.reduce((first, second) => first + second, 0);
  if (!whole(total)) fail('arithmetic');
  return total;
}

export interface StructureConsolidationBudgetFloorInput {
  parentContext: OutlineCapabilityContext;
  parentSourceFindings: OutlineGroundingFinding[];
  selectedIds: string[];
  plan: OutlineConsolidationPlan;
  /** Must come from the caller's latest authenticated durable parent, not a
   * browser, earlier prefix or newly constructed allowance. This pure helper
   * cannot authenticate a caller that changes both receipt and expected limits. */
  terminalBudget: AuthoringBudgetReceipt;
  expectedBudgetLimits: AuthoringBudgetLimits;
  /** Optional fully validated unreviewed child. Without it, allow the most
   * optimistic legal selection-to-one reduction, not a particular proposal. */
  draft?: OutlineConsolidationDraft;
}

function terminalAllowance(budget: AuthoringBudgetReceipt, expected: AuthoringBudgetLimits) {
  const keys = ['maxSends', 'maxInputTokens', 'maxOutputTokens', 'maxEstimatedTokens'] as const;
  if (!budget || !expected || !budget.limits || keys.some(key => !whole(expected[key]) || expected[key] === 0 ||
    !whole(budget.limits[key]) || budget.limits[key] === 0) ||
    Object.keys(expected).sort().join(',') !== [...keys].sort().join(',') || !same(budget.limits, expected)) fail('inherited-limits');
  if (budget.version !== 1 || budget.estimator !== 'utf8-bytes-conservative-v1' || budget.retryVisibility !== 'unknown' ||
    budget.limitScope !== 'process' || budget.accounting !== 'conservative-reservations-v1') fail('budget-contract');
  const fields = ['observedSends', 'estimatedInputTokens', 'reservedOutputTokens', 'admissionTokens', 'pendingSends',
    'settledSends', 'conservativeFinishedSends', 'queueWaitMs', 'executionMs', 'rejectedSends'] as const;
  if (fields.some(key => !whole(budget[key])) || budget.pendingSends !== 0 || budget.settledSends !== 0 ||
    budget.conservativeFinishedSends !== budget.observedSends ||
    budget.admissionTokens !== sum([budget.estimatedInputTokens, budget.reservedOutputTokens]) ||
    budget.observedSends > budget.limits.maxSends || budget.admissionTokens > budget.limits.maxEstimatedTokens) fail('terminal-budget');
  if (!['complete', 'partial', 'unknown'].includes(budget.usageCompleteness) ||
    [budget.reportedInputTokens, budget.reportedOutputTokens].some(value => value !== null && !whole(value))) fail('reported-usage');
  const logical = budget.logical, work = ['generatorAttempts', 'repairCycles', 'evidenceExpansions'] as const;
  if (!logical || !logical.limits || work.some(key => !whole(logical[key]) || !whole(logical.limits[key]) ||
    logical[key] > logical.limits[key])) fail('logical-budget');
  return { remainingUnits: budget.limits.maxEstimatedTokens - budget.admissionTokens,
    remainingSends: budget.limits.maxSends - budget.observedSends };
}

/** Read the actual compact JSON emitted by the production renderer. Do not
 * price private source objects, deduplicate equal texts under different aliases,
 * or assume a future coalesced/compressed packet has this lower bound. */
function originalProjection(context: OutlineCapabilityContext) {
  const prompt = renderOutlineCapabilityDistinctness(context);
  const boundary = prompt.lastIndexOf('\n\n');
  if (boundary < 0) fail('renderer-packet');
  const json = prompt.slice(boundary + 2);
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { fail('renderer-packet'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('renderer-packet');
  const packet = parsed as Record<string, unknown>;
  const expected = context.sources.map(({ alias, materialName, chunkIndex, text }) => ({ id: alias, material: materialName, chunkIndex, text }));
  // Exact key order and bytes are intentional: the proof counts disjoint
  // serialized JSON objects in this specific renderer's actual prompt.
  if (packet.version !== OUTLINE_CAPABILITY_DISTINCTNESS || packet.contextHash !== context.contextHash ||
    !same(packet.candidateIds, context.candidateIds) || JSON.stringify(packet) !== json ||
    JSON.stringify(packet.originalSections) !== JSON.stringify(expected)) fail('renderer-original-projection');
  const native = estimateCapabilityReviewSend(prompt);
  if (!whole(native) || native < bytes(prompt)) fail('native-estimator');
  return { rows: expected, sourceRowJsonBytes: sum(expected.map(row => bytes(JSON.stringify(row)))),
    fullDiagnosticPromptBytes: bytes(prompt), fullDiagnosticNativeUnits: native,
    projectionHash: hash(expected), fullDiagnosticPromptHash: createHash('sha256').update(prompt).digest('hex') };
}

/** Pure impossibility test for a COMPLETE fresh child review under the current
 * unchanged full-original renderer, <=4 candidates/send and 6000 output/send.
 * Every source is owned by at least one child target, so at least one send must
 * contain each exact public original row. Those row serializations are disjoint
 * substrings of the raw JSON packet, and native UTF-8 admission is no smaller.
 * Sum each row once, then add ceil(childTargets/4)*6000. All instructions, row
 * delimiters, candidate/peer payloads, native escaping and corrections are
 * omitted: this is an optimistic lower bound, not an executable plan or cost
 * estimate. Full source/model verdict reuse would require a different proof.
 *
 * Invalid/pending authority refuses. A returned `not-ruled-out` is NEVER fit,
 * dispatch, credit, adoption, currentness or authentication authority. The caller
 * still needs fresh course-fenced parent reads and a complete actual plan.
 */
export function assessStructureConsolidationBudgetFloor(input: StructureConsolidationBudgetFloorInput) {
  if (!input || OUTLINE_CAPABILITY_PACKING_LIMITS.candidates !== 4 || OUTLINE_CAPABILITY_PACKING_LIMITS.output !== 6000) fail('protocol');
  const allowance = terminalAllowance(input.terminalBudget, input.expectedBudgetLimits);
  const plan = deriveOutlineConsolidationPlan(input.parentContext, input.parentSourceFindings, input.selectedIds);
  if (!same(plan, input.plan)) fail('plan-changed');
  let context = input.parentContext;
  if (input.draft !== undefined) {
    const checked = validateOutlineConsolidationProposal(input.draft.proposal, input.parentContext, input.parentSourceFindings, plan);
    if (!same(checked, input.draft)) fail('draft-changed');
    context = checked.childContext;
    if (!same(context.sources, input.parentContext.sources)) fail('child-originals-changed');
  }
  const projection = originalProjection(context);
  const parentTargets = input.parentContext.candidateIds.length;
  const minimumTargets = input.draft === undefined ? parentTargets - plan.selectedIds.length + 1 : context.candidateIds.length;
  if (!whole(minimumTargets) || minimumTargets < 1) fail('target-count');
  const minimumSends = Math.ceil(minimumTargets / OUTLINE_CAPABILITY_PACKING_LIMITS.candidates);
  const minimumOutputUnits = minimumSends * OUTLINE_CAPABILITY_PACKING_LIMITS.output;
  const minimumAdditionalUnits = sum([projection.sourceRowJsonBytes, minimumOutputUnits]);
  const reasons = [
    ...(minimumAdditionalUnits > allowance.remainingUnits ? ['total-units'] : []),
    ...(minimumSends > allowance.remainingSends ? ['send-count'] : []),
    ...(input.terminalBudget.limits.maxOutputTokens < OUTLINE_CAPABILITY_PACKING_LIMITS.output ? ['output-cap'] : []),
    ...(projection.rows.some(row => bytes(JSON.stringify(row)) > Math.min(48000, input.terminalBudget.limits.maxInputTokens)) ? ['single-original-input'] : []),
  ];
  const protocolHash = createHash('sha256').update(VERSION).update(readFileSync(__filename))
    .update(structureOutlineReviewProtocolHash(OUTLINE_CAPABILITY_DISTINCTNESS)).update(outlineConsolidationProtocolHash()).digest('hex');
  const receipt = { version: VERSION, status: reasons.length ? 'cannot-fit' as const : 'not-ruled-out' as const, reasons,
    scope: 'complete-fresh-child-review-current-full-original-renderer-no-verdict-reuse' as const,
    authority: 'lower-bound-only-no-send-credit-adoption-or-authentication-authority' as const,
    targetCountScope: input.draft === undefined ? 'unknown-proposal-optimistic-selection-to-one' as const : 'fixed-validated-unreviewed-draft' as const,
    parentTargets, selectedIds: [...plan.selectedIds], minimumTargets,
    ...(input.draft === undefined ? {} : { fixedChildTargets: context.candidateIds.length, draftHash: input.draft.draftHash }),
    sourceRows: projection.rows.length, sourceRowJsonBytes: projection.sourceRowJsonBytes,
    candidatesPerSend: OUTLINE_CAPABILITY_PACKING_LIMITS.candidates, outputUnitsPerSend: OUTLINE_CAPABILITY_PACKING_LIMITS.output,
    minimumSends, minimumOutputUnits, minimumAdditionalUnits, ...allowance,
    inheritedBudget: structuredClone(input.terminalBudget), expectedBudgetLimits: structuredClone(input.expectedBudgetLimits),
    bindings: { protocolHash, reviewProtocolHash: structureOutlineReviewProtocolHash(OUTLINE_CAPABILITY_DISTINCTNESS),
      consolidationProtocolHash: plan.protocolHash, parentContextHash: input.parentContext.contextHash,
      currentContextHash: context.contextHash, planHash: plan.planHash, sourceIdentityHash: hash(context.sources),
      projectionHash: projection.projectionHash, terminalBudgetHash: hash(input.terminalBudget), expectedLimitsHash: hash(input.expectedBudgetLimits) },
    diagnostics: { fullContextPromptBytes: projection.fullDiagnosticPromptBytes, fullContextNativeUnits: projection.fullDiagnosticNativeUnits,
      fullContextPromptHash: projection.fullDiagnosticPromptHash, fullContextRenderIsNotAnAdmissibleSend: true as const },
  };
  return { ...receipt, receiptHash: hash(receipt) };
}
