import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BSON } from 'mongodb';
import * as legacyGrounding from '../../server/src/services/structure-outline-grounding';
import type { StructureEvidence, StructureResult } from '../../server/src/types/structure';
import type { OutlineCapabilityComparison } from '../../server/src/types/structure-distinctness';
import { estimateAuthoringTokens } from '../../server/src/components/genai/llm/authoring-budget';
import { outlineGroundingProtocolHash, planOutlineGrounding, type OutlineGroundingBatch } from '../../server/src/services/structure-outline-grounding';
import { finalizeCapabilityStructureProposal, outlineCapabilityGroundingReceipt, planCapabilityOutlineGrounding,
  capabilityReviewAdmissionPlan, estimateCapabilityReviewSend,
  selectCapabilityOutlineGroundingBatch, structureOutlineReviewProtocolHash, validateCapabilityOutlineGroundingRows,
  type CapabilityOutlineGroundingBatch } from '../../server/src/services/structure-capability-grounding';
import { reviewCapabilityStructureProposal, type ReviewProgress } from '../../server/src/services/structure-capability-review';

const protocol = 'outline-capability-distinctness-v1' as const;
function fixture(count = 3, sourcePadding = '') {
  const sections = [
    { id: 's1', materialId: 'm1', materialName: 'Chapter 1.pdf', chunkIndex: 0,
      text: 'Debt issuance raises debt and cash. Net debt subtracts cash from debt. Expected appreciation divides the price change by the initial share price.' + sourcePadding },
    { id: 's2', materialId: 'm2', materialName: 'Chapter 2.pdf', chunkIndex: 0,
      text: 'A dividend distribution transfers cash to shareholders, and the ex-dividend date establishes entitlement.' },
  ];
  const evidence: StructureEvidence[] = Array.from({ length: count }, (_, index) => {
    const source = sections[index === 2 ? 1 : 0];
    return { id: `E${index + 1}`, objective: ['Explain transaction effects', 'Calculate expected appreciation', 'Describe dividend entitlement'][index] ?? `Compare financing choice ${index}`,
      materialId: source.materialId, materialName: source.materialName, chunkIndex: source.chunkIndex, quote: source.text };
  });
  const names = ['Explain how debt issuance changes net debt and debt ratios.', 'Calculate expected share price appreciation after borrowing.',
    'Describe dividend entitlement at the ex-dividend date.'];
  const themes: StructureResult['themes'] = evidence.map((point, index) => ({ name: `Topic ${index + 1}`, los: [{
    name: names[index] ?? `Compare net debt borrowing alternative ${index}`, evidenceIds: [point.id], materialIds: [point.materialId] }] }));
  const batches = planCapabilityOutlineGrounding(themes, evidence, sections, 48000, protocol);
  return { sections, evidence, themes, batches };
}

function verdict(batch: OutlineGroundingBatch, relation: OutlineCapabilityComparison['relation'] = 'distinct') {
  const context = (batch as CapabilityOutlineGroundingBatch).capabilityContext;
  return { reviews: batch.objectives.map(row => ({ id: row.id, sourceStatus: 'supported', sourceIds: row.sourceIds,
    coveredEvidenceIds: row.evidenceIds, sourceReason: 'Scripted source support for mechanical controls.', topicFit: 'fits', topicReason: 'The topic organizes the stated operation.' })),
  capabilityComparisons: context.nominations.flatMap(nomination => nomination.peerIds.map(peerId => {
    const candidate = context.objectives.find(row => row.id === nomination.objectiveId)!;
    const peer = context.objectives.find(row => row.id === peerId)!;
    const quote = (id: string) => ({ sourceId: id, quote: context.sources.find(row => row.alias === id)!.text });
    return { objectiveId: candidate.id, peerId, pairId: context.pairs.find(row =>
      [row.firstId, row.secondId].includes(candidate.id) && [row.firstId, row.secondId].includes(peerId))!.id,
    relation, candidateOperation: candidate.name, peerOperation: peer.name,
    sharedCapabilities: relation === 'distinct' || relation === 'uncertain' ? [] : [{ operation: 'Explain the common debt adjustment.',
      candidateQuotes: [quote(candidate.sourceIds[0])], peerQuotes: [quote(peer.sourceIds[0])] }],
    candidateUniqueCapabilities: relation === 'distinct' || relation === 'partial-overlap' ? [{ operation: candidate.name, quotes: [quote(candidate.sourceIds[0])] }] : [],
    peerUniqueCapabilities: relation === 'distinct' ? [{ operation: peer.name, quotes: [quote(peer.sourceIds[0])] }] : [],
    reason: 'Scripted comparison, not a real semantic judgment.' };
  })) };
}

it('reuses an exact wrapper plan across actual BSON input recovery without sharing caller state, and rebuilds a changed original', () => {
  const { themes, evidence, sections } = fixture(10);
  const marker = randomUUID();
  for (const section of sections) section.text += ` Unique cold-plan marker ${marker}.`;
  for (const point of evidence) point.quote = sections.find(section => section.materialId === point.materialId)!.text;
  const build = jest.spyOn(legacyGrounding, 'planOutlineGrounding');
  try {
    const first = planCapabilityOutlineGrounding(themes, evidence, sections, 16000, protocol);
    expect(build).toHaveBeenCalledTimes(1);
    const expected = structuredClone(first);
    const recovered = BSON.deserialize(BSON.serialize({ themes, evidence, sections })) as {
      themes: typeof themes; evidence: typeof evidence; sections: typeof sections;
    };
    const second = planCapabilityOutlineGrounding(recovered.themes, recovered.evidence, recovered.sections, 16000, protocol);
    expect(build).toHaveBeenCalledTimes(1);
    expect(second).toEqual(expected); expect(second).not.toBe(first);
    (first[0] as CapabilityOutlineGroundingBatch).capabilityContext.sources[0].text += ' First caller mutation.';
    second[0].objectives[0].name += ' Second caller mutation.';
    const third = planCapabilityOutlineGrounding(recovered.themes, recovered.evidence, recovered.sections, 16000, protocol);
    expect(build).toHaveBeenCalledTimes(1); expect(third).toEqual(expected);
    recovered.sections[0].text += ' An independently changed exact original.';
    const changed = planCapabilityOutlineGrounding(recovered.themes, recovered.evidence, recovered.sections, 16000, protocol);
    expect(build).toHaveBeenCalledTimes(2);
    expect((changed[0] as CapabilityOutlineGroundingBatch).capabilityContext.proposalHash)
      .not.toBe((expected[0] as CapabilityOutlineGroundingBatch).capabilityContext.proposalHash);
  } finally { build.mockRestore(); }
});

it('keeps absent-selector planner, prompt and legacy runtime protocol hash byte-compatible', () => {
  const { themes, evidence, sections } = fixture();
  expect(planCapabilityOutlineGrounding(themes, evidence, sections, 48000)).toEqual(planOutlineGrounding(themes, evidence, sections, 48000));
  expect(structureOutlineReviewProtocolHash()).toBe(outlineGroundingProtocolHash());
  // These hashes freeze the unchanged pre-selector runtime sources.
  const legacyPins = {
    "structure-outline-grounding.ts": "a6f9fa23f3b7b35c9f2dd52a85303953f9e4e3917c59356fdd0ef1c1e6acf366",
    "structure-outline-review.ts": "35cf0002adee090161bf33644f72f03516abc07320ecacbd05064ed76dbe9d74"
};
  for (const [filename, expected] of Object.entries(legacyPins)) {
    expect(createHash('sha256').update(readFileSync(path.resolve(`server/src/services/${filename}`))).digest('hex')).toBe(expected);
  }
});

it('refuses explicit unknown selectors instead of silently using the historical branch', () => {
  const { themes, evidence, sections } = fixture();
  expect(() => planCapabilityOutlineGrounding(themes, evidence, sections, 48000, 'unknown' as typeof protocol)).toThrow('protocol-unsupported');
  expect(() => structureOutlineReviewProtocolHash(null as unknown as typeof protocol)).toThrow('protocol-unsupported');
});

it('keeps every cross-topic peer and full original in a subset correction, emitting original text once', () => {
  const { batches, sections } = fixture(); const batch = batches[0];
  const selected = selectCapabilityOutlineGroundingBatch(batch, ['L2']) as CapabilityOutlineGroundingBatch;
  expect(selected.objectives.map(row => row.id)).toEqual(['L2']);
  expect(selected.capabilityContext.nominations).toEqual([{ objectiveId: 'L2', peerIds: ['L1'] }]);
  expect(selected.prompt).toContain('Explain how debt issuance changes net debt and debt ratios.');
  expect(selected.prompt.split(sections[0].text)).toHaveLength(2);
  expect(selected.prompt).not.toContain(sections[1].text);
});

it('repackages without dropping objectives, originals, comparisons or increasing the fixed caps', () => {
  const { themes, evidence, sections } = fixture(10);
  const batches = planCapabilityOutlineGrounding(themes, evidence, sections, 12500, protocol);
  const ids = batches.flatMap(batch => batch.objectives).map(row => row.id);
  expect(new Set(ids).size).toBe(evidence.length);
  expect([...ids].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))).toEqual(evidence.map((_, index) => `L${index + 1}`));
  for (const batch of batches) {
    expect(batch.objectives.length).toBeLessThanOrEqual(4);
    expect(batch.prompt).toBe(''); expect(batch.sources).toEqual([]);
    const send = selectCapabilityOutlineGroundingBatch(batch, batch.objectives.map(row => row.id));
    expect(estimateAuthoringTokens(send.prompt)).toBeLessThanOrEqual(12500);
    expect(estimateCapabilityReviewSend(send.prompt)).toBeLessThanOrEqual(14000);
    expect((batch as CapabilityOutlineGroundingBatch).capabilityContext.nominations.every(row => row.peerIds.length <= 2)).toBe(true);
  }
  const findings = batches.flatMap(batch => validateCapabilityOutlineGroundingRows(verdict(batch), batch).findings);
  const admitted = finalizeCapabilityStructureProposal(themes, findings, batches.flatMap(batch => batch.objectives), batches);
  expect(admitted.themes).toEqual(themes); // Review scheduling never reorders the teacher's curriculum.
});

it('checks minimum complete native input and output reservations against the existing remainder before review work', () => {
  const { batches } = fixture();
  const budget = { limits: { maxSends: 100, maxEstimatedTokens: 2000000, maxInputTokens: 48000, maxOutputTokens: 6000 },
    admissionTokens: 1000000, estimatedInputTokens: 800000, reservedOutputTokens: 200000, observedSends: 20, pendingSends: 0 };
  const plan = capabilityReviewAdmissionPlan(batches, budget);
  const actual = selectCapabilityOutlineGroundingBatch(batches[0], batches[0].objectives.map(row => row.id));
  expect(plan).toMatchObject({ batches: 1, inputUnits: estimateCapabilityReviewSend(actual.prompt), outputUnits: 6000,
    remainingUnits: 1000000, remainingSends: 80, fits: true });
  expect(capabilityReviewAdmissionPlan(batches, { ...budget, admissionTokens: 2000000 - plan.minimumAdditionalUnits + 1 }).fits).toBe(false);
  expect(capabilityReviewAdmissionPlan(batches, { ...budget, observedSends: 100 }).fits).toBe(false);
  expect(capabilityReviewAdmissionPlan(batches, { ...budget, pendingSends: 1 }).fits).toBe(false);
  expect(capabilityReviewAdmissionPlan(batches, budget, ['L1', 'L2', 'L3'])).toMatchObject({ batches: 0, inputUnits: 0, outputUnits: 0, fits: true });
});

it('refuses an oversized complete peer group rather than trimming or un-nominating it', () => {
  const { themes, evidence, sections } = fixture(2, ' Exact original condition.'.repeat(150));
  expect(() => planCapabilityOutlineGrounding(themes, evidence, sections, 11000, protocol)).toThrow('objective-peer-group-too-large');
});

it.each(['equivalent', 'partial-overlap', 'uncertain'] as const)('holds source-supported %s wording while preserving distinct source-supported operations', relation => {
  const { batches, themes } = fixture(); const findings = batches.flatMap(batch => validateCapabilityOutlineGroundingRows(verdict(batch, relation), batch).findings);
  const admitted = finalizeCapabilityStructureProposal(themes, findings, batches.flatMap(batch => batch.objectives), batches);
  expect(admitted.themes).toEqual([themes[2]]);
  expect(admitted.receipt.supportedObjectives).toBe(3);
  expect(admitted.receipt.withheldObjectives).toBe(0);
  expect(admitted.receipt.capabilityDistinctness).toMatchObject({ complete: true, eligibleIds: ['L3'], held: [
    { id: 'L1', reasons: [relation] }, { id: 'L2', reasons: [relation] }] });
});

it('preserves both explanation and calculation despite sharing the exact original', () => {
  const { batches, themes } = fixture(); const findings = batches.flatMap(batch => validateCapabilityOutlineGroundingRows(verdict(batch), batch).findings);
  expect(finalizeCapabilityStructureProposal(themes, findings, batches.flatMap(batch => batch.objectives), batches).themes).toEqual(themes);
});

it('retains a valid sibling and corrects only missing comparisons, preserving the outside-subset peer', async () => {
  const { batches } = fixture(); const first = verdict(batches[0]);
  first.capabilityComparisons = first.capabilityComparisons.filter(row => row.objectiveId !== 'L2');
  const complete = jest.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(verdict(selectCapabilityOutlineGroundingBatch(batches[0], ['L2'])));
  const progress: ReviewProgress = { findings: [], attempts: {}, unresolvedDispatchIds: [], failures: [] };
  const beforeDispatch = jest.fn(async () => undefined), afterValidation = jest.fn(async () => undefined);
  const findings = await reviewCapabilityStructureProposal({ batches, progress, complete, beforeDispatch, afterValidation, assertCurrent: async () => undefined });
  expect(beforeDispatch.mock.calls).toEqual([[['L1', 'L2', 'L3'], 0, 0], [['L2'], 1, 0]]);
  expect(progress.attempts).toEqual({ L1: 1, L2: 2, L3: 1 });
  expect(complete.mock.calls[1][0]).toContain('Explain how debt issuance changes net debt and debt ratios.');
  expect(findings).toHaveLength(3);
  expect(afterValidation).toHaveBeenCalledTimes(2);
  expect(outlineCapabilityGroundingReceipt(findings, 3, batches).capabilityDistinctness?.eligibleIds).toEqual(['L1', 'L2', 'L3']);
});

it('refuses a retained source-positive finding with edited capability rows before another dispatch', async () => {
  const { batches } = fixture(); const findings = validateCapabilityOutlineGroundingRows(verdict(batches[0]), batches[0]).findings;
  findings[0].capabilityComparisons![0].pairId = 'CP' + '0'.repeat(32);
  const complete = jest.fn();
  await expect(reviewCapabilityStructureProposal({ batches, progress: { findings, attempts: { L1: 1, L2: 1, L3: 1 }, unresolvedDispatchIds: [] },
    complete, beforeDispatch: async () => undefined, afterValidation: async () => undefined, assertCurrent: async () => undefined })).rejects.toThrow('comparison-identity');
  expect(complete).not.toHaveBeenCalled();
});

it('rejects extra envelope fields instead of projecting them into an apparently valid source review', () => {
  const { batches } = fixture(); const checked = validateCapabilityOutlineGroundingRows({ ...verdict(batches[0]), skipPeerReview: true }, batches[0]);
  expect(checked.findings).toEqual([]);
  expect(checked.failures).toHaveLength(3);
});

it('uses the existing second attempt for reciprocal cross-batch contradictions and keeps the first valid peer row', async () => {
  const { batches: original } = fixture();
  const batches = original[0].objectives.map(row => selectCapabilityOutlineGroundingBatch(original[0], [row.id]));
  const first = verdict(batches[0]); const conflicting = verdict(batches[1], 'partial-overlap');
  const complete = jest.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(conflicting)
    .mockResolvedValueOnce(verdict(batches[1])).mockResolvedValueOnce(verdict(batches[2]));
  const progress: ReviewProgress = { findings: [], attempts: {}, unresolvedDispatchIds: [], failures: [] };
  const persisted = jest.fn(async () => undefined);
  const result = await reviewCapabilityStructureProposal({ batches, progress, complete, afterValidation: persisted,
    assertCurrent: async () => undefined, beforeDispatch: async () => undefined });
  expect(progress.attempts).toEqual({ L1: 1, L2: 2, L3: 1 });
  expect(complete.mock.calls[2][0]).toContain('structure-capability-peer-relation-conflict');
  expect(complete.mock.calls[2][0]).toContain('Previously retained peer comparisons');
  expect(result[0].capabilityComparisons).toEqual(first.capabilityComparisons);
  expect(result[1].capabilityComparisons![0].relation).toBe('distinct');
  expect(persisted).toHaveBeenCalledTimes(4);
});

it('retains same-call contradictory rows as failures for one bounded correction, never as completed findings', () => {
  const { batches } = fixture(); const raw = verdict(batches[0]);
  raw.capabilityComparisons[1] = verdict(batches[0], 'equivalent').capabilityComparisons[1];
  const checked = validateCapabilityOutlineGroundingRows(raw, batches[0]);
  expect(checked.findings.map(row => row.id)).toEqual(['L3']);
  expect(checked.failures.map(row => row.id)).toEqual(['L1', 'L2']);
  expect(checked.failures.every(row => row.reason.startsWith('structure-capability-peer-relation-conflict:'))).toBe(true);
});

it('does not purchase a reciprocal correction solely for a fully source-ineligible peer, while keeping strict quote checks', () => {
  const { batches } = fixture(); const raw = verdict(batches[0]);
  raw.reviews[1].sourceStatus = 'unsupported'; raw.reviews[1].coveredEvidenceIds = [];
  raw.capabilityComparisons[1] = verdict(batches[0], 'equivalent').capabilityComparisons[1];
  const checked = validateCapabilityOutlineGroundingRows(raw, batches[0]);
  expect(checked.failures).toEqual([]); expect(checked.findings).toHaveLength(3);
  raw.capabilityComparisons[0].candidateUniqueCapabilities[0].quotes[0].quote = 'A fabricated source statement.';
  expect(validateCapabilityOutlineGroundingRows(raw, batches[0]).failures).toContainEqual(expect.objectContaining({ id: 'L1', reason: 'structure-distinctness-quote-identity' }));
});
