import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { recoverOutlineFunctions, type OutlineSection } from './outline-controls';
import { createCapturedCompletion } from './completion';
import { hashControl, safeError, sha256 } from './protocol';
import type { ConservativeLedger } from './ledger';
import { summarizeHarnessUsage } from '../prompt-ab/usage-summary';

const argument = (name: string, fallback?: string) => { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1]; };
async function main(): Promise<void> {
  const output = argument('--output'); const ledgerPath = argument('--ledger'); const scope = argument('--scope');
  if (!output || !ledgerPath || !scope) throw new Error('Supply a NEW --output directory and the shared phase --ledger/--scope. Default is zero-call preflight.');
  const baselinePath = argument('--baseline', 'audit-results/quality-lab-2026-10-16/baseline-code/server/src/services/structure-generation.service.ts')!;
  const currentPath = 'server/src/services/structure-generation.service.ts'; const inventoryPath = 'server/src/services/structure-source-inventory.ts';
  const sourcePath = argument('--text', 'audit-results/generation-quality-corpus/chapter-13.txt')!;
  const pdfPath = argument('--pdf', 'audit-results/generation-quality-corpus/chapter-13.pdf')!;
  const [baseline, current, inventory, text, pdf, manifestRaw, ledgerRaw, baselineManifestRaw] = await Promise.all([
    readFile(baselinePath, 'utf8'), readFile(currentPath, 'utf8'), readFile(inventoryPath, 'utf8'), readFile(sourcePath, 'utf8'), readFile(pdfPath),
    readFile('audit-results/generation-quality-corpus/manifest.json', 'utf8'), readFile(ledgerPath, 'utf8'), readFile('audit-results/quality-lab-2026-10-16/baseline-code.json', 'utf8'),
  ]);
  const sourceManifest = JSON.parse(manifestRaw) as { chapters: Array<{ chapter: number; sha256: string; pages: number; url: string }> };
  const chapter = sourceManifest.chapters.find(item => item.chapter === 13); if (!chapter || sha256(pdf) !== chapter.sha256) throw new Error('quality-lab-statistics-original-pdf-mismatch');
  const baselineManifest = JSON.parse(baselineManifestRaw) as { gitObject: string; source: string; purpose: string; files: Array<{ file: string; sha256: string }> };
  if (baselineManifest.files.find(item => item.file === currentPath)?.sha256 !== sha256(baseline)) throw new Error('quality-lab-outline-baseline-provenance-mismatch');
  const page6 = text.split('\f')[5]; if (!page6?.trim()) throw new Error('quality-lab-statistics-page-six-missing');
  const section: OutlineSection = { id: 'C1.S1', materialId: 'chapter-13', materialName: 'Statistics basics — PDF page 6', chunkIndex: 5, text: page6 };
  const old = recoverOutlineFunctions(baseline); const next = recoverOutlineFunctions(current, inventory); const options = { level: 'auto' as const, emphasis: 'balanced' as const };
  if (hashControl(old.functions.sourcePassages(section)) !== hashControl(next.functions.sourcePassages(section))) throw new Error('quality-lab-matched-original-partition-differs');
  const ledger = JSON.parse(ledgerRaw) as ConservativeLedger;
  if (ledger.scope !== scope || ledger.limits.maxSends !== 100 || ledger.limits.maxConservativeTokens !== 2_000_000 || ledger.limits.maxInputTokens !== 200000) throw new Error('quality-lab-outline-ledger-mismatch');
  const arms = [{ id: 'october-14-prompt', functions: old.functions, prompt: old.functions.sourceExtractionPrompt([section], options) },
    { id: 'current-prompt', functions: next.functions, prompt: next.functions.sourceExtractionPrompt([section], options) }].map(arm => ({ ...arm,
      inputEstimate: Buffer.byteLength(JSON.stringify([{ role: 'user', content: arm.prompt }]), 'utf8') + 32 }));
  const controls = { version: 1, source: { pdf: path.resolve(pdfPath), pdfSha256: chapter.sha256, url: chapter.url, totalPdfPages: chapter.pages,
    textFile: path.resolve(sourcePath), textFileSha256: sha256(text), pdfPage: 6, inputText: page6, inputTextSha256: sha256(page6), section, passages: next.functions.sourcePassages(section) },
    baseline: { path: path.resolve(baselinePath), sha256: sha256(baseline), gitObject: baselineManifest.gitObject, retainedSource: baselineManifest.source, purpose: baselineManifest.purpose, declarations: old.identities },
    current: { path: currentPath, sha256: sha256(current), inventoryPath, inventorySha256: sha256(inventory), declarations: next.identities },
    options, model: 'gpt-6-luna', reasoningEffort: 'medium', maxOutputTokens: 8000,
    arms: arms.map(arm => ({ id: arm.id, prompt: arm.prompt, promptSha256: sha256(arm.prompt), inputEstimate: arm.inputEstimate, firstSendConservativeTokens: arm.inputEstimate + 8000 })),
    remainingSends: 100 - ledger.reservedSends, remainingConservativeTokens: 2_000_000 - ledger.conservativeTokens,
    mutationScope: 'No Mongo/Qdrant/source/Bank/config writes. Local evidence and shared conservative ledger only.', teacherAcceptance: null,
    limitations: ['This is a prospective matched two-call comparison of actual retained/current extraction prompts, not a reconstructed historical response.',
      'Source text, numbered source passages, instructor options, model, effort and output cap are identical. Prompt protocol is the experimental variable.',
      'One page and one repetition are a regression probe, not full multi-file semantic coverage or a general quality improvement measurement.'] };
  await mkdir(output, { recursive: false }); await writeFile(path.join(output, 'controls.json'), JSON.stringify(controls, null, 2) + '\n', { flag: 'wx' });
  const live = argument('--live'); if (live !== undefined && live !== 'once') throw new Error('quality-lab-live-must-be-once');
  if (!live) { console.log(JSON.stringify({ preflight: true, providerCalls: 0, output, arms: controls.arms.map(arm => ({ id: arm.id, conservativeTokens: arm.firstSendConservativeTokens })) })); return; }
  if (controls.remainingSends < 2 || controls.arms.reduce((sum, arm) => sum + arm.firstSendConservativeTokens, 0) > controls.remainingConservativeTokens) throw new Error('quality-lab-extraction-pair-does-not-fit-remaining-ledger');
  const [{ completeJson }, { AuthoringBudget, withAuthoringBudget }] = await Promise.all([import('../../server/src/components/genai/llm'), import('../../server/src/services/authoring-budget.service')]);
  const budget = new AuthoringBudget(`${scope}:statistics-extraction-pair`, { maxSends: 4, maxInputTokens: 24000, maxOutputTokens: 8000, maxEstimatedTokens: controls.remainingConservativeTokens });
  const assertCurrent = async () => { if (sha256(await readFile(currentPath)) !== controls.current.sha256 || sha256(await readFile(inventoryPath)) !== controls.current.inventorySha256 || sha256(await readFile(baselinePath)) !== controls.baseline.sha256) throw new Error('quality-lab-extraction-pair-code-changed'); };
  const recorder = createCapturedCompletion({ directory: path.join(output, 'transcripts'), ledgerPath, scope, limits: ledger.limits,
    cellId: 'statistics-page-six', complete: completeJson, maxInputTokens: 24000, maxOutputTokens: 8000, assertCurrent });
  const outcomes: Array<Record<string, unknown>> = []; let status = 'running'; let terminalError: ReturnType<typeof safeError> | null = null;
  const save = async () => { const file = path.join(output, 'results.json'); const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify({ version: 1, status, controlsSha256: hashControl(controls), outcomes, captures: recorder.captures,
      budget: budget.snapshot(), usage: summarizeHarnessUsage(recorder.captures.filter(item => item.transcript).flatMap(item => item.transcript.attempts.flatMap(attempt => attempt.events)), { coverageComplete: true }),
      teacherAcceptance: null, error: terminalError, limitations: controls.limitations }, null, 2) + '\n', { flag: 'wx' }); await rename(temporary, file); };
  await save();
  try {
    await withAuthoringBudget(budget, async () => {
      for (const arm of arms) {
        const raw = await recorder.complete<unknown>(arm.prompt, { model: 'gpt-6-luna', reasoningEffort: 'medium', maxTokens: 8000, usageContext: { stage: arm.id } });
        let ownValidation: unknown; let ownValidationError: ReturnType<typeof safeError> | null = null;
        let commonStrictValidation: unknown; let commonStrictError: ReturnType<typeof safeError> | null = null;
        try { ownValidation = arm.functions.validateSourceExtraction(raw, [section], arm.id === 'current-prompt'); } catch (error) { ownValidationError = safeError(error); }
        try { commonStrictValidation = next.functions.validateSourceExtraction(raw, [section], true); } catch (error) { commonStrictError = safeError(error); }
        outcomes.push({ arm: arm.id, raw, ownValidation: ownValidation ?? null, ownValidationError, commonStrictValidation: commonStrictValidation ?? null, commonStrictError,
          teacherAcceptance: null, semanticCoverage: null }); await save();
      }
    }); status = 'completed';
  } catch (error) { status = 'stopped'; terminalError = safeError(error); process.exitCode = 1; }
  finally { await save(); }
  console.log(JSON.stringify({ status, output: path.resolve(output), observedSends: budget.snapshot().observedSends }));
}
if (require.main === module) void main().catch(error => { console.error(safeError(error).message); process.exitCode = 1; });
