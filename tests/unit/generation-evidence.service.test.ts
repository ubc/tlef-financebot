jest.mock('../../server/src/components/mongodb/collections', () => ({
  materialsCol: jest.fn(), materialChunksCol: jest.fn(), contentRunsCol: jest.fn(),
}));

import { ObjectId, type WithId } from 'mongodb';
import { contentRunsCol, materialChunksCol, materialsCol } from '../../server/src/components/mongodb/collections';
import {
  assertGenerationEvidenceCurrent, buildGenerationEvidence, GENERATION_EVIDENCE_LIMITS,
  renderGenerationEvidence, type GenerationEvidenceInput,
} from '../../server/src/services/generation-evidence.service';
import type { ContentRun, Material, MaterialChunk } from '../../server/src/types/domain';
import fixture from '../fixtures/generation-quality/source-evidence.json';

const courseId = new ObjectId();
const materialId = new ObjectId();
const loId = new ObjectId();
const themeId = new ObjectId();
let materials: WithId<Material>[];
let chunks: WithId<MaterialChunk>[];
let runs: WithId<ContentRun>[];
let materialQuery: unknown;
let chunkQuery: unknown;
const cursor = <T>(rows: () => T[]) => {
  const result = { toArray: jest.fn(async () => rows()), sort: jest.fn(), limit: jest.fn() };
  result.sort.mockReturnValue(result); result.limit.mockReturnValue(result);
  return result;
};
const input = (): GenerationEvidenceInput => ({
  courseId, loIds: [loId], policyVersion: 'grounded-memory-v1',
  allowedMaterials: [{ materialId: materialId.toHexString(), role: 'primary', loId: loId.toHexString(), loName: fixture.learningObjective }],
  seeds: [{ materialId: materialId.toHexString(), chunkIndex: 1, text: chunks[1].text }],
});

beforeEach(() => {
  materials = [{ _id: materialId, courseId, name: fixture.name, format: 'txt', status: 'ready', revision: 3,
    assignments: [{ themeId, loId }], uploadedAt: new Date('2026-10-01') }];
  chunks = fixture.chunks.map((text, index) => ({ _id: new ObjectId(), courseId, materialId, index, text,
    characterCount: text.length, createdAt: new Date('2026-10-01'), metadata: { sourceId: fixture.name, page: index + 1 } }));
  runs = [];
  jest.mocked(materialsCol).mockReturnValue({ find: (filter: unknown) => { materialQuery = filter; return cursor(() => materials); } } as never);
  jest.mocked(materialChunksCol).mockReturnValue({ find: (filter: unknown) => { chunkQuery = filter; return cursor(() => chunks); } } as never);
  jest.mocked(contentRunsCol).mockReturnValue({ find: () => cursor(() => runs) } as never);
});

it('recovers neighboring definitions from original Mongo text within the explicit course and material scope', async () => {
  const packet = await buildGenerationEvidence(input());
  expect(materialQuery).toEqual({ courseId, status: 'ready', deletedAt: { $exists: false }, _id: { $in: [materialId] } });
  expect(chunkQuery).toEqual({ courseId, materialId: { $in: [materialId] } });
  expect(packet.passages.map(passage => passage.chunkIndex)).toEqual([1, 0, 2]);
  expect(packet.passages[1]).toMatchObject({ text: fixture.chunks[0], selection: 'neighbor', role: 'primary', loId: loId.toHexString() });
  expect(packet.coverage).toMatchObject({ sourceChunks: 4, selectedChunks: 3, truncated: false });
  expect(packet.parsingProvenance).toBe('unrecorded');
  const rendered = renderGenerationEvidence(packet);
  expect(rendered).toContain(packet.passages[0].id);
  expect(rendered).toContain('False distractors and false T/F claims are allowed');
  expect(rendered).not.toContain(fixture.outsideSelectedNotes);
});

it('keeps exact source offsets and bounds the packet without pretending to inspect every source passage', async () => {
  chunks[1].text = 'Long source. '.repeat(4000);
  const packet = await buildGenerationEvidence(input());
  expect(packet.coverage.truncated).toBe(true);
  expect(packet.coverage.selectedCharacters).toBeLessThanOrEqual(GENERATION_EVIDENCE_LIMITS.packetCharacters);
  expect(packet.passages.length).toBeLessThanOrEqual(GENERATION_EVIDENCE_LIMITS.packetPassages);
  expect(packet.findings).toContainEqual(expect.objectContaining({ code: 'evidence-budget-truncated' }));
  for (const passage of packet.passages) expect(passage.text).toBe(chunks[passage.chunkIndex].text.slice(passage.start, passage.end));
});

it('never accepts vector payload text as source truth, including a valid index with different text', async () => {
  const request = input(); request.seeds[0].text = fixture.outsideSelectedNotes;
  await expect(buildGenerationEvidence(request)).rejects.toThrow('generation-evidence-stale-retrieval');
  request.seeds[0] = { materialId: materialId.toHexString(), chunkIndex: 99, text: chunks[1].text };
  await expect(buildGenerationEvidence(request)).rejects.toThrow('generation-evidence-stale-retrieval');
});

it('allows legacy seed text only when it locates one exact persisted chunk', async () => {
  const request = input(); delete request.seeds[0].chunkIndex;
  const packet = await buildGenerationEvidence(request);
  expect(packet.passages[0].text).toBe(chunks[1].text);
  chunks[0].text = chunks[1].text;
  await expect(buildGenerationEvidence(request)).rejects.toThrow('generation-evidence-stale-retrieval');
});

it('rejects undeclared sources, missing sources, foreign courses, deleted sources and processing sources', async () => {
  const request = input(); request.seeds[0].materialId = new ObjectId().toHexString();
  await expect(buildGenerationEvidence(request)).rejects.toThrow('generation-evidence-seed-outside-scope');
  const original = materials[0];
  materials = []; await expect(buildGenerationEvidence(input())).rejects.toThrow('generation-evidence-material-unavailable');
  for (const changed of [{ courseId: new ObjectId() }, { deletedAt: new Date() }, { status: 'processing' as const }]) {
    materials = [{ ...original, ...changed }];
    await expect(buildGenerationEvidence(input())).rejects.toThrow('generation-evidence-material-unavailable');
  }
});

it('rejects cross-course chunks and incomplete or duplicate chunk indices', async () => {
  chunks[0].courseId = new ObjectId();
  await expect(buildGenerationEvidence(input())).rejects.toThrow('generation-evidence-invalid-chunk-scope');
  chunks[0].courseId = courseId; chunks[0].index = 1;
  await expect(buildGenerationEvidence(input())).rejects.toThrow('generation-evidence-chunks-missing');
  chunks.shift();
  await expect(buildGenerationEvidence(input())).rejects.toThrow('generation-evidence-chunks-missing');
});

it('requires a complete matching ingest manifest when the material records an active ingest', async () => {
  const runId = new ObjectId(); materials[0].activeRunId = runId;
  await expect(buildGenerationEvidence(input())).rejects.toThrow('generation-evidence-ingest-incomplete');
  runs = [{ _id: runId, courseId, kind: 'material-ingest', status: 'completed', stage: 'classifying', requestedBy: 'teacher',
    completedUnits: 4, revision: 1, events: [], warnings: [], createdAt: new Date(), updatedAt: new Date(),
    input: { materialId, sourceName: fixture.name, sourceFormat: 'txt', trigger: 'upload' },
    result: { chunkCount: 4, characterCount: 500, vectorCount: 4, indexedCount: 4, classification: 'skipped' } }];
  await expect(buildGenerationEvidence(input())).resolves.toMatchObject({ materials: [expect.objectContaining({ activeRunId: runId.toHexString() })] });
  if (runs[0].kind === 'material-ingest') runs[0].result!.chunkCount = 5;
  await expect(buildGenerationEvidence(input())).rejects.toThrow('generation-evidence-ingest-incomplete');
});

it('hashes all original chunks and canonical parsing metadata, including text outside the selected packet', async () => {
  const before = await buildGenerationEvidence(input());
  chunks[0].metadata = { page: 1, sourceId: fixture.name };
  expect((await buildGenerationEvidence(input())).id).toBe(before.id);
  chunks[3].text = 'Changed a passage outside the selected packet.';
  const changed = await buildGenerationEvidence(input());
  expect(changed.sourceFingerprint).not.toBe(before.sourceFingerprint);
  expect(changed.id).not.toBe(before.id);
  await expect(assertGenerationEvidenceCurrent(before)).rejects.toThrow('generation-evidence-source-changed');
});

it('invalidates a frozen packet when revision, assignment, metadata, or source eligibility changes', async () => {
  const before = await buildGenerationEvidence(input());
  await expect(assertGenerationEvidenceCurrent(before)).resolves.toBeUndefined();
  materials[0].revision = 4;
  await expect(assertGenerationEvidenceCurrent(before)).rejects.toThrow('generation-evidence-source-changed');
  materials[0].revision = 3; materials[0].assignments = [];
  await expect(assertGenerationEvidenceCurrent(before)).rejects.toThrow('generation-evidence-source-changed');
  materials[0].assignments = [{ themeId, loId }]; chunks[0].metadata = { page: 99 };
  await expect(assertGenerationEvidenceCurrent(before)).rejects.toThrow('generation-evidence-source-changed');
  materials[0].deletedAt = new Date();
  await expect(assertGenerationEvidenceCurrent(before)).rejects.toThrow('generation-evidence-material-unavailable');
});

it('reports damaged source text without guessing the missing formula', async () => {
  chunks[1].text = fixture.damagedFormula;
  const packet = await buildGenerationEvidence(input());
  expect(packet.findings).toEqual([{ code: 'source-text-damage', passageIds: [packet.passages[0].id], message: expect.stringContaining('original file') }]);
  expect(packet.passages[0].text).toBe(fixture.damagedFormula);
});

it('requires primary evidence and rejects oversized or empty corpus selections', async () => {
  const request = input(); request.seeds = [];
  await expect(buildGenerationEvidence(request)).rejects.toThrow('generation-evidence-no-primary');
  request.allowedMaterials[0].role = 'prerequisite';
  await expect(buildGenerationEvidence(request)).rejects.toThrow('generation-evidence-no-primary');
  chunks[0].text = 'x'.repeat(GENERATION_EVIDENCE_LIMITS.corpusCharacters + 1);
  await expect(buildGenerationEvidence(input())).rejects.toThrow('generation-evidence-corpus-too-large');
});

it('keeps equal text from separate source identities unambiguous and records supporting LO roles', async () => {
  const secondId = new ObjectId();
  materials.push({ ...materials[0], _id: secondId });
  chunks.push(...chunks.map(chunk => ({ ...chunk, _id: new ObjectId(), materialId: secondId })));
  const request = input();
  request.allowedMaterials.push({ materialId: secondId.toHexString(), role: 'secondary', loId: new ObjectId().toHexString(), loName: 'Explain risk' });
  request.seeds.push({ materialId: secondId.toHexString(), chunkIndex: 1, text: fixture.chunks[1] });
  const packet = await buildGenerationEvidence(request);
  expect(new Set(packet.passages.map(passage => passage.id)).size).toBe(packet.passages.length);
  expect(packet.passages[1]).toMatchObject({ role: 'secondary', loName: 'Explain risk', selection: 'retrieved' });
});
