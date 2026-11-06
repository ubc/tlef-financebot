import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ObjectId } from 'mongodb';
import { assessOutlineCoverageRepair, buildOutlineWordingRepairBody, createOutlineCoverageRepairPrompt,
  createOutlineWordingRepairPrompt, outlineCoverageRepairProtocolHash, outlineWordingRepairProtocolHash,
  resolveOutlineCoverageRepairTargets } from '../../server/src/services/structure-outline-repair';
import { planOutlineGrounding, selectOutlineGroundingBatch, validateOutlineGroundingRows } from '../../server/src/services/structure-outline-grounding';
import type { OutlineGroundingFinding } from '../../server/src/types/structure';
import type { StructureReviewCheckpointBody } from '../../server/src/types/structure-review';
import type { StructureCoverageRepairRequest } from '../../server/src/types/structure-repair';
import { structureRepairFixture } from './fixtures/structure-repair';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const clone = <T>(value: T): T => structuredClone(value);
function parentFixture(secondTarget = false) {
  const { body } = structureRepairFixture();
  body.corpus.sections[2].text += ' Diversification does not remove market risk. A diversified investor still bears market risk.';
  const base = body.evidence[2];
  body.evidence.push({ ...base, id: 'E4', objective: 'Explain why market risk remains after diversification.', quote: 'Diversification does not remove market risk.' },
    { ...base, id: 'E5', objective: 'Identify the risk still borne by a diversified investor.', quote: 'A diversified investor still bears market risk.' });
  body.themes[0].los[2].evidenceIds = ['E3', 'E4', 'E5'];
  if (secondTarget) {
    body.evidence.push({ ...body.evidence[0], id: 'E6', objective: 'Preserve the after-tax lease alternative condition.' });
    body.themes[0].los[0].evidenceIds.push('E6');
  }
  body.batches = planOutlineGrounding(body.themes, body.evidence, body.corpus.sections, body.reviewInputLimit);
  const findings = body.batches.flatMap(batch => validateOutlineGroundingRows({ reviews: batch.objectives.map(row => ({ id: row.id,
    sourceStatus: row.id === 'L3' || (secondTarget && row.id === 'L1') ? 'supported' : 'uncertain', sourceIds: row.sourceIds,
    coveredEvidenceIds: row.id === 'L3' ? ['E3'] : secondTarget && row.id === 'L1' ? ['E1'] : [],
    sourceReason: 'Scripted fixture judgment, not an actual model verdict.', topicFit: 'fits', topicReason: 'Fixture topic.' })) }, batch).findings);
  return { body, findings };
}
function changedBody(body: StructureReviewCheckpointBody, id = 'L3') {
  return buildOutlineWordingRepairBody(body, [{ id, name: 'Explain how diversification removes firm-specific risk while market risk remains.' }], new ObjectId().toHexString(), body.baseBudget);
}
function reviewed(body: StructureReviewCheckpointBody, parentFindings: OutlineGroundingFinding[], id: string, ids: string[], status: 'supported' | 'unsupported' | 'uncertain' = 'supported') {
  const batch = body.batches.find(row => row.objectives.some(row => row.id === id))!;
  const own = selectOutlineGroundingBatch(batch, [id]);
  const checked = validateOutlineGroundingRows({ reviews: [{ id, sourceStatus: status, sourceIds: own.objectives[0].sourceIds,
    coveredEvidenceIds: ids, sourceReason: 'Synthetic fresh review used only to test admission mechanics.', topicFit: 'fits', topicReason: 'Same fixture topic.' }] }, own);
  expect(checked.failures).toEqual([]); expect(checked.findings).toHaveLength(1);
  return parentFindings.map(row => row.id === id ? checked.findings[0] : clone(row));
}

it('derives old coverage and canonical target order from complete parent authority, never caller preservation fields', () => {
  const { body, findings } = parentFixture(true); const before = JSON.stringify({ body, findings });
  const targets = resolveOutlineCoverageRepairTargets(body, findings, [{ id: 'L3', evidenceIds: ['E5', 'E4'] }, { id: 'L1', evidenceIds: ['E6'] }]);
  expect(targets.map(row => row.id)).toEqual(['L1', 'L3']); expect(targets[1].evidenceIds).toEqual(['E4', 'E5']);
  expect(targets[1].preserveEvidenceIds).toEqual(['E3']); expect(targets[1].findingHash).toBe(hash(JSON.stringify(findings[2])));
  expect(JSON.stringify({ body, findings })).toBe(before);
});

it.each([
  [], [{ id: 'L3', evidenceIds: [] }], [{ id: 'L3', evidenceIds: Array(9).fill('E4') }],
  [{ id: 'L3', evidenceIds: ['E4'] }, { id: 'L3', evidenceIds: ['E5'] }], [{ id: 'L3', evidenceIds: ['E4', 'E4'] }],
  [{ id: 'L3', evidenceIds: ['E4'], preserveEvidenceIds: [] }], [{ id: 'L3', evidenceIds: ['E4'], sourceStatus: 'supported' }],
  [{ id: 'foreign', evidenceIds: ['E4'] }], [{ id: 'L3', evidenceIds: ['foreign'] }], [{ id: 'L3', evidenceIds: ['E1'] }],
  [{ id: 'L3', evidenceIds: ['E3'] }], [{ id: 'L1', evidenceIds: ['E1'] }],
].map(requests => ({ requests })))('refuses malformed, foreign, credited or unsupported requests: $requests', ({ requests }) => {
  const { body, findings } = parentFixture();
  expect(() => resolveOutlineCoverageRepairTargets(body, findings, requests as StructureCoverageRepairRequest[])).toThrow();
});

it('refuses a point credited by another admitted objective even when it is uncredited in the target itself', () => {
  const { body } = parentFixture(); const other = body.themes[0].los[0];
  other.evidenceIds.push('E4'); other.materialIds.push(body.evidence[2].materialId);
  body.batches = planOutlineGrounding(body.themes, body.evidence, body.corpus.sections, body.reviewInputLimit);
  const findings = body.batches.flatMap(batch => validateOutlineGroundingRows({ reviews: batch.objectives.map(row => ({ id: row.id,
    sourceStatus: row.id === 'L2' ? 'uncertain' : 'supported', sourceIds: row.sourceIds,
    coveredEvidenceIds: row.id === 'L1' ? ['E4'] : row.id === 'L3' ? ['E3'] : [], sourceReason: 'Synthetic global coverage.', topicFit: 'fits', topicReason: 'Fixture topic.' })) }, batch).findings);
  expect(() => resolveOutlineCoverageRepairTargets(body, findings, [{ id: 'L3', evidenceIds: ['E4'] }])).toThrow('point-not-uncredited-own');
});

it('refuses requesting the same uncredited capability twice across two otherwise valid target objectives', () => {
  const { body } = parentFixture(true); const other = body.themes[0].los[0];
  other.evidenceIds.push('E4'); other.materialIds.push(body.evidence[2].materialId);
  body.batches = planOutlineGrounding(body.themes, body.evidence, body.corpus.sections, body.reviewInputLimit);
  const findings = body.batches.flatMap(batch => validateOutlineGroundingRows({ reviews: batch.objectives.map(row => ({ id: row.id,
    sourceStatus: row.id === 'L2' ? 'uncertain' : 'supported', sourceIds: row.sourceIds,
    coveredEvidenceIds: row.id === 'L1' ? ['E1'] : row.id === 'L3' ? ['E3'] : [], sourceReason: 'Synthetic distinct previous coverage.', topicFit: 'fits', topicReason: 'Fixture topic.' })) }, batch).findings);
  expect(resolveOutlineCoverageRepairTargets(body, findings, [{ id: 'L1', evidenceIds: ['E4'] }])[0].evidenceIds).toEqual(['E4']);
  expect(resolveOutlineCoverageRepairTargets(body, findings, [{ id: 'L3', evidenceIds: ['E4'] }])[0].evidenceIds).toEqual(['E4']);
  expect(() => resolveOutlineCoverageRepairTargets(body, findings, [{ id: 'L1', evidenceIds: ['E4'] }, { id: 'L3', evidenceIds: ['E4'] }])).toThrow('coverage-request-identity');
});

it.each(['missing-parent', 'duplicate-parent', 'forged-parent', 'stale-plan'] as const)('requires every exact parent finding before deriving targets: %s', fault => {
  const { body, findings } = parentFixture();
  if (fault === 'missing-parent') findings.pop();
  if (fault === 'duplicate-parent') findings[1] = clone(findings[2]);
  if (fault === 'forged-parent') findings[2].coveredEvidenceIds = ['foreign'];
  if (fault === 'stale-plan') body.batches[0].objectives[2].name = 'Stale original binding.';
  expect(() => resolveOutlineCoverageRepairTargets(body, findings, [{ id: 'L3', evidenceIds: ['E4'] }])).toThrow();
});

it('sends complete own originals, explicit target/preserved capabilities and teacher constraints without claiming their truth', () => {
  const { body, findings } = parentFixture(); body.options.guidance = 'Keep the original actor and risk terminology.';
  body.options.level = 'introductory'; body.options.emphasis = 'conceptual';
  const targets = resolveOutlineCoverageRepairTargets(body, findings, [{ id: 'L3', evidenceIds: ['E4'] }]);
  const prompt = createOutlineCoverageRepairPrompt(body, findings, targets); const data = JSON.parse(prompt.slice(prompt.lastIndexOf('\n\n') + 2));
  expect(data.objectives[0].requestedCapabilities.map((row: { id: string }) => row.id)).toEqual(['E4']);
  expect(data.objectives[0].preserveCapabilities.map((row: { id: string }) => row.id)).toEqual(['E3']);
  expect(data.originalSections[0].text).toBe(body.corpus.sections[2].text); expect(prompt).not.toContain(body.corpus.sections[0].text);
  expect(data.originalInstructorConstraints).toEqual({ guidance: body.options.guidance, level: 'introductory', emphasis: 'conceptual' });
  expect(prompt).toContain('earlier positive review is not source proof'); expect(prompt).toContain('Return no-repair');
  expect(prompt).toContain('without establishing a unique answer'); expect(prompt).not.toContain('findingHash');
});

it.each(['missing-preserved', 'foreign-target', 'hash', 'extra-verdict'] as const)('rejects changed or forged server target metadata: %s', fault => {
  const { body, findings } = parentFixture(); const targets = resolveOutlineCoverageRepairTargets(body, findings, [{ id: 'L3', evidenceIds: ['E4'] }]);
  if (fault === 'missing-preserved') targets[0].preserveEvidenceIds = [];
  if (fault === 'foreign-target') targets[0].evidenceIds = ['E6'];
  if (fault === 'hash') targets[0].findingHash = '0'.repeat(64);
  if (fault === 'extra-verdict') Object.assign(targets[0], { approved: true });
  expect(() => createOutlineCoverageRepairPrompt(body, findings, targets)).toThrow();
});

it('requires requested plus all previous capabilities under the new immutable wording and keeps sibling findings exact', () => {
  const { body, findings } = parentFixture(); const targets = resolveOutlineCoverageRepairTargets(body, findings, [{ id: 'L3', evidenceIds: ['E4'] }]);
  const next = changedBody(body); const fresh = reviewed(next, findings, 'L3', ['E3', 'E4']); const before = JSON.stringify({ body, findings, next, fresh });
  const assessment = assessOutlineCoverageRepair(body, next, findings, fresh, targets, ['L3']);
  expect(assessment).toMatchObject({ version: 'coverage-wording-outline-repair-v1', status: 'passed', targets: [
    { id: 'L3', status: 'covered', requestedEvidenceIds: ['E4'], preservedEvidenceIds: ['E3'], missingEvidenceIds: [], lostEvidenceIds: [], reasons: [] },
  ] }); expect(assessment.bindingHash).toMatch(/^[a-f0-9]{64}$/); expect(JSON.stringify({ body, findings, next, fresh })).toBe(before);
  const differentlyRecorded = clone(fresh); differentlyRecorded[2].reason += ' Distinct receipt.';
  expect(assessOutlineCoverageRepair(body, next, findings, differentlyRecorded, targets, ['L3']).bindingHash).not.toBe(assessment.bindingHash);
});

it.each([['missing-requested', ['E3'], ['E4'], []], ['lost-previous', ['E4'], [], ['E3']]] as const)('records a source-positive coverage shortfall for %s', (_label, credits, missing, lost) => {
  const { body, findings } = parentFixture(); const targets = resolveOutlineCoverageRepairTargets(body, findings, [{ id: 'L3', evidenceIds: ['E4'] }]); const next = changedBody(body);
  const assessment = assessOutlineCoverageRepair(body, next, findings, reviewed(next, findings, 'L3', [...credits]), targets, ['L3']);
  expect(assessment.status).toBe('shortfall'); expect(assessment.targets[0].missingEvidenceIds).toEqual(missing); expect(assessment.targets[0].lostEvidenceIds).toEqual(lost);
});

it.each(['unsupported', 'uncertain'] as const)('retains genuine %s fresh judgments as shortfall, including an all-withheld child', status => {
  const { body, findings } = parentFixture(); const targets = resolveOutlineCoverageRepairTargets(body, findings, [{ id: 'L3', evidenceIds: ['E4'] }]); const next = changedBody(body);
  const assessment = assessOutlineCoverageRepair(body, next, findings, reviewed(next, findings, 'L3', [], status), targets, ['L3']);
  expect(assessment.status).toBe('shortfall'); expect(assessment.targets[0]).toMatchObject({ missingEvidenceIds: ['E4'], lostEvidenceIds: ['E3'] });
  expect(assessment.targets[0].reasons.some(reason => reason.includes(`review is ${status}`))).toBe(true);
});

it('records no-repair and a missing exhausted target review separately without inventing findings', () => {
  const { body, findings } = parentFixture(); const targets = resolveOutlineCoverageRepairTargets(body, findings, [{ id: 'L3', evidenceIds: ['E4'] }]);
  const unchanged = buildOutlineWordingRepairBody(body, [], new ObjectId().toHexString(), body.baseBudget);
  const noRepair = assessOutlineCoverageRepair(body, unchanged, findings, findings, targets, []);
  expect(noRepair.status).toBe('shortfall'); expect(noRepair.targets[0].lostEvidenceIds).toEqual([]); expect(noRepair.targets[0].reasons).toContain('No wording repair was proposed.');
  const next = changedBody(body); const partial = findings.filter(row => row.id !== 'L3'); const before = JSON.stringify(partial);
  const missing = assessOutlineCoverageRepair(body, next, findings, partial, targets, ['L3']);
  expect(missing.status).toBe('shortfall'); expect(missing.targets[0]).toMatchObject({ missingEvidenceIds: ['E4'], lostEvidenceIds: ['E3'] });
  expect(missing.targets[0].reasons.some(reason => reason.includes('review is missing'))).toBe(true); expect(JSON.stringify(partial)).toBe(before);
});

it.each(['missing-sibling', 'foreign-finding', 'duplicate-finding', 'stale-target', 'foreign-credit', 'changed-sibling', 'missing-target-forged-sibling'] as const)('refuses malformed fresh authority rather than relabeling %s as semantic shortfall', defect => {
  const { body, findings } = parentFixture(); const targets = resolveOutlineCoverageRepairTargets(body, findings, [{ id: 'L3', evidenceIds: ['E4'] }]); const next = changedBody(body);
  const fresh = reviewed(next, findings, 'L3', ['E3', 'E4']);
  if (defect === 'missing-sibling') fresh.splice(0, 1);
  if (defect === 'foreign-finding') fresh.push({ ...fresh[2], id: 'foreign' });
  if (defect === 'duplicate-finding') fresh.push(clone(fresh[2]));
  if (defect === 'stale-target') fresh[2] = clone(findings[2]);
  if (defect === 'foreign-credit') fresh[2].coveredEvidenceIds.push('foreign');
  if (defect === 'changed-sibling') fresh[0].reason = 'Changed unreviewed sibling judgment.';
  if (defect === 'missing-target-forged-sibling') { fresh.pop(); fresh[0].contentHash = '0'.repeat(64); }
  expect(() => assessOutlineCoverageRepair(body, next, findings, fresh, targets, ['L3'])).toThrow();
});

it.each(['source', 'evidence', 'topic', 'extra-LO', 'unmarked-wording', 'unknown-changed-ID'] as const)('rejects scope or changed-ID corruption: %s', defect => {
  const { body, findings } = parentFixture(); const targets = resolveOutlineCoverageRepairTargets(body, findings, [{ id: 'L3', evidenceIds: ['E4'] }]); const next = changedBody(body);
  let changed = ['L3'];
  if (defect === 'source') next.corpus.sections[2].text += ' New unrelated source.';
  if (defect === 'evidence') next.themes[0].los[2].evidenceIds.push('E1');
  if (defect === 'topic') next.themes[0].name = 'New topic';
  if (defect === 'extra-LO') next.themes[0].los.push(clone(next.themes[0].los[0]));
  if (defect === 'unmarked-wording') changed = [];
  if (defect === 'unknown-changed-ID') changed = ['foreign'];
  expect(() => assessOutlineCoverageRepair(body, next, findings, findings, targets, changed)).toThrow();
});

it('uses exact retained E13/L4 originals and recorded old credits without automatically treating E661/E810 as requirements', () => {
  const root = path.resolve(__dirname, '../..'); const base = 'audit-results/quality-lab-outline-continuation-2026-10-17/';
  const rawBody = readFileSync(path.join(root, base, 'checkpoint-body.json'), 'utf8');
  const rawResult = readFileSync(path.join(root, base, 'live-after-fixture-reconciliation/results.json'), 'utf8');
  expect(hash(rawBody)).toBe('82aaab21c39e92a113ae5405e4cec4650a3c1a42bcd91d24f9a7657ce7aefd69');
  expect(hash(rawResult)).toBe('492bce4a301999bcf719e326710b4363cdf7bb0561823751aafa49dd14a15edf');
  const body = JSON.parse(rawBody) as StructureReviewCheckpointBody;
  const findings = JSON.parse(rawResult).child.structureResult.coverage.outlineGrounding.findings as OutlineGroundingFinding[];
  const targets = resolveOutlineCoverageRepairTargets(body, findings, [{ id: 'L4', evidenceIds: ['E13'] }]);
  expect(targets[0]).toMatchObject({ id: 'L4', evidenceIds: ['E13'], preserveEvidenceIds: ['E14', 'E15'] });
  const prompt = createOutlineCoverageRepairPrompt(body, findings, targets); const data = JSON.parse(prompt.slice(prompt.lastIndexOf('\n\n') + 2));
  expect(data.originalSections).toHaveLength(2); expect(data.originalSections[0].text).toBe(body.batches[0].sources.find(row => row.alias === 'S4')!.text);
  expect(data.originalSections[0].text).toContain('Corporate finance picks shareholders because they have a residual');
  expect(data.objectives.flatMap((row: { requestedCapabilities: Array<{ id: string }> }) => row.requestedCapabilities.map(point => point.id))).toEqual(['E13']);
  expect(() => resolveOutlineCoverageRepairTargets(body, findings, [{ id: 'L115', evidenceIds: ['E810'] }])).toThrow('target-not-supported');
  // The E661 extraction is not source truth: selection needs an explicit request,
  // and even then a fresh independent reviewer can withhold it. It is not added.
  expect(prompt).not.toContain('E661'); expect(prompt).not.toContain('E810');
  expect(() => createOutlineWordingRepairPrompt(body, [findings.find(row => row.id === 'L4')!])).toThrow('target-finding');
  const proposed = buildOutlineWordingRepairBody(body, [{ id: 'L4', name: 'Explain shareholder priority from residual versus contractual claims, the stock-price metric under rational-investor assumptions, and compatibility with employees, customers and social norms.' }], new ObjectId().toHexString(), body.baseBudget);
  const fresh = reviewed(proposed, findings, 'L4', ['E13', 'E14', 'E15']);
  expect(assessOutlineCoverageRepair(body, proposed, findings, fresh, targets, ['L4']).status).toBe('passed');
  expect(assessOutlineCoverageRepair(body, proposed, findings, reviewed(proposed, findings, 'L4', ['E14', 'E15']), targets, ['L4']).status).toBe('shortfall');
  const missing = assessOutlineCoverageRepair(body, proposed, findings, findings.filter(row => row.id !== 'L4'), targets, ['L4']);
  expect(missing.status).toBe('shortfall'); expect(missing.targets[0].reasons.some(reason => reason.includes('review is missing'))).toBe(true);
});

it('preserves the historical prompt function bytes and separates the new coverage protocol identity', () => {
  const root = path.resolve(__dirname, '../..'); const filename = 'server/src/services/structure-outline-repair.ts';
  const original = readFileSync(path.join(root, 'audit-results/outline-coverage-next-gap-2026-10-17/source-at-audit', filename), 'utf8');
  const current = readFileSync(path.join(root, filename), 'utf8');
  const extract = (text: string) => text.slice(text.indexOf('export function createOutlineWordingRepairPrompt('), text.indexOf('export function validateOutlineWordingRepairProposal('));
  expect(extract(current)).toBe(extract(original));
  expect(outlineCoverageRepairProtocolHash()).toMatch(/^[a-f0-9]{64}$/); expect(outlineCoverageRepairProtocolHash()).not.toBe(outlineWordingRepairProtocolHash());
});
