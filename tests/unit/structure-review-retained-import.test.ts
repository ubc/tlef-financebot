import { createHash } from 'node:crypto';
import { outlineGroundingProtocolHash, planOutlineGrounding, selectOutlineGroundingBatch, validateOutlineGroundingRows } from '../../server/src/services/structure-outline-grounding';
import { projectRetainedStructureReviews, type RetainedStructureReviewAuthority } from '../../server/src/services/structure-review-retained-import';
import type { StructureReviewCheckpointBody } from '../../server/src/types/structure-review';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Synthetic cardinality fixture only; it is not proof about retained live LOs. */
function fixture(fullHistoricalShape = false): { body: StructureReviewCheckpointBody; authority: RetainedStructureReviewAuthority } {
  const count = fullHistoricalShape ? 142 : 5;
  const materialId = '000000000000000000000001';
  const sections = Array.from({ length: count }, (_, index) => ({ id: `C${index + 1}.S1`, materialId, materialName: 'Synthetic original.pdf',
    chunkIndex: index, text: `Original teaching point ${index + 1}: use its own explicitly stated condition.` }));
  const evidence = sections.map((section, index) => ({ id: `E${index + 1}`, objective: `Apply teaching point ${index + 1}`,
    materialId, materialName: section.materialName, chunkIndex: section.chunkIndex, quote: section.text }));
  const themes = [{ name: 'Synthetic taught applications', los: evidence.map(point => ({ name: point.objective,
    evidenceIds: [point.id], materialIds: [materialId] })) }];
  const body: StructureReviewCheckpointBody = {
    version: 'exact-outline-review-v1', courseId: '000000000000000000000002', rootRunId: '000000000000000000000003',
    origin: 'retained-artifact-import-v1', options: { materialIds: [materialId] },
    corpus: { sections, fingerprint: 'synthetic-exact-source-fingerprint', materials: [{ materialId, name: 'Synthetic original.pdf',
      chunks: count, sections: count, sourceTextHash: hash(sections), parserVersion: 'parser-v1', chunkerVersion: 'chunker-v1' }],
      sourceSelection: { ready: true, requested: [], included: [], excluded: [] } },
    themes, evidence, extractions: sections.map(section => ({ sectionId: section.id, reused: true,
      row: { sectionId: section.id, objectives: [{ name: 'Apply the exact condition', passageId: `${section.id}.P1`, quote: section.text }], knowledge: [] } })),
    excludedSections: [], cache: { hits: count, misses: 0, reusedSections: count, extractedSections: 0 },
    batches: planOutlineGrounding(themes, evidence, sections, 48000), reviewInputLimit: 48000,
    model: { model: 'gpt-6.1-sol', modelSource: 'override', reasoningEffort: 'medium' },
    providerIdentityHash: hash('synthetic-provider'), protocolHash: outlineGroundingProtocolHash(),
    baseBudget: { version: 1, estimator: 'utf8-bytes-conservative-v1', retryVisibility: 'unknown', limitScope: 'process',
      observedSends: 20, estimatedInputTokens: 804330, reservedOutputTokens: 200000, accounting: 'conservative-reservations-v1',
      admissionTokens: 1004330, pendingSends: 0, reportedInputTokens: null, reportedOutputTokens: null,
      usageCompleteness: 'unknown', queueWaitMs: 0, executionMs: 0, rejectedSends: 0,
      logical: { generatorAttempts: 0, repairCycles: 0, evidenceExpansions: 0, limits: { generatorAttempts: 1, repairCycles: 1, evidenceExpansions: 1 } },
      limits: { maxSends: 100, maxInputTokens: 48000, maxOutputTokens: 6000, maxEstimatedTokens: 2000000 } },
  };
  const expected = body.batches.flatMap(batch => batch.objectives);
  const correctedId = fullHistoricalShape ? 'L96' : 'L4';
  const parentIds = fullHistoricalShape ? expected.slice(0, 103).map(row => row.id).filter(id => id !== correctedId) : ['L1', 'L2', 'L3'];
  const parentFindings = parentIds.map((id, index) => {
    const batch = body.batches.find(row => row.objectives.some(objective => objective.id === id))!;
    const objective = expected.find(row => row.id === id)!;
    const negative = fullHistoricalShape ? index >= 82 : index === 2;
    const raw = { reviews: [{ id, sourceStatus: negative ? 'unsupported' : 'supported', sourceIds: objective.sourceIds,
      coveredEvidenceIds: objective.evidenceIds, sourceReason: negative ? 'The final wording adds an untaught condition.' : 'The original explicitly teaches this application.',
      topicFit: 'fits', topicReason: 'This heading groups the exact original applications.' }] };
    const canonical = validateOutlineGroundingRows(raw, selectOutlineGroundingBatch(batch, [id])).findings[0]!;
    if (negative) {
      // Reproduce the historical v2 negative shape without changing its verdict.
      canonical.coveredEvidenceIds = fullHistoricalShape && index === 101 ? [] : [...objective.evidenceIds];
      delete canonical.ignoredModelCoverage;
    }
    return canonical;
  });
  const owner = body.batches.find(batch => batch.objectives.some(row => row.id === correctedId))!;
  const correctedBatch = selectOutlineGroundingBatch(owner, [correctedId]);
  const raw = { reviews: [{ id: correctedId, sourceStatus: 'unsupported', sourceIds: correctedBatch.objectives[0]!.sourceIds,
    coveredEvidenceIds: correctedBatch.objectives[0]!.evidenceIds, sourceReason: 'The original does not establish the added capability.',
    topicFit: 'fits', topicReason: 'The heading does not supply the missing capability.' }] };
  return { body, authority: { parentRunId: body.rootRunId, parentCourseId: body.courseId, terminalStatus: 'failed', parentFindings,
    parentFindingHashes: parentFindings.map(finding => ({ id: finding.id, hash: hash(finding) })),
    parentExpectedIds: expected.map(row => row.id), parentAttempts: Object.fromEntries(parentIds.map((id, index) => [id, index % 5 === 0 ? 2 : 1])),
    corrected: { raw, rawSha256: hash(raw), batch: correctedBatch, consumedAttempts: 2 },
    expectedParentCount: parentFindings.length, manifestHash: hash('synthetic-server-authenticated-manifest') } };
}

it('projects synthetic 142/102 controls into 103 resolved and 39 pending without claiming live proof', () => {
  const { body, authority } = fixture(true); const oldBytes = authority.parentFindings.map(row => JSON.stringify(row));
  const result = projectRetainedStructureReviews(body, authority);
  expect(result.findings).toHaveLength(103);
  expect(authority.parentExpectedIds.filter(id => !result.findings.some(row => row.id === id))).toHaveLength(39);
  expect(result.findings.filter(row => row.status === 'supported')).toHaveLength(82);
  expect(result.findings.filter(row => row.status !== 'supported')).toHaveLength(21);
  expect(result.attempts.L96).toBe(2);
  for (const [index, original] of authority.parentFindings.entries()) {
    expect(JSON.stringify(result.authority.originalFindings[index])).toBe(oldBytes[index]);
    expect(hash(result.authority.originalFindings[index])).toBe(authority.parentFindingHashes[index]!.hash);
    if (original.status === 'supported') expect(JSON.stringify(result.findings.find(row => row.id === original.id))).toBe(oldBytes[index]);
    expect(result.attempts[original.id]).toBe(authority.parentAttempts[original.id]);
  }
  expect(result.findings.filter(row => row.status !== 'supported').every(row => row.coveredEvidenceIds.length === 0)).toBe(true);
  expect(result.findings.find(row => row.id === 'L96')!.ignoredModelCoverage?.authoritative).toBe(false);
});

it.each(['course', 'run', 'nonterminal', 'unlabelled-origin', 'protocol', 'manifest'])('rejects %s authority changes', defect => {
  const { body, authority } = fixture();
  if (defect === 'course') authority.parentCourseId = '000000000000000000000099';
  if (defect === 'run') authority.parentRunId = '000000000000000000000099';
  if (defect === 'nonterminal') Object.assign(authority, { terminalStatus: 'running' });
  if (defect === 'unlabelled-origin') body.origin = 'production-proposal-v1';
  if (defect === 'protocol') body.protocolHash = hash('incompatible-v1-semantics');
  if (defect === 'manifest') authority.manifestHash = 'not-a-manifest-hash';
  expect(() => projectRetainedStructureReviews(body, authority)).toThrow(/structure-review-retained-(parent-identity|manifest-or-protocol)/);
});

it.each(['caller-count', 'missing-pin', 'changed-pin', 'duplicate-id', 'full-id-order', 'proposal-binding'])('rejects %s instead of trusting numeric counts', defect => {
  const { body, authority } = fixture();
  if (defect === 'caller-count') authority.expectedParentCount = 1;
  if (defect === 'missing-pin') authority.parentFindingHashes.pop();
  if (defect === 'changed-pin') authority.parentFindingHashes[0]!.hash = hash('another-parent-row');
  if (defect === 'duplicate-id') { authority.parentFindings[1] = structuredClone(authority.parentFindings[0]!);
    authority.parentFindingHashes[1] = { id: authority.parentFindings[1]!.id, hash: hash(authority.parentFindings[1]) }; }
  if (defect === 'full-id-order') authority.parentExpectedIds.reverse();
  if (defect === 'proposal-binding') body.batches[0]!.objectives[0]!.contentHash = hash('another-binding');
  expect(() => projectRetainedStructureReviews(body, authority)).toThrow();
});

it.each(['wording', 'content-hash', 'own-source-binding', 'positive-coverage', 'positive-source', 'extra-field'])('rejects pinned parent %s tampering against reconstructed originals', defect => {
  const { body, authority } = fixture(); const row = authority.parentFindings[0]!;
  if (defect === 'wording') row.name = 'An unreviewed advanced capability';
  if (defect === 'content-hash') row.contentHash = hash('another-proposal');
  if (defect === 'own-source-binding') row.sourceIds = ['S2'];
  if (defect === 'positive-coverage') row.coveredEvidenceIds = [];
  if (defect === 'positive-source') row.citedSourceIds = ['S2'];
  if (defect === 'extra-field') Object.assign(row, { trustedModelProof: true });
  authority.parentFindingHashes[0]!.hash = hash(row);
  expect(() => projectRetainedStructureReviews(body, authority)).toThrow();
});

it.each(['missing', 'zero', 'extra', 'third-attempt'])('refuses %s historical attempt metadata', defect => {
  const { body, authority } = fixture();
  if (defect === 'missing') delete authority.parentAttempts.L1;
  if (defect === 'zero') authority.parentAttempts.L1 = 0;
  if (defect === 'extra') authority.parentAttempts['L-foreign'] = 1;
  if (defect === 'third-attempt') authority.parentAttempts.L1 = 3;
  expect(() => projectRetainedStructureReviews(body, authority)).toThrow('structure-review-retained-parent-attempts');
});

it.each(['raw-hash', 'reset-attempt', 'positive-verdict', 'foreign-source', 'changed-binding', 'resolved-id'])('rejects correction %s changes', defect => {
  const { body, authority } = fixture();
  const raw = authority.corrected.raw as { reviews: Array<{ id: string; sourceStatus: string; sourceIds: string[] }> };
  if (defect === 'raw-hash') authority.corrected.rawSha256 = hash('another-response');
  if (defect === 'reset-attempt') authority.corrected.consumedAttempts = 1;
  if (defect === 'positive-verdict') raw.reviews[0]!.sourceStatus = 'supported';
  if (defect === 'foreign-source') raw.reviews[0]!.sourceIds = ['S-foreign'];
  if (defect === 'changed-binding') authority.corrected.batch.objectives[0]!.contentHash = hash('another-binding');
  if (defect === 'resolved-id') authority.corrected.batch.objectives[0]!.id = 'L1';
  if (defect !== 'raw-hash') authority.corrected.rawSha256 = hash(authority.corrected.raw);
  expect(() => projectRetainedStructureReviews(body, authority)).toThrow();
});

it('rejects pending or retrospectively settled parent budget state', () => {
  for (const defect of ['pending', 'settled']) {
    const { body, authority } = fixture();
    if (defect === 'pending') body.baseBudget.pendingSends = 1;
    else body.baseBudget.accounting = 'reported-usage-settlement-v1';
    expect(() => projectRetainedStructureReviews(body, authority)).toThrow('structure-review-retained-parent-budget');
  }
});

it('preserves original input bytes and returns detached retained rows and attempt maps', () => {
  const { body, authority } = fixture(); const originalBody = JSON.stringify(body); const originalAuthority = JSON.stringify(authority);
  const result = projectRetainedStructureReviews(body, authority);
  result.authority.originalFindings[0]!.reason = 'Changed in caller memory'; result.findings[0]!.name = 'Changed in caller memory';
  result.attempts.L1 = 99;
  expect(JSON.stringify(body)).toBe(originalBody); expect(JSON.stringify(authority)).toBe(originalAuthority);
});
