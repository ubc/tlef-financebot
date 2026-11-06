import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { StructureResult, StructureOptions } from '../../server/src/types/structure';
import type { StructureGenerationObserver } from '../../server/src/services/structure-generation.service';
import { extractionPreflight, outlineOptionsForFixture, recoverOutlineFunctions, validateDeclaredColdFixture, type OutlineCorpusFixture } from './outline-controls';
import { createCapturedCompletion } from './completion';
import { hashControl, safeError, sha256 } from './protocol';
import type { ConservativeLedger } from './ledger';
import { summarizeHarnessUsage } from '../prompt-ab/usage-summary';
import { serializeAdmission } from './serialize-admission';
import { assertLedgerIntegrity, readDeclaredOutlinePhase } from './phase-declaration';

const argument = (name: string, fallback?: string) => { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1]; };
const CODE_FILES = ['scripts/quality-lab/run-outline-experiment.ts', 'scripts/quality-lab/outline-controls.ts', 'scripts/quality-lab/serialize-admission.ts', 'scripts/quality-lab/completion.ts', 'scripts/quality-lab/capture.ts', 'scripts/quality-lab/ledger.ts',
  'scripts/quality-lab/phase-declaration.ts',
  'server/src/services/structure-generation.service.ts', 'server/src/services/structure-source-inventory.ts', 'server/src/services/source-evidence-cache.service.ts', 'server/src/services/source-readiness.service.ts',
  'server/src/services/structure-outline-grounding.ts', 'server/src/types/structure.ts',
  'server/src/services/content-runs.service.ts',
  'server/src/components/genai/llm/index.ts', 'server/src/components/genai/llm/model-capabilities.ts', 'server/src/components/genai/llm/model-call.ts', 'server/src/components/genai/llm/authoring-budget.ts'];
async function main(): Promise<void> {
  const fixturePath = argument('--fixture', 'audit-results/quality-lab-2026-10-16/corpus-fixture.json')!;
  const output = argument('--output'); const ledgerPath = argument('--ledger'); const scope = argument('--scope');
  if (!output || !ledgerPath || !scope) throw new Error('Supply a NEW --output directory and shared --ledger/--scope. Default is zero DB/API/network-call preflight.');
  const phaseFile = argument('--phase-declaration'); const phaseSha256 = argument('--phase-sha256');
  if (Boolean(phaseFile) !== Boolean(phaseSha256)) throw new Error('quality-lab-outline-phase-file-and-hash-required');
  const live = argument('--live'); if (live !== undefined && live !== 'once') throw new Error('quality-lab-live-must-be-once');
  const phase = phaseFile ? await readDeclaredOutlinePhase(phaseFile, phaseSha256!, ledgerPath, scope, !live) : undefined;
  const outputCap = Number(argument('--output-cap', phase ? '24000' : '10000'));
  if (!Number.isSafeInteger(outputCap) || outputCap < 6000 || outputCap > 24000) throw new Error('quality-lab-outline-output-cap-invalid');
  if (phase && outputCap !== phase.declaration.maximumOutputTokens) throw new Error('quality-lab-outline-phase-output-cap-mismatch');
  const chapters = argument('--chapters')?.split(',').map(Number);
  const [fixtureRaw, source, inventory] = await Promise.all([readFile(fixturePath, 'utf8'), readFile('server/src/services/structure-generation.service.ts', 'utf8'), readFile('server/src/services/structure-source-inventory.ts', 'utf8')]);
  const fixture = JSON.parse(fixtureRaw) as OutlineCorpusFixture; const ledger = phase?.ledger ?? JSON.parse(await readFile(ledgerPath, 'utf8')) as ConservativeLedger;
  assertLedgerIntegrity(ledger);
  if (!phase && (ledger.scope !== scope || ledger.scope !== 'quality-lab-2026-10-16-phase-one' || ledger.limits.maxSends !== 100 || ledger.limits.maxConservativeTokens !== 2_000_000 || ledger.limits.maxInputTokens !== 200000)) throw new Error('quality-lab-outline-ledger-mismatch');
  if (phase) {
    const origin = JSON.parse(await readFile(phase.declaration.sourceFixtureOrigin.path, 'utf8')) as OutlineCorpusFixture;
    if (chapters) throw new Error('quality-lab-outline-phase-full-ten-required');
    validateDeclaredColdFixture(fixture, origin);
  }
  const functions = recoverOutlineFunctions(source, inventory);
  const options: StructureOptions & { materialIds: string[] } = outlineOptionsForFixture(fixture, chapters);
  const plan = extractionPreflight({ fixture, chapters, functions: functions.functions, batchLimits: functions.batchLimits, options, outputCap,
    remainingSends: ledger.limits.maxSends - ledger.reservedSends, remainingConservativeTokens: ledger.limits.maxConservativeTokens - ledger.conservativeTokens });
  for (const item of plan.corpus.included) if (sha256(await readFile(item.publicPdf)) !== item.pdfSha256) throw new Error('quality-lab-outline-original-pdf-mismatch');
  const sourceReceipt = { ready: plan.corpus.included.every(item => item.readiness.ready), included: plan.corpus.included.map(item => item.readiness.snapshot),
    requested: plan.corpus.included.map(item => item.readiness), excluded: plan.corpus.excluded,
    sourceBatchId: fixture.sourceBatchId ?? null, admission: fixture.admission ?? null,
    origin: fixture.fixtureKind === 'http-upload-real-index' ? 'Actual HTTP-uploaded complete PDFs and real local parsing/chunking/embedding/indexing; live execution rechecks authoritative manifests and the original intended batch.' : 'Recorded indexed-original fixture; live execution rechecks authoritative Mongo manifests. A cloned fixture reuses recorded indexing provenance and is not a fresh parsing/indexing run.',
    caveat: fixture.fixtureKind === 'http-upload-real-index' ? 'Advisory classification is explicitly blocked by the preparation runner. Exact HTTP/index receipts are separate; pedagogical coverage remains unmeasured.' : 'This is not a new multipart upload-admission acceptance test. Original source/index provenance and any clone preparation must be reported separately.' };
  const controls = { version: 1, createdAt: new Date().toISOString(), fixture: path.resolve(fixturePath), fixtureSha256: sha256(fixtureRaw),
    courseId: fixture.courseId, database: fixture.database, actor: fixture.actor, model: 'gpt-6-luna', reasoningEffort: 'medium', maxOutputTokens: outputCap,
    extractionOutputCap: Math.min(12000, outputCap), synthesisOutputCap: Math.min(24000, outputCap), sourceReviewOutputCap: 6000, options, sourceReceipt,
    structureSourceSha256: sha256(source), inventorySourceSha256: sha256(inventory), declarationIdentities: functions.identities, batchLimits: functions.batchLimits,
    plan, ledger: path.resolve(ledgerPath), scope, phaseDeclaration: phase ? { file: phase.file, sha256: phase.sha256, declaration: phase.declaration, ledgerExists: phase.ledgerExists } : null,
    coldCacheRequired: Boolean(phase), observedLedgerBefore: { reservedSends: ledger.reservedSends, conservativeTokens: ledger.conservativeTokens },
    nativeBudgetPolicy: 'The production structure run retains its own native send/input/output and total limits (currently a conservative2m total by default). The separate4m shared experiment allowance does not enlarge or reset that inner budget. JSON corrections, organization, synthesis and original-evidence review all charge both applicable bounds.',
    mutationScope: 'One owned disposable diagnostic contentRun and normal production source-extraction/synthesis cache writes. No Agenda job, Theme/LO apply, question publication, student data, Canvas or Admin configuration writes.',
    limitations: ['Preflight reads local files only. It does not assert that live Mongo is currently unchanged or that any extraction cache is warm.',
      'All original sections of every selected file remain in scope. An explicit subset reports every excluded source; it cannot establish complete ten-file coverage.',
      'Synthesis input depends on actual validated learning points. Full first-pass completion cannot be guaranteed from extraction estimates alone.',
      'Source passage accounting, mapped IDs and model dispositions are mechanical observations; professor-confirmed semantic coverage remains null.'] };
  await mkdir(output, { recursive: false }); await writeFile(path.join(output, 'controls.json'), JSON.stringify(controls, null, 2) + '\n', { flag: 'wx' });
  if (!live) { console.log(JSON.stringify({ preflight: true, providerCalls: 0, databaseCalls: 0, networkCalls: 0, output, summary: plan.summary })); return; }
  // The known cold first extraction alone must fit; never start a doomed full
  // ten-source run by silently trimming inputs or resetting the phase ledger.
  if (!plan.summary.initialExtractionFits || plan.summary.initialExtractionSends + 1 > plan.summary.remainingSends) throw new Error('quality-lab-outline-cold-minimum-does-not-fit-remaining-ledger');
  const code: Array<{ file: string; snapshot: string; sha256: string }> = [];
  for (const file of CODE_FILES) { const bytes = await readFile(file); const snapshot = path.join(output, 'code', file); await mkdir(path.dirname(snapshot), { recursive: true });
    await writeFile(snapshot, bytes, { flag: 'wx' }); code.push({ file, snapshot, sha256: sha256(bytes) }); }
  const [{ env }, mongo, { ObjectId }, structure, { completeJson }, { AuthoringBudget, withAuthoringBudget }, { coursesCol }, { initializeAuthoringCommitSupport }, runs] = await Promise.all([
    import('../../server/src/config/env'), import('../../server/src/components/mongodb'), import('mongodb'), import('../../server/src/services/structure-generation.service'),
    import('../../server/src/components/genai/llm'), import('../../server/src/services/authoring-budget.service'), import('../../server/src/components/mongodb/collections'), import('../../server/src/services/authoring-commit.service'),
    import('../../server/src/services/content-runs.service'),
  ]);
  const address = new URL(env.mongodbUri);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(address.hostname) || address.port !== '27029' || env.mongodbDbName !== fixture.database) throw new Error('quality-lab-outline-disposable-database-required');
  const assertCurrent = async () => {
    if (sha256(await readFile(fixturePath)) !== controls.fixtureSha256) throw new Error('quality-lab-outline-fixture-changed');
    if (phase) await readDeclaredOutlinePhase(phase.file, phase.sha256, ledgerPath, scope);
    for (const identity of code) if (sha256(await readFile(identity.file)) !== identity.sha256) throw new Error(`quality-lab-outline-code-changed:${identity.file}`);
  };
  const budget = new AuthoringBudget(`${scope}:outline`, { maxSends: plan.summary.remainingSends, maxInputTokens: 200000,
    maxOutputTokens: Math.max(controls.extractionOutputCap, controls.synthesisOutputCap), maxEstimatedTokens: plan.summary.remainingConservativeTokens });
  const events: Parameters<StructureGenerationObserver['record']>[0][] = [];
  const recorder = createCapturedCompletion({ directory: path.join(output, 'transcripts'), ledgerPath, scope, limits: ledger.limits,
    cellId: 'outline', complete: serializeAdmission(completeJson), maxInputTokens: 200000, maxOutputTokens: 24000, assertCurrent });
  let status = 'preparing-live'; let result: StructureResult | null = null; let error: ReturnType<typeof safeError> | null = null;
  let liveCorpus: unknown = null; let diagnosticRun: unknown = null; let runId: InstanceType<typeof ObjectId> | undefined; const started = Date.now();
  const save = async () => { const file = path.join(output, 'results.json'); const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify({ version: 1, status, elapsedMs: Date.now() - started, controlsSha256: hashControl(controls), code, liveCorpus, diagnosticRun, runId: runId?.toHexString() ?? null, events, result,
      captures: recorder.captures, budget: budget.snapshot(), usage: summarizeHarnessUsage(recorder.captures.filter(item => item.transcript).flatMap(item => item.transcript.attempts.flatMap(attempt => attempt.events)), { coverageComplete: true }),
      teacherAcceptance: null, semanticCoverage: null, error, limitations: controls.limitations }, null, 2) + '\n', { flag: 'wx' }); await rename(temporary, file); };
  await save();
  try {
    const db = await mongo.connectMongo(); const courseId = new ObjectId(fixture.courseId); const course = await coursesCol().findOne({ _id: courseId });
    if (course?.ownerPuid !== fixture.actor) throw new Error('quality-lab-outline-fixture-owner-mismatch');
    if (!(await initializeAuthoringCommitSupport()).available) throw new Error('quality-lab-outline-replica-required');
    await assertCurrent();
    const coldCacheCounts = { sourceEvidenceExtractions: await db.collection('sourceEvidenceExtractions').countDocuments({ courseId }),
      structureRuns: await db.collection('contentRuns').countDocuments({ courseId, kind: 'structure-generation' }) };
    if (phase && (coldCacheCounts.sourceEvidenceExtractions || coldCacheCounts.structureRuns)) throw new Error('quality-lab-outline-course-not-cold');
    const loaded = await structure.loadStructureCorpus(courseId, options.materialIds, options.sourceBatchId);
    const normalize = (sections: typeof loaded.sections) => sections.map(({ materialId, materialName, chunkIndex, localId, text }) => ({ materialId, materialName, chunkIndex, localId, text })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    if (hashControl(normalize(loaded.sections)) !== hashControl(normalize(plan.corpus.sections))) throw new Error('quality-lab-outline-live-source-drift');
    liveCorpus = { ...loaded, coldCacheCounts }; await writeFile(path.join(output, 'live-corpus-before.json'), JSON.stringify(liveCorpus, null, 2) + '\n', { flag: 'wx' });
    const run = await runs.createStructureGenerationRun({ courseId, requestedBy: fixture.actor, options }); runId = run._id;
    diagnosticRun = await runs.updateContentRun(runId, { status: 'running', stage: 'analyzing' });
    status = 'running'; await save();
    result = await withAuthoringBudget(budget, () => structure.generateStructure(courseId, options, runId, {
      model: { model: 'gpt-6-luna', reasoningEffort: 'medium' }, maxOutputTokens: outputCap, complete: recorder.complete,
      record: async event => { events.push(event); await save(); },
    }));
    await assertCurrent();
    diagnosticRun = await runs.updateContentRun(runId, { status: 'completed', stage: 'checking', structureResult: result });
    status = 'completed';
  } catch (caught) {
    status = 'stopped'; error = safeError(caught); process.exitCode = 1;
    if (runId) {
      const active = await runs.getContentRun(runId);
      if (active && (active.status === 'queued' || active.status === 'running')) await runs.failContentRun(runId, { code: 'quality-lab-outline-stopped', message: error.message, atStage: active.stage, retryable: false });
      diagnosticRun = await runs.getContentRun(runId);
    }
  }
  finally { await save(); await mongo.closeMongo(); }
  console.log(JSON.stringify({ status, output: path.resolve(output), observedSends: budget.snapshot().observedSends,
    files: result?.coverage.materials.length ?? null, themes: result?.themes.length ?? null, los: result?.themes.reduce((sum, theme) => sum + theme.los.length, 0) ?? null,
    teacherAcceptance: null, semanticCoverage: null }));
}
if (require.main === module) void main().catch(error => { console.error(safeError(error).message); process.exitCode = 1; });
