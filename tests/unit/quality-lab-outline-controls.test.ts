import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { extractionPreflight, fixtureSections, recoverOutlineFunctions, type OutlineCorpusFixture, type OutlineSection } from '../../scripts/quality-lab/outline-controls';
import { SOURCE_PASSAGE_POLICY, LEGACY_SOURCE_PASSAGE_POLICY, legacySourcePassages } from '../../server/src/services/source-passages';

const root = path.join(__dirname, '../..');
const source = readFileSync(path.join(root, 'server/src/services/structure-generation.service.ts'), 'utf8');
const inventory = readFileSync(path.join(root, 'server/src/services/structure-source-inventory.ts'), 'utf8');
const recovered = recoverOutlineFunctions(source, inventory);
function fixture(): OutlineCorpusFixture {
  const sources = [3, 6].map(chapter => {
    const chunks = Array.from({ length: 18 }, (_, index) => ({ index, text: `Chapter ${chapter}: original paragraph ${index}. `.repeat(10), characterCount: 0 }));
    chunks.forEach(chunk => { chunk.characterCount = chunk.text.length; });
    const hash = createHash('sha256'); for (const chunk of chunks) hash.update(`${chunk.index}:${Buffer.byteLength(chunk.text, 'utf8')}:`).update(chunk.text);
    const sourceTextHash = hash.digest('hex'); const materialId = `material-${chapter}`;
    const snapshot = { materialId, name: `Chapter ${chapter}`, sourceTextHash, chunkCount: chunks.length, characterCount: chunks.reduce((sum, chunk) => sum + chunk.text.length, 0), parserVersion: 'fixture-parser', chunkerVersion: 'fixture-chunker' };
    return { chapter, pages: 20, publicPdf: '/ignored/fixture.pdf', pdfSha256: 'pdfhash', materialId, name: snapshot.name,
      manifest: { ...snapshot, indexedCount: chunks.length }, readiness: { materialId, name: snapshot.name, ready: true, state: 'indexed' as const, classification: 'completed' as const, snapshot }, chunks };
  });
  return { version: 1, courseId: 'course', actor: 'QUALITY-RETEST-FIXTURE-test', database: 'financebot_quality_smoke_retest_test', fixtureKind: 'controlled', createdAt: '2026-10-16', copiedCacheRows: 0, sources };
}
describe('zero-call recovered outline experiment controls', () => {
  it('recovers actual source prompt and dependencies with exact original passage groups', () => {
    const section: OutlineSection = { id: 'C1.S1', materialId: 'source', materialName: 'Original statistics', chunkIndex: 0, text: 'The variance definition uses the population denominator. '.repeat(10) + 'Standard deviation is the square root of variance.' };
    const prompt = recovered.functions.sourceExtractionPrompt([section], {});
    const passages = recovered.functions.sourcePassages(section);
    expect(prompt).toContain('supportingPassageIds'); expect(prompt).toContain('passageDispositions'); expect(passages.length).toBeGreaterThan(1);
    expect(prompt).toContain(JSON.stringify(passages.at(-1)!.text));
    expect(() => recoverOutlineFunctions(source)).toThrow('dependency-missing');
    const incomplete = { sections: [{ sectionId: section.id, objectives: [{ name: 'Explain the source variance definition', passageId: passages[0]!.id }] }] };
    expect(() => recovered.functions.validateSourceExtraction(incomplete, [section], true)).toThrow('Missing objective references');
    const complete = { sections: [{ sectionId: section.id, objectives: [{ name: 'Explain variance and the square-root relationship to standard deviation', passageId: passages[0]!.id, supportingPassageIds: passages.slice(1).map(passage => passage.id) }] }] };
    expect(recovered.functions.validateSourceExtraction(complete, [section], true)[0]!.objectives[0]!.supportingPassages).toHaveLength(passages.length - 1);
  });
  it('retains an archived inline helper without current module bindings or a fresh-policy default', () => {
    // Retained declarations remain independently executable. This fixture uses
    // the historical algorithm and contains no imported policy dependencies.
    const inline = `export function sourcePassages(section: Section): Array<{ id: string; text: string }> {
      const passages: Array<{ id: string; text: string }> = [];
      for (let start = 0; start < section.text.length;) {
        let end = Math.min(start + 500, section.text.length);
        if (end < section.text.length) {
          const whitespace = section.text.slice(start, end).search(/\\s+\\S*$/);
          if (whitespace > 250) end = start + whitespace;
        }
        const text = section.text.slice(start, end).trim();
        if (text) passages.push({ id: \`\${section.id}.P\${passages.length + 1}\`, text });
        start = end;
      }
      return passages;
    }`;
    const archived = source.replace(/export function sourcePassages\([\s\S]*?\n}/, inline)
      .replaceAll('LEGACY_SOURCE_PASSAGE_POLICY', JSON.stringify(LEGACY_SOURCE_PASSAGE_POLICY));
    const old = recoverOutlineFunctions(archived, inventory);
    const section: OutlineSection = { id: 'C1.S1', materialId: 'source', materialName: 'Retained source', chunkIndex: 0,
      text: `${'A'.repeat(481)}\nNewfoundland Light & Power   + 1.80%\nTail` };
    expect(old.functions.freshPassagePolicy).toBeUndefined();
    expect(old.identities.some(row => row.name.startsWith('source-passages:'))).toBe(false);
    expect(old.functions.sourcePassages(section)).toEqual(legacySourcePassages(section));
    expect(old.functions.sourceExtractionPrompt([section], {})).toBe(recovered.functions.sourceExtractionPrompt([section], {}, LEGACY_SOURCE_PASSAGE_POLICY));
  });
  it('uses the explicit current line policy only for new extraction preflight prompts', () => {
    const currentFixture = fixture();
    const source = currentFixture.sources[0]!;
    source.chunks[0]!.text = `${'A'.repeat(481)}\nNewfoundland Light & Power   + 1.80%\nTail`;
    source.chunks[0]!.characterCount = source.chunks[0]!.text.length;
    const hash = createHash('sha256');
    for (const chunk of source.chunks) hash.update(`${chunk.index}:${Buffer.byteLength(chunk.text, 'utf8')}:`).update(chunk.text);
    source.manifest.sourceTextHash = hash.digest('hex');
    source.manifest.characterCount = source.chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
    source.readiness.snapshot = { ...source.readiness.snapshot!, sourceTextHash: source.manifest.sourceTextHash, characterCount: source.manifest.characterCount };
    const plan = extractionPreflight({ fixture: currentFixture, functions: recovered.functions, batchLimits: recovered.batchLimits, options: {}, outputCap: 1000,
      remainingSends: 100, remainingConservativeTokens: 1000000 });
    expect(recovered.functions.freshPassagePolicy).toBe(SOURCE_PASSAGE_POLICY);
    expect(recovered.identities.find(row => row.name === 'source-passages:module')!.sha256).toBe(createHash('sha256').update(readFileSync(path.join(root, 'server/src/services/source-passages.ts'))).digest('hex'));
    const first = plan.corpus.sections.filter(section => plan.sends[0]!.sectionIds.includes(section.localId!) && section.materialId === plan.sends[0]!.materialId)
      .map(section => ({ ...section, id: section.localId! }));
    expect(plan.sends[0]!.prompt).toBe(recovered.functions.sourceExtractionPrompt(first, {}, SOURCE_PASSAGE_POLICY));
    expect(plan.sends[0]!.prompt).not.toBe(recovered.functions.sourceExtractionPrompt(first, {}));
  });
  it('retains every chunk and reports explicit subset exclusions without relabelling full coverage', () => {
    const original = fixture(); const all = fixtureSections(original); expect(all.sections).toHaveLength(36);
    const subset = fixtureSections(original, [3]); expect(subset.sections).toHaveLength(18); expect(subset.excluded).toEqual([{ chapter: 6, name: 'Chapter 6', reason: 'explicit-experiment-subset' }]);
    const corrupted = fixture(); corrupted.sources[0]!.chunks[2]!.text += 'changed';
    expect(() => fixtureSections(corrupted)).toThrow('chunks-incomplete');
  });
  it('uses exact production batch constants and fails the known extraction minimum against remaining allowance', () => {
    const plan = extractionPreflight({ fixture: fixture(), functions: recovered.functions, batchLimits: recovered.batchLimits, options: {}, outputCap: 10000, remainingSends: 2, remainingConservativeTokens: 1000 });
    expect(recovered.batchLimits).toEqual({ sections: 16, characters: 18000 }); expect(plan.sends).toHaveLength(4);
    expect(plan.summary.initialExtractionFits).toBe(false); expect(plan.summary.guaranteedTotalFits).toBe(false);
    expect(plan.summary.initialExtractionConservativeTokens).toBe(plan.summary.extractionInputEstimate + 40000);
    expect(plan.sends.every(send => send.reservedOutputTokens === 10000)).toBe(true);
  });
});
