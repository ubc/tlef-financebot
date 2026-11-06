import { planOutlineGrounding, validateOutlineGroundingRows, type OutlineGroundingBatch } from '../../server/src/services/structure-outline-grounding';
import { finalizeStructureProposal, reviewStructureProposal, type ReviewProgress, type StructureProposalReviewInput } from '../../server/src/services/structure-outline-review';
import type { StructureEvidence, StructureResult } from '../../server/src/types/structure';

function fixture(count = 2) {
  const sections = Array.from({ length: count }, (_, index) => ({ id: `section-${index + 1}`, materialId: `material-${index + 1}`,
    materialName: `Chapter ${index + 1}.pdf`, chunkIndex: index, text: `Chapter ${index + 1}: F = ma under condition ${index + 1}.` }));
  const evidence: StructureEvidence[] = sections.map((section, index) => ({ id: `E${index + 1}`, objective: `Apply condition ${index + 1}`,
    materialId: section.materialId, materialName: section.materialName, chunkIndex: section.chunkIndex, quote: section.text }));
  const themes: StructureResult['themes'] = [{ name: 'Taught formula applications', los: evidence.map(point => ({
    name: `Apply the relationship under ${point.objective}`, evidenceIds: [point.id], materialIds: [point.materialId],
  })) }];
  const batches = planOutlineGrounding(themes, evidence, sections, 48000);
  return { themes, batches, batch: batches[0]! };
}

function verdict(batch: OutlineGroundingBatch, ids = batch.objectives.map(row => row.id)) {
  return { reviews: batch.objectives.filter(row => ids.includes(row.id)).map(row => ({ id: row.id, sourceStatus: 'supported',
    sourceIds: [...row.sourceIds], coveredEvidenceIds: [...row.evidenceIds], sourceReason: 'The complete original teaches this exact relationship and condition.',
    topicFit: 'fits', topicReason: 'The topic groups these source-supported applications.' })) };
}

function harness(batches: OutlineGroundingBatch[], progress: ReviewProgress = { findings: [], attempts: {}, unresolvedDispatchIds: [] }) {
  const assertCurrent = jest.fn(async (): Promise<void> => undefined);
  const complete = jest.fn(async (_prompt: string, item: number, _attempt: number): Promise<unknown> => verdict(batches[item]!));
  const beforeDispatch = jest.fn(async (_ids: string[], _attempt: number, _item: number): Promise<void> => undefined);
  const afterValidation = jest.fn(async (_result: Parameters<StructureProposalReviewInput['afterValidation']>[0]): Promise<void> => undefined);
  const onReceipt = jest.fn(async (): Promise<void> => undefined);
  return { batches, progress, assertCurrent, complete, beforeDispatch, afterValidation, onReceipt };
}

it('claims a review before completion, retains a complete receipt and uses current final admission', async () => {
  const { themes, batches, batch } = fixture(); const input = harness(batches); const events: string[] = [];
  input.beforeDispatch.mockImplementation(async ids => {
    events.push('claim'); expect(ids).toEqual(['L1', 'L2']);
    expect(input.progress.attempts).toEqual({});
  });
  input.complete.mockImplementation(async () => {
    events.push('send'); expect(input.progress.attempts).toEqual({ L1: 1, L2: 1 });
    expect(input.progress.unresolvedDispatchIds).toEqual(['L1', 'L2']);
    return verdict(batch);
  });
  input.afterValidation.mockImplementation(async result => {
    events.push('persist'); expect(result.findings).toHaveLength(2);
    expect(input.progress.unresolvedDispatchIds).toEqual(['L1', 'L2']);
  });
  const findings = await reviewStructureProposal(input);
  expect(events).toEqual(['claim', 'send', 'persist']);
  expect(input.progress.unresolvedDispatchIds).toEqual([]);
  expect(input.progress.failures).toEqual([]);
  expect(input.onReceipt).toHaveBeenCalledTimes(2);
  expect(input.assertCurrent).toHaveBeenCalledTimes(4);
  expect(finalizeStructureProposal(themes, findings, batch.objectives).themes).toEqual(themes);
});

it('preserves a valid sibling and corrects only the invalid objective using its exact originals and diagnostics', async () => {
  const { batches, batch } = fixture(); const input = harness(batches); const first = verdict(batch);
  first.reviews[1]!.sourceIds = ['S-foreign'];
  input.complete.mockResolvedValueOnce(first).mockResolvedValueOnce(verdict(batch, ['L2']));
  const findings = await reviewStructureProposal(input);
  expect(findings.map(row => row.id)).toEqual(['L1', 'L2']);
  expect(input.progress.attempts).toEqual({ L1: 1, L2: 2 });
  expect(input.beforeDispatch.mock.calls).toEqual([[['L1', 'L2'], 0, 0], [['L2'], 1, 0]]);
  const correction = input.complete.mock.calls[1]![0];
  expect(correction).toContain('Correct ONLY the remaining objectives below');
  expect(correction).toContain('structure-grounding-review-source');
  expect(correction).toContain('Chapter 2: F = ma under condition 2.');
  expect(correction).not.toContain('Chapter 1: F = ma under condition 1.');
  expect(correction).not.toContain(batch.objectives[0]!.name);
  expect(input.afterValidation.mock.calls[0]![0].findings.map(row => row.id)).toEqual(['L1']);
  expect(input.afterValidation.mock.calls[0]![0].failures[0]).toMatchObject({ id: 'L2', allowedSourceIds: ['S2'], allowedEvidenceIds: ['E2'] });
});

it('skips an exact retained finding without changing its bytes or resetting consumed attempts', async () => {
  const { batches, batch } = fixture();
  const retained = validateOutlineGroundingRows(verdict(batch, ['L1']), { ...batch, objectives: [batch.objectives[0]!] }).findings;
  const before = JSON.stringify(retained[0]);
  const input = harness(batches, { findings: retained, attempts: { L1: 2 }, unresolvedDispatchIds: [] });
  input.complete.mockResolvedValue(verdict(batch, ['L2']));
  const findings = await reviewStructureProposal(input);
  expect(input.beforeDispatch).toHaveBeenCalledWith(['L2'], 0, 0);
  expect(input.complete).toHaveBeenCalledTimes(1);
  expect(input.complete.mock.calls[0]![0]).not.toContain(batch.objectives[0]!.name);
  expect(JSON.stringify(findings[0])).toBe(before);
  expect(input.progress.attempts).toEqual({ L1: 2, L2: 1 });
});

it.each(['foreign', 'duplicate', 'content-hash', 'source', 'coverage', 'negative-coverage'])('refuses %s retained findings before any dispatch', async defect => {
  const { batches, batch } = fixture(); const checked = validateOutlineGroundingRows(verdict(batch), batch);
  const findings = checked.findings;
  if (defect === 'foreign') findings[0]!.id = 'L-foreign';
  if (defect === 'duplicate') findings[1] = structuredClone(findings[0]!);
  if (defect === 'content-hash') findings[0]!.contentHash = 'forged';
  if (defect === 'source') findings[0]!.citedSourceIds = ['S2'];
  if (defect === 'coverage') findings[0]!.coveredEvidenceIds = ['E2'];
  if (defect === 'negative-coverage') findings[0]!.status = 'unsupported';
  const input = harness(batches, { findings, attempts: { L1: 1, L2: 1 }, unresolvedDispatchIds: [] });
  await expect(reviewStructureProposal(input)).rejects.toThrow();
  expect(input.complete).not.toHaveBeenCalled(); expect(input.beforeDispatch).not.toHaveBeenCalled();
});

it('accepts canonical retained negative rows as resolved without treating them as selectable objectives', async () => {
  const { batches, batch, themes } = fixture(); const raw = verdict(batch);
  raw.reviews.forEach(row => { row.sourceStatus = 'uncertain'; row.coveredEvidenceIds = []; });
  const findings = validateOutlineGroundingRows(raw, batch).findings;
  const input = harness(batches, { findings, attempts: { L1: 1, L2: 2 }, unresolvedDispatchIds: [] });
  const result = await reviewStructureProposal(input);
  expect(result).toEqual(findings); expect(input.complete).not.toHaveBeenCalled();
  expect(() => finalizeStructureProposal(themes, result, batch.objectives)).toThrow('structure-grounding-no-supported-objectives');
});

it('resumes only the remaining correction using durable exact validation failures', async () => {
  const { batches, batch } = fixture(); const raw = verdict(batch); raw.reviews[1]!.coveredEvidenceIds = [];
  const checked = validateOutlineGroundingRows(raw, batch);
  const input = harness(batches, { findings: checked.findings, attempts: { L1: 1, L2: 1 }, unresolvedDispatchIds: [], failures: checked.failures });
  input.complete.mockResolvedValue(verdict(batch, ['L2']));
  await reviewStructureProposal(input);
  expect(input.beforeDispatch).toHaveBeenCalledTimes(1);
  expect(input.beforeDispatch).toHaveBeenCalledWith(['L2'], 1, 0);
  expect(input.complete.mock.calls[0]![0]).toContain(JSON.stringify(checked.failures));
  expect(input.progress.attempts.L2).toBe(2);
});

it.each(['exhausted', 'missing-diagnostic', 'foreign-attempt', 'tampered-diagnostic'])('fails closed for %s durable attempt state', async defect => {
  const { batches, batch } = fixture(1); const raw = verdict(batch); raw.reviews[0]!.coveredEvidenceIds = [];
  const checked = validateOutlineGroundingRows(raw, batch);
  const progress: ReviewProgress = { findings: [], attempts: { L1: 1 }, unresolvedDispatchIds: [], failures: checked.failures };
  if (defect === 'exhausted') progress.attempts.L1 = 2;
  if (defect === 'missing-diagnostic') delete progress.failures;
  if (defect === 'foreign-attempt') progress.attempts.foreign = 1;
  if (defect === 'tampered-diagnostic') progress.failures![0]!.allowedSourceIds = ['S-foreign'];
  const input = harness(batches, progress);
  await expect(reviewStructureProposal(input)).rejects.toThrow();
  expect(input.complete).not.toHaveBeenCalled(); expect(input.beforeDispatch).not.toHaveBeenCalled();
});

it('does not send or change local attempt state when the durable claim fails', async () => {
  const { batches } = fixture(); const input = harness(batches);
  input.beforeDispatch.mockRejectedValue(new Error('claim-conflict'));
  await expect(reviewStructureProposal(input)).rejects.toThrow('claim-conflict');
  expect(input.complete).not.toHaveBeenCalled();
  expect(input.progress).toEqual({ findings: [], attempts: {}, unresolvedDispatchIds: [], failures: [] });
});

it.each(['transport', 'persistence'])('retains an unresolved claim after %s failure and refuses replay without another send', async defect => {
  const { batches } = fixture(1); const input = harness(batches);
  if (defect === 'transport') input.complete.mockRejectedValue(new Error('transport-unknown'));
  else input.afterValidation.mockRejectedValue(new Error('persistence-unknown'));
  await expect(reviewStructureProposal(input)).rejects.toThrow(`${defect}-unknown`);
  expect(input.progress.attempts).toEqual({ L1: 1 });
  expect(input.progress.unresolvedDispatchIds).toEqual(['L1']);
  expect(input.progress.findings).toEqual([]);
  const replay = harness(batches, input.progress);
  await expect(reviewStructureProposal(replay)).rejects.toThrow('structure-grounding-review-unresolved-dispatch');
  expect(replay.beforeDispatch).not.toHaveBeenCalled(); expect(replay.complete).not.toHaveBeenCalled();
});

it('persists valid siblings but rejects a foreign response identity without narrowing or silently finalizing', async () => {
  const { batches, batch } = fixture(); const input = harness(batches); const raw = verdict(batch);
  raw.reviews.push({ ...raw.reviews[0]!, id: 'foreign-objective' });
  input.complete.mockResolvedValue(raw);
  await expect(reviewStructureProposal(input)).rejects.toThrow('structure-grounding-review-identity');
  expect(input.progress.findings.map(row => row.id)).toEqual(['L1', 'L2']);
  expect(input.progress.unresolvedDispatchIds).toEqual([]);
  expect(input.complete).toHaveBeenCalledTimes(1); expect(input.afterValidation).toHaveBeenCalledTimes(1);
  const replay = harness(batches, input.progress);
  await expect(reviewStructureProposal(replay)).rejects.toThrow('structure-grounding-review-failure-binding');
  expect(replay.complete).not.toHaveBeenCalled();
});

it('stops after the second invalid semantic response while retaining independently valid rows', async () => {
  const { batches, batch } = fixture(); const input = harness(batches); const raw = verdict(batch); raw.reviews[1]!.coveredEvidenceIds = [];
  input.complete.mockResolvedValueOnce(raw).mockResolvedValueOnce({ reviews: [raw.reviews[1]] });
  await expect(reviewStructureProposal(input)).rejects.toThrow('structure-grounding-review-coverage');
  expect(input.complete).toHaveBeenCalledTimes(2);
  expect(input.progress.findings.map(row => row.id)).toEqual(['L1']);
  expect(input.progress.attempts).toEqual({ L1: 1, L2: 2 });
  expect(input.progress.unresolvedDispatchIds).toEqual([]);
  const replay = harness(batches, input.progress);
  await expect(reviewStructureProposal(replay)).rejects.toThrow('structure-grounding-review-coverage');
  expect(replay.complete).not.toHaveBeenCalled();
});

it('rechecks currentness after a response and refuses to persist source-stale findings', async () => {
  const { batches } = fixture(1); const input = harness(batches);
  input.assertCurrent.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValue(new Error('source-changed'));
  await expect(reviewStructureProposal(input)).rejects.toThrow('source-changed');
  expect(input.complete).toHaveBeenCalledTimes(1); expect(input.afterValidation).not.toHaveBeenCalled();
  expect(input.progress.findings).toEqual([]); expect(input.progress.unresolvedDispatchIds).toEqual(['L1']);
});

it('retains advisory topic concerns without turning supported source findings into withheld objectives', async () => {
  const { batches, batch, themes } = fixture(1); const input = harness(batches); const raw = verdict(batch);
  raw.reviews[0]!.topicFit = 'misgrouped'; raw.reviews[0]!.topicReason = 'Move this supported application to a neighboring topic.';
  input.complete.mockResolvedValue(raw);
  const findings = await reviewStructureProposal(input);
  const admitted = finalizeStructureProposal(themes, findings, batch.objectives);
  expect(admitted.themes).toEqual(themes); expect(admitted.receipt.groupingIssues).toBe(1);
  expect(findings[0]!.status).toBe('supported');
});
