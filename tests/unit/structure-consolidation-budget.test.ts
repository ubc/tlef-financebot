import type { AuthoringBudgetReceipt } from '../../server/src/types/authoring-budget';
import type { GroundingObjective } from '../../server/src/types/structure';
import type { OutlineConsolidationProposal } from '../../server/src/types/structure-consolidation';
import * as distinctness from '../../server/src/services/structure-capability-distinctness';
import { validateOutlineGroundingRows } from '../../server/src/services/structure-outline-grounding';
import { deriveOutlineConsolidationPlan, OUTLINE_CONSOLIDATION_PROTOCOL, validateOutlineConsolidationProposal } from '../../server/src/services/structure-outline-consolidation';
import { assessStructureConsolidationBudgetFloor, type StructureConsolidationBudgetFloorInput } from '../../server/src/services/structure-consolidation-budget';

// Portable scripted protocol controls, not a source/semantic/model benchmark.
function budget(): AuthoringBudgetReceipt {
  return { version: 1, estimator: 'utf8-bytes-conservative-v1', retryVisibility: 'unknown', limitScope: 'process',
    observedSends: 3, estimatedInputTokens: 2000, reservedOutputTokens: 18000, accounting: 'conservative-reservations-v1',
    admissionTokens: 20000, pendingSends: 0, settledSends: 0, conservativeFinishedSends: 3,
    reportedInputTokens: null, reportedOutputTokens: null, usageCompleteness: 'unknown', queueWaitMs: 0, executionMs: 1, rejectedSends: 0,
    logical: { generatorAttempts: 0, repairCycles: 0, evidenceExpansions: 0, limits: { generatorAttempts: 2, repairCycles: 1, evidenceExpansions: 1 } },
    limits: { maxSends: 20, maxInputTokens: 48000, maxOutputTokens: 6000, maxEstimatedTokens: 40000 } };
}
function fixture(selected = 3, survivors = 2): StructureConsolidationBudgetFloorInput {
  const text = 'SCRIPTED original: quote "price", slash \\ and line\n二. Several source-bound operations.';
  const sources = [1, 2].map(i => ({ alias: `S${i}`, id: `S${90 + i}`, localId: `C${i}.S1`, materialId: `M${i}`,
    materialName: `Notes "${i}" \\ table.pdf`, chunkIndex: i * 3, text }));
  const objectives: GroundingObjective[] = Array.from({ length: 6 }, (_, i) => {
    const id = `L${i + 1}`, evidenceId = `E${i + 1}`, source = sources[i % 2]!;
    return { id, themeIndex: 0, loIndex: i, topic: 'Scripted operations', name: `Perform scripted operation ${i + 1}.`,
      contentHash: String(i + 1).repeat(64), evidenceIds: [evidenceId], materialIds: [source.materialId], sourceIds: [source.alias],
      learningPoints: [{ id: evidenceId, objective: `Perform scripted operation ${i + 1}.`, materialId: source.materialId, sourceIds: [source.alias] }] };
  });
  const context = distinctness.planOutlineCapabilityDistinctness([{ objectives, sources, prompt: '' }], distinctness.OUTLINE_CAPABILITY_DISTINCTNESS)!;
  const findings = objectives.map(objective => validateOutlineGroundingRows({ reviews: [{ id: objective.id, sourceStatus: 'supported',
    sourceIds: objective.sourceIds, coveredEvidenceIds: objective.evidenceIds, sourceReason: 'SCRIPTED source judgment.', topicFit: 'fits', topicReason: 'SCRIPTED.' }] },
  { objectives: [objective], sources: sources.filter(row => objective.sourceIds.includes(row.alias)), prompt: '' }).findings[0]!);
  const selectedIds = objectives.slice(0, selected).map(row => row.id);
  const plan = deriveOutlineConsolidationPlan(context, findings, selectedIds);
  const successor = (index: number) => selectedIds[index < survivors ? index : 0]!;
  const proposal: OutlineConsolidationProposal = { version: OUTLINE_CONSOLIDATION_PROTOCOL, planHash: plan.planHash,
    replacements: selectedIds.slice(0, survivors).map(id => ({ id, name: `Consolidated scripted operation on ${id}.`,
      evidenceIds: objectives.slice(0, selected).flatMap((row, i) => successor(i) === id ? row.evidenceIds : []) })),
    lineage: selectedIds.map((id, i) => ({ previousId: id, successorIds: [successor(i)] })) };
  const terminalBudget = budget();
  return { parentContext: context, parentSourceFindings: findings, selectedIds, plan, terminalBudget,
    expectedBudgetLimits: structuredClone(terminalBudget.limits), draft: validateOutlineConsolidationProposal(proposal, context, findings, plan) };
}
const withoutDraft = (value: StructureConsolidationBudgetFloorInput) => { const copy = structuredClone(value); delete copy.draft; return copy; };

describe('pure source-preserving consolidation budget impossibility bound', () => {
  afterEach(() => jest.restoreAllMocks());

  it('counts actual public renderer rows, preserves duplicate-text aliases and omits private metadata', () => {
    const data = fixture(), result = assessStructureConsolidationBudgetFloor(data);
    const prompt = distinctness.renderOutlineCapabilityDistinctness(data.draft!.childContext);
    const actual = JSON.parse(prompt.slice(prompt.lastIndexOf('\n\n') + 2)) as { originalSections: unknown[] };
    expect(result.sourceRowJsonBytes).toBe(actual.originalSections.reduce<number>((sum, row) => sum + Buffer.byteLength(JSON.stringify(row)), 0));
    expect(result.sourceRows).toBe(2);
    expect(data.parentContext.sources[0]!.text).toBe(data.parentContext.sources[1]!.text);
    expect(result.sourceRowJsonBytes).toBeGreaterThan(Buffer.byteLength(JSON.stringify(actual.originalSections[0])));
    expect(JSON.stringify(actual.originalSections)).not.toContain('localId');
    expect(result.sourceRowJsonBytes).toBeLessThan(data.parentContext.sources.reduce((sum, row) => sum + Buffer.byteLength(JSON.stringify(row)), 0));
    expect(result.diagnostics.fullContextNativeUnits).toBeGreaterThan(result.diagnostics.fullContextPromptBytes);
    expect(result.diagnostics.fullContextPromptBytes).toBeGreaterThan(result.sourceRowJsonBytes);
  });

  it.each([2, 3, 4])('uses the most optimistic %i-to-one count only before a proposal is fixed', count => {
    const data = fixture(count, 2), global = assessStructureConsolidationBudgetFloor(withoutDraft(data)), fixed = assessStructureConsolidationBudgetFloor(data);
    expect(global.minimumTargets).toBe(6 - count + 1);
    expect(global.targetCountScope).toBe('unknown-proposal-optimistic-selection-to-one');
    expect(fixed.minimumTargets).toBe(6 - count + 2);
    expect(fixed.fixedChildTargets).toBe(fixed.minimumTargets);
    expect(fixed.targetCountScope).toBe('fixed-validated-unreviewed-draft');
    expect(fixed.minimumSends).toBe(Math.ceil(fixed.minimumTargets / 4));
  });

  it('does not use a fixed 3-to-2 send floor for an unknown 3-to-one proposal', () => {
    const data = fixture(), global = assessStructureConsolidationBudgetFloor(withoutDraft(data)), fixed = assessStructureConsolidationBudgetFloor(data);
    expect([global.minimumSends, fixed.minimumSends]).toEqual([1, 2]);
    expect(fixed.minimumAdditionalUnits - global.minimumAdditionalUnits).toBe(6000);
  });

  it('retains exact allowance and never turns not-ruled-out into fit or spending/adoption authority', () => {
    const data = fixture(), before = structuredClone(data), result = assessStructureConsolidationBudgetFloor(data);
    expect(result.status).toBe('not-ruled-out');
    expect(result.remainingUnits).toBe(20000);
    expect(result.remainingSends).toBe(17);
    expect(result.inheritedBudget).toEqual(data.terminalBudget);
    expect(result.authority).toContain('no-send-credit-adoption-or-authentication-authority');
    for (const key of ['fits', 'executionAllowed', 'eligibleIds', 'adopted', 'freshAllowance']) expect(Object.hasOwn(result, key)).toBe(false);
    result.inheritedBudget.limits.maxEstimatedTokens = 1;
    result.selectedIds.push('L999');
    expect(data).toEqual(before);
    expect(assessStructureConsolidationBudgetFloor(data).receiptHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('refuses a total shortfall without clipping or resetting a spent allowance', () => {
    const data = fixture(); data.terminalBudget.limits.maxEstimatedTokens = 20000;
    data.expectedBudgetLimits = structuredClone(data.terminalBudget.limits);
    const result = assessStructureConsolidationBudgetFloor(data);
    expect(result.status).toBe('cannot-fit'); expect(result.reasons).toEqual(['total-units']);
    expect(result.remainingUnits).toBe(0); expect(result.inheritedBudget.admissionTokens).toBe(20000);
  });

  it.each(['send-count', 'output-cap', 'single-original-input'])('can establish %s impossibility independently of the total ceiling', reason => {
    const data = fixture();
    if (reason === 'send-count') data.terminalBudget.limits.maxSends = 3;
    if (reason === 'output-cap') data.terminalBudget.limits.maxOutputTokens = 5999;
    if (reason === 'single-original-input') data.terminalBudget.limits.maxInputTokens = 20;
    data.expectedBudgetLimits = structuredClone(data.terminalBudget.limits);
    expect(assessStructureConsolidationBudgetFloor(data).reasons).toContain(reason);
  });

  it.each(['maxSends', 'maxInputTokens', 'maxOutputTokens', 'maxEstimatedTokens'] as const)('rejects changed inherited %s', key => {
    const data = fixture(); data.terminalBudget.limits[key]++;
    expect(() => assessStructureConsolidationBudgetFloor(data)).toThrow('inherited-limits');
  });

  it.each([
    ['pending', (data: StructureConsolidationBudgetFloorInput) => { data.terminalBudget.pendingSends = 1; }],
    ['unknown pending', (data: StructureConsolidationBudgetFloorInput) => { delete data.terminalBudget.pendingSends; }],
    ['settlement', (data: StructureConsolidationBudgetFloorInput) => { data.terminalBudget.accounting = 'reported-usage-settlement-v1'; }],
    ['wrong admission', (data: StructureConsolidationBudgetFloorInput) => { data.terminalBudget.admissionTokens = 1; }],
    ['counter', (data: StructureConsolidationBudgetFloorInput) => { data.terminalBudget.conservativeFinishedSends = 2; }],
    ['fraction', (data: StructureConsolidationBudgetFloorInput) => { data.terminalBudget.queueWaitMs = 0.5; }],
    ['nan', (data: StructureConsolidationBudgetFloorInput) => { data.terminalBudget.executionMs = NaN; }],
    ['negative', (data: StructureConsolidationBudgetFloorInput) => { data.terminalBudget.rejectedSends = -1; }],
    ['overflow', (data: StructureConsolidationBudgetFloorInput) => { data.terminalBudget.admissionTokens = Number.MAX_SAFE_INTEGER + 1; }],
    ['overdrawn', (data: StructureConsolidationBudgetFloorInput) => { data.terminalBudget.limits.maxEstimatedTokens = 100; data.expectedBudgetLimits = { ...data.terminalBudget.limits }; }],
    ['logical', (data: StructureConsolidationBudgetFloorInput) => { data.terminalBudget.logical.repairCycles = 2; }],
    ['reported', (data: StructureConsolidationBudgetFloorInput) => { data.terminalBudget.reportedInputTokens = -1; }],
  ] as const)('rejects corrupt/unknown terminal state: %s', (_label, mutate) => {
    const data = fixture(); mutate(data); expect(() => assessStructureConsolidationBudgetFloor(data)).toThrow('structure-consolidation-budget-');
  });

  it.each([[], ['L1'], ['L1', 'L1'], ['L1', 'L999'], ['L1', 'L2', 'L3', 'L4', 'L5']].map(ids => ({ ids })))('requires an explicit supported 2-to-4 selection: $ids', ({ ids }) => {
    const data = fixture(); data.selectedIds = ids; expect(() => assessStructureConsolidationBudgetFloor(data)).toThrow();
  });

  it('rejects a coherent source-negative selected row rather than treating a cheap bound as eligibility', () => {
    const data = fixture(), objective = data.parentContext.objectives[0]!;
    data.parentSourceFindings[0] = validateOutlineGroundingRows({ reviews: [{ id: objective.id, sourceStatus: 'unsupported', sourceIds: [],
      coveredEvidenceIds: [], sourceReason: 'SCRIPTED negative.', topicFit: 'fits', topicReason: 'SCRIPTED.' }] },
    { objectives: [objective], sources: data.parentContext.sources, prompt: '' }).findings[0]!;
    expect(() => assessStructureConsolidationBudgetFloor(data)).toThrow('selection-not-supported');
  });

  it.each(['plan', 'credits', 'retirement', 'source-coordinate', 'corpus-identity'])('refuses altered %s obligations/identity', field => {
    const data = fixture();
    if (field === 'plan') data.plan.oldCreditObligations.pop();
    if (field === 'credits') data.draft!.memberCreditObligations.pop();
    if (field === 'retirement') data.draft!.retiredIds = [];
    if (field === 'source-coordinate') data.draft!.childContext.sources[0]!.chunkIndex++;
    if (field === 'corpus-identity') data.draft!.childContext.sources[0]!.id = 'other';
    expect(() => assessStructureConsolidationBudgetFloor(data)).toThrow();
  });

  it.each(['key', 'alias', 'material', 'coordinate', 'text', 'coalesced', 'pretty'])('refuses renderer %s drift before using a stale serialized-row proof', field => {
    const original = distinctness.renderOutlineCapabilityDistinctness;
    jest.spyOn(distinctness, 'renderOutlineCapabilityDistinctness').mockImplementation(context => {
      const prompt = original(context), boundary = prompt.lastIndexOf('\n\n');
      const packet = JSON.parse(prompt.slice(boundary + 2)) as { originalSections: Array<Record<string, unknown>> };
      const row = packet.originalSections[0]!;
      if (field === 'key') { row.alias = row.id; delete row.id; }
      if (field === 'alias') row.id = 'S999';
      if (field === 'material') row.material = 'different';
      if (field === 'coordinate') row.chunkIndex = 99;
      if (field === 'text') row.text = 'clipped';
      if (field === 'coalesced') packet.originalSections.pop();
      return prompt.slice(0, boundary + 2) + JSON.stringify(packet, null, field === 'pretty' ? 2 : undefined);
    });
    expect(() => assessStructureConsolidationBudgetFloor(fixture())).toThrow('renderer-original-projection');
  });
});
