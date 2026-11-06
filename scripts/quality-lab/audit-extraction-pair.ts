import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SourceExtractionSection } from '../../server/src/types/source-evidence';
import type { StructureOptions } from '../../server/src/types/structure';
import { recoverOutlineFunctions, type OutlineSection } from './outline-controls';
import { safeError, sha256 } from './protocol';

const argument = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
/** Trusted VM errors live in another realm and need not satisfy instanceof.
 * Normalize only the plain message through the same credential-safe sanitizer. */
export function safeRealmError(error: unknown): ReturnType<typeof safeError> {
  const message = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : 'Unknown failure';
  return safeError(new Error(message));
}
interface PairControls {
  source: { pdf: string; pdfSha256: string; pdfPage: number; section: OutlineSection; inputTextSha256: string };
  baseline: { path: string; sha256: string };
  current: { path: string; sha256: string; inventoryPath: string; inventorySha256: string };
  options: StructureOptions;
  arms: Array<{ id: string; prompt: string; promptSha256: string }>;
}
async function main(): Promise<void> {
  const directory = argument('--pair'); const output = argument('--output');
  if (!directory || !output) throw new Error('Supply --pair <terminal-pair-directory> and --output <new-audit.json>. No model/DB calls.');
  const [controlsRaw, resultRaw] = await Promise.all([readFile(path.join(directory, 'controls.json'), 'utf8'), readFile(path.join(directory, 'results.json'), 'utf8')]);
  const controls = JSON.parse(controlsRaw) as PairControls; const result = JSON.parse(resultRaw) as { status: string; outcomes: Array<{ arm: string; raw: unknown; commonStrictError: unknown }> };
  if (!['completed', 'stopped'].includes(result.status)) throw new Error('quality-lab-extraction-pair-still-live');
  const [baseline, current, inventory, pdf] = await Promise.all([readFile(controls.baseline.path, 'utf8'), readFile(controls.current.path, 'utf8'), readFile(controls.current.inventoryPath, 'utf8'), readFile(controls.source.pdf)]);
  if (sha256(baseline) !== controls.baseline.sha256 || sha256(current) !== controls.current.sha256 || sha256(inventory) !== controls.current.inventorySha256 || sha256(pdf) !== controls.source.pdfSha256 || sha256(controls.source.section.text) !== controls.source.inputTextSha256) throw new Error('quality-lab-extraction-pair-audit-control-drift');
  const old = recoverOutlineFunctions(baseline); const next = recoverOutlineFunctions(current, inventory);
  const rows = result.outcomes.map(outcome => {
    const functions = outcome.arm === 'october-14-prompt' ? old.functions : next.functions;
    const expectedPrompt = functions.sourceExtractionPrompt([controls.source.section], controls.options);
    const recordedPrompt = controls.arms.find(arm => arm.id === outcome.arm);
    if (!recordedPrompt || expectedPrompt !== recordedPrompt.prompt || sha256(expectedPrompt) !== recordedPrompt.promptSha256) throw new Error('quality-lab-extraction-pair-audit-prompt-drift');
    let ownRows: SourceExtractionSection[] = []; let strictRows: SourceExtractionSection[] = [];
    let ownError: ReturnType<typeof safeError> | null = null; let strictError: ReturnType<typeof safeError> | null = null;
    try { ownRows = functions.validateSourceExtraction(outcome.raw, [controls.source.section], outcome.arm === 'current-prompt'); } catch (error) { ownError = safeRealmError(error); }
    try { strictRows = next.functions.validateSourceExtraction(outcome.raw, [controls.source.section], true); } catch (error) { strictError = safeRealmError(error); }
    const linked = new Set(ownRows.flatMap(row => row.objectives.flatMap(point => [point.passageId, ...(point.supportingPassages ?? []).map(passage => passage.passageId)])));
    const passages = next.functions.sourcePassages(controls.source.section);
    const dispositions = ownRows.flatMap(row => row.passageDispositions ?? []);
    return { arm: outcome.arm, ownProtocolValid: ownError === null, ownError, commonStrictProtocolValid: strictError === null, commonStrictError: strictError,
      originalRecordedCommonStrictError: outcome.commonStrictError, objectives: ownRows.flatMap(row => row.objectives), knowledge: ownRows.flatMap(row => row.knowledge),
      objectiveCount: ownRows.reduce((sum, row) => sum + row.objectives.length, 0), objectiveOriginalReferenceCounts: ownRows.flatMap(row => row.objectives.map(point => 1 + (point.supportingPassages?.length ?? 0))),
      originalPassages: passages.length, objectiveLinkedPassages: linked.size, passageDispositions: dispositions,
      unaccountedPassageIds: passages.filter(passage => !linked.has(passage.id) && !dispositions.some(disposition => disposition.passageId === passage.id)).map(passage => passage.id),
      checkedOriginalGroups: strictRows, teacherAcceptance: null, semanticCoverage: null };
  });
  await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, JSON.stringify({ version: 1, generatedAt: new Date().toISOString(),
    providerCalls: 0, databaseCalls: 0, originalResultsSha256: sha256(resultRaw), controlsSha256: sha256(controlsRaw), pair: path.resolve(directory),
    originalPdfPage: controls.source.pdfPage, originalPageImageReference: path.resolve('audit-results/generation-quality-corpus/audit-chapter-13-page-6.png'), rows,
    limitations: ['This audit revalidates the exact captured model outputs without modifying them, making another model call or fabricating a response.',
      'A common strict passage-accounting pass establishes original-reference completeness only. Every formula, denominator, square-root relationship, objective wording and instructional scope still requires original-page semantic inspection.',
      'One source page and one repetition do not establish general model superiority, teacher acceptance or full ten-file pedagogical coverage.'] }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ output: path.resolve(output), providerCalls: 0, rows: rows.map(row => ({ arm: row.arm, objectives: row.objectiveCount, references: row.objectiveOriginalReferenceCounts, strict: row.commonStrictProtocolValid })) }));
}
if (require.main === module) void main().catch(error => { console.error(safeRealmError(error).message); process.exitCode = 1; });
