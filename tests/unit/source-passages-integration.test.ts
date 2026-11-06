jest.mock('../../server/src/components/mongodb/collections', () => ({ sourceEvidenceExtractionsCol: jest.fn() }));
jest.mock('../../server/src/components/genai/llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../server/src/components/genai/embeddings', () => ({ embedOne: jest.fn() }));
jest.mock('../../server/src/components/jobs', () => ({ defineJob: jest.fn(), enqueueJob: jest.fn() }));
jest.mock('../../server/src/services/admin.service', () => ({ utilityStepConfig: jest.fn() }));
import { ObjectId, type WithId } from 'mongodb';
import { sourcePassages, sourceExtractionPrompt, finalizeStructureCoverage } from '../../server/src/services/structure-generation.service';
import { splitSourcePassages, SOURCE_PASSAGE_POLICY, LEGACY_SOURCE_PASSAGE_POLICY } from '../../server/src/services/source-passages';
import { sourceExtractionIdentity, SOURCE_EXTRACTION_PROMPT_VERSION, SOURCE_EXTRACTION_SCHEMA_VERSION } from '../../server/src/services/source-evidence-cache.service';
import { selectCatalogOriginalSeeds } from '../../server/src/services/generation-catalog.service';
import { hashSourceChunks } from '../../server/src/services/source-readiness.service';
import { validateStructureReviewCheckpoint } from '../../server/src/services/structure-review-checkpoint.service';
import { outlineGroundingProtocolHash } from '../../server/src/services/structure-outline-grounding';
import type { StructureReviewCheckpointBody } from '../../server/src/types/structure-review';
import type { MaterialChunk } from '../../server/src/types/domain';
import type { SourceEvidenceExtraction } from '../../server/src/types/source-evidence';

const original = `${'A'.repeat(481)}\nNewfoundland Light & Power   + 1.80%\nTail`;
const materialId = new ObjectId();
const section = { id: 'S1', localId: 'C1.S1', materialId: materialId.toHexString(), materialName: 'Public table', chunkIndex: 0, text: original };
const local = { ...section, id: section.localId };
const selection = { requested: [], included: [], excluded: [], ready: true };
function context(policy?: typeof SOURCE_PASSAGE_POLICY | typeof LEGACY_SOURCE_PASSAGE_POLICY) {
  const passages = sourcePassages(local, policy);
  return { corpus: { ...(policy ? { passagePolicy: policy } : {}), sections: [section], fingerprint: 'unchanged-originals', sourceSelection: selection,
    materials: [{ materialId: materialId.toHexString(), name: 'Public table', chunks: 1, sections: 1, sourceTextHash: 'same', parserVersion: 'same', chunkerVersion: 'same' }] },
    evidence: [{ id: 'E1', objective: 'Inspect the recorded company row', materialId: materialId.toHexString(), materialName: 'Public table', chunkIndex: 0,
      quote: passages[1].text, sourcePassageId: passages[1].id }],
    extractions: [{ sectionId: section.id, reused: true, row: { sectionId: local.id, objectives: [{ name: 'Inspect the recorded company row', passageId: passages[1].id, quote: passages[1].text }], knowledge: [],
      passageDispositions: [{ passageId: passages[0].id, disposition: 'context' as const, reason: 'Recorded source header' }] } }],
    excludedSections: [], cache: { hits: 1, misses: 0, reusedSections: 1, extractedSections: 0 } };
}

it('keeps the public helper and historical final inventories on their original word aliases', () => {
  expect(sourcePassages(local)).toEqual(splitSourcePassages(local, LEGACY_SOURCE_PASSAGE_POLICY));
  const old = context();
  const themes = [{ name: 'Topic', los: [{ name: 'Inspect the recorded company row', materialIds: [materialId.toHexString()], evidenceIds: ['E1'] }] }];
  const historical = finalizeStructureCoverage(old, themes, {} as never);
  expect(historical.coverage.sourceInventory!.targets.map(row => row.quote)).toEqual(splitSourcePassages(local, LEGACY_SOURCE_PASSAGE_POLICY).map(row => row.text));
  expect(historical.coverage.sourceInventory!.targets[1].quote).toMatch(/^Light & Power/);
  const current = finalizeStructureCoverage(context(SOURCE_PASSAGE_POLICY), themes, {} as never);
  expect(current.coverage.sourceInventory!.targets.map(row => row.quote)).toEqual(splitSourcePassages(local).map(row => row.text));
  expect(current.coverage.sourceInventory!.targets[1].quote).toMatch(/^Newfoundland Light & Power/);
  expect(historical.evidence[0].quote).toBe(old.evidence[0].quote);
  expect(() => finalizeStructureCoverage({ ...old, corpus: { ...old.corpus, passagePolicy: 'future-unknown' as never } }, themes, {} as never)).toThrow('source-passage-policy-unsupported');
});

it('binds changed real extraction prompt payloads while preserving identical prompt cache keys', () => {
  const input = { courseId: new ObjectId(), materialId, sourceTextHash: 'same', parserVersion: 'same', chunkerVersion: 'same', sourceTitle: 'Public table',
    guidance: '', modelConfiguration: {}, sections: [local] };
  const identity = (text: string, passagePolicy: typeof SOURCE_PASSAGE_POLICY | typeof LEGACY_SOURCE_PASSAGE_POLICY) => sourceExtractionIdentity({ ...input, passagePolicy,
    promptText: sourceExtractionPrompt([{ ...local, text }], {}, passagePolicy) });
  expect(identity(original, SOURCE_PASSAGE_POLICY).cacheKey).not.toBe(identity(original, LEGACY_SOURCE_PASSAGE_POLICY).cacheKey);
  expect(identity('One complete original row.', SOURCE_PASSAGE_POLICY).cacheKey).toBe(identity('One complete original row.', LEGACY_SOURCE_PASSAGE_POLICY).cacheKey);
});

it.each([LEGACY_SOURCE_PASSAGE_POLICY, SOURCE_PASSAGE_POLICY] as const)('catalog resolves stored P1 under its own %s policy', policy => {
  const chunk = { _id: new ObjectId(), courseId: new ObjectId(), materialId, index: 0, text: original, characterCount: original.length } as WithId<MaterialChunk>;
  const passage = sourcePassages(local, policy)[0];
  const record = { _id: new ObjectId(), courseId: chunk.courseId, materialId, ...(policy === SOURCE_PASSAGE_POLICY ? { passagePolicy: policy } : {}),
    sourceTextHash: hashSourceChunks([chunk]), sourceTitle: 'Public table', parserVersion: 'same', chunkerVersion: 'same',
    schemaVersion: SOURCE_EXTRACTION_SCHEMA_VERSION, promptVersion: SOURCE_EXTRACTION_PROMPT_VERSION,
    completedAt: new Date(), cacheKey: 'fixture', promptTextHash: 'fixture', modelConfigurationHash: 'fixture', guidanceHash: 'fixture', sectionIds: [local.id],
    sections: [{ sectionId: local.id, objectives: [], knowledge: [{ kind: 'concept', name: 'Recorded company row', passageId: passage.id, quote: passage.text }] }] } as WithId<SourceEvidenceExtraction>;
  const input = { query: 'company', chunks: [chunk], records: [record], sources: [{ materialId: materialId.toHexString(), name: 'Public table' }] };
  expect(selectCatalogOriginalSeeds(input)).toMatchObject({ rejectedReferences: 0, seeds: [{ text: original }] });
  const wrongPolicy = policy === SOURCE_PASSAGE_POLICY ? LEGACY_SOURCE_PASSAGE_POLICY : SOURCE_PASSAGE_POLICY;
  expect(selectCatalogOriginalSeeds({ ...input, records: [{ ...record, passagePolicy: wrongPolicy }] })).toMatchObject({ rejectedReferences: 1, seeds: [] });
  expect(selectCatalogOriginalSeeds({ ...input, records: [{ ...record, passagePolicy: 'future-unknown' as never }] })).toMatchObject({ rejectedReferences: 1, seeds: [] });
});

it('validates old/current original equality independently of the derived policy and refuses unknown policy entries', () => {
  const corpus = { sections: [], materials: [], fingerprint: 'originals', sourceSelection: selection };
  const body = { version: 'exact-outline-review-v1', courseId: new ObjectId().toHexString(), rootRunId: new ObjectId().toHexString(), corpus,
    protocolHash: outlineGroundingProtocolHash(), baseBudget: { pendingSends: 0 }, themes: [], evidence: [], extractions: [], batches: [], reviewInputLimit: 46500 } as unknown as StructureReviewCheckpointBody;
  expect(() => validateStructureReviewCheckpoint(body, { ...corpus, passagePolicy: SOURCE_PASSAGE_POLICY })).not.toThrow();
  expect(() => validateStructureReviewCheckpoint({ ...body, corpus: { ...corpus, passagePolicy: 'future-unknown' as never } })).toThrow('source-passage-policy-unsupported');
  expect(() => validateStructureReviewCheckpoint(body, { ...corpus, passagePolicy: 'future-unknown' as never })).toThrow('source-passage-policy-unsupported');
});
