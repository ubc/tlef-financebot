/** Offline contract audit over retained public originals. No model or DB calls.
 * This demonstrates missing-passage detection, not a new model quality score. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { sourcePassages, validateSourceExtraction, validateCachedSourceExtraction, structureSynthesisLedger } from '../server/src/services/structure-generation.service';
import { structurePassageCues } from '../server/src/services/structure-source-inventory';

const values = process.argv.slice(2);
const argument = (name: string, fallback: string) => values.includes(name) ? values[values.indexOf(name) + 1] : fallback;
const corpus = resolve(argument('--corpus', 'audit-results/generation-quality-corpus'));
const output = resolve(argument('--out', 'audit-results/quality-authoring-2026-10-16/source-inventory-offline.json'));
const inventory = JSON.parse(readFileSync('scripts/prompt-ab/fixtures/public-source-coverage-inventory.json', 'utf8')) as {
  benchmarkSources: { coldBatch: number[] }; items: Array<{ chapter: number; sourceSha256: string }>;
};
const originals = inventory.benchmarkSources.coldBatch.map(chapter => {
  const name = `chapter-${String(chapter).padStart(2, '0')}`;
  const pdf = readFileSync(resolve(corpus, `${name}.pdf`));
  const sourceSha256 = createHash('sha256').update(pdf).digest('hex');
  if (sourceSha256 !== inventory.items.find(item => item.chapter === chapter)!.sourceSha256) throw new Error(`Changed public source: ${name}`);
  const text = readFileSync(resolve(corpus, `${name}.txt`), 'utf8');
  const pages = text.split('\f').filter(page => page.trim());
  const targets = pages.flatMap((page, index) => sourcePassages({ id: `PDF${index + 1}`, materialId: name, materialName: name, chunkIndex: index, text: page })
    .map(passage => ({ id: passage.id, reviewCues: structurePassageCues(passage.text), status: 'unreviewed' })));
  return { chapter, sourceSha256, originalPages: pages.length, parsedTextSha256: createHash('sha256').update(text).digest('hex'),
    parsedTextCharacters: text.length, parsedPassages: targets.length,
    reviewCueCounts: Object.fromEntries(['formula', 'numerical-relationship', 'visual-relationship'].map(cue => [cue, targets.filter(target => target.reviewCues.includes(cue as never)).length])),
    modelCalls: 0, semanticCoverage: null };
});
const chapter13 = readFileSync(resolve(corpus, 'chapter-13.txt'), 'utf8');
const page6 = chapter13.split('\f')[5];
const section = { id: 'C1.S1', materialId: 'chapter-13', materialName: 'Statistics basics — PDF page 6', chunkIndex: 5, text: page6 };
const passages = sourcePassages(section);
if (passages.length < 2 || passages.length > 8) throw new Error('Unexpected fixed regression partition.');
const point = { name: 'Distinguish variance denominators and compute standard deviation as the square root of variance', passageId: passages[0].id };
const oldStyle = { sections: [{ sectionId: section.id, objectives: [point] }] };
const previousContractAccepted = !!validateSourceExtraction(oldStyle, [section]);
let strictFailure = '';
try { validateSourceExtraction(oldStyle, [section], true); } catch (error) { strictFailure = (error as Error).message; }
if (!strictFailure.includes('Missing objective references')) throw new Error('The incomplete source contract was not detected.');
// A declared deterministic control response, not a model-generated improvement.
const completeControl = { sections: [{ sectionId: section.id, objectives: [{ ...point, supportingPassageIds: passages.slice(1).map(passage => passage.id) }] }] };
const checked = validateSourceExtraction(completeControl, [section], true);
validateCachedSourceExtraction(checked, [section], true);
const evidence = [{ id: 'E1', objective: point.name, materialId: section.materialId, materialName: section.materialName, chunkIndex: section.chunkIndex,
  quote: checked[0].objectives[0].quote, sourcePassageId: point.passageId, supportingPassages: checked[0].objectives[0].supportingPassages }];
const ledger = structureSynthesisLedger(evidence);
const result = { version: 1, recordedAt: new Date().toISOString(), providerCalls: 0, databaseWrites: 0,
  method: 'Offline partition of the same retained PDF text, exact source-byte hashes and deterministic protocol controls. No new model output or semantic score.',
  originalFiles: originals, summary: { files: originals.length, pages: originals.reduce((sum, source) => sum + source.originalPages, 0),
    passages: originals.reduce((sum, source) => sum + source.parsedPassages, 0), semanticCoverage: null },
  fixedInputRegression: { source: 'chapter-13.txt', pdfPage: 6, inputText: page6,
    inputSha256: createHash('sha256').update(page6).digest('hex'), passages,
    historicalFindingReference: 'audit-results/generation-quality-corpus/inventory-source-audit.json#public-corpus-14',
    historicalFinding: 'The existing October 14 audit found the square-root relationship absent from extracted names and an exact first quote ending before a named denominator distinction. The raw historical response is not reconstructed here.',
    oldStyleControlInput: oldStyle, previousContractAccepted, strictFailure,
    completeDeterministicControl: completeControl, checkedOriginalGroups: checked[0].objectives[0], synthesisLedger: JSON.parse(ledger.ledger),
    outcome: 'An incomplete first-quote-only response is now detected; a declared complete source group round-trips with exact originals. This is not a measured model improvement.' },
  limitations: ['All cue matches remain unreviewed until actual extraction and source review.', 'A passage linked to an LO does not prove every concept within that passage is covered.',
    'PDF page partitions are this offline audit scope; they are not relabelled as the prior ingestion chunk boundaries.', 'No OCR or vision extraction was added. Chart values, geometry, actors and relations absent from parsed text require original visual inspection.'] };
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
process.stdout.write(JSON.stringify({ output, ...result.summary, incompleteResponseDetected: !!strictFailure, exactSourceGroups: passages.length }) + '\n');
