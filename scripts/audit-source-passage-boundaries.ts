import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import vm from 'node:vm';
import ts from 'typescript';
import { splitSourcePassages, resolveSourcePassagePolicy, SOURCE_PASSAGE_POLICY, LEGACY_SOURCE_PASSAGE_POLICY } from '../server/src/services/source-passages';
import type { finalizeStructureCoverage, sourceExtractionPrompt } from '../server/src/services/structure-generation.service';
import type { StructureReviewCheckpointBody } from '../server/src/types/structure-review';
import type { StructureResult } from '../server/src/types/structure';

const root = path.resolve(__dirname, '..');
const archive = 'audit-results/quality-lab-public-http-2026-10-17-live/code-snapshot';
const checkpointPath = 'audit-results/quality-lab-outline-continuation-2026-10-17/checkpoint-body.json';
const resultPath = 'audit-results/quality-lab-outline-continuation-2026-10-17/live-after-fixture-reconciliation/results.json';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function declaration(source: string, name: string): string {
  const file = ts.createSourceFile('trusted-source.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const node of file.statements) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) return node.getText(file).replace(/^export\s+/, '');
    if (ts.isVariableStatement(node)) for (const item of node.declarationList.declarations) if (ts.isIdentifier(item.name) && item.name.text === name) return `const ${item.getText(file)};`;
  }
  throw new Error(`Missing trusted declaration: ${name}`);
}
function recover<T>(sources: Array<{ source: string; names: string[] }>, exports: string, globals: Record<string, unknown>): T {
  const code = sources.flatMap(item => item.names.map(name => declaration(item.source, name))).join('\n') + `\n(${exports});`;
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return vm.runInNewContext(compiled, globals, { timeout: 1000 }) as T;
}
function passageBoundaries(sections: Array<{ text: string }>, rows: Array<Array<{ text: string }>>) {
  let lineOrPage = 0; let withinLine = 0;
  for (const [index, section] of sections.entries()) {
    let previousEnd = 0;
    for (const [position, passage] of rows[index].entries()) {
      const start = section.text.indexOf(passage.text, previousEnd);
      assert(start >= previousEnd, 'Passage order cannot be rebound to its original section.');
      if (position > 0) {
        if (/[\r\n\f]/.test(section.text.slice(previousEnd, start))) lineOrPage++; else withinLine++;
      }
      previousEnd = start + passage.text.length;
    }
  }
  return { total: lineOrPage + withinLine, lineOrPage, withinLine };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--output') throw new Error('Use --output with a new local evidence directory. No model or database operation exists in this tool.');
  const output = path.resolve(root, args[1]);
  assert(output.startsWith(path.join(root, 'audit-results') + path.sep), 'Output must be inside this repository audit-results directory.');
  const files = ['scripts/audit-source-passage-boundaries.ts', checkpointPath, resultPath, `${archive}/manifest-final.json`, `${archive}/server/src/services/structure-generation.service.ts`,
    'server/src/services/source-passages.ts', 'server/src/services/structure-generation.service.ts', 'server/src/services/structure-source-inventory.ts', 'server/src/services/source-evidence-cache.service.ts'];
  const raw = new Map(await Promise.all(files.map(async file => [file, await readFile(path.join(root, file), 'utf8')] as const)));
  const manifest = JSON.parse(raw.get(`${archive}/manifest-final.json`)!) as { files: Array<{ file: string; expectedSha256: string; snapshotSha256: string; verified: boolean }> };
  const oldSource = raw.get(`${archive}/server/src/services/structure-generation.service.ts`)!;
  const pin = manifest.files.find(row => row.file === 'server/src/services/structure-generation.service.ts');
  assert(pin?.verified && pin.expectedSha256 === hash(oldSource) && pin.snapshotSha256 === hash(oldSource), 'Archived production source does not match its retained hash receipt.');
  const body = JSON.parse(raw.get(checkpointPath)!) as StructureReviewCheckpointBody;
  const retained = (JSON.parse(raw.get(resultPath)!) as { child: { structureResult: StructureResult } }).child.structureResult;
  assert.equal(body.corpus.passagePolicy, undefined, 'This counterexample must remain a historical pre-policy checkpoint.');
  assert.equal(body.corpus.sections.length, 671);
  const legacy = recover<(section: { id: string; text: string }) => Array<{ id: string; text: string }>>([
    { source: oldSource, names: ['sourcePassages'] },
  ], 'sourcePassages', {});
  const inventorySource = raw.get('server/src/services/structure-source-inventory.ts')!;
  const currentSource = raw.get('server/src/services/structure-generation.service.ts')!;
  const current = recover<{ finalizeStructureCoverage: typeof finalizeStructureCoverage; sourceExtractionPrompt: typeof sourceExtractionPrompt;
    batchLimits: { sections: number; characters: number } }>([
    { source: inventorySource, names: ['structurePassageCues', 'structureSourceInventory', 'structureNoObjectiveWarning'] },
    { source: currentSource, names: ['sourcePassages', 'sourceExtractionPrompt', 'finalizeStructureCoverage', 'MAX_BATCH_SECTIONS', 'MAX_BATCH_CHARS'] },
  ], '{finalizeStructureCoverage,sourceExtractionPrompt,batchLimits:{sections:MAX_BATCH_SECTIONS,characters:MAX_BATCH_CHARS}}',
  { splitSourcePassages, resolveSourcePassagePolicy, SOURCE_PASSAGE_POLICY, LEGACY_SOURCE_PASSAGE_POLICY });
  const identity = recover<(input: Record<string, unknown>) => { cacheKey: string; promptTextHash: string }>([
    { source: raw.get('server/src/services/source-evidence-cache.service.ts')!, names: ['SOURCE_EXTRACTION_PROMPT_VERSION', 'SOURCE_EXTRACTION_SCHEMA_VERSION', 'sourceEvidenceHash', 'sourceExtractionIdentity'] },
  ], 'sourceExtractionIdentity', { createHash, resolveSourcePassagePolicy });
  const beforeStart = performance.now();
  const previous = body.corpus.sections.map(section => legacy({ ...section, id: section.localId ?? section.id }));
  const beforeMs = performance.now() - beforeStart;
  const afterStart = performance.now();
  const revised = body.corpus.sections.map(section => splitSourcePassages({ ...section, id: section.localId ?? section.id }));
  const afterMs = performance.now() - afterStart;
  const comparisons = body.corpus.sections.map((section, index) => {
    const before = previous[index]; const after = revised[index];
    assert.deepEqual(JSON.parse(JSON.stringify(splitSourcePassages({ ...section, id: section.localId ?? section.id }, LEGACY_SOURCE_PASSAGE_POLICY))), JSON.parse(JSON.stringify(before)));
    for (const passage of after) assert(passage.text.length <= 500 && passage.text.length > 0 && section.text.includes(passage.text), 'A new passage is too large or not an exact original substring.');
    assert.equal(after.map(row => row.text.replace(/\s/g, '')).join(''), section.text.replace(/\s/g, ''), 'A non-whitespace source character was changed or omitted.');
    const local = [{ ...section, id: section.localId ?? section.id }];
    const oldPrompt = current.sourceExtractionPrompt(local, body.options, LEGACY_SOURCE_PASSAGE_POLICY);
    const newPrompt = current.sourceExtractionPrompt(local, body.options, SOURCE_PASSAGE_POLICY);
    const material = body.corpus.materials.find(row => row.materialId === section.materialId)!;
    const base = { courseId: { toHexString: () => body.courseId }, materialId: section.materialId, sourceTextHash: material.sourceTextHash,
      parserVersion: material.parserVersion, chunkerVersion: material.chunkerVersion, sourceTitle: material.name,
      guidance: body.options.guidance ?? '', modelConfiguration: body.model, sections: local };
    const oldKey = identity({ ...base, passagePolicy: LEGACY_SOURCE_PASSAGE_POLICY, promptText: oldPrompt });
    const newKey = identity({ ...base, passagePolicy: SOURCE_PASSAGE_POLICY, promptText: newPrompt });
    const changed = JSON.stringify(before) !== JSON.stringify(after);
    assert.equal(oldPrompt !== newPrompt, changed, 'Unexpected prompt change outside source partition payload.');
    assert.equal(oldKey.cacheKey !== newKey.cacheKey, changed, 'Unchanged source spans lost their extraction cache identity.');
    return { materialId: section.materialId, materialName: section.materialName, sectionId: section.id, localId: section.localId, chunkIndex: section.chunkIndex,
      inputText: section.text, inputSha256: hash(section.text), changed, before, after, oldPromptSha256: hash(oldPrompt), newPromptSha256: hash(newPrompt),
      oldCacheKey: oldKey.cacheKey, newCacheKey: newKey.cacheKey };
  });
  // Parent and child cache keys also bind the entire enclosing batch. Identical
  // single-section payloads do not establish actual reuse from another parent.
  const batches: StructureReviewCheckpointBody['corpus']['sections'][] = [];
  for (const section of body.corpus.sections) {
    let last = batches.at(-1);
    if (!last || last[0].materialId !== section.materialId || last.length >= current.batchLimits.sections ||
        last.reduce((sum, value) => sum + value.text.length, 0) + section.text.length > current.batchLimits.characters) { last = []; batches.push(last); }
    last.push(section);
  }
  const batchComparisons = batches.map(batch => {
    const local = batch.map(section => ({ ...section, id: section.localId ?? section.id }));
    const changed = current.sourceExtractionPrompt(local, body.options, LEGACY_SOURCE_PASSAGE_POLICY) !== current.sourceExtractionPrompt(local, body.options, SOURCE_PASSAGE_POLICY);
    return { sectionIds: batch.map(section => section.id), changed };
  });
  const sectionsInChangedBatches = new Set(batchComparisons.filter(batch => batch.changed).flatMap(batch => batch.sectionIds));
  const historical = current.finalizeStructureCoverage(body, retained.themes, retained.coverage.budget, retained.coverage.outlineGrounding);
  assert.deepEqual(JSON.parse(JSON.stringify(historical.coverage.sourceInventory!.targets)), retained.coverage.sourceInventory!.targets, 'Historical final inventory target identities or quotes changed.');
  const table = comparisons.find(row => row.sectionId === 'S547')!;
  const expectedRow = 'Newfoundland Light & Power   + 1.80%';
  assert.equal(table.before.some(row => row.text.includes(expectedRow)), false);
  assert.equal(table.after.filter(row => row.text.includes(expectedRow)).length, 1);
  const result = { version: 1, scope: 'File-only structural passage repair; no new model output, saved question, source write or semantic acceptance.',
    inputs: files.map(file => ({ file, sha256: hash(raw.get(file)!) })), policies: { before: LEGACY_SOURCE_PASSAGE_POLICY, after: SOURCE_PASSAGE_POLICY },
    sections: comparisons.length, changedSections: comparisons.filter(row => row.changed).length,
    beforePassages: previous.reduce((n, rows) => n + rows.length, 0), afterPassages: revised.reduce((n, rows) => n + rows.length, 0),
    beforeQuoteCharacters: previous.flat().reduce((n, row) => n + row.text.length, 0), afterQuoteCharacters: revised.flat().reduce((n, row) => n + row.text.length, 0),
    boundaries: { before: passageBoundaries(body.corpus.sections, previous), after: passageBoundaries(body.corpus.sections, revised),
      definition: 'Inter-passage quote gaps containing a native newline/form-feed versus cuts within the same native text line.' },
    batchCache: { batchLimits: current.batchLimits, totalBatches: batches.length,
      changedBatchIdentities: batchComparisons.filter(batch => batch.changed).length, unchangedBatchIdentities: batchComparisons.filter(batch => !batch.changed).length,
      sectionsInChangedBatches: sectionsInChangedBatches.size,
      unchangedSectionsInChangedBatches: comparisons.filter(section => !section.changed && sectionsInChangedBatches.has(section.sectionId)).length,
      actualReuse: null, databaseLookupPerformed: false },
    beforeMs, afterMs, maximumNewQuoteCharacters: Math.max(...revised.flat().map(row => row.text.length)),
    checks: { exactOriginalSubstrings: true, noNonWhitespaceLoss: true, maximum500: true, unchangedSpansKeepCacheKey: true, changedSpansChangePromptAndKey: true,
      historicalInventoryTargetsByteEquivalent: true, historicalTargets: historical.coverage.sourceInventory!.targets.length },
    counterexample: table, providerCalls: 0, databaseCalls: 0, teacherAcceptance: null,
    limitations: ['This removes an artificial line split. It does not prove that a new model will interpret a company row correctly.',
      'A line longer than 500 characters still requires bounded fallback and separate supporting original passages.',
      'Unchanged per-section identities do not guarantee cache hits when their enclosing batch identity changes; no database lookup or warm-hit estimate was performed.',
      'Chunk boundaries and missing chart semantics remain separate problems. The plaintext parser output and stored source records are unchanged.',
      'Reported times measure only two in-memory splitter loops on retained sections, not upload, extraction or end-to-end model latency.'] };
  await mkdir(output, { recursive: false });
  await writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  await writeFile(path.join(output, 'all-sections.json'), JSON.stringify(comparisons, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ output, sections: result.sections, changedSections: result.changedSections, beforePassages: result.beforePassages,
    afterPassages: result.afterPassages, checks: result.checks, providerCalls: 0, databaseCalls: 0 }));
}
void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
