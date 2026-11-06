jest.mock('../../server/src/components/mongodb/collections', () => Object.fromEntries([
  'contentRunsCol', 'coursesCol', 'structureReviewCheckpointsCol', 'structureReviewProgressCol', 'structureReviewAttemptsCol',
].map(name => [name, jest.fn(() => { throw new Error('Database access is forbidden in pure checkpoint tests.'); })])));
jest.mock('../../server/src/services/authoring-commit.service', () => ({
  authoringCollection: jest.fn(() => { throw new Error('Database access is forbidden in pure checkpoint tests.'); }),
  withCourseAuthoringWrite: jest.fn(() => { throw new Error('Database access is forbidden in pure checkpoint tests.'); }),
}));
jest.mock('../../server/src/services/content-runs.service', () => Object.fromEntries([
  'assertContentRunActive', 'createStructureGenerationRun', 'getContentRun', 'updateContentRun',
].map(name => [name, jest.fn(() => { throw new Error('Run mutation is forbidden in pure checkpoint tests.'); })])));
jest.mock('../../server/src/components/genai/llm', () => ({
  completeJson: jest.fn(() => { throw new Error('Model calls are forbidden in pure checkpoint tests.'); }),
}));

import { planOutlineGrounding, outlineGroundingProtocolHash, validateOutlineGroundingRows } from '../../server/src/services/structure-outline-grounding';
import { createStructureReviewContinuation, getStructureReviewProgress, reserveStructureReviewSend, sameProjectedStructureFinding, structureReviewHash, validateCheckpointFinding, validateStructureReviewCheckpoint } from '../../server/src/services/structure-review-checkpoint.service';
import type { StructureReviewCheckpointBody, StructureReviewProgress } from '../../server/src/types/structure-review';
import { planCapabilityOutlineGrounding, selectCapabilityOutlineGroundingBatch, structureOutlineReviewProtocolHash,
  validateCapabilityOutlineGroundingRows, type CapabilityOutlineGroundingBatch } from '../../server/src/services/structure-capability-grounding';
import { BSON, ObjectId } from 'mongodb';
import { contentRunsCol, coursesCol, structureReviewCheckpointsCol, structureReviewProgressCol, structureReviewAttemptsCol } from '../../server/src/components/mongodb/collections';
import { authoringCollection, withCourseAuthoringWrite } from '../../server/src/services/authoring-commit.service';
import { assertContentRunActive, createStructureGenerationRun, getContentRun } from '../../server/src/services/content-runs.service';
import { completeJson } from '../../server/src/components/genai/llm';

function fixture(): StructureReviewCheckpointBody {
  const materialIds = ['000000000000000000000001', '000000000000000000000002'];
  const sections = materialIds.map((materialId, index) => ({ id: `section-${index + 1}`, materialId, materialName: `Chapter ${index + 1}.pdf`,
    chunkIndex: 0, text: `The original formula F = ma applies under condition ${index + 1}.` }));
  const evidence = sections.map((section, index) => ({ id: `E${index + 1}`, objective: `Apply formula under condition ${index + 1}`,
    materialId: section.materialId, materialName: section.materialName, chunkIndex: section.chunkIndex, quote: section.text }));
  const themes = [{ name: 'Taught applications', los: evidence.map(point => ({ name: point.objective,
    evidenceIds: [point.id], materialIds: [point.materialId] })) }];
  return {
    version: 'exact-outline-review-v1', courseId: '000000000000000000000003', rootRunId: '000000000000000000000004',
    origin: 'production-proposal-v1', options: { materialIds },
    corpus: { sections, fingerprint: 'original-ingest-and-selection-fingerprint',
      materials: sections.map(section => ({ materialId: section.materialId, name: section.materialName, chunks: 1, sections: 1,
        sourceTextHash: structureReviewHash(section.text), parserVersion: 'parser-v1', chunkerVersion: 'chunker-v1' })),
      sourceSelection: { ready: true, requested: sections.map(section => ({ materialId: section.materialId,
        name: section.materialName, ready: true, state: 'indexed', classification: 'pending' })),
        included: sections.map(section => ({ materialId: section.materialId, name: section.materialName,
          sourceTextHash: structureReviewHash(section.text), chunkCount: 1, characterCount: section.text.length,
          parserVersion: 'parser-v1', chunkerVersion: 'chunker-v1', revision: 1 })),
        excluded: [], sourceBatchId: '000000000000000000000005' },
    },
    themes, evidence,
    extractions: sections.map(section => ({ sectionId: section.id, reused: true, row: { sectionId: section.id,
      objectives: [{ name: 'Apply the stated formula', passageId: `${section.id}.P1`, quote: section.text }], knowledge: [] } })),
    excludedSections: [], cache: { hits: 2, misses: 0, reusedSections: 2, extractedSections: 0 },
    batches: planOutlineGrounding(themes, evidence, sections, 48000), reviewInputLimit: 48000,
    model: { model: 'gpt-6.1-sol', modelSource: 'override', reasoningEffort: 'medium' },
    providerIdentityHash: 'frozen-provider-identity-hash', protocolHash: outlineGroundingProtocolHash(),
    baseBudget: { version: 1, estimator: 'utf8-bytes-conservative-v1', retryVisibility: 'unknown', limitScope: 'process',
      observedSends: 20, estimatedInputTokens: 800000, reservedOutputTokens: 200000, accounting: 'conservative-reservations-v1',
      admissionTokens: 1000000, pendingSends: 0, reportedInputTokens: 100000, reportedOutputTokens: 20000,
      usageCompleteness: 'complete', queueWaitMs: 0, executionMs: 1000, rejectedSends: 0,
      logical: { generatorAttempts: 0, repairCycles: 0, evidenceExpansions: 0, limits: { generatorAttempts: 1, repairCycles: 1, evidenceExpansions: 1 } },
      limits: { maxSends: 100, maxInputTokens: 48000, maxOutputTokens: 6000, maxEstimatedTokens: 2000000 } },
  };
}

function findings(body: StructureReviewCheckpointBody, negative = false, includeIgnoredClaims = false) {
  const batch = body.batches[0]!;
  return validateOutlineGroundingRows({ reviews: batch.objectives.map(objective => ({ id: objective.id,
    sourceStatus: negative ? 'uncertain' : 'supported', sourceIds: [...objective.sourceIds],
    coveredEvidenceIds: negative && !includeIgnoredClaims ? [] : [...objective.evidenceIds],
    sourceReason: negative ? 'The required condition is not clearly readable.' : 'The original explicitly teaches the stated condition.',
    topicFit: 'fits', topicReason: 'The topic groups these exact source applications.' })) }, batch).findings;
}

function reorderedPackingBody(): StructureReviewCheckpointBody {
  const body = fixture();
  const materialIds = ['000000000000000000000011', '000000000000000000000012', '000000000000000000000013'];
  const sections = materialIds.map((materialId, index) => ({ id: `packed-source-${index + 1}`, materialId,
    materialName: `Packed chapter ${index + 1}.pdf`, chunkIndex: 0,
    text: `Source ${index + 1}: dividends reduce equity value; expected appreciation equals equity return less dividend yield.\n`
      + 'Complete original teaching conditions. '.repeat(64) }));
  body.evidence = Array.from({ length: 10 }, (_, index) => {
    const source = sections[index % sections.length];
    return { id: `E${index + 1}`, objective: `Assess taught financing operation ${index + 1} from chapter ${index % 3 + 1}.`,
      materialId: source.materialId, materialName: source.materialName, chunkIndex: 0, quote: source.text };
  });
  body.themes = body.evidence.map((point, index) => ({ name: `Topic ${index + 1}`, los: [{
    name: `Assess financing operation ${index + 1} using the stated chapter ${index % 3 + 1} conditions.`,
    evidenceIds: [point.id], materialIds: [point.materialId],
  }] }));
  body.options = { materialIds, capabilityDistinctnessProtocol: 'outline-capability-distinctness-v1' };
  body.corpus.sections = sections; body.corpus.fingerprint = 'ten-objective-source-overlap-checkpoint';
  body.corpus.materials = sections.map(source => ({ materialId: source.materialId, name: source.materialName, chunks: 1, sections: 1,
    sourceTextHash: structureReviewHash(source.text), parserVersion: 'parser-v1', chunkerVersion: 'chunker-v1' }));
  body.corpus.sourceSelection = { ready: true, requested: [], excluded: [], included: sections.map(source => ({
    materialId: source.materialId, name: source.materialName, sourceTextHash: structureReviewHash(source.text), chunkCount: 1,
    characterCount: source.text.length, parserVersion: 'parser-v1', chunkerVersion: 'chunker-v1', revision: 1,
  })) };
  body.extractions = sections.map(source => ({ sectionId: source.id, reused: true, row: { sectionId: source.id,
    objectives: [{ name: 'Scripted taught financing operations', passageId: `${source.id}.P1`, quote: source.text }], knowledge: [] } }));
  body.reviewInputLimit = 16000; body.protocolHash = structureOutlineReviewProtocolHash(body.options.capabilityDistinctnessProtocol);
  body.batches = planCapabilityOutlineGrounding(body.themes, body.evidence, sections, body.reviewInputLimit, body.options.capabilityDistinctnessProtocol);
  return body;
}

it('reconstructs a BSON checkpoint with deliberately noncontiguous review groups while preserving global objective coordinates', () => {
  const original = reorderedPackingBody();
  const scheduled = original.batches.flatMap(batch => batch.objectives.map(row => row.id));
  expect(scheduled).not.toEqual(Array.from({ length: 10 }, (_, index) => `L${index + 1}`));
  expect(original.batches.some(batch => batch.objectives.some((row, index, rows) =>
    index > 0 && Number(row.id.slice(1)) - Number(rows[index - 1].id.slice(1)) > 1))).toBe(true);
  const body = BSON.deserialize(BSON.serialize(original)) as StructureReviewCheckpointBody;
  expect(() => validateStructureReviewCheckpoint(body, structuredClone(body.corpus))).not.toThrow();
  for (const value of body.batches) {
    const batch = selectCapabilityOutlineGroundingBatch(value, value.objectives.map(row => row.id)) as CapabilityOutlineGroundingBatch;
    const context = batch.capabilityContext;
    const raw = { reviews: batch.objectives.map(row => ({ id: row.id, sourceStatus: 'supported', sourceIds: row.sourceIds,
      coveredEvidenceIds: row.evidenceIds, sourceReason: 'Scripted exact-source support.', topicFit: 'fits', topicReason: 'Scripted topic organization.' })),
    capabilityComparisons: context.nominations.flatMap(nomination => nomination.peerIds.map(peerId => {
      const own = context.objectives.find(row => row.id === nomination.objectiveId)!;
      const peer = context.objectives.find(row => row.id === peerId)!;
      const quote = (row: typeof own) => [{ sourceId: row.sourceIds[0], quote: context.sources.find(source => source.alias === row.sourceIds[0])!.text }];
      return { objectiveId: own.id, peerId, pairId: context.pairs.find(pair =>
        [pair.firstId, pair.secondId].includes(own.id) && [pair.firstId, pair.secondId].includes(peerId))!.id,
      relation: 'distinct', candidateOperation: own.name, peerOperation: peer.name, sharedCapabilities: [],
      candidateUniqueCapabilities: [{ operation: own.name, quotes: quote(own) }], peerUniqueCapabilities: [{ operation: peer.name, quotes: quote(peer) }],
      reason: 'Scripted operation labels test coordinate binding, not semantic distinctness.' };
    })) };
    const checked = validateCapabilityOutlineGroundingRows(raw, batch);
    expect(checked.failures).toEqual([]);
    for (const finding of checked.findings) {
      expect(finding.id).toBe(`L${finding.themeIndex + 1}`); expect(finding.loIndex).toBe(0);
      expect(() => validateCheckpointFinding(body, finding)).not.toThrow();
    }
  }
  expect(body.themes).toEqual(original.themes);
  const swapped = structuredClone(body); [swapped.batches[0], swapped.batches[1]] = [swapped.batches[1], swapped.batches[0]];
  expect(() => validateStructureReviewCheckpoint(swapped)).toThrow('structure-review-binding-changed');
});

it('replays the explicit capability checkpoint from its lazy storage and denies removed comparison authority', () => {
  const body = fixture(); body.themes[0].los = [body.themes[0].los[0]];
  body.options.capabilityDistinctnessProtocol = 'outline-capability-distinctness-v1';
  body.protocolHash = structureOutlineReviewProtocolHash(body.options.capabilityDistinctnessProtocol);
  body.batches = planCapabilityOutlineGrounding(body.themes, body.evidence, body.corpus.sections,
    body.reviewInputLimit, body.options.capabilityDistinctnessProtocol);
  expect(body.batches.every(row => row.prompt === '' && row.sources.length === 0)).toBe(true);
  expect(() => validateStructureReviewCheckpoint(body)).not.toThrow();
  const batch = selectCapabilityOutlineGroundingBatch(body.batches[0], ['L1']);
  const original = batch.objectives[0];
  const checked = validateCapabilityOutlineGroundingRows({ reviews: [{ id: original.id, sourceStatus: 'supported',
    sourceIds: original.sourceIds, coveredEvidenceIds: original.evidenceIds, sourceReason: 'Scripted original-source verdict.',
    topicFit: 'fits', topicReason: 'The source-backed operation fits this topic.' }], capabilityComparisons: [] }, batch);
  expect(checked.failures).toEqual([]);
  expect(() => validateCheckpointFinding(body, checked.findings[0])).not.toThrow();
  delete checked.findings[0].capabilityComparisons;
  expect(() => validateCheckpointFinding(body, checked.findings[0])).toThrow('structure-review-finding-changed');
});

it('refuses a capability checkpoint that drops its selector or injects a duplicate cached source/prompt representation', () => {
  const body = fixture(); body.options.capabilityDistinctnessProtocol = 'outline-capability-distinctness-v1';
  body.protocolHash = structureOutlineReviewProtocolHash(body.options.capabilityDistinctnessProtocol);
  body.batches = planCapabilityOutlineGrounding(body.themes, body.evidence, body.corpus.sections,
    body.reviewInputLimit, body.options.capabilityDistinctnessProtocol);
  const changed = structuredClone(body); delete changed.options.capabilityDistinctnessProtocol;
  expect(() => validateStructureReviewCheckpoint(changed)).toThrow('structure-review-protocol-changed');
  const send = selectCapabilityOutlineGroundingBatch(body.batches[0], body.batches[0].objectives.map(row => row.id));
  body.batches[0].prompt = send.prompt; body.batches[0].sources = send.sources;
  expect(() => validateStructureReviewCheckpoint(body)).toThrow('structure-review-binding-changed');
});

afterEach(() => {
  // The new producer group deliberately uses in-memory collection adapters;
  // its own assertions distinguish permitted fixture writes from model calls.
  // Preserve the stronger no-adapter-call guarantee for every pure test above.
  if (expect.getState().currentTestName?.startsWith('continuation producer budget ceiling coherence')) return;
  for (const modulePath of [
    '../../server/src/components/mongodb/collections', '../../server/src/services/authoring-commit.service',
    '../../server/src/services/content-runs.service', '../../server/src/components/genai/llm',
  ]) {
    const exports = jest.requireMock(modulePath) as Record<string, jest.Mock>;
    for (const mock of Object.values(exports)) expect(mock).not.toHaveBeenCalled();
  }
});

it('reconstructs exact current bindings without mutating the checkpoint or accessing any service', () => {
  const body = fixture(); const original = JSON.stringify(body);
  expect(() => validateStructureReviewCheckpoint(body, structuredClone(body.corpus))).not.toThrow();
  for (const finding of findings(body)) expect(() => validateCheckpointFinding(body, finding)).not.toThrow();
  expect(JSON.stringify(body)).toBe(original);
});

it.each(['version', 'course', 'root-run', 'protocol'])('rejects changed %s identity before review', defect => {
  const body = fixture();
  if (defect === 'version') Object.assign(body, { version: 'historical-protocol' });
  if (defect === 'course') body.courseId = 'not-an-object-id';
  if (defect === 'root-run') body.rootRunId = 'not-an-object-id';
  if (defect === 'protocol') body.protocolHash = 'foreign-semantic-protocol';
  expect(() => validateStructureReviewCheckpoint(body)).toThrow(/structure-review-(checkpoint-version|protocol-changed)/);
});

it.each(['fingerprint', 'original-text', 'source-order', 'source-reingest', 'replaced-material'])('rejects current corpus %s changes', defect => {
  const body = fixture(); const current = structuredClone(body.corpus);
  if (defect === 'fingerprint') current.fingerprint = 'another-current-snapshot';
  if (defect === 'original-text') current.sections[0]!.text += ' New unreviewed source conditions.';
  if (defect === 'source-order') current.sections.reverse();
  if (defect === 'source-reingest') current.materials[0]!.parserVersion = 'parser-v2';
  if (defect === 'replaced-material') current.materials[0]!.materialId = '000000000000000000000099';
  expect(() => validateStructureReviewCheckpoint(body, current)).toThrow('structure-review-source-changed');
});

it.each(['proposal-wording', 'source-alias', 'objective-content-hash', 'omitted-objective'])('rejects changed %s bindings instead of regenerating them', defect => {
  const body = fixture();
  if (defect === 'proposal-wording') body.themes[0]!.los[0]!.name = 'Apply an unreviewed advanced technique';
  if (defect === 'source-alias') body.batches[0]!.sources[0]!.alias = 'S-foreign';
  if (defect === 'objective-content-hash') body.batches[0]!.objectives[0]!.contentHash = 'forged';
  if (defect === 'omitted-objective') body.batches[0]!.objectives.pop();
  expect(() => validateStructureReviewCheckpoint(body)).toThrow('structure-review-binding-changed');
});

it.each(['intended-batch', 'exclusion', 'replacement', 'included-original', 'requested-identity'])('rejects changed selection %s even with an unchanged corpus fingerprint', defect => {
  const body = fixture(); const current = structuredClone(body.corpus);
  if (defect === 'intended-batch') current.sourceSelection.sourceBatchId = '000000000000000000000088';
  if (defect === 'exclusion') current.sourceSelection.excluded.push({ name: 'New excluded chapter', reason: 'An explicit changed selection' });
  if (defect === 'replacement') current.sourceSelection.replacements = [{ previousMaterialId: '000000000000000000000001',
    replacementMaterialId: '000000000000000000000088', previousName: 'Chapter 1.pdf', replacementName: 'Replacement Chapter 1.pdf' }];
  if (defect === 'included-original') current.sourceSelection.included[0]!.sourceTextHash = 'different-original';
  if (defect === 'requested-identity') current.sourceSelection.requested[0]!.materialId = '000000000000000000000088';
  expect(() => validateStructureReviewCheckpoint(body, current)).toThrow('structure-review-source-changed');
});

it('allows advisory-only metadata revisions and classification changes while original selection stays exact', () => {
  const body = fixture(); const current = structuredClone(body.corpus);
  current.sourceSelection.included[0]!.revision = 9;
  current.sourceSelection.requested[0]!.classification = 'completed';
  expect(() => validateStructureReviewCheckpoint(body, current)).not.toThrow();
});

it.each(['missing', 'duplicate'])('refuses %s extraction-section identities', defect => {
  const body = fixture();
  if (defect === 'missing') body.extractions.pop();
  else body.extractions[1]!.sectionId = body.extractions[0]!.sectionId;
  expect(() => validateStructureReviewCheckpoint(body)).toThrow('structure-review-extraction-incomplete');
});

it.each(['pending', 'settled-accounting'])('refuses a %s base budget instead of resetting cumulative cost', defect => {
  const body = fixture();
  if (defect === 'pending') body.baseBudget.pendingSends = 1;
  else body.baseBudget.accounting = 'reported-usage-settlement-v1';
  expect(() => validateStructureReviewCheckpoint(body)).toThrow('structure-review-budget-not-terminal-conservative');
});

it('binds model, provider, options and protocol identity into immutable body hashes', () => {
  const body = fixture(); const hash = structureReviewHash(body);
  for (const change of ['model', 'effort', 'provider', 'options', 'protocol']) {
    const changed = structuredClone(body);
    if (change === 'model') changed.model.model = 'another-model';
    if (change === 'effort') changed.model.reasoningEffort = 'high';
    if (change === 'provider') changed.providerIdentityHash = 'another-provider-identity';
    if (change === 'options') changed.options.guidance = 'A different explicit authoring request';
    if (change === 'protocol') changed.protocolHash = 'another-review-protocol';
    expect(structureReviewHash(changed)).not.toBe(hash);
  }
  expect(structureReviewHash(body)).toBe(hash);
});

it.each(['identity', 'content-hash', 'wording', 'source', 'empty-positive-source', 'foreign-coverage', 'empty-positive-coverage'])('rejects positive finding %s tampering', defect => {
  const body = fixture(); const finding = findings(body)[0]!;
  if (defect === 'identity') finding.id = 'foreign-objective';
  if (defect === 'content-hash') finding.contentHash = 'another-content-hash';
  if (defect === 'wording') finding.name = 'An unreviewed objective';
  if (defect === 'source') finding.citedSourceIds = ['S2'];
  if (defect === 'empty-positive-source') finding.citedSourceIds = [];
  if (defect === 'foreign-coverage') finding.coveredEvidenceIds = ['E2'];
  if (defect === 'empty-positive-coverage') finding.coveredEvidenceIds = [];
  expect(() => validateCheckpointFinding(body, finding)).toThrow(/structure-review-finding-(identity|changed)/);
});

it('retains exact canonical negative findings and marks ignored model claims non-authoritative', () => {
  const body = fixture(); const finding = findings(body, true, true)[0]!;
  const original = JSON.stringify(finding);
  expect(finding.coveredEvidenceIds).toEqual([]);
  expect(finding.ignoredModelCoverage).toEqual({ authoritative: false, reason: 'negative-source-verdict', evidenceIds: ['E1'] });
  expect(() => validateCheckpointFinding(body, finding)).not.toThrow();
  expect(JSON.stringify(finding)).toBe(original);
});

it.each(['credited-negative', 'authoritative-ignored', 'foreign-ignored', 'positive-ignored'])('rejects %s coverage without promoting diagnostics to support', defect => {
  const body = fixture(); const finding = findings(body, true, true)[0]!;
  if (defect === 'credited-negative') finding.coveredEvidenceIds = ['E1'];
  if (defect === 'authoritative-ignored') Object.assign(finding.ignoredModelCoverage!, { authoritative: true });
  if (defect === 'foreign-ignored') finding.ignoredModelCoverage!.evidenceIds = ['E2'];
  if (defect === 'positive-ignored') { finding.status = 'supported'; finding.coveredEvidenceIds = ['E1']; }
  expect(() => validateCheckpointFinding(body, finding)).toThrow('structure-review-finding-changed');
});

it('compares projected negative content independent of object-key insertion order while raw hashes remain byte-bound', () => {
  const body = fixture(); const finding = findings(body, true, true)[0]!;
  const reordered = Object.fromEntries(Object.entries(finding).reverse()) as typeof finding;
  expect(sameProjectedStructureFinding(finding, reordered)).toBe(true);
  expect(structureReviewHash(finding)).not.toBe(structureReviewHash(reordered));
  expect(() => validateCheckpointFinding(body, finding)).not.toThrow();
});

it.each(['reason', 'coverage', 'sourceIds', 'array-order'])('does not ignore projected negative %s changes', defect => {
  const body = fixture(); const finding = findings(body, true, true)[0]!;
  if (defect === 'array-order') finding.sourceIds = ['S1', 'S2'];
  const changed = structuredClone(finding);
  if (defect === 'reason') changed.reason = 'A different unreviewed semantic verdict';
  if (defect === 'coverage') changed.coveredEvidenceIds = ['E1'];
  if (defect === 'sourceIds') changed.sourceIds = ['S2'];
  if (defect === 'array-order') changed.sourceIds.reverse();
  expect(sameProjectedStructureFinding(finding, changed)).toBe(false);
});

describe('continuation producer budget ceiling coherence (portable mocked storage)', () => {
  function setup(recover = false) {
    jest.clearAllMocks();
    const body = fixture(), parentId = new ObjectId(body.rootRunId), course = new ObjectId(body.courseId), checkpointId = new ObjectId(), childId = new ObjectId();
    const checkpoint = { _id: checkpointId, courseId: course, runId: parentId, hash: structureReviewHash(body), body, createdAt: new Date() };
    const receipt = BSON.deserialize(BSON.serialize(body.baseBudget)) as typeof body.baseBudget;
    const parent = { _id: parentId, courseId: course, kind: 'structure-generation', status: 'failed',
      structureReview: { checkpointId, checkpointHash: checkpoint.hash }, structureDiagnostics: { budget: receipt } };
    const child = { _id: childId, courseId: course, kind: 'structure-generation' };
    const progress: StructureReviewProgress = { courseId: course, checkpointId, checkpointHash: checkpoint.hash,
      ownerRunId: recover ? childId : parentId, revision: 0, findings: [], attempts: {}, failures: [], unresolvedDispatchIds: [],
      usedTokens: 1000000, reservations: 20, pendingNative: [], maxTokens: 2000000, maxSends: 100, updatedAt: new Date(),
      ...(recover ? { continuationRunId: childId, continuationStartReservations: 20, continuationBaseBudget: structuredClone(receipt) } : {}) };
    const write = jest.fn(async (_filter: unknown, _update: unknown) => ({ modifiedCount: 1 })), attemptedRecovery = jest.fn(() => ({ toArray: async () => [] }));
    const nativeWrite = jest.fn(async (_filter: unknown, update: { $set: Partial<StructureReviewProgress> }) => { Object.assign(progress, update.$set); return progress; });
    jest.mocked(structureReviewCheckpointsCol).mockReturnValue({ findOne: async () => checkpoint } as never);
    jest.mocked(structureReviewProgressCol).mockReturnValue({ findOne: async () => progress, updateOne: write, findOneAndUpdate: nativeWrite } as never);
    jest.mocked(structureReviewAttemptsCol).mockReturnValue({ find: attemptedRecovery } as never);
    jest.mocked(coursesCol).mockReturnValue({ findOne: async () => ({ _id: course }) } as never);
    jest.mocked(contentRunsCol).mockReturnValue({ findOne: async () => null } as never);
    jest.mocked(authoringCollection).mockImplementation(value => value);
    jest.mocked(withCourseAuthoringWrite).mockImplementation(async (_id, work) => work());
    jest.mocked(getContentRun).mockImplementation(async id => (id.equals(parentId) ? parent : child) as never);
    jest.mocked(createStructureGenerationRun).mockResolvedValue(child as never);
    jest.mocked(assertContentRunActive).mockResolvedValue();
    const refreshHash = () => { checkpoint.hash = structureReviewHash(body); parent.structureReview.checkpointHash = checkpoint.hash; progress.checkpointHash = checkpoint.hash; };
    return { body, receipt, parentId, childId, checkpoint, progress, write, nativeWrite, attemptedRecovery, refreshHash };
  }
  const noWrites = (row: ReturnType<typeof setup>) => {
    expect(row.write).not.toHaveBeenCalled(); expect(createStructureGenerationRun).not.toHaveBeenCalled(); expect(completeJson).not.toHaveBeenCalled();
  };

  it.each([false, true])('rejects diagnostic256 against immutable100 before child persistence/recovery (recover=%s)', async recover => {
    const row = setup(recover); row.receipt.limits.maxSends = 256;
    await expect(createStructureReviewContinuation(row.parentId, 'scripted', async () => {})).rejects.toThrow('structure-review-budget-limits-changed');
    expect(row.receipt.limits.maxSends).toBe(256); expect(row.progress.maxSends).toBe(100); noWrites(row);
  });

  it('rejects the reverse100 diagnostic against immutable256 without rewriting either ceiling', async () => {
    const row = setup(); row.body.baseBudget.limits.maxSends = 256; row.progress.maxSends = 256; row.refreshHash();
    await expect(createStructureReviewContinuation(row.parentId, 'scripted', async () => {})).rejects.toThrow('structure-review-budget-limits-changed');
    expect(row.receipt.limits.maxSends).toBe(100); expect(row.progress.maxSends).toBe(256); noWrites(row);
  });

  it.each((['maxInputTokens', 'maxOutputTokens', 'maxEstimatedTokens'] as const).flatMap(key => [-1, 1].map(delta => ({ key, delta }))))('rejects changed receipt $key ($delta) although parent counts/tokens agree', async ({ key, delta }) => {
    const row = setup(); row.receipt.limits[key] += delta;
    await expect(createStructureReviewContinuation(row.parentId, 'scripted', async () => {})).rejects.toThrow('structure-review-budget-limits-changed'); noWrites(row);
  });

  it.each(['maxSends', 'maxTokens'] as const)('uses immutable checkpoint origin when both diagnostic and durable %s drift', async key => {
    const row = setup(); row.progress[key]++;
    if (key === 'maxSends') row.receipt.limits.maxSends++; else row.receipt.limits.maxEstimatedTokens++;
    await expect(createStructureReviewContinuation(row.parentId, 'scripted', async () => {})).rejects.toThrow('structure-review-budget-limits-changed'); noWrites(row);
  });

  it('rejects an altered continuation-base ceiling before returning an otherwise coherent existing child', async () => {
    const row = setup(true); row.progress.continuationBaseBudget!.limits.maxOutputTokens++;
    await expect(createStructureReviewContinuation(row.parentId, 'scripted', async () => {})).rejects.toThrow('structure-review-budget-limits-changed'); noWrites(row);
  });

  it('checks resumed progress before attempting raw recovery writes', async () => {
    const row = setup(true); row.progress.continuationBaseBudget!.limits.maxSends = 256; row.progress.unresolvedDispatchIds = ['L1'];
    await expect(getStructureReviewProgress(row.checkpoint, row.childId)).rejects.toThrow('structure-review-budget-limits-changed');
    expect(row.attemptedRecovery).not.toHaveBeenCalled(); noWrites(row);
  });

  it('creates a coherent historical-selector-absent child and retains optional receipt absence without upgrading it', async () => {
    const row = setup(); delete row.body.baseBudget.accounting; delete row.receipt.accounting;
    delete row.body.baseBudget.admissionTokens; delete row.receipt.admissionTokens; row.refreshHash();
    const before = BSON.serialize(row.receipt);
    await expect(createStructureReviewContinuation(row.parentId, 'scripted', async () => {})).resolves.toMatchObject({ _id: row.childId });
    expect(createStructureGenerationRun).toHaveBeenCalledTimes(1); expect(row.write).toHaveBeenCalledTimes(1);
    const stored = row.write.mock.calls[0]![1] as { $set: { continuationBaseBudget: unknown } };
    expect(BSON.serialize(stored.$set.continuationBaseBudget as never)).toEqual(before);
    expect(row.body.options.capabilityDistinctnessProtocol).toBeUndefined(); expect(completeJson).not.toHaveBeenCalled();
  });

  it('recovers a coherent existing child after child spend without requiring parent prefix counters to equal current counters', async () => {
    const row = setup(true); row.progress.reservations = 21; row.progress.usedTokens += 7000;
    await expect(createStructureReviewContinuation(row.parentId, 'scripted', async () => {})).resolves.toMatchObject({ _id: row.childId });
    noWrites(row);
  });

  it('compares BSON-restored ceiling values independently of object-key order', async () => {
    const row = setup(); row.receipt.limits = Object.fromEntries(Object.entries(row.receipt.limits).reverse()) as typeof row.receipt.limits;
    await expect(createStructureReviewContinuation(row.parentId, 'scripted', async () => {})).resolves.toMatchObject({ _id: row.childId });
    expect(completeJson).not.toHaveBeenCalled();
  });

  it.each(['input', 'output'] as const)('never widens a coherent smaller inherited native %s cap', async kind => {
    const row = setup(true), key = kind === 'input' ? 'maxInputTokens' : 'maxOutputTokens', limit = kind === 'input' ? 1000 : 4000;
    row.body.baseBudget.limits[key] = limit; row.receipt.limits[key] = limit; row.progress.continuationBaseBudget!.limits[key] = limit;
    row.progress.unresolvedDispatchIds = ['L1']; row.refreshHash();
    await expect(reserveStructureReviewSend(row.checkpoint, row.childId, { prompt: 'x'.repeat(kind === 'input' ? 3000 : 100),
      model: row.body.model.model, provider: 'openai', options: {}, outputCap: 6000, jsonAttempt: 0 })).rejects.toThrow('structure-review-budget-exhausted');
    expect(row.nativeWrite).not.toHaveBeenCalled(); noWrites(row);
  });
});
