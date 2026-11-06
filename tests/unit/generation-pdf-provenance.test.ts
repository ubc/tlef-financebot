jest.mock('../../server/src/components/mongodb/collections', () => ({ materialsCol: jest.fn(), materialChunksCol: jest.fn(), contentRunsCol: jest.fn() }));
jest.mock('../../server/src/services/source-readiness.service', () => ({ getMaterialSourceReadiness: jest.fn(async () => ({ ready: true })) }));
jest.mock('../../server/src/services/material-source-provenance.service', () => ({
  ...jest.requireActual('../../server/src/services/material-source-provenance.service'), readMaterialSourceProvenance: jest.fn(),
}));
jest.mock('../../server/src/services/generation-catalog.service', () => ({ readCatalogOriginalSeeds: jest.fn(async () => ({ seeds: [], rejectedReferences: 0, referencedMaterials: [] })) }));

import { createHash } from 'node:crypto';
import { ObjectId, type WithId } from 'mongodb';
import { contentRunsCol, materialChunksCol, materialsCol } from '../../server/src/components/mongodb/collections';
import { createMaterialChunkBindings, readMaterialSourceProvenance } from '../../server/src/services/material-source-provenance.service';
import { buildPdfPageMap, locatePdfChunk } from '../../server/src/components/genai/document-parsing/pdf-provenance';
import { assertGenerationEvidenceCurrent, buildGenerationEvidence, expandGenerationEvidence, renderGenerationEvidence } from '../../server/src/services/generation-evidence.service';
import { attachGenerationCitationLocations, renderSourceCitationSpans, resolveSpanCitations, sourceCitationSpans } from '../../server/src/services/generation-citation-spans';
import type { Material, MaterialChunk } from '../../server/src/types/domain';
import type { MaterialSourceProvenance } from '../../server/src/types/source-provenance';
import type { GenerationEvidencePacket } from '../../server/src/types/generation-evidence';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const courseId = new ObjectId('111111111111111111111111'), materialId = new ObjectId('222222222222222222222222');
const provenanceId = new ObjectId('333333333333333333333333'), loId = new ObjectId('444444444444444444444444');
let material: WithId<Material>, chunks: WithId<MaterialChunk>[], record: WithId<MaterialSourceProvenance>;
const cursor = <T>(rows: () => T[]) => { const value = { sort: () => value, limit: () => value, toArray: async () => rows() }; return value; };
function source(text = 'A'.repeat(750) + '\f' + 'B'.repeat(750) + '\f' + 'C'.repeat(750) + '\f'): void {
  const pages = text.split('\f').length - Number(text.endsWith('\f'));
  const pageMap = buildPdfPageMap(text, pages, 'poppler-pdftotext');
  if (pageMap.status !== 'verified') throw new Error('Synthetic test requires a verified page map.');
  const now = new Date('2026-10-17T00:00:00Z');
  material = { _id: materialId, courseId, name: 'Synthetic chapter.pdf', format: 'pdf', status: 'ready', revision: 1,
    assignments: [{ themeId: loId, loId }], uploadedAt: now,
    sourceManifest: { version: 1, provenanceId, sourceTextHash: sha(`0:${Buffer.byteLength(text)}:${text}`), chunkCount: 1,
      characterCount: text.length, indexedCount: 1, parserVersion: 'test-parser', chunkerVersion: 'test-chunker', indexedAt: now } };
  record = { _id: provenanceId, courseId, materialId, sourceTextHash: material.sourceManifest!.sourceTextHash, chunkCount: 1,
    chunkBindings: { version: 'full-chunk-provenance-v1', entries: [], sha256: '' },
    rawTextStoragePath: '/private/test-not-read.txt', createdAt: now,
    receipt: { version: 'pdf-parse-receipt-v1', pdfSha256: sha('synthetic PDF identity'), pdfBytes: 10, routingPolicy: 'text-poppler-first-v2',
      requestedFormat: 'text', actualFormat: 'text', successfulEngine: 'poppler-pdftotext', engineVersion: 'test',
      attempts: [{ engine: 'poppler-pdftotext', outcome: 'succeeded', elapsedMs: 1 }], rawTextSha256: sha(text), rawTextBytes: Buffer.byteLength(text),
      rawTextUtf16Length: text.length, pageCount: { engine: 'pdfinfo', engineVersion: 'test', status: 'verified', count: pages }, pageMap } };
  chunks = [{ _id: new ObjectId('555555555555555555555555'), courseId, materialId, index: 0, text, characterCount: text.length, createdAt: now,
    metadata: { sourceId: material.name }, sourceProvenance: { provenanceId: provenanceId.toHexString(), pdfSha256: record.receipt.pdfSha256,
      rawTextSha256: record.receipt.rawTextSha256, pageMapSha256: pageMap.sha256, locator: locatePdfChunk(text, text, pageMap) } }];
  record.chunkBindings = createMaterialChunkBindings(chunks);
}
const input = (enabled = true) => ({ courseId, loIds: [loId], policyVersion: 'grounded-memory-v2',
  ...(enabled ? { sourceProvenance: 'pdf-pages-v1' as const } : {}),
  allowedMaterials: [{ materialId: materialId.toHexString(), role: 'primary' as const, loId: loId.toHexString(), loName: 'Synthetic source objective' }],
  seeds: [{ materialId: materialId.toHexString(), chunkIndex: 0, text: chunks[0].text }] });
function rehash(packet: GenerationEvidencePacket): void {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;
  const body: Partial<GenerationEvidencePacket> = { ...packet }; delete body.id; packet.id = sha(JSON.stringify(canonical(body)));
}

beforeEach(() => {
  source();
  jest.mocked(materialsCol).mockReturnValue({ find: () => cursor(() => [material]) } as never);
  jest.mocked(materialChunksCol).mockReturnValue({ find: () => cursor(() => chunks) } as never);
  jest.mocked(contentRunsCol).mockReturnValue({ find: () => cursor(() => []) } as never);
  jest.mocked(readMaterialSourceProvenance).mockReset().mockImplementation(async () => record);
});

// Verified against the R3 archived service, SHA 62902bb6d5a7e747a7e350ef86223fe5cc76650760e2e5eaf85315410251896c,
// in a pure dependency-injected comparison. No ignored audit artifact is needed to run this regression.
it.each([
  ['grounded-memory-v1', '8de4f8ab422c5432c7eea66a858d4d3f647b50b106841a971b3c0dd3ba3586bb', 'e0571642272de9f6b114e8a0e4e713a3e4548b70e920d7d01ccd4fdec2651dbd', 'c54724858dd2caae54c51a7d29403eda98a05699fe3002f4a8cdf3824fd4791c'],
  ['grounded-memory-v2', '96a6d6510bc98743982272678527147f412c88135b7052f48988b1960e3f7404', '41e8c43d23f45dd0ffd12155813e6ac237a8416cab06b5ae140c0ec7d81e1e50', '87e44a5fe777cf75654c5a93927ad5c8ee7bce3c57db65a9554333b81721db50'],
])('preserves R3 exact legacy packet and prompt bytes under %s', async (policyVersion, id, packetSha, promptSha) => {
  const packet = await buildGenerationEvidence({ ...input(false), policyVersion });
  expect(packet.id).toBe(id); expect(sha(JSON.stringify(packet))).toBe(packetSha);
  expect(sha(renderGenerationEvidence(packet))).toBe(promptSha);
});

it('keeps legacy packet IDs, prompts and currentness independent of newly recorded top-level provenance', async () => {
  const legacy = await buildGenerationEvidence(input(false)); const rendered = renderGenerationEvidence(legacy);
  expect(legacy).toMatchObject({ schemaVersion: 'source-passages-v1', parsingProvenance: 'unrecorded' });
  expect(legacy.passages.every(passage => !('sourceLocation' in passage))).toBe(true);
  expect(readMaterialSourceProvenance).not.toHaveBeenCalled();
  chunks[0].sourceProvenance!.pdfSha256 = sha('different top-level provenance');
  material.sourceManifest!.provenanceId = new ObjectId(); record.receipt.rawTextSha256 = sha('different receipt');
  expect(await buildGenerationEvidence(input(false))).toEqual(legacy);
  expect(renderGenerationEvidence(legacy)).toBe(rendered);
  await expect(assertGenerationEvidenceCurrent(legacy)).resolves.toBeUndefined();
  expect(readMaterialSourceProvenance).not.toHaveBeenCalled();
});

it('opts in explicitly and pins validated multi-page passage locations without leaking receipts into model prompts', async () => {
  const packet = await buildGenerationEvidence(input());
  expect(packet).toMatchObject({ schemaVersion: 'source-passages-v2', parsingProvenance: 'verified' });
  expect(packet.materials[0].sourceProvenance).toMatchObject({ provenanceId: provenanceId.toHexString(), receiptHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(packet.passages[0].sourceLocation).toMatchObject({ status: 'verified', chunkStart: 0, chunkEnd: 2000, rawStart: 0, rawEnd: 2000 });
  expect(packet.passages[0].sourceLocation?.status === 'verified' && packet.passages[0].sourceLocation.pageSpans.map(span => span.physicalPage)).toEqual([1, 2, 3]);
  for (const text of [renderGenerationEvidence(packet), renderSourceCitationSpans(packet)]) {
    expect(text).not.toContain(record.rawTextStoragePath); expect(text).not.toContain('pageMapSha256'); expect(text).not.toContain('pdfSha256');
  }
  await expect(assertGenerationEvidenceCurrent(packet)).resolves.toBeUndefined();
});

it('keeps partial provenance explicit when a neighboring chunk has ambiguous physical origins', async () => {
  const text = 'A'.repeat(25); const pageMap = record.receipt.pageMap;
  chunks.push({ ...chunks[0], _id: new ObjectId(), index: 1, text, characterCount: text.length,
    sourceProvenance: { ...chunks[0].sourceProvenance!, locator: locatePdfChunk(chunks[0].text, text, pageMap) } });
  material.sourceManifest!.chunkCount = material.sourceManifest!.indexedCount = record.chunkCount = 2;
  material.sourceManifest!.characterCount += text.length;
  record.sourceTextHash = material.sourceManifest!.sourceTextHash = sha(chunks.map(chunk => `${chunk.index}:${Buffer.byteLength(chunk.text)}:${chunk.text}`).join(''));
  record.chunkBindings = createMaterialChunkBindings(chunks);
  const packet = await buildGenerationEvidence(input());
  expect(packet.parsingProvenance).toBe('partial');
  expect(packet.passages.find(passage => passage.chunkIndex === 0)?.sourceLocation).toMatchObject({ status: 'verified' });
  expect(packet.passages.find(passage => passage.chunkIndex === 1)?.sourceLocation).toMatchObject({ status: 'unavailable' });
  await expect(assertGenerationEvidenceCurrent(packet)).resolves.toBeUndefined();
});

it('does not accept locator page labels that disagree with the current sidecar page intervals', async () => {
  const locator = chunks[0].sourceProvenance!.locator;
  if (locator.status !== 'verified') throw new Error('Expected verified fixture locator.');
  locator.pageSpans[0].physicalPage = 99;
  const packet = await buildGenerationEvidence(input());
  expect(packet.parsingProvenance).toBe('partial');
  expect(packet.passages[0].sourceLocation).toMatchObject({ status: 'unavailable', reason: 'source-provenance-binding-invalid' });
});

it('preserves unknown locations without claiming that text support or every source has verified pages', async () => {
  delete chunks[0].sourceProvenance;
  const packet = await buildGenerationEvidence(input());
  expect(packet.parsingProvenance).toBe('partial');
  expect(packet.passages[0].sourceLocation).toMatchObject({ status: 'unavailable', reason: 'source-provenance-binding-invalid' });
  await expect(assertGenerationEvidenceCurrent(packet)).resolves.toBeUndefined();
  jest.mocked(readMaterialSourceProvenance).mockResolvedValue(null);
  expect((await buildGenerationEvidence(input())).passages[0].sourceLocation).toMatchObject({ status: 'unavailable' });
});

it('detects changed sidecar, raw binding and stored chunk locator state before adoption', async () => {
  const packet = await buildGenerationEvidence(input());
  record.receipt.rawTextSha256 = sha('replacement raw output');
  await expect(assertGenerationEvidenceCurrent(packet)).rejects.toThrow('generation-evidence-source-changed');
  source(); const refreshed = await buildGenerationEvidence(input());
  chunks[0].sourceProvenance!.pdfSha256 = sha('wrong current PDF');
  await expect(assertGenerationEvidenceCurrent(refreshed)).rejects.toThrow('generation-evidence-source-changed');
});

it('rejects tampered frozen passage locations even when a caller recomputes the packet hash', async () => {
  const packet = await buildGenerationEvidence(input());
  const location = packet.passages[0].sourceLocation!;
  if (location.status !== 'verified') throw new Error('Expected verified test location.');
  location.pageSpans[0].physicalPage = 9; rehash(packet);
  await expect(assertGenerationEvidenceCurrent(packet)).rejects.toThrow('generation-evidence-provenance-changed');
  const missing = await buildGenerationEvidence(input()); delete missing.passages[0].sourceLocation; rehash(missing);
  await expect(assertGenerationEvidenceCurrent(missing)).rejects.toThrow('generation-evidence-provenance-changed');
});

it('retains the provenance schema during bounded evidence expansion', async () => {
  const packet = await buildGenerationEvidence(input());
  const expanded = await expandGenerationEvidence(packet, 'source');
  expect(expanded.schemaVersion).toBe('source-passages-v2'); expect(expanded.parsingProvenance).toBe('verified');
});

it('projects the exact selected span across pages and preserves separate nonadjacent citation groups', async () => {
  const packet = await buildGenerationEvidence(input());
  const spans = sourceCitationSpans(packet);
  const result = resolveSpanCitations(packet, [{ kind: 'premise', claim: 'Selected exact source', spanIds: ['S2'] }]);
  expect(result.issues).toEqual([]); expect(result.citations[0].quote).toBe(spans[1].text);
  expect(result.citations[0].materialId).toBe(materialId.toHexString());
  expect(result.citations[0].sourceLocation).toMatchObject({ status: 'verified', rawStart: 700, rawEnd: 1400, chunkStart: 700, chunkEnd: 1400,
    pageSpans: [{ physicalPage: 1, rawStart: 700, rawEnd: 750, chunkStart: 700, chunkEnd: 750 },
      { physicalPage: 2, rawStart: 751, rawEnd: 1400, chunkStart: 751, chunkEnd: 1400 }] });
  const separate = resolveSpanCitations(packet, [{ kind: 'solution', claim: 'Nonadjacent', spanIds: ['S1', 'S3'] }]);
  expect(separate.citations).toHaveLength(2);
  expect(separate.citations.map(citation => citation.sourceLocation?.status === 'verified' && [citation.sourceLocation.rawStart, citation.sourceLocation.rawEnd])).toEqual([[0, 700], [1400, 2000]]);
});

it('keeps the selected occurrence for repeated span text, while copied ambiguous quotes receive no guessed location', async () => {
  source('A'.repeat(1500) + '\f' + 'B'.repeat(20) + '\f');
  const packet = await buildGenerationEvidence(input());
  const citation = resolveSpanCitations(packet, [{ kind: 'premise', claim: 'Second exact span', spanIds: ['S2'] }]).citations[0];
  expect(citation.sourceLocation).toMatchObject({ status: 'verified', rawStart: 700, rawEnd: 1400 });
  expect(attachGenerationCitationLocations(packet, [citation])[0]).toEqual(citation);
  const copied = attachGenerationCitationLocations(packet, [{ kind: 'solution', claim: 'Ambiguous copied quote', passageId: packet.passages[0].id, quote: 'AAA' }]);
  expect(copied[0].sourceLocation).toMatchObject({ status: 'unavailable', reason: 'source-quote-range-ambiguous' });
  const unique = attachGenerationCitationLocations(packet, [{ kind: 'solution', claim: 'Unique copied quote', passageId: packet.passages[0].id, quote: 'B'.repeat(20) }]);
  expect(unique[0].materialId).toBe(materialId.toHexString());
  expect(unique[0].sourceLocation).toMatchObject({ status: 'verified', rawStart: 1501, rawEnd: 1521 });
});

it('does not add citation fields to historical packets or guess a malformed selected range', async () => {
  const legacy = await buildGenerationEvidence(input(false));
  const citations = [{ kind: 'premise' as const, claim: 'Legacy', passageId: legacy.passages[0].id, quote: 'AAA' }];
  expect(attachGenerationCitationLocations(legacy, citations)).toBe(citations);
  expect(resolveSpanCitations(legacy, [{ kind: 'premise', claim: 'Legacy', spanIds: ['S1'] }]).citations[0]).not.toHaveProperty('sourceLocation');
  expect(resolveSpanCitations(legacy, [{ kind: 'premise', claim: 'Legacy', spanIds: ['S1'] }]).citations[0]).not.toHaveProperty('materialId');
  const packet = await buildGenerationEvidence(input()); packet.passages[0].sourceLocation!.offsetUnit = 'wrong' as never;
  expect(resolveSpanCitations(packet, [{ kind: 'premise', claim: 'Invalid', spanIds: ['S1'] }]).citations[0].sourceLocation).toMatchObject({ status: 'unavailable', reason: 'source-location-invalid' });
});

it('cannot claim a verified page range for a quote ending inside a Unicode code point', async () => {
  source('A'.repeat(699) + '😀' + 'Z'.repeat(600) + '\f');
  const packet = await buildGenerationEvidence(input());
  const citation = resolveSpanCitations(packet, [{ kind: 'premise', claim: 'Split code point', spanIds: ['S1'] }]).citations[0];
  expect(citation.sourceLocation).toMatchObject({ status: 'unavailable', reason: 'source-location-invalid' });
});
