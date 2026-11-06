import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { GroundingObjective, OutlineGroundingFinding } from '../types/structure';
import type { OutlineCapabilityContext, OutlineCapabilityOriginal } from '../types/structure-distinctness';
import type { OutlineConsolidationComparisonClosure, OutlineConsolidationDirectedComparison, OutlineConsolidationDraft,
  OutlineConsolidationParentObservation, OutlineConsolidationPlan, OutlineConsolidationProposal } from '../types/structure-consolidation';
import { outlineGroundingProtocolHash, validateOutlineGroundingRows } from './structure-outline-grounding';
import { assertOutlineCapabilityContext, OUTLINE_CAPABILITY_DISTINCTNESS, outlineCapabilityDistinctnessProtocolHash,
  planOutlineCapabilityDistinctness, selectOutlineCapabilityContext, validateOutlineCapabilityComparisons } from './structure-capability-distinctness';

export const OUTLINE_CONSOLIDATION_PROTOCOL = 'source-preserving-outline-consolidation-v1' as const;
const objectiveId = z.string().regex(/^L[1-9]\d{0,5}$/);
const nonempty = z.string().regex(/\S/);
const schema = z.object({ version: z.literal(OUTLINE_CONSOLIDATION_PROTOCOL), planHash: z.string().regex(/^[a-f0-9]{64}$/),
  replacements: z.array(z.object({ id: objectiveId, name: nonempty.max(12000),
    evidenceIds: z.array(nonempty.max(200)).min(1).max(200) }).strict()).min(1).max(4),
  lineage: z.array(z.object({ previousId: objectiveId, successorIds: z.array(objectiveId).min(1).max(4) }).strict()).min(2).max(4),
}).strict();
const unique = (values: string[]) => new Set(values).size === values.length;
function fail(reason: string): never { throw new Error(`structure-consolidation-${reason}`); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const same = (one: unknown, two: unknown) => canonical(one) === canonical(two);
const clone = <T>(value: T): T => structuredClone(value);

/** Source bytes bind this pure protocol and its existing peer planner/parser.
 * No default selector, checkpoint or historical contract is changed. */
export function outlineConsolidationProtocolHash(): string {
  return createHash('sha256').update(readFileSync(__filename)).update(outlineCapabilityDistinctnessProtocolHash())
    .update(outlineGroundingProtocolHash()).digest('hex');
}

function fullContext(context: OutlineCapabilityContext): void {
  assertOutlineCapabilityContext(context);
  const rebuilt = planOutlineCapabilityDistinctness([{ objectives: context.objectives, sources: context.sources, prompt: '' }], OUTLINE_CAPABILITY_DISTINCTNESS)!;
  // Reject scoped contexts and self-consistent but noncanonical nominations.
  assertOutlineCapabilityContext(context, rebuilt);
}

function sourceAuthority(context: OutlineCapabilityContext, findings: OutlineGroundingFinding[]) {
  if (!Array.isArray(findings) || findings.length !== context.objectives.length || !unique(findings.map(row => row?.id)) ||
    findings.some(row => !context.candidateIds.includes(row?.id))) fail('parent-source-incomplete');
  const canonicalFindings: OutlineGroundingFinding[] = [];
  const observations: OutlineConsolidationParentObservation[] = [];
  for (const objective of context.objectives) {
    const finding = findings.find(row => row.id === objective.id)!;
    const sourceOnly = { ...finding }; delete sourceOnly.capabilityComparisons;
    const checked = validateOutlineGroundingRows({ reviews: [{ id: finding.id, sourceStatus: finding.status,
      sourceIds: finding.citedSourceIds, coveredEvidenceIds: finding.ignoredModelCoverage?.evidenceIds ?? finding.coveredEvidenceIds,
      sourceReason: finding.reason, topicFit: finding.topicFit, topicReason: finding.topicReason }] }, {
      objectives: [objective], sources: context.sources.filter(source => objective.sourceIds.includes(source.alias)), prompt: '',
    });
    if (checked.failures.length || checked.findings.length !== 1 || !same(sourceOnly, checked.findings[0])) fail('parent-source-invalid');
    canonicalFindings.push(clone(checked.findings[0]!));
    const observation: OutlineConsolidationParentObservation = { id: objective.id, sourceFindingHash: hash(sourceOnly),
      capabilityObservationState: 'absent' };
    if (Object.hasOwn(finding, 'capabilityComparisons')) {
      if (!Array.isArray(finding.capabilityComparisons)) fail('parent-comparison-invalid');
      const comparisons = validateOutlineCapabilityComparisons({ reviews: [], capabilityComparisons: finding.capabilityComparisons },
        selectOutlineCapabilityContext(context, [objective.id]));
      if (comparisons.failures.length || comparisons.findings.length !== 1 ||
        !same(comparisons.findings[0]!.capabilityComparisons, finding.capabilityComparisons)) fail('parent-comparison-invalid');
      observation.capabilityObservationState = 'retained-parent-observation';
      observation.capabilityComparisons = clone(finding.capabilityComparisons);
    }
    observations.push(observation);
  }
  return { findings: canonicalFindings, observations };
}

/** Derive obligations, not semantic approval. Durable history/current-source
 * authentication belongs to the later course-fenced service. */
export function deriveOutlineConsolidationPlan(parentContext: OutlineCapabilityContext, parentSourceFindings: OutlineGroundingFinding[],
  selectedIds: string[]): OutlineConsolidationPlan {
  fullContext(parentContext);
  const authority = sourceAuthority(parentContext, parentSourceFindings);
  if (!Array.isArray(selectedIds) || selectedIds.length < 2 || selectedIds.length > 4 || !unique(selectedIds) ||
    selectedIds.some(id => !parentContext.candidateIds.includes(id))) fail('selection-identity');
  const selected = parentContext.objectives.filter(row => selectedIds.includes(row.id));
  if (selected.some(row => authority.findings.find(finding => finding.id === row.id)!.status !== 'supported')) fail('selection-not-supported');
  const points = new Map<string, GroundingObjective['learningPoints'][number]>();
  // Conflicting point definitions anywhere in the immutable proposal cannot
  // become different capabilities merely by selecting one occurrence.
  for (const objective of parentContext.objectives) for (const point of objective.learningPoints) {
    if (points.has(point.id) && !same(points.get(point.id), point)) fail('point-definition-conflict');
    points.set(point.id, point);
  }
  const assignedIds = new Set(selected.flatMap(row => row.evidenceIds));
  const assignedPoints = [...points.values()].filter(point => assignedIds.has(point.id));
  const aliases = new Set(selected.flatMap(row => row.sourceIds));
  const members = selected.map(objective => ({ objective: clone(objective),
    sourceObservation: clone(authority.findings.find(row => row.id === objective.id)!),
    observation: clone(authority.observations.find(row => row.id === objective.id)!) }));
  const oldCreditObligations = assignedPoints.filter(point => members.some(member => member.sourceObservation.coveredEvidenceIds.includes(point.id)))
    .map(point => ({ evidenceId: point.id, previousOwnerIds: members.filter(member => member.sourceObservation.coveredEvidenceIds.includes(point.id))
      .map(member => member.objective.id), point: clone(point) }));
  const observed = authority.observations.filter(row => row.capabilityObservationState !== 'absent').length;
  const content: Omit<OutlineConsolidationPlan, 'planHash'> = { version: OUTLINE_CONSOLIDATION_PROTOCOL,
    protocolHash: outlineConsolidationProtocolHash(), parentContextHash: parentContext.contextHash, parentProposalHash: parentContext.proposalHash,
    parentSourceFindingsHash: hash({ findings: authority.findings, observations: authority.observations }),
    selectedIds: selected.map(row => row.id), members, assignedPoints: clone(assignedPoints),
    originals: clone(parentContext.sources.filter(source => aliases.has(source.alias))), oldCreditObligations,
    parentCapabilityObservations: observed === 0 ? 'absent' : observed === authority.observations.length ? 'complete' : 'partial',
    authority: 'pure-obligations-only-raw-history-not-authenticated' };
  return { ...content, planHash: hash(content) };
}

function directed(context: OutlineCapabilityContext): OutlineConsolidationDirectedComparison[] {
  return context.nominations.flatMap(row => row.peerIds.map(peerId => {
    const pair = context.pairs.find(pair => [pair.firstId, pair.secondId].includes(row.objectiveId) && [pair.firstId, pair.secondId].includes(peerId))!;
    return { objectiveId: row.objectiveId, peerId, pairId: pair.id, bindingHash: pair.bindingHash };
  }));
}
const edgeKey = (row: OutlineConsolidationDirectedComparison) => `${row.objectiveId}:${row.peerId}`;
function closure(parent: OutlineCapabilityContext, child: OutlineCapabilityContext, survivors: string[],
  observations: OutlineConsolidationParentObservation[]): OutlineConsolidationComparisonClosure {
  const oldRows = directed(parent), newRows = directed(child);
  const old = new Map(oldRows.map(row => [edgeKey(row), row])), fresh = new Map(newRows.map(row => [edgeKey(row), row]));
  const added = newRows.filter(row => !old.has(edgeKey(row))), removed = oldRows.filter(row => !fresh.has(edgeKey(row)));
  const changed = newRows.filter(row => old.has(edgeKey(row)) && !same(old.get(edgeKey(row)), row))
    .map(row => ({ before: old.get(edgeKey(row))!, after: row }));
  const affected = new Set(survivors);
  const unreviewedParentComparisonCandidateIds = child.candidateIds.filter(id =>
    observations.find(row => row.id === id)!.capabilityObservationState === 'absent');
  unreviewedParentComparisonCandidateIds.forEach(id => affected.add(id));
  for (const row of child.nominations) {
    const prior = parent.nominations.find(old => old.objectiveId === row.objectiveId)!;
    if (!same(prior.peerIds, row.peerIds)) affected.add(row.objectiveId);
  }
  for (const row of [...added, ...changed.map(row => row.after)]) affected.add(row.objectiveId);
  // A fresh replacement cannot inherit even a structurally identical old
  // incident row. Incoming third-party owners need a fresh whole envelope too.
  for (const row of newRows) if (survivors.includes(row.peerId)) affected.add(row.objectiveId);
  const freshComparisonCandidateIds = child.candidateIds.filter(id => affected.has(id));
  return { allChildComparisons: newRows, added, removed, changed, requiredFreshComparisons: newRows.filter(row => affected.has(row.objectiveId)),
    freshComparisonCandidateIds, affectedUnchangedCandidateIds: freshComparisonCandidateIds.filter(id => !survivors.includes(id)),
    unreviewedParentComparisonCandidateIds };
}

function replacementObjective(original: GroundingObjective, row: OutlineConsolidationProposal['replacements'][number],
  predecessors: GroundingObjective[], plan: OutlineConsolidationPlan): GroundingObjective {
  const allowedPoints = new Set(predecessors.flatMap(predecessor => predecessor.evidenceIds));
  if (row.evidenceIds.some(id => !allowedPoints.has(id)) || !unique(row.evidenceIds)) fail('replacement-evidence-scope');
  const learningPoints = row.evidenceIds.map(id => plan.assignedPoints.find(point => point.id === id)!);
  const aliases = new Set(predecessors.flatMap(predecessor => predecessor.sourceIds));
  const originals: OutlineCapabilityOriginal[] = plan.originals.filter(source => aliases.has(source.alias));
  const materialIds = [...new Set(predecessors.flatMap(predecessor => predecessor.materialIds))];
  const evidenceIds = learningPoints.map(point => point.id), sourceIds = originals.map(source => source.alias);
  const contentHash = createHash('sha256').update(JSON.stringify({ topic: original.topic, name: row.name,
    evidenceIds, materialIds, learningPoints, originals })).digest('hex');
  return { ...clone(original), name: row.name, contentHash, evidenceIds, materialIds, sourceIds, learningPoints: clone(learningPoints) };
}

/** Validate a proposed transformation only. Assignment creates a required
 * fresh-review obligation; no old row becomes a child source or novelty vote. */
export function validateOutlineConsolidationProposal(raw: unknown, parentContext: OutlineCapabilityContext,
  parentSourceFindings: OutlineGroundingFinding[], plan: OutlineConsolidationPlan): OutlineConsolidationDraft {
  const expected = deriveOutlineConsolidationPlan(parentContext, parentSourceFindings, plan?.selectedIds);
  if (!same(plan, expected)) fail('plan-changed');
  const checked = schema.safeParse(raw);
  if (!checked.success) fail('proposal-schema');
  const input = checked.data;
  if (input.planHash !== plan.planHash || !unique(input.replacements.map(row => row.id)) ||
    input.replacements.length > plan.selectedIds.length || input.replacements.some(row => !plan.selectedIds.includes(row.id))) fail('replacement-identity');
  const survivorIds = plan.selectedIds.filter(id => input.replacements.some(row => row.id === id));
  if (input.lineage.length !== plan.selectedIds.length || !unique(input.lineage.map(row => row.previousId)) ||
    input.lineage.some(row => !plan.selectedIds.includes(row.previousId) || !unique(row.successorIds) ||
      row.successorIds.some(id => !survivorIds.includes(id)) || survivorIds.includes(row.previousId) && !row.successorIds.includes(row.previousId))) fail('lineage-identity');
  const lineage = plan.selectedIds.map(id => ({ previousId: id,
    successorIds: survivorIds.filter(survivor => input.lineage.find(row => row.previousId === id)!.successorIds.includes(survivor)) }));
  const replacements = survivorIds.map(id => {
    const row = input.replacements.find(row => row.id === id)!;
    const predecessors = plan.members.filter(member => lineage.find(link => link.previousId === member.objective.id)!.successorIds.includes(id))
      .map(member => member.objective);
    return replacementObjective(plan.members.find(member => member.objective.id === id)!.objective, row, predecessors, plan);
  });
  const retiredIds = plan.selectedIds.filter(id => !survivorIds.includes(id));
  if (!retiredIds.length && replacements.every(row => {
    const old = parentContext.objectives.find(old => old.id === row.id)!;
    return row.name === old.name && same([...row.evidenceIds].sort(), [...old.evidenceIds].sort());
  })) fail('proposal-no-op');
  const memberCreditObligations = plan.members.flatMap(member => member.sourceObservation.coveredEvidenceIds.map(evidenceId => {
    const assignedSuccessorIds = lineage.find(row => row.previousId === member.objective.id)!.successorIds.filter(id =>
      replacements.find(row => row.id === id)!.evidenceIds.includes(evidenceId));
    if (!assignedSuccessorIds.length) fail('old-credit-unassigned');
    return { previousId: member.objective.id, evidenceId, assignedSuccessorIds };
  }));
  const objectives = parentContext.objectives.flatMap(objective => retiredIds.includes(objective.id) ? []
    : [replacements.find(row => row.id === objective.id) ?? clone(objective)]);
  // Deliberately use the explicit-objective peer planner. The ordinary themes
  // planner renumbers L IDs and cannot represent this private retirement map.
  const childContext = planOutlineCapabilityDistinctness([{ objectives, sources: clone(parentContext.sources), prompt: '' }], OUTLINE_CAPABILITY_DISTINCTNESS)!;
  if (!same(childContext.sources, parentContext.sources)) fail('original-bindings-changed');
  const authority = sourceAuthority(parentContext, parentSourceFindings);
  const proposal: OutlineConsolidationProposal = { version: OUTLINE_CONSOLIDATION_PROTOCOL, planHash: plan.planHash,
    replacements: replacements.map(row => ({ id: row.id, name: row.name, evidenceIds: [...row.evidenceIds] })), lineage };
  const content: Omit<OutlineConsolidationDraft, 'draftHash'> = { version: OUTLINE_CONSOLIDATION_PROTOCOL,
    protocolHash: plan.protocolHash, planHash: plan.planHash, proposal, childContext, survivorIds, retiredIds,
    unchangedObjectiveIds: parentContext.candidateIds.filter(id => !plan.selectedIds.includes(id)), freshSourceTargetIds: [...survivorIds],
    sourceReviewScope: 'minimum-replacements-only-unchanged-source-reuse-not-authorized',
    comparisonClosure: closure(parentContext, childContext, survivorIds, authority.observations), memberCreditObligations,
    oldCreditObligations: plan.oldCreditObligations.map(obligation => ({ ...clone(obligation),
      assignedSuccessorIds: survivorIds.filter(id => memberCreditObligations.some(row => row.evidenceId === obligation.evidenceId && row.assignedSuccessorIds.includes(id))) })),
    inheritedParentObservations: clone(authority.observations), reviewAuthority: 'unreviewed-child-no-credit-or-adoption-authority' };
  return { ...content, draftHash: hash(content) };
}
