import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { GroundingObjective, OutlineGroundingFinding, OutlineGroundingReceipt, StructureEvidence, StructureResult } from '../types/structure';
import type { OutlineCapabilityContext, OutlineCapabilityDistinctnessProtocol } from '../types/structure-distinctness';
import type { AuthoringBudgetReceipt } from '../types/authoring-budget';
import { admitGroundedOutline, outlineGroundingProtocolHash, outlineGroundingReceipt, planOutlineGrounding,
  selectOutlineGroundingBatch, validateOutlineGroundingRows, type GroundingSection,
  type OutlineGroundingBatch, type OutlineGroundingRowFailure } from './structure-outline-grounding';
import { assertOutlineCapabilityContext, assessOutlineCapabilityAdmission, outlineCapabilityDistinctnessProtocolHash,
  planOutlineCapabilityDistinctness, renderOutlineCapabilityDistinctness, selectOutlineCapabilityContext,
  validateOutlineCapabilityComparisons } from './structure-capability-distinctness';
import { measureCapabilityPackingPrompt, planOutlineCapabilityPacking } from './structure-capability-packing';
import { withCapabilityPlanCache } from './structure-capability-plan-cache';

export interface CapabilityOutlineGroundingBatch extends OutlineGroundingBatch {
  capabilityContext: OutlineCapabilityContext;
}
const VERSION: OutlineCapabilityDistinctnessProtocol = 'outline-capability-distinctness-v1';
const JSON_CORRECTION_SUFFIX = '\n\nYour previous reply was not valid JSON. Respond with ONLY the JSON value — no prose, no explanation, no code fences.';
const equal = (first: unknown, second: unknown) => JSON.stringify(first) === JSON.stringify(second);
function fail(reason: string): never { throw new Error(`structure-capability-${reason}`); }

export function estimateCapabilityReviewSend(prompt: string): number {
  return Math.max(Buffer.byteLength(prompt, 'utf8'), Buffer.byteLength(JSON.stringify([{ role: 'user', content: prompt }]), 'utf8')) + 32;
}

export function assertStructureCapabilityProtocol(protocol: unknown): asserts protocol is OutlineCapabilityDistinctnessProtocol | undefined {
  if (protocol !== undefined && protocol !== VERSION) fail('protocol-unsupported');
}

/** Historical modules stay byte-identical, including their runtime hash. */
export function structureOutlineReviewProtocolHash(protocol?: OutlineCapabilityDistinctnessProtocol): string {
  assertStructureCapabilityProtocol(protocol);
  if (protocol === undefined) return outlineGroundingProtocolHash();
  const driver = path.join(__dirname, `structure-capability-review${path.extname(__filename)}`);
  const packing = path.join(__dirname, `structure-capability-packing${path.extname(__filename)}`);
  const cache = path.join(__dirname, `structure-capability-plan-cache${path.extname(__filename)}`);
  return createHash('sha256').update(VERSION).update(outlineGroundingProtocolHash())
    .update(outlineCapabilityDistinctnessProtocolHash()).update(readFileSync(__filename))
    .update(readFileSync(driver)).update(readFileSync(packing)).update(readFileSync(cache)).digest('hex');
}

function context(batch: OutlineGroundingBatch): OutlineCapabilityContext | undefined {
  if (!Object.hasOwn(batch, 'capabilityContext')) return undefined;
  const candidate = (batch as CapabilityOutlineGroundingBatch).capabilityContext;
  assertOutlineCapabilityContext(candidate);
  if (!equal(candidate.candidateIds, batch.objectives.map(row => row.id))) fail('batch-identity');
  for (const objective of batch.objectives) {
    if (!equal(candidate.objectives.find(row => row.id === objective.id), objective)) fail('batch-binding');
    for (const id of objective.sourceIds) {
      if (!candidate.sources.some(row => row.alias === id) || batch.sources.length &&
          !equal(candidate.sources.find(row => row.alias === id), batch.sources.find(row => row.alias === id))) fail('batch-source');
    }
  }
  return candidate;
}

function sourceReviewInstructions(batch: OutlineGroundingBatch): string {
  // Keep the historical source instructions, but emit full originals once in
  // the new peer packet. This branch never rewrites or clips original text.
  const boundary = batch.prompt.lastIndexOf('\n\n');
  const payload = JSON.parse(batch.prompt.slice(boundary + 2)) as { objectives: unknown[]; originalSections: unknown[] };
  if (!Array.isArray(payload.objectives) || !Array.isArray(payload.originalSections)) fail('legacy-render-shape');
  return batch.prompt.slice(0, boundary);
}
function wrapCapabilityPrompt(sourceInstructions: string, capabilityPrompt: string): string {
  return [sourceInstructions,
    'REPLACE the earlier envelope with {"reviews":[...],"capabilityComparisons":[...]}. Resolve candidate learningPointIds and full originals below. Peer originals never expand candidate sources.',
    capabilityPrompt].join('\n\n');
}
function render(batch: OutlineGroundingBatch, selected: OutlineCapabilityContext): string {
  return wrapCapabilityPrompt(sourceReviewInstructions(batch), renderOutlineCapabilityDistinctness(selected));
}

/** Nominate on the whole immutable proposal before repacking. A smaller review
 * batch never silently drops a cross-topic comparator or its exact originals. */
export function planCapabilityOutlineGrounding(themes: StructureResult['themes'], evidence: StructureEvidence[],
  sections: GroundingSection[], inputLimit: number, protocol?: OutlineCapabilityDistinctnessProtocol): OutlineGroundingBatch[] {
  assertStructureCapabilityProtocol(protocol);
  if (protocol === undefined) return planOutlineGrounding(themes, evidence, sections, inputLimit);
  return withCapabilityPlanCache({ protocolHash: structureOutlineReviewProtocolHash(protocol), themes, evidence, sections, inputLimit },
    () => planExplicitCapabilityOutline(themes, evidence, sections, inputLimit, protocol));
}

function planExplicitCapabilityOutline(themes: StructureResult['themes'], evidence: StructureEvidence[],
  sections: GroundingSection[], inputLimit: number, protocol: OutlineCapabilityDistinctnessProtocol): OutlineGroundingBatch[] {
  const ordinary = planOutlineGrounding(themes, evidence, sections, inputLimit);
  const full = planOutlineCapabilityDistinctness(ordinary, protocol)!;
  const sourceInstructions = sourceReviewInstructions(ordinary[0]!);
  if (ordinary.some(batch => sourceReviewInstructions(batch) !== sourceInstructions)) fail('source-instructions-changed');
  const renderer = { wrapPrompt: (prompt: string) => wrapCapabilityPrompt(sourceInstructions, prompt),
    estimateNative: estimateCapabilityReviewSend, jsonCorrectionSuffix: JSON_CORRECTION_SUFFIX };
  let packing: ReturnType<typeof planOutlineCapabilityPacking>;
  try { packing = planOutlineCapabilityPacking(full, inputLimit, ordinary.map(batch => batch.objectives.map(row => row.id)), renderer); }
  catch (error) {
    if (error instanceof Error && error.message === 'structure-capability-packing-singleton-input') fail('objective-peer-group-too-large');
    throw error;
  }
  const result = packing.groups.map((ids, i) => {
    // Real contexts and hashes are rebuilt only for the chosen complete plan.
    // Trial hashes never enter stored checkpoints, prompts or Apply authority.
    const selected = selectOutlineCapabilityContext(full, ids);
    const batch = { objectives: selected.objectives.filter(row => selected.candidateIds.includes(row.id)),
      sources: [], prompt: '', capabilityContext: selected } as CapabilityOutlineGroundingBatch;
    const actual = selectCapabilityOutlineGroundingBatch(batch, ids);
    const measured = measureCapabilityPackingPrompt(actual.prompt, inputLimit, renderer);
    if (!measured.fits || !equal(measured, packing.measurements[i])) fail('packing-size-changed');
    return batch;
  });
  return result;
}

/** Check the minimum known complete review before purchasing its first send.
 * JSON/schema correction, unknown provider work and hidden retries can still
 * exhaust the unchanged allowance; this is not a promise of completion. */
export function capabilityReviewAdmissionPlan(batches: OutlineGroundingBatch[], budget: Pick<AuthoringBudgetReceipt,
  'limits' | 'admissionTokens' | 'estimatedInputTokens' | 'reservedOutputTokens' | 'observedSends' | 'pendingSends'>,
  resolvedIds: string[] = []) {
  const sends = batches.flatMap(batch => {
    const ids = batch.objectives.filter(row => !resolvedIds.includes(row.id)).map(row => row.id);
    return ids.length ? [estimateCapabilityReviewSend(selectCapabilityOutlineGroundingBatch(batch, ids).prompt)] : [];
  });
  const inputUnits = sends.reduce((sum, value) => sum + value, 0), outputUnits = sends.length * 6000;
  const remainingUnits = budget.limits.maxEstimatedTokens - (budget.admissionTokens ?? budget.estimatedInputTokens + budget.reservedOutputTokens);
  const remainingSends = budget.limits.maxSends - budget.observedSends;
  return { version: VERSION, batches: sends.length, inputUnits, outputUnits, minimumAdditionalUnits: inputUnits + outputUnits,
    maximumInputUnits: Math.max(0, ...sends), remainingUnits, remainingSends,
    fits: budget.pendingSends === 0 && sends.every(value => value <= Math.min(48000, budget.limits.maxInputTokens)) &&
      budget.limits.maxOutputTokens >= 6000 && sends.length <= remainingSends && inputUnits + outputUnits <= remainingUnits };
}

export function selectCapabilityOutlineGroundingBatch(batch: OutlineGroundingBatch, ids: string[]): OutlineGroundingBatch {
  const selected = context(batch);
  if (!selected) return selectOutlineGroundingBatch(batch, ids);
  const aliases = new Set(batch.objectives.flatMap(row => row.sourceIds));
  const ordinary = selectOutlineGroundingBatch({ ...batch, sources: selected.sources.filter(row => aliases.has(row.alias)) }, ids);
  const scoped = selectOutlineCapabilityContext(selected, ids);
  return { ...ordinary, prompt: render(ordinary, scoped), capabilityContext: scoped } as CapabilityOutlineGroundingBatch;
}

export function validateCapabilityOutlineGroundingRows(raw: unknown, batch: OutlineGroundingBatch, priorFindings: OutlineGroundingFinding[] = []): {
  findings: OutlineGroundingFinding[]; failures: OutlineGroundingRowFailure[];
} {
  const selected = context(batch);
  if (!selected) return validateOutlineGroundingRows(raw, batch);
  const compared = validateOutlineCapabilityComparisons(raw, selected);
  const source = validateOutlineGroundingRows({ reviews: raw && typeof raw === 'object' && 'reviews' in raw ? raw.reviews : undefined }, batch);
  const failures = [...source.failures];
  for (const failure of compared.failures) if (!failures.some(row => row.id === failure.id)) {
    const objective = batch.objectives.find(row => row.id === failure.id);
    failures.push({ id: failure.id, reason: failure.reason.slice(0, 600),
      allowedSourceIds: [...(objective?.sourceIds ?? [])], allowedEvidenceIds: [...(objective?.evidenceIds ?? [])] });
  }
  const findings = source.findings.filter(row => !failures.some(failure => failure.id === row.id)).map(row => ({ ...row,
    capabilityComparisons: compared.findings.find(finding => finding.id === row.id)!.capabilityComparisons }));
  const relations = new Map<string, Set<string>>();
  const sourceById = new Map([...priorFindings, ...findings].map(row => [row.id, row]));
  for (const finding of [...priorFindings, ...findings]) for (const row of finding.capabilityComparisons ?? []) {
    if (sourceById.get(row.objectiveId)?.status !== 'supported' || sourceById.get(row.peerId)?.status !== 'supported') continue;
    const values = relations.get(row.pairId) ?? new Set<string>(); values.add(row.relation); relations.set(row.pairId, values);
  }
  for (const finding of findings) {
    const conflict = finding.capabilityComparisons.find(row => (relations.get(row.pairId)?.size ?? 0) > 1);
    if (conflict) failures.push({ id: finding.id, reason: `structure-capability-peer-relation-conflict: ${conflict.pairId}`,
      allowedSourceIds: [...finding.sourceIds], allowedEvidenceIds: [...finding.evidenceIds] });
  }
  return { findings: findings.filter(row => !failures.some(failure => failure.id === row.id)), failures };
}

function fullContext(batches: OutlineGroundingBatch[]): OutlineCapabilityContext | undefined {
  const selected = batches.map(context);
  if (!selected.some(Boolean)) return undefined;
  if (selected.some(row => !row)) fail('mixed-review-contract');
  const full = planOutlineCapabilityDistinctness(batches.map((batch, index) => ({ ...batch, sources: selected[index]!.sources })), VERSION)!;
  for (const [index, batch] of batches.entries()) {
    assertOutlineCapabilityContext(selected[index]!, selectOutlineCapabilityContext(full, batch.objectives.map(row => row.id)));
  }
  return full;
}

export function outlineCapabilityGroundingReceipt(findings: OutlineGroundingFinding[], total: number,
  batches: OutlineGroundingBatch[]): OutlineGroundingReceipt {
  const receipt = outlineGroundingReceipt(findings, total);
  const selected = fullContext(batches);
  return selected ? { ...receipt, capabilityDistinctness: assessOutlineCapabilityAdmission(selected, findings) } : receipt;
}

/** A source-supported broad/uncertain duplicate remains diagnostic. Its unique
 * credits are gaps until a separate narrowed survivor passes fresh review. */
export function finalizeCapabilityStructureProposal(themes: StructureResult['themes'], findings: OutlineGroundingFinding[],
  expected: GroundingObjective[], batches: OutlineGroundingBatch[]): ReturnType<typeof admitGroundedOutline> {
  const admitted = admitGroundedOutline(themes, findings, expected);
  const selected = fullContext(batches);
  if (!selected) return admitted;
  const capabilityDistinctness = assessOutlineCapabilityAdmission(selected, findings);
  if (!capabilityDistinctness.complete) fail('comparisons-incomplete');
  const eligible = new Set(capabilityDistinctness.eligibleIds);
  const result = themes.map((theme, themeIndex) => ({ ...theme, los: theme.los.flatMap((lo, loIndex) => {
    const finding = findings.find(row => row.themeIndex === themeIndex && row.loIndex === loIndex)!;
    return finding.status === 'supported' && eligible.has(finding.id)
      ? [{ ...lo, evidenceIds: [...finding.coveredEvidenceIds], materialIds: [...new Set(finding.coveredEvidenceIds.map(id =>
        finding.learningPoints.find(point => point.id === id)!.materialId))] }] : [];
  }) })).filter(theme => theme.los.length);
  if (!result.length) fail('no-distinct-supported-objectives');
  return { themes: result, receipt: { ...admitted.receipt, capabilityDistinctness } };
}
