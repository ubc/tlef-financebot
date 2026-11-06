import { BSON } from 'mongodb';
import type { GroundingObjective } from '../../server/src/types/structure';
import type { OutlineCapabilityComparison, OutlineCapabilityContext } from '../../server/src/types/structure-distinctness';
import type { OutlineConsolidationProposal } from '../../server/src/types/structure-consolidation';
import * as legacy from '../../server/src/services/structure-outline-grounding';
import * as distinctness from '../../server/src/services/structure-capability-distinctness';
import { deriveOutlineConsolidationPlan, OUTLINE_CONSOLIDATION_PROTOCOL, outlineConsolidationProtocolHash,
  validateOutlineConsolidationProposal } from '../../server/src/services/structure-outline-consolidation';

// All labels and judgments below are scripted protocol controls. Source/credit
// assignment is not a semantic claim, a model result or adoption authority.
const sourceText = 'Classify financing choices. Explain how dividends reduce equity. Calculate expected price appreciation as cost of equity minus dividend yield.';
const points = [
  { id: 'E1', objective: 'Classify financing choices.', materialId: 'M1', sourceIds: ['S1'] },
  { id: 'E2', objective: 'Explain how dividends reduce equity.', materialId: 'M1', sourceIds: ['S1'] },
  { id: 'E3', objective: 'Calculate expected price appreciation as cost of equity minus dividend yield.', materialId: 'M1', sourceIds: ['S1'] },
  { id: 'E4', objective: 'Compare a separate valuation activity.', materialId: 'M2', sourceIds: ['S2'] },
];
function fixture() {
  const objective = (id: string, index: number, name: string, ids: string[]): GroundingObjective => ({ id,
    themeIndex: 4, loIndex: index, topic: 'Financing and valuation', name, contentHash: String(index + 1).repeat(64),
    evidenceIds: ids, materialIds: [...new Set(ids.map(id => points.find(point => point.id === id)!.materialId))],
    sourceIds: [...new Set(ids.flatMap(id => points.find(point => point.id === id)!.sourceIds))],
    learningPoints: structuredClone(ids.map(id => points.find(point => point.id === id)!)) });
  const objectives = [
    objective('L10', 0, 'Classify financing choices.', ['E1']),
    objective('L20', 2, 'Explain dividend effects and calculate expected price appreciation.', ['E2', 'E3']),
    objective('L30', 4, 'Classify financing and explain dividend effects.', ['E1', 'E2', 'E3']),
    objective('L40', 6, 'Calculate expected price appreciation for a different stated decision.', ['E3']),
    objective('L50', 8, 'Compare a separate valuation activity.', ['E4']),
  ];
  const sources = [{ alias: 'S1', id: 'S444', localId: 'C12.S1', materialId: 'M1', materialName: 'Financing.pdf', chunkIndex: 11, text: sourceText },
    { alias: 'S2', id: 'S633', localId: 'C30.S1', materialId: 'M2', materialName: 'Valuation.pdf', chunkIndex: 29, text: 'Compare a separate valuation activity.' }];
  const context = distinctness.planOutlineCapabilityDistinctness([{ objectives, sources, prompt: '' }], distinctness.OUTLINE_CAPABILITY_DISTINCTNESS)!;
  const findings = objectives.map(row => legacy.validateOutlineGroundingRows({ reviews: [{ id: row.id, sourceStatus: 'supported',
    sourceIds: row.sourceIds, coveredEvidenceIds: row.id === 'L30' ? ['E1', 'E2'] : row.evidenceIds,
    sourceReason: 'SCRIPTED: supplied originals support the stated operations.', topicFit: 'fits', topicReason: 'SCRIPTED grouping.' }] },
  { objectives: [row], sources: sources.filter(source => row.sourceIds.includes(source.alias)), prompt: '' }).findings[0]!);
  return { context, findings };
}
function threeToTwo() {
  const data = fixture();
  const plan = deriveOutlineConsolidationPlan(data.context, data.findings, ['L30', 'L10', 'L20']);
  const proposal: OutlineConsolidationProposal = { version: OUTLINE_CONSOLIDATION_PROTOCOL, planHash: plan.planHash,
    replacements: [{ id: 'L10', name: 'Classify financing choices.', evidenceIds: ['E1'] },
      { id: 'L30', name: 'Explain dividend effects and calculate expected price appreciation.', evidenceIds: ['E2', 'E3'] }],
    lineage: [{ previousId: 'L10', successorIds: ['L10'] }, { previousId: 'L20', successorIds: ['L30'] },
      { previousId: 'L30', successorIds: ['L10', 'L30'] }] };
  return { ...data, plan, proposal };
}
function comparisons(context: OutlineCapabilityContext, id: string): OutlineCapabilityComparison[] {
  const own = context.objectives.find(row => row.id === id)!;
  return context.nominations.find(row => row.objectiveId === id)!.peerIds.map(peerId => {
    const peer = context.objectives.find(row => row.id === peerId)!;
    const quote = (sourceId: string) => ({ sourceId, quote: context.sources.find(row => row.alias === sourceId)!.text });
    return { objectiveId: id, peerId,
      pairId: context.pairs.find(row => [row.firstId, row.secondId].includes(id) && [row.firstId, row.secondId].includes(peerId))!.id,
      relation: 'distinct', candidateOperation: `SCRIPTED ${id} operation`, peerOperation: `SCRIPTED ${peerId} operation`,
      sharedCapabilities: [], candidateUniqueCapabilities: [{ operation: `SCRIPTED ${id} operation`, quotes: [quote(own.sourceIds[0]!)] }],
      peerUniqueCapabilities: [{ operation: `SCRIPTED ${peerId} operation`, quotes: [quote(peer.sourceIds[0]!)] }], reason: 'SCRIPTED distinctness control.' };
  });
}
function checked(data = threeToTwo()) {
  return validateOutlineConsolidationProposal(data.proposal, data.context, data.findings, data.plan);
}

describe('source-preserving outline consolidation pure core', () => {
  it('supports an explicit 3→2 split with stable IDs, coordinates, order and complete original bindings', () => {
    const data = threeToTwo(), draft = checked(data);
    expect(draft.survivorIds).toEqual(['L10', 'L30']);
    expect(draft.retiredIds).toEqual(['L20']);
    expect(draft.childContext.candidateIds).toEqual(['L10', 'L30', 'L40', 'L50']);
    expect(draft.childContext.objectives.map(row => [row.id, row.themeIndex, row.loIndex])).toEqual([
      ['L10', 4, 0], ['L30', 4, 4], ['L40', 4, 6], ['L50', 4, 8],
    ]);
    expect(draft.childContext.objectives.find(row => row.id === 'L40')).toEqual(data.context.objectives.find(row => row.id === 'L40'));
    expect(draft.childContext.sources).toEqual(data.context.sources);
    expect(draft.childContext.sources[0]).toMatchObject({ alias: 'S1', id: 'S444', chunkIndex: 11, text: sourceText });
    expect(draft.reviewAuthority).toBe('unreviewed-child-no-credit-or-adoption-authority');
    expect(draft.freshSourceTargetIds).toEqual(['L10', 'L30']);
    expect(draft.sourceReviewScope).toBe('minimum-replacements-only-unchanged-source-reuse-not-authorized');
  });

  it('retains explanation and calculation as separate obligations although they share one exact original', () => {
    const { plan } = threeToTwo();
    expect(plan.oldCreditObligations.map(row => row.evidenceId)).toEqual(['E1', 'E2', 'E3']);
    const calculation = plan.oldCreditObligations.find(row => row.evidenceId === 'E3')!;
    expect(calculation.previousOwnerIds).toEqual(['L20']);
    expect(calculation.point.objective).toContain('Calculate expected price appreciation');
    expect(calculation.point.sourceIds).toEqual(plan.oldCreditObligations.find(row => row.evidenceId === 'E2')!.point.sourceIds);
    const data = threeToTwo(); data.proposal.replacements[1]!.evidenceIds = ['E2'];
    expect(() => checked(data)).toThrow('structure-consolidation-old-credit-unassigned');
  });

  it('requires each old owner credit within its explicit successor set, not only a global union', () => {
    const data = threeToTwo();
    data.proposal.lineage.find(row => row.previousId === 'L20')!.successorIds = ['L10'];
    data.proposal.replacements[0]!.evidenceIds = ['E1', 'E2'];
    // E3 still exists globally on L30, but L20 does not map to L30 anymore.
    expect(() => checked(data)).toThrow('structure-consolidation-old-credit-unassigned');
  });

  it('permits 2→2 narrowing and distributes old credits across explicit self-plus-other successors', () => {
    const data = fixture(), plan = deriveOutlineConsolidationPlan(data.context, data.findings, ['L20', 'L30']);
    const draft = validateOutlineConsolidationProposal({ version: OUTLINE_CONSOLIDATION_PROTOCOL, planHash: plan.planHash,
      replacements: [{ id: 'L20', name: 'Calculate expected price appreciation.', evidenceIds: ['E3'] },
        { id: 'L30', name: 'Classify financing choices and explain dividend effects.', evidenceIds: ['E1', 'E2'] }],
      lineage: [{ previousId: 'L20', successorIds: ['L20', 'L30'] }, { previousId: 'L30', successorIds: ['L30'] }] }, data.context, data.findings, plan);
    expect(draft.retiredIds).toEqual([]);
    expect(draft.memberCreditObligations.filter(row => row.previousId === 'L20')).toEqual([
      { previousId: 'L20', evidenceId: 'E2', assignedSuccessorIds: ['L30'] },
      { previousId: 'L20', evidenceId: 'E3', assignedSuccessorIds: ['L20'] },
    ]);
  });

  it('rejects a true no-op and evidence-order-only changes without retiring anyone', () => {
    const data = fixture(), plan = deriveOutlineConsolidationPlan(data.context, data.findings, ['L10', 'L20']);
    const raw = { version: OUTLINE_CONSOLIDATION_PROTOCOL, planHash: plan.planHash,
      replacements: plan.members.map(row => ({ id: row.objective.id, name: row.objective.name, evidenceIds: [...row.objective.evidenceIds].reverse() })),
      lineage: plan.selectedIds.map(id => ({ previousId: id, successorIds: [id] })) };
    expect(() => validateOutlineConsolidationProposal(raw, data.context, data.findings, plan)).toThrow('structure-consolidation-proposal-no-op');
  });

  it('does not grant source credit merely because a replacement assigns a point or asserts its wording', () => {
    const data = threeToTwo(); data.proposal.replacements[1]!.name = 'An unreviewed new assertion.';
    const draft = checked(data);
    expect(draft.reviewAuthority).toContain('unreviewed-child');
    expect(Object.hasOwn(draft, 'findings')).toBe(false);
    expect(Object.hasOwn(draft, 'eligibleIds')).toBe(false);
    expect(draft.oldCreditObligations.find(row => row.evidenceId === 'E3')!.assignedSuccessorIds).toEqual(['L30']);
  });

  it('requires every child comparison when the historical parent has no comparison observations', () => {
    const data = threeToTwo(), draft = checked(data), closure = draft.comparisonClosure;
    expect(data.plan.parentCapabilityObservations).toBe('absent');
    expect(closure.unreviewedParentComparisonCandidateIds).toEqual(draft.childContext.candidateIds);
    expect(closure.freshComparisonCandidateIds).toEqual(draft.childContext.candidateIds);
    expect(closure.requiredFreshComparisons).toEqual(closure.allChildComparisons);
    expect(closure.requiredFreshComparisons.every(row => ![row.objectiveId, row.peerId].includes('L20'))).toBe(true);
    expect(closure.removed.some(row => [row.objectiveId, row.peerId].includes('L20'))).toBe(true);
  });

  it('captures changed incident bindings and an unchanged third peer incoming to narrowed survivors', () => {
    const data = threeToTwo();
    data.findings = data.findings.map(row => ({ ...row, capabilityComparisons: comparisons(data.context, row.id) }));
    data.plan = deriveOutlineConsolidationPlan(data.context, data.findings, data.plan.selectedIds);
    data.proposal.planHash = data.plan.planHash;
    const draft = checked(data), closure = draft.comparisonClosure;
    expect(data.plan.parentCapabilityObservations).toBe('complete');
    expect(closure.unreviewedParentComparisonCandidateIds).toEqual([]);
    expect(closure.affectedUnchangedCandidateIds).toContain('L40');
    expect(closure.requiredFreshComparisons.some(row => row.objectiveId === 'L40' && row.peerId === 'L30')).toBe(true);
    expect(closure.changed.some(row => row.after.objectiveId === 'L40' && row.after.peerId === 'L30')).toBe(true);
    expect(closure.requiredFreshComparisons.filter(row => row.objectiveId === 'L40')).toHaveLength(
      draft.childContext.nominations.find(row => row.objectiveId === 'L40')!.peerIds.length);
    expect(draft.inheritedParentObservations.find(row => row.id === 'L20')!.capabilityComparisons).toEqual(comparisons(data.context, 'L20'));
    expect(draft.freshSourceTargetIds).toEqual(['L10', 'L30']);
  });

  it('clones returned plans and drafts so mutations do not alter caller source authority or later results', () => {
    const data = threeToTwo(), original = structuredClone(data);
    const draft = checked(data); draft.childContext.sources[0]!.text = 'mutated';
    draft.inheritedParentObservations[0]!.sourceFindingHash = 'bad';
    expect(data).toEqual(original);
    expect(checked(data).childContext.sources[0]!.text).toBe(sourceText);
    data.plan.originals[0]!.text = 'mutated';
    expect(() => checked(data)).toThrow('structure-consolidation-plan-changed');
    expect(data.context.sources[0]!.text).toBe(sourceText);
  });

  it('is stable through real BSON round-trip without nullable private authority fields', () => {
    const data = threeToTwo(), expected = checked(data);
    const restored = BSON.deserialize(BSON.serialize(data)) as typeof data;
    const actual = checked(restored);
    expect(actual).toEqual(expected);
    expect(actual.draftHash).toBe(expected.draftHash);
    expect(BSON.deserialize(BSON.serialize(actual))).toEqual(actual);
    expect(actual.inheritedParentObservations.every(row => !Object.hasOwn(row, 'capabilityComparisons'))).toBe(true);
  });

  it.each([[], ['L10'], ['L10', 'L10'], ['L10', 'L999'], ['L10', 'L20', 'L30', 'L40', 'L50']].map(ids => ({ ids })))('rejects invalid explicit selections $ids', ({ ids }) => {
    const data = fixture();
    expect(() => deriveOutlineConsolidationPlan(data.context, data.findings, ids)).toThrow('structure-consolidation-selection-identity');
  });

  it.each(['unsupported', 'uncertain'] as const)('refuses selected %s source findings while preserving resolved negative siblings', status => {
    const data = fixture(), objective = data.context.objectives[1]!;
    data.findings[1] = legacy.validateOutlineGroundingRows({ reviews: [{ id: objective.id, sourceStatus: status,
      sourceIds: objective.sourceIds, coveredEvidenceIds: objective.evidenceIds, sourceReason: 'SCRIPTED negative source control.',
      topicFit: 'fits', topicReason: 'SCRIPTED grouping.' }] }, { objectives: [objective], sources: data.context.sources, prompt: '' }).findings[0]!;
    expect(() => deriveOutlineConsolidationPlan(data.context, data.findings, ['L10', 'L20'])).toThrow('structure-consolidation-selection-not-supported');
    const plan = deriveOutlineConsolidationPlan(data.context, data.findings, ['L10', 'L30']);
    expect(plan.selectedIds).toEqual(['L10', 'L30']);
    expect(plan.oldCreditObligations.some(row => row.previousOwnerIds.includes('L20'))).toBe(false);
  });

  it('requires complete canonical source findings and rejects fabricated negative credits', () => {
    const data = fixture();
    expect(() => deriveOutlineConsolidationPlan(data.context, data.findings.slice(1), ['L10', 'L20'])).toThrow('parent-source-incomplete');
    const modified = structuredClone(data.findings); modified[0]!.status = 'unsupported';
    expect(() => deriveOutlineConsolidationPlan(data.context, modified, ['L10', 'L20'])).toThrow('parent-source-invalid');
    modified[0] = { ...data.findings[0]!, citedSourceIds: ['S444'] };
    expect(() => deriveOutlineConsolidationPlan(data.context, modified, ['L10', 'L20'])).toThrow('parent-source-invalid');
  });

  it('rejects scoped rather than complete proposal contexts and conflicting shared point definitions', () => {
    const data = fixture(), scoped = distinctness.selectOutlineCapabilityContext(data.context, ['L10', 'L20']);
    expect(() => deriveOutlineConsolidationPlan(scoped, data.findings, ['L10', 'L20'])).toThrow();
    const objectives = structuredClone(data.context.objectives);
    objectives[2]!.learningPoints.find(row => row.id === 'E3')!.objective = 'Different definition of the same evidence ID.';
    const conflict = distinctness.planOutlineCapabilityDistinctness([{ objectives, sources: data.context.sources, prompt: '' }], distinctness.OUTLINE_CAPABILITY_DISTINCTNESS)!;
    const findings = data.findings.map(row => row.id === 'L30' ? { ...row, ...objectives[2] } : row);
    expect(() => deriveOutlineConsolidationPlan(conflict, findings, ['L10', 'L20'])).toThrow('point-definition-conflict');
  });

  it('binds full parent findings, exact source text and the derived selected obligation plan', () => {
    const data = threeToTwo();
    data.findings[4]!.reason = 'A changed but syntactically valid historical source reason.';
    expect(() => checked(data)).toThrow('plan-changed');
    const source = threeToTwo(); source.context.sources[0]!.text += ' Changed original.';
    expect(() => checked(source)).toThrow('structure-distinctness-context-changed');
    const selected = threeToTwo(); selected.plan.selectedIds.pop();
    expect(() => checked(selected)).toThrow('plan-changed');
  });

  it('refuses malformed retained comparison observations rather than treating them as missing approval', () => {
    const data = fixture(); data.findings[0]!.capabilityComparisons = [];
    expect(() => deriveOutlineConsolidationPlan(data.context, data.findings, ['L10', 'L20'])).toThrow('parent-comparison-invalid');
  });

  it('supports four selected members and an explicitly chosen single survivor without renumbering later IDs', () => {
    const data = fixture(), plan = deriveOutlineConsolidationPlan(data.context, data.findings, ['L10', 'L20', 'L30', 'L40']);
    const draft = validateOutlineConsolidationProposal({ version: OUTLINE_CONSOLIDATION_PROTOCOL, planHash: plan.planHash,
      replacements: [{ id: 'L30', name: 'An explicitly proposed combined activity requiring fresh review.', evidenceIds: ['E1', 'E2', 'E3'] }],
      lineage: plan.selectedIds.map(previousId => ({ previousId, successorIds: ['L30'] })) }, data.context, data.findings, plan);
    expect(draft.childContext.candidateIds).toEqual(['L30', 'L50']);
    expect(draft.survivorIds).toEqual(['L30']);
    expect(draft.retiredIds).toEqual(['L10', 'L20', 'L40']);
    expect(draft.childContext.objectives[1]).toEqual(data.context.objectives[4]);
    expect(draft.childContext.objectives[0]!.loIndex).toBe(4);
  });

  it('does not turn individually valid contradictory parent observations into global child admission', () => {
    const data = threeToTwo();
    data.findings = data.findings.map(row => ({ ...row, capabilityComparisons: comparisons(data.context, row.id) }));
    const first = data.findings[0]!.capabilityComparisons![0]!;
    first.relation = 'uncertain'; first.candidateUniqueCapabilities = []; first.peerUniqueCapabilities = [];
    data.plan = deriveOutlineConsolidationPlan(data.context, data.findings, data.plan.selectedIds);
    data.proposal.planHash = data.plan.planHash;
    expect(data.plan.parentCapabilityObservations).toBe('complete');
    expect(data.plan.authority).toBe('pure-obligations-only-raw-history-not-authenticated');
    expect(checked(data).reviewAuthority).toBe('unreviewed-child-no-credit-or-adoption-authority');
    expect(checked(data).inheritedParentObservations[0]!.capabilityComparisons![0]!.relation).toBe('uncertain');
  });

  it.each([
    (raw: OutlineConsolidationProposal) => ({ ...raw, approval: true }),
    (raw: OutlineConsolidationProposal) => ({ ...raw, replacements: [{ ...raw.replacements[0], coveredEvidenceIds: ['E3'] }] }),
    (raw: OutlineConsolidationProposal) => ({ ...raw, planHash: 'a'.repeat(64) }),
    (raw: OutlineConsolidationProposal) => ({ ...raw, replacements: [{ ...raw.replacements[0], id: 'L999' }] }),
    (raw: OutlineConsolidationProposal) => ({ ...raw, replacements: [raw.replacements[0], raw.replacements[0]] }),
    (raw: OutlineConsolidationProposal) => ({ ...raw, lineage: raw.lineage.slice(1) }),
    (raw: OutlineConsolidationProposal) => ({ ...raw, lineage: raw.lineage.map(row => ({ ...row, successorIds: ['L999'] })) }),
    (raw: OutlineConsolidationProposal) => ({ ...raw, replacements: [{ ...raw.replacements[0], evidenceIds: ['E4'] }, raw.replacements[1]] }),
    (raw: OutlineConsolidationProposal) => ({ ...raw, replacements: [{ ...raw.replacements[0], evidenceIds: ['E1', 'E1'] }, raw.replacements[1]] }),
  ])('rejects untrusted fields, identity/scope/lineage mutations (%#)', change => {
    const data = threeToTwo();
    expect(() => validateOutlineConsolidationProposal(change(data.proposal), data.context, data.findings, data.plan)).toThrow();
  });

  it('binds both existing source-review and peer protocol dependencies without editing either', () => {
    const original = outlineConsolidationProtocolHash();
    const source = jest.spyOn(legacy, 'outlineGroundingProtocolHash').mockReturnValue('f'.repeat(64));
    expect(outlineConsolidationProtocolHash()).not.toBe(original); source.mockRestore();
    const peer = jest.spyOn(distinctness, 'outlineCapabilityDistinctnessProtocolHash').mockReturnValue('e'.repeat(64));
    expect(outlineConsolidationProtocolHash()).not.toBe(original); peer.mockRestore();
    expect(outlineConsolidationProtocolHash()).toBe(original);
  });
});
