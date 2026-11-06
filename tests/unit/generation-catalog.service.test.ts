jest.mock('../../server/src/config/env', () => ({ env: {} }));
jest.mock('../../server/src/components/genai/llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../server/src/components/genai/embeddings', () => ({ embedOne: jest.fn() }));
jest.mock('../../server/src/components/mongodb/collections', () => ({ sourceEvidenceExtractionsCol: jest.fn() }));
import { ObjectId, type WithId } from 'mongodb';
import { selectCatalogOriginalSeeds } from '../../server/src/services/generation-catalog.service';
import { sourcePassages } from '../../server/src/services/structure-generation.service';
import { hashSourceChunks } from '../../server/src/services/source-readiness.service';
import { SOURCE_EXTRACTION_PROMPT_VERSION, SOURCE_EXTRACTION_SCHEMA_VERSION } from '../../server/src/services/source-evidence-cache.service';
import type { MaterialChunk } from '../../server/src/types/domain';
import type { SourceEvidenceExtraction } from '../../server/src/types/source-evidence';

const courseId = new ObjectId();
function source(index: number, text: string) {
  const materialId = new ObjectId(); const name = `Chapter ${index}`;
  const chunk = { _id: new ObjectId(), courseId, materialId, index: 0, text, characterCount: text.length } as WithId<MaterialChunk>;
  const passages = sourcePassages({ id: 'C1.S1', materialId: materialId.toHexString(), materialName: name, chunkIndex: 0, text: text.slice(0, 6000) });
  const record = { _id: new ObjectId(), courseId, materialId, sourceTextHash: hashSourceChunks([chunk]), sourceTitle: name, parserVersion: 'parser', chunkerVersion: 'chunker', schemaVersion: SOURCE_EXTRACTION_SCHEMA_VERSION, promptVersion: SOURCE_EXTRACTION_PROMPT_VERSION, cacheKey: 'cache-fixture', promptTextHash: 'prompt-fixture', modelConfigurationHash: 'model-fixture', guidanceHash: 'guidance-fixture', sectionIds: ['C1.S1'], completedAt: new Date(),
    sections: [{ sectionId: 'C1.S1', objectives: [], knowledge: [{ kind: 'condition', name: 'CAPM beta definition', passageId: passages.at(-1)!.id, quote: passages.at(-1)!.text }] }] } as WithId<SourceEvidenceExtraction>;
  return { chunk, record, metadata: { materialId: materialId.toHexString(), name, parserVersion: 'parser', chunkerVersion: 'chunker' } };
}
describe('catalog locators rebound to current originals', () => {
  it.each([
    ['schemaVersion', 'source-knowledge-v1'],
    ['promptVersion', 'source-local-ledger-v2'],
  ] as const)('keeps an obsolete %s ineligible even when all original quotes are valid', (field, value) => {
    const fixture = source(1, 'CAPM beta measures systematic risk.');
    fixture.record[field] = value;
    const result = selectCatalogOriginalSeeds({ query: 'CAPM beta', records: [fixture.record], chunks: [fixture.chunk], sources: [fixture.metadata] });
    expect(result.seeds).toEqual([]); expect(result.referencedMaterials).toEqual([]);
  });
  it('retrieves original later-chapter definitions and diversifies relevant sources', () => {
    const first = source(1, 'CAPM uses beta for systematic risk.'); const second = source(10, 'CAPM beta definitions require a market portfolio; total volatility is different.');
    const result = selectCatalogOriginalSeeds({ query: 'CAPM beta market portfolio', records: [first.record, second.record], chunks: [first.chunk, second.chunk], sources: [first.metadata, second.metadata] });
    expect(result.seeds).toHaveLength(2); expect(result.seeds.map(seed => seed.text)).toEqual([second.chunk.text, first.chunk.text]);
    expect(result.seeds.map(seed => seed.materialId)).toContain(second.metadata.materialId);
  });
  it.each(['quote', 'passage', 'hash', 'parser', 'title'])('refuses forged or stale catalog references: %s', kind => {
    const fixture = source(1, 'CAPM beta measures systematic risk.');
    if (kind === 'quote') fixture.record.sections[0].knowledge[0].quote = 'Outside content';
    if (kind === 'passage') fixture.record.sections[0].knowledge[0].passageId = 'C99.S99.P99';
    if (kind === 'hash') fixture.record.sourceTextHash = 'stale';
    if (kind === 'parser') fixture.record.parserVersion = 'obsolete-parser';
    if (kind === 'title') fixture.record.sourceTitle = 'Different source';
    const result = selectCatalogOriginalSeeds({ query: 'CAPM beta', records: [fixture.record], chunks: [fixture.chunk], sources: [fixture.metadata] });
    expect(result.seeds).toHaveLength(0);
  });
  it('validates overlapping 6000-character section tails using the original passage algorithm', () => {
    const fixture = source(1, `${'Background source words '.repeat(260)}CAPM beta later definition.`.slice(0, 6000));
    fixture.record.sections[0].knowledge[0].name = 'CAPM beta late passage';
    const result = selectCatalogOriginalSeeds({ query: 'CAPM beta', records: [fixture.record], chunks: [fixture.chunk], sources: [fixture.metadata] });
    expect(result.seeds).toHaveLength(1); expect(result.seeds[0].text).toBe(fixture.chunk.text);
  });
});
