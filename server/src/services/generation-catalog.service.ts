import type { ObjectId, WithId } from 'mongodb';
import { sourceEvidenceExtractionsCol } from '../components/mongodb/collections';
import type { MaterialChunk } from '../types/domain';
import type { EvidenceSeed } from '../types/generation-evidence';
import { hashSourceChunks } from './source-readiness.service';
import { sourcePassages } from './structure-generation.service';
import { SOURCE_EXTRACTION_PROMPT_VERSION, SOURCE_EXTRACTION_SCHEMA_VERSION } from './source-evidence-cache.service';
import type { SourceEvidenceExtraction } from '../types/source-evidence';
import { resolveSourcePassagePolicy } from './source-passages';

const words = (value: string) => new Set(value.toLocaleLowerCase('en').match(/[\p{L}\p{N}_]{3,}/gu) ?? []);
function score(query: Set<string>, text: string): number { const tokens = words(text); return [...query].filter(word => tokens.has(word)).length; }

/** Cache points nominate ORIGINAL chunks only. Every source-local quote is
 * rebound to its current original passage; a summary cannot become evidence. */
export function selectCatalogOriginalSeeds(input: {
  query: string; records: Array<WithId<SourceEvidenceExtraction>>; chunks: Array<WithId<MaterialChunk>>;
  sources: Array<{ materialId: string; name: string; parserVersion?: string; chunkerVersion?: string }>; maxChunks?: number;
}): { seeds: EvidenceSeed[]; referencedMaterials: string[]; rejectedReferences: number } {
  const query = words(input.query); let rejectedReferences = 0;
  const ranked: Array<{ chunk: WithId<MaterialChunk>; score: number; preferredStart: number }> = [];
  for (const record of input.records) {
    let passagePolicy: ReturnType<typeof resolveSourcePassagePolicy>;
    try { passagePolicy = resolveSourcePassagePolicy(record.passagePolicy); } catch { rejectedReferences++; continue; }
    const source = input.sources.find(source => source.materialId === record.materialId.toHexString());
    const own = input.chunks.filter(chunk => chunk.materialId.equals(record.materialId));
    if (!source || record.sourceTextHash !== hashSourceChunks(own) || record.sourceTitle !== source.name ||
      record.schemaVersion !== SOURCE_EXTRACTION_SCHEMA_VERSION || record.promptVersion !== SOURCE_EXTRACTION_PROMPT_VERSION ||
      (source.parserVersion && source.parserVersion !== record.parserVersion) || (source.chunkerVersion && source.chunkerVersion !== record.chunkerVersion)) continue;
    for (const section of record.sections) {
      const locator = /^C(\d+)\.S(\d+)$/.exec(section.sectionId);
      const chunk = locator ? own.find(chunk => chunk.index === Number(locator[1]) - 1) : undefined;
      if (!chunk || !locator) { rejectedReferences++; continue; }
      const start = (Number(locator[2]) - 1) * 5800;
      const passages = sourcePassages({ id: section.sectionId, materialId: source.materialId, materialName: source.name, chunkIndex: chunk.index, text: chunk.text.slice(start, start + 6000) }, passagePolicy);
      for (const point of [...section.objectives, ...section.knowledge]) {
        const passage = passages.find(passage => passage.id === point.passageId);
        if (!passage || passage.text !== point.quote) { rejectedReferences++; continue; }
        const relevance = score(query, `${point.name} ${point.quote}`);
        if (relevance > 0) ranked.push({ chunk, preferredStart: chunk.text.indexOf(point.quote, start), score: relevance + ('kind' in point && typeof point.kind === 'string' && ['formula', 'notation', 'condition', 'unit'].includes(point.kind) ? 0.25 : 0) });
      }
    }
  }
  ranked.sort((a, b) => b.score - a.score || a.chunk.index - b.chunk.index);
  const seeds: EvidenceSeed[] = []; const selected = new Set<string>(); const materials = new Set<string>();
  // First take the strongest relevant passage for each source, then fill the
  // remaining bounded budget. Unrelated files are never forced into a task.
  for (const diversify of [true, false]) for (const row of ranked) {
    const materialId = row.chunk.materialId.toHexString(); const key = `${materialId}:${row.chunk.index}`;
    if (selected.has(key) || (diversify && materials.has(materialId)) || seeds.length >= (input.maxChunks ?? 8)) continue;
    selected.add(key); materials.add(materialId); seeds.push({ materialId, chunkIndex: row.chunk.index, text: row.chunk.text, preferredStart: row.preferredStart });
  }
  return { seeds, referencedMaterials: [...materials], rejectedReferences };
}
export async function readCatalogOriginalSeeds(input: { courseId: ObjectId; query: string; chunks: Array<WithId<MaterialChunk>>; sources: Array<{ materialId: string; name: string; parserVersion?: string; chunkerVersion?: string }> }) {
  const records = await sourceEvidenceExtractionsCol().find({ courseId: input.courseId, materialId: { $in: input.chunks.map(chunk => chunk.materialId) }, schemaVersion: SOURCE_EXTRACTION_SCHEMA_VERSION, promptVersion: SOURCE_EXTRACTION_PROMPT_VERSION, parentCacheKey: { $exists: false } }).sort({ completedAt: -1 }).limit(300).toArray();
  return selectCatalogOriginalSeeds({ ...input, records });
}
