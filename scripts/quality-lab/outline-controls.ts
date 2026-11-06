import ts from 'typescript';
import vm from 'node:vm';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { StructureOptions } from '../../server/src/types/structure';
import type { SourceExtractionSection } from '../../server/src/types/source-evidence';
import type { MaterialSourceReadiness } from '../../server/src/types/material-upload';
import { sha256 } from './protocol';
import { splitSourcePassages, resolveSourcePassagePolicy, LEGACY_SOURCE_PASSAGE_POLICY, SOURCE_PASSAGE_POLICY, type SourcePassagePolicy } from '../../server/src/services/source-passages';

export interface OutlineSection { id: string; localId?: string; materialId: string; materialName: string; chunkIndex: number; text: string }
export interface OutlineFunctions {
  sourceExtractionPrompt(sections: OutlineSection[], options: StructureOptions, policy?: SourcePassagePolicy): string;
  sourcePassages(section: OutlineSection, policy?: SourcePassagePolicy): Array<{ id: string; text: string }>;
  validateSourceExtraction(raw: unknown, sections: OutlineSection[], requireAccounting?: boolean, policy?: SourcePassagePolicy): SourceExtractionSection[];
  /** Present only for the current explicitly versioned production helper. */
  freshPassagePolicy?: SourcePassagePolicy;
}
function declarations(source: string): Map<string, string> {
  const file = ts.createSourceFile('trusted-structure.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS); const found = new Map<string, string>();
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) found.set(statement.name.text, statement.getText(file).replace(/^export\s+/, ''));
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) found.set(declaration.name.text, `const ${declaration.getText(file)};`);
  }
  return found;
}
/** Recover actual prompt/validator declarations from trusted retained repository
 * snapshots. No model output is executed, and no database/provider is imported. */
export function recoverOutlineFunctions(source: string, inventorySource?: string): { functions: OutlineFunctions; identities: Array<{ name: string; sha256: string }>;
  batchLimits: { sections: number; characters: number } } {
  const found = declarations(source); const names = ['extractionSchema', 'referencedExtractionSchema', 'normalize', 'sourcePassages', 'validateReferencedExtraction', 'validateExtraction', 'validateSourceExtraction', 'sourceExtractionPrompt'];
  const prompt = found.get('sourceExtractionPrompt') ?? '';
  const validator = found.get('validateSourceExtraction') ?? '';
  const extra = declarations(inventorySource ?? '');
  for (const name of ['structurePassageCues', 'assertStructurePassageAccounting']) if ((prompt + validator).includes(`${name}(`)) {
    const value = extra.get(name); if (!value) throw new Error(`quality-lab-outline-dependency-missing:${name}`); found.set(name, value); names.unshift(name);
  }
  for (const name of names) if (!found.has(name)) throw new Error(`quality-lab-outline-declaration-missing:${name}`);
  const versionedSpans = found.get('sourcePassages')!.includes('splitSourcePassages(');
  const bindings = versionedSpans ? { splitSourcePassages, resolveSourcePassagePolicy, LEGACY_SOURCE_PASSAGE_POLICY } : {};
  const body = `${names.map(name => found.get(name)).join('\n')}\n({sourceExtractionPrompt,sourcePassages,validateSourceExtraction});`;
  const compiled = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, strict: true } }).outputText;
  const functions = vm.runInNewContext(compiled, { z, ...bindings }, { timeout: 1000 }) as OutlineFunctions;
  if (versionedSpans) functions.freshPassagePolicy = SOURCE_PASSAGE_POLICY;
  const integer = (name: string) => { const match = found.get(name)?.match(/=\s*(\d[\d_]*)\s*;/); if (!match) throw new Error(`quality-lab-outline-limit-missing:${name}`); return Number(match[1]!.replaceAll('_', '')); };
  return { functions, identities: [...names.map(name => ({ name, sha256: sha256(found.get(name)!) })), ...(versionedSpans ? [
    { name: 'source-passages:module', sha256: sha256(readFileSync(path.join(__dirname, '../../server/src/services/source-passages.ts'), 'utf8')) },
    { name: 'source-passages:splitSourcePassages', sha256: sha256(splitSourcePassages.toString()) },
    { name: 'source-passages:resolveSourcePassagePolicy', sha256: sha256(resolveSourcePassagePolicy.toString()) },
    { name: 'source-passages:policies', sha256: sha256(JSON.stringify([LEGACY_SOURCE_PASSAGE_POLICY, SOURCE_PASSAGE_POLICY])) },
  ] : [])], batchLimits: { sections: integer('MAX_BATCH_SECTIONS'), characters: integer('MAX_BATCH_CHARS') } };
}
export interface OutlineCorpusFixture {
  version: number; courseId: string; actor: string; database: string; fixtureKind: string; createdAt: string; copiedCacheRows: number;
  sourceBatchId?: string; admission?: unknown;
  sources: Array<{ chapter: number; pages: number; publicPdf: string; pdfSha256: string; materialId: string; name: string;
    manifest: { sourceTextHash: string; chunkCount: number; indexedCount: number; characterCount: number; parserVersion: string; chunkerVersion: string; ingestRunId?: string };
    readiness: MaterialSourceReadiness; chunks: Array<{ index: number; text: string; characterCount: number }> }>;
}
export function validateDeclaredColdFixture(fixture: OutlineCorpusFixture, origin: OutlineCorpusFixture): void {
  const chapters = (sources: OutlineCorpusFixture['sources']) => sources.map(source => source.chapter).sort((a, b) => a - b).join(',');
  if (!['recorded-index-cold-clone', 'http-upload-real-index'].includes(fixture.fixtureKind) || fixture.copiedCacheRows !== 0 ||
      !/^[a-f0-9]{24}$/.test(fixture.courseId) || fixture.courseId === origin.courseId || fixture.database !== origin.database ||
      fixture.sources.length !== 10 || origin.sources.length !== 10 || chapters(fixture.sources) !== chapters(origin.sources) ||
      new Set(fixture.sources.map(source => source.materialId)).size !== 10 || new Set(fixture.sources.map(source => source.chapter)).size !== 10 ||
      fixture.sources.some(item => !/^[a-f0-9]{24}$/.test(item.materialId) || !origin.sources.some(old => old.chapter === item.chapter && old.pdfSha256 === item.pdfSha256) || origin.sources.some(old => old.materialId === item.materialId)) ||
      (fixture.fixtureKind === 'http-upload-real-index' && !/^[a-f0-9]{24}$/.test(fixture.sourceBatchId ?? ''))) throw new Error('quality-lab-outline-phase-cold-ten-fixture-required');
  fixtureSections(fixture);
  for (const source of fixture.sources) {
    const snapshot = source.readiness.snapshot;
    if (source.readiness.materialId !== source.materialId || source.readiness.name !== source.name || !snapshot || snapshot.materialId !== source.materialId || snapshot.name !== source.name ||
        snapshot.sourceTextHash !== source.manifest.sourceTextHash || snapshot.chunkCount !== source.manifest.chunkCount || snapshot.characterCount !== source.manifest.characterCount ||
        snapshot.parserVersion !== source.manifest.parserVersion || snapshot.chunkerVersion !== source.manifest.chunkerVersion || snapshot.ingestRunId !== source.manifest.ingestRunId) throw new Error('quality-lab-outline-cold-readiness-identity-mismatch');
  }
}
export function outlineOptionsForFixture(fixture: OutlineCorpusFixture, chapters?: readonly number[]): StructureOptions & { materialIds: string[] } {
  return { materialIds: fixture.sources.filter(item => !chapters || chapters.includes(item.chapter)).map(item => item.materialId),
    ...(fixture.sourceBatchId ? { sourceBatchId: fixture.sourceBatchId } : {}), level: 'auto', emphasis: 'balanced' };
}
export function fixtureSections(fixture: OutlineCorpusFixture, chapters?: readonly number[]): { sections: OutlineSection[]; included: OutlineCorpusFixture['sources']; excluded: Array<{ chapter: number; name: string; reason: string }> } {
  if (fixture.version !== 1 || !fixture.actor.startsWith('QUALITY-RETEST-FIXTURE-') || !/^financebot_quality_smoke_retest_[a-z0-9_]+$/.test(fixture.database)) throw new Error('quality-lab-outline-fixture-not-owned');
  if (chapters && (!chapters.length || new Set(chapters).size !== chapters.length || chapters.some(chapter => !fixture.sources.some(source => source.chapter === chapter)))) throw new Error('quality-lab-outline-subset-invalid');
  const sections: OutlineSection[] = [];
  const included = fixture.sources.filter(source => !chapters || chapters.includes(source.chapter));
  for (const source of included) {
    const hash = createHash('sha256');
    for (const [index, chunk] of source.chunks.entries()) {
      if (chunk.index !== index || chunk.characterCount !== chunk.text.length || !chunk.text.trim()) throw new Error('quality-lab-outline-fixture-chunks-incomplete');
      hash.update(`${chunk.index}:${Buffer.byteLength(chunk.text, 'utf8')}:`).update(chunk.text);
      for (let start = 0; start < chunk.text.length; start += 5800) {
        sections.push({ id: `S${sections.length + 1}`, localId: `C${chunk.index + 1}.S${Math.floor(start / 5800) + 1}`, materialId: source.materialId,
          materialName: source.name, chunkIndex: chunk.index, text: chunk.text.slice(start, start + 6000) });
        if (start + 6000 >= chunk.text.length) break;
      }
    }
    if (!source.readiness.ready || source.manifest.sourceTextHash !== hash.digest('hex') || source.manifest.chunkCount !== source.chunks.length ||
      source.manifest.indexedCount !== source.chunks.length || source.manifest.characterCount !== source.chunks.reduce((sum, chunk) => sum + chunk.text.length, 0)) throw new Error('quality-lab-outline-fixture-manifest-mismatch');
  }
  return { sections, included, excluded: fixture.sources.filter(source => !included.includes(source)).map(source => ({ chapter: source.chapter, name: source.name, reason: 'explicit-experiment-subset' })) };
}
export function extractionPreflight(input: { fixture: OutlineCorpusFixture; chapters?: readonly number[]; functions: OutlineFunctions; batchLimits: { sections: number; characters: number };
  options: StructureOptions; outputCap: number; remainingSends: number; remainingConservativeTokens: number }) {
  const corpus = fixtureSections(input.fixture, input.chapters); const batches: OutlineSection[][] = [];
  for (const section of corpus.sections) {
    let last = batches.at(-1);
    if (!last || last[0]!.materialId !== section.materialId || last.length >= input.batchLimits.sections || last.reduce((sum, value) => sum + value.text.length, 0) + section.text.length > input.batchLimits.characters) { last = []; batches.push(last); }
    last.push(section);
  }
  const sends = batches.map((batch, index) => {
    const local = batch.map(section => ({ ...section, id: section.localId! }));
    const prompt = input.functions.sourceExtractionPrompt(local, input.options, input.functions.freshPassagePolicy);
    const inputEstimate = Buffer.byteLength(JSON.stringify([{ role: 'user', content: prompt }]), 'utf8') + 32;
    return { index, materialId: batch[0]!.materialId, sourceName: batch[0]!.materialName, sectionIds: local.map(section => section.id),
      sourceCharacters: batch.reduce((sum, section) => sum + section.text.length, 0), prompt, promptSha256: sha256(prompt), inputEstimate,
      reservedOutputTokens: Math.min(12000, input.outputCap), conservativeTokens: inputEstimate + Math.min(12000, input.outputCap) };
  });
  const extractionTokens = sends.reduce((sum, send) => sum + send.conservativeTokens, 0);
  return { corpus, sends, summary: { files: corpus.included.length, pages: corpus.included.reduce((sum, source) => sum + source.pages, 0), sections: corpus.sections.length,
    originalCharacters: corpus.sections.reduce((sum, section) => sum + section.text.length, 0), initialExtractionSends: sends.length,
    extractionInputEstimate: sends.reduce((sum, send) => sum + send.inputEstimate, 0), reservedExtractionOutput: sends.reduce((sum, send) => sum + send.reservedOutputTokens, 0),
    initialExtractionConservativeTokens: extractionTokens, remainingSends: input.remainingSends, remainingConservativeTokens: input.remainingConservativeTokens,
    initialExtractionFits: sends.length <= input.remainingSends && extractionTokens <= input.remainingConservativeTokens,
    minimumAdditionalSynthesisSends: 1, synthesisOutputCap: Math.min(24000, input.outputCap),
    guaranteedTotalFits: false, teacherAccepted: null,
    caveat: 'Exact first-attempt cold extraction estimates only. Actual cache reuse, partial-row repairs, JSON correction, fallback, organized packs and final synthesis are data-dependent; no completion guarantee is inferred.' },
    perSource: corpus.included.map(source => ({ chapter: source.chapter, name: source.name, materialId: source.materialId, pages: source.pages,
      chunks: source.chunks.length, readiness: source.readiness, manifest: source.manifest, pdfSha256: source.pdfSha256,
      initialExtractionSends: sends.filter(send => send.materialId === source.materialId).length,
      conservativeTokens: sends.filter(send => send.materialId === source.materialId).reduce((sum, send) => sum + send.conservativeTokens, 0) })) };
}
