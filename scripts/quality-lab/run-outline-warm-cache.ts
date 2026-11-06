import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { StructureOptions, StructureResult } from '../../server/src/types/structure';
import type { StructureGenerationObserver } from '../../server/src/services/structure-generation.service';
import { createCacheOnlyCompletion } from './cache-only-completion';
import { hashControl, safeError, sha256 } from './protocol';
import type { ConservativeLedger } from './ledger';
import { assertLedgerIntegrity, readDeclaredOutlinePhase } from './phase-declaration';

const argument = (name: string, fallback?: string) => { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1]; };
interface ColdControls { fixture: string; fixtureSha256: string; courseId: string; database: string; actor: string; model: string; reasoningEffort: string;
  maxOutputTokens: number; extractionOutputCap: number; synthesisOutputCap: number; sourceReviewOutputCap?: number; options: StructureOptions & { materialIds: string[] };
  structureSourceSha256: string; inventorySourceSha256: string; ledger: string; scope: string; sourceReceipt: unknown;
  phaseDeclaration?: { file: string; sha256: string } | null }
interface ColdResult { status: string; result: StructureResult; liveCorpus: { fingerprint: string }; code: Array<{ file: string; sha256: string }> }
const CODE_FILES = ['scripts/quality-lab/run-outline-warm-cache.ts', 'scripts/quality-lab/cache-only-completion.ts', 'server/src/services/structure-generation.service.ts',
  'scripts/quality-lab/phase-declaration.ts',
  'server/src/services/structure-source-inventory.ts', 'server/src/services/source-evidence-cache.service.ts', 'server/src/services/source-readiness.service.ts',
  'server/src/services/structure-outline-grounding.ts', 'server/src/types/structure.ts',
  'server/src/services/content-runs.service.ts', 'server/src/components/genai/llm/model-capabilities.ts'];
function contentHash(result: StructureResult): string {
  return hashControl({ themes: result.themes, evidence: result.evidence.map(({ extraction: _origin, ...point }) => { void _origin; return point; }) });
}
async function main(): Promise<void> {
  const prior = argument('--prior', 'audit-results/quality-lab-2026-10-16/outline-subset-live')!; const output = argument('--output');
  if (!output) throw new Error('Supply a NEW --output directory. Default is zero DB/API preflight; --live cache-only explicitly runs the zero-model production-cache probe.');
  const [coldControlsRaw, coldResultRaw] = await Promise.all([readFile(path.join(prior, 'controls.json'), 'utf8'), readFile(path.join(prior, 'results.json'), 'utf8')]);
  const cold = JSON.parse(coldControlsRaw) as ColdControls; const previous = JSON.parse(coldResultRaw) as ColdResult;
  if (previous.status !== 'completed' || !previous.result || !cold.options.materialIds.length || !cold.actor.startsWith('QUALITY-RETEST-FIXTURE-')) throw new Error('quality-lab-warm-cache-complete-owned-prior-required');
  const fixtureRaw = await readFile(cold.fixture, 'utf8'); if (sha256(fixtureRaw) !== cold.fixtureSha256) throw new Error('quality-lab-warm-cache-fixture-drift');
  const ledgerBefore = JSON.parse(await readFile(cold.ledger, 'utf8')) as ConservativeLedger;
  const phase = cold.phaseDeclaration ? await readDeclaredOutlinePhase(cold.phaseDeclaration.file, cold.phaseDeclaration.sha256, cold.ledger, cold.scope) : undefined;
  assertLedgerIntegrity(ledgerBefore);
  if (!phase && (ledgerBefore.scope !== cold.scope || ledgerBefore.scope !== 'quality-lab-2026-10-16-phase-one' || ledgerBefore.limits.maxSends !== 100 || ledgerBefore.limits.maxConservativeTokens !== 2_000_000 || ledgerBefore.limits.maxInputTokens !== 200000)) throw new Error('quality-lab-warm-cache-ledger-scope-mismatch');
  const code: Array<{ file: string; sha256: string }> = [];
  for (const file of CODE_FILES) {
    const digest = sha256(await readFile(file)); const old = previous.code.find(identity => identity.file === file);
    if (old && old.sha256 !== digest) throw new Error(`quality-lab-warm-cache-code-differs-from-cold:${file}`);
    code.push({ file, sha256: digest });
  }
  if (code.find(identity => identity.file === 'server/src/services/structure-generation.service.ts')?.sha256 !== cold.structureSourceSha256 ||
    code.find(identity => identity.file === 'server/src/services/structure-source-inventory.ts')?.sha256 !== cold.inventorySourceSha256) throw new Error('quality-lab-warm-cache-exact-production-code-required');
  const controls = { version: 1, mode: 'cache-only-zero-model', prior: path.resolve(prior), priorControlsSha256: sha256(coldControlsRaw), priorResultsSha256: sha256(coldResultRaw),
    fixtureSha256: cold.fixtureSha256, courseId: cold.courseId, database: cold.database, actor: cold.actor,
    model: cold.model, reasoningEffort: cold.reasoningEffort, maxOutputTokens: cold.maxOutputTokens, extractionOutputCap: cold.extractionOutputCap, synthesisOutputCap: cold.synthesisOutputCap,
    sourceReviewOutputCap: cold.sourceReviewOutputCap ?? 6000,
    options: cold.options, requestHash: hashControl({ model: cold.model, effort: cold.reasoningEffort, cap: cold.maxOutputTokens, options: cold.options, sourceFingerprint: previous.liveCorpus.fingerprint }),
    coldSourceFingerprint: previous.liveCorpus.fingerprint, coldOutlineContentHash: contentHash(previous.result), sourceReceipt: cold.sourceReceipt, code,
    nativeMaxSends: 0, injectedMissPolicy: 'Every unexpected extraction/synthesis completion throws before any provider dispatch.',
    coldMinimumGuardExemption: 'Only this guaranteed zero-model cache probe may bypass the estimated cold-extraction minimum; source readiness/scope/model/cache identity checks remain mandatory.',
    ledger: cold.ledger, scope: cold.scope, phaseDeclaration: cold.phaseDeclaration ?? null, ledgerBefore: { reservedSends: ledgerBefore.reservedSends, conservativeTokens: ledgerBefore.conservativeTokens },
    mutationScope: 'One owned disposable diagnostic contentRun and normal validated cache reuse bookkeeping; no Agenda job, source edits, Topic/LO apply, question or student writes.',
    limitations: ['A cache miss stops the experiment honestly. Historical output is never substituted for a missing production cache entry.',
      'Zero model sends prove zero model-token consumption for this probe, not zero database/CPU/infrastructure cost.',
      'If the probe stops before full synthesis, its wall time is time to cache-miss detection, not complete warm-outline latency.',
      'A full reused result still requires original-source semantic inspection and teacher acceptance; both remain unmeasured.'] };
  await mkdir(output, { recursive: false }); await writeFile(path.join(output, 'controls.json'), JSON.stringify(controls, null, 2) + '\n', { flag: 'wx' });
  const live = argument('--live'); if (live !== undefined && live !== 'cache-only') throw new Error('quality-lab-warm-live-must-be-cache-only');
  if (!live) { console.log(JSON.stringify({ preflight: true, databaseCalls: 0, providerCalls: 0, output, nativeMaxSends: 0, requestedFiles: cold.options.materialIds.length })); return; }
  const [{ env }, mongo, { ObjectId }, { coursesCol }, commits, structure, runs, { AuthoringBudget, withAuthoringBudget }] = await Promise.all([
    import('../../server/src/config/env'), import('../../server/src/components/mongodb'), import('mongodb'), import('../../server/src/components/mongodb/collections'),
    import('../../server/src/services/authoring-commit.service'), import('../../server/src/services/structure-generation.service'), import('../../server/src/services/content-runs.service'), import('../../server/src/services/authoring-budget.service'),
  ]);
  const address = new URL(env.mongodbUri);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(address.hostname) || address.port !== '27029' || env.mongodbDbName !== cold.database) throw new Error('quality-lab-warm-disposable-database-required');
  const guard = new AuthoringBudget(`${cold.scope}:warm-cache-zero-model`, { maxSends: 0, maxEstimatedTokens: 1, maxInputTokens: 200000, maxOutputTokens: 24000 });
  const blocker = createCacheOnlyCompletion({ model: cold.model, reasoningEffort: cold.reasoningEffort, extractionOutputCap: cold.extractionOutputCap, synthesisOutputCap: cold.synthesisOutputCap, sourceReviewOutputCap: cold.sourceReviewOutputCap ?? 6000 });
  const events: Parameters<StructureGenerationObserver['record']>[0][] = [];
  const codeCurrent = async () => {
    if (sha256(await readFile(cold.fixture)) !== cold.fixtureSha256) throw new Error('quality-lab-warm-cache-fixture-drift');
    if (phase) await readDeclaredOutlinePhase(phase.file, phase.sha256, cold.ledger, cold.scope);
    for (const identity of code) if (sha256(await readFile(identity.file)) !== identity.sha256) throw new Error(`quality-lab-warm-code-changed:${identity.file}`);
  };
  let status = 'preparing-live'; let result: StructureResult | null = null; let diagnosticRun: unknown = null; let runId: InstanceType<typeof ObjectId> | undefined;
  let error: ReturnType<typeof safeError> | null = null; let sourceFingerprint: string | null = null; const started = Date.now();
  const save = async () => { const file = path.join(output, 'results.json'); const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify({ version: 1, status, elapsedMs: Date.now() - started, controlsSha256: hashControl(controls), sourceFingerprint,
      requestHash: controls.requestHash, coldOutlineContentHash: controls.coldOutlineContentHash, warmOutlineContentHash: result ? contentHash(result) : null,
      identicalOutlineContent: result ? contentHash(result) === controls.coldOutlineContentHash : null, result, diagnosticRun, events, blockedCacheMisses: blocker.attempts,
      budget: guard.snapshot(), observedModelSends: guard.snapshot().observedSends, modelInputTokens: 0, modelOutputTokens: 0,
      tokenCountBasis: 'No provider dispatch is available through the injected completion and the enclosing native send allowance is zero.',
      teacherAcceptance: null, semanticCoverage: null, error, limitations: controls.limitations }, null, 2) + '\n', { flag: 'wx' }); await rename(temporary, file); };
  await save();
  try {
    await mongo.connectMongo(); const courseId = new ObjectId(cold.courseId); const course = await coursesCol().findOne({ _id: courseId });
    if (course?.ownerPuid !== cold.actor || !(await commits.initializeAuthoringCommitSupport()).available) throw new Error('quality-lab-warm-owned-replica-fixture-required');
    await codeCurrent(); const corpus = await structure.loadStructureCorpus(courseId, cold.options.materialIds, cold.options.sourceBatchId); sourceFingerprint = corpus.fingerprint;
    if (sourceFingerprint !== controls.coldSourceFingerprint) throw new Error('quality-lab-warm-source-fingerprint-drift');
    const run = await runs.createStructureGenerationRun({ courseId, requestedBy: cold.actor, options: cold.options }); runId = run._id;
    diagnosticRun = await runs.updateContentRun(runId, { status: 'running', stage: 'analyzing' }); status = 'running-cache-only'; await save();
    result = await withAuthoringBudget(guard, () => structure.generateStructure(courseId, cold.options, runId, {
      model: { model: cold.model, reasoningEffort: cold.reasoningEffort as 'medium' }, maxOutputTokens: cold.maxOutputTokens,
      complete: async <T>(prompt: string, options: Parameters<typeof blocker.complete>[1]): Promise<T> => { await codeCurrent(); return blocker.complete<T>(prompt, options); },
      record: async event => { events.push(event); await save(); },
    }));
    diagnosticRun = await runs.updateContentRun(runId, { status: 'completed', stage: 'checking', structureResult: result });
    status = 'completed-cache-only';
  } catch (caught) {
    error = safeError(caught); status = error.message.includes('warm-cache-miss-no-provider-dispatch') ? 'cache-miss' : 'stopped'; process.exitCode = 1;
    if (runId) {
      const active = await runs.getContentRun(runId);
      if (active && (active.status === 'queued' || active.status === 'running')) await runs.failContentRun(runId, { code: 'cache-only-probe-stopped', message: error.message, atStage: active.stage, retryable: false });
      diagnosticRun = await runs.getContentRun(runId);
    }
  } finally { await save(); await mongo.closeMongo(); }
  await codeCurrent();
  if (hashControl(JSON.parse(await readFile(cold.ledger, 'utf8'))) !== hashControl(ledgerBefore)) throw new Error('quality-lab-warm-ledger-mutated');
  if (guard.snapshot().observedSends !== 0) throw new Error('quality-lab-warm-zero-model-invariant-failed');
  console.log(JSON.stringify({ status, output: path.resolve(output), elapsedMs: Date.now() - started, observedModelSends: 0,
    blockedStages: blocker.attempts.map(attempt => attempt.stage), identicalOutlineContent: result ? contentHash(result) === controls.coldOutlineContentHash : null }));
}
if (require.main === module) void main().catch(error => { console.error(safeError(error).message); process.exitCode = 1; });
