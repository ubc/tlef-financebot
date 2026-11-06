/** Default file-only preparation; only root may execute an exact fresh declaration. */
import assert from 'node:assert/strict';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import { writeRecoveryPlan, type RecoveryInputCell, type planTransportRecovery, type auditFrozenJudge } from './plan-heldout-transport-recovery';
import { frozenReviewCompletion } from './heldout-historical-review-adapter';
import { MODEL_COMPARISON_CODE_FILES } from './run-model-comparison';
import { createCapturedCompletion } from './completion';
import { parseLabCandidate } from './candidate';
import { assertLedgerIntegrity } from './phase-declaration';
import { sha256, hashControl, safeError, type FrozenFixture, type CapturedCompletion, type JsonCompletion } from './protocol';
import { summarizeHarnessUsage } from '../prompt-ab/usage-summary';
import type { ConservativeLedger } from './ledger';
import type { GeneratorOutput } from '../../server/src/services/generation.service';
import type { GenerationQualityAssessment } from '../../server/src/types/generation-quality';
import type { CompleteJsonOptions } from '../../server/src/components/genai/llm';
import type * as GenerationQuality from '../../server/src/services/generation-quality.service';

const ROOT = path.resolve(__dirname, '../..');
const CODE = [...MODEL_COMPARISON_CODE_FILES, 'scripts/quality-lab/run-heldout-transport-recovery.ts', 'scripts/quality-lab/plan-heldout-transport-recovery.ts',
  'scripts/quality-lab/heldout-historical-review-adapter.ts', 'scripts/quality-lab/completion.ts', 'server/src/components/genai/llm/request-deadline.ts',
  'server/src/components/genai/llm/provider-usage.ts', 'server/src/components/genai/llm/latex-escapes.ts', 'server/src/services/authoring-budget.service.ts',
  'server/src/components/genai/logger.ts', 'server/src/config/env.ts', 'package.json', 'package-lock.json'];
interface Identity { file: string; sha256: string }
interface PlanReceipt { version: number; status: string; declarationSha256: string; fixtureSha256: string; scheduleSha256: string;
  plan: ReturnType<typeof planTransportRecovery>; protocol: ReturnType<typeof auditFrozenJudge>;
  functionAudit: Array<{ identical: boolean }>; identities: Identity[]; originalUsage: unknown; limitations: string[] }
interface Controls { version: 1; scope: string; origin: string; planFile: Identity; proof: PlanReceipt; fixture: FrozenFixture; originalCells: RecoveryInputCell[];
  identities: Identity[]; provider: string; endpoint: string; timeoutMs: 180000; offlineReviewMatches: Array<{ id: string; initialPromptSha256: string }>;
  generationModuleAudit: unknown; parentLedger: Identity; limits: { maxSends: number; maxConservativeTokens: number; maxInputTokens: number }; preparedAt: string }
interface Declaration { version: 1; scope: string; controls: Identity; limits: Controls['limits']; parentLedger: Identity; protocol: string; saved: 0; adopted: 0 }
interface RecoveredCell { id: string; operation: string; status: 'pending' | 'generated' | 'invalid-candidate' | 'reviewed'; originalCandidate: GeneratorOutput | null;
  normalizedCandidate: GeneratorOutput | null; deterministic: unknown; quality: GenerationQualityAssessment | null; eligible: boolean | null;
  captures: Array<{ file: string; transcript: CapturedCompletion }>; mappings: unknown[]; error: unknown }
/** The production assessor turns completion exceptions into withheld results.
 * This controlled experiment must still stop on adapter/admission faults. */
export function latchCompletionFailure(complete: JsonCompletion): { complete: JsonCompletion; assertSucceeded: () => void } {
  let failed = false; let failure: unknown;
  return { complete: async <T>(prompt: string, options?: CompleteJsonOptions): Promise<T> => {
    try { return await complete<T>(prompt, options); } catch (error) { failed = true; failure = error; throw error; }
  }, assertSucceeded: () => { if (failed) throw failure; } };
}
export function parseRecoveryArguments(argv: string[]): Record<string, string> {
  const allowed = new Set(['--output', '--origin', '--live', '--declaration', '--declaration-sha256']);
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i], value = argv[i + 1];
    assert(allowed.has(key) && !(key in args) && value && !value.startsWith('--'), `Unknown, duplicate or missing argument: ${key}`);
    args[key] = value;
  }
  assert(args['--output'], 'A new --output directory is required.');
  if (args['--live'] === undefined) assert(Object.keys(args).every(key => ['--output', '--origin'].includes(key)), 'Offline preparation accepts only --origin and --output.');
  else { assert.equal(args['--live'], 'once'); assert(!args['--origin'], 'Live origin must come from the pinned controls.');
    assert(args['--declaration'] && /^[a-f0-9]{64}$/.test(args['--declaration-sha256']), 'Live execution requires an exact declaration and SHA256.'); }
  return args;
}
const json = async <T>(file: string): Promise<T> => JSON.parse(await readFile(file, 'utf8')) as T;
const pin = async (file: string): Promise<Identity> => ({ file: path.resolve(file), sha256: sha256(await readFile(file)) });
async function save(file: string, value: unknown, exclusive = false): Promise<void> {
  const temp = exclusive ? file : `${file}.${randomUUID()}.tmp`; await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); if (!exclusive) await rename(temp, file);
}
export function assertCombinedRecoveryBudget(parent: ConservativeLedger, child: ConservativeLedger, limits: Controls['limits']): void {
  assertLedgerIntegrity(parent); assertLedgerIntegrity(child); assert.equal(hashControl(child.limits), hashControl(limits));
  assert(parent.reservedSends + child.reservedSends <= parent.limits.maxSends, 'Combined send ceiling exceeded.');
  assert(parent.conservativeTokens + child.conservativeTokens <= parent.limits.maxConservativeTokens, 'Combined conservative ceiling exceeded.');
}
/** All production statements except the unused worker and its added import
 * must match the frozen generation module. Comparison never invokes that worker. */
export function generationModuleAudit(old: string, now: string) {
  const statements = (text: string) => { const a = ts.createSourceFile('trusted-generation.ts', text, ts.ScriptTarget.Latest, true); return a.statements.map(n => ({
    worker: ts.isFunctionDeclaration(n) && n.name?.text === 'runTrackedGenerationPipelineInner', text: n.getText(a) })); };
  const a = statements(old), b = statements(now); assert.equal(a.length, b.length);
  let imports = 0, workers = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i].worker && b[i].worker) { workers++; continue; }
    if (b[i].text.startsWith('import { bindPlannedAuthoringTask, buildGenerationSemanticRepairPlan,')) { assert.equal(b[i].text.replace('bindPlannedAuthoringTask, ', ''), a[i].text); imports++; }
    else assert.equal(b[i].text, a[i].text, 'A comparison dependency changed.');
  }
  assert.equal(workers, 1); assert.equal(imports, 1); return { statementCount: a.length, allOtherStatementsIdentical: true,
    unusedWorkerHistoricalSha256: sha256(a.find(n => n.worker)!.text), unusedWorkerCurrentSha256: sha256(b.find(n => n.worker)!.text) };
}
async function readInitialPrompt(quality: typeof GenerationQuality, item: FrozenFixture['cases'][number], candidate: GeneratorOutput, order: number) {
  let prompt: string | null = null;
  const complete: JsonCompletion = async () => { throw new Error('offline-prompt-only'); };
  const capture: JsonCompletion = <T>(text: string, options?: CompleteJsonOptions) => { assert.equal(prompt, null); prompt = text; return complete<T>(text, options); };
  const assessment = await quality.assessGenerationQuality({ packet: structuredClone(item.packet), memory: structuredClone(item.memory), candidate: { ...structuredClone(candidate), type: item.request.type },
    requirements: structuredClone(item.requirements), item: order, policy: 'grounded-memory-v2', step: { model: 'gpt-6.1-sol', reasoningEffort: 'medium' }, complete: capture });
  return { prompt, assessment };
}
function noSockets(): () => void {
  const original = net.Socket.prototype.connect; net.Socket.prototype.connect = function (): never { throw new Error('heldout-recovery-preflight-network-forbidden'); };
  return () => { net.Socket.prototype.connect = original; };
}
export async function prepareHeldoutRecovery(origin: string, output: string): Promise<string> {
  await mkdir(output, { recursive: false }); const restore = noSockets();
  try {
    const planPath = path.join(output, 'recovery-plan.json'); await writeRecoveryPlan(origin, planPath); const proof = await json<PlanReceipt>(planPath);
    assert(proof.protocol.initialRendererIdentical && proof.protocol.onlyChangeIsExplicitCorrectionGuidance && proof.functionAudit.every(row => row.identical));
    const declaration = await json<{ fixture: { path: string }; ledger: string }>(path.join(origin, 'declaration.json'));
    const fixture = await json<FrozenFixture>(declaration.fixture.path); const originalCells: RecoveryInputCell[] = [];
    for (let i = 1; i <= 6; i++) originalCells.push(...(await json<{ cells: RecoveryInputCell[] }>(path.join(origin, 'live', `shard-${i}`, 'results.json'))).cells);
    const identities = [...proof.identities, ...await Promise.all(CODE.map(file => pin(path.join(ROOT, file))))];
    for (const source of fixture.sourceControls) { const chapter = Number(source.material.chapter); assert(Number.isSafeInteger(chapter)); const p = await pin(path.join(ROOT, 'audit-results/generation-quality-corpus', `chapter-${String(chapter).padStart(2, '0')}.pdf`)); assert.equal(p.sha256, source.pdfSha256); identities.push(p); }
    const quality = await import('../../server/src/services/generation-quality.service'); const { env } = await import('../../server/src/config/env');
    assert(['openai', 'ubc-llm-sandbox'].includes(env.llmProvider)); assert.equal(env.llmRequestTimeoutMs, 180000);
    const endpoint = new URL(env.llmEndpoint || 'https://api.openai.com/v1'); assert(!endpoint.username && !endpoint.password && !endpoint.search);
    const matches = [];
    for (const gap of proof.plan.recoveryCells.filter(row => row.operation === 'review-retained')) {
      const item = fixture.cases.find(row => row.id === gap.schedule.caseId)!; const result = await readInitialPrompt(quality, item, gap.retained!.candidate as GeneratorOutput, gap.schedule.order);
      assert.equal(result.prompt, gap.originalFailedRequest.prompt, 'Frozen initial review does not reproduce.'); matches.push({ id: gap.id, initialPromptSha256: sha256(result.prompt!) });
    }
    const generationFile = path.join(ROOT, 'server/src/services/generation.service.ts');
    const generationAudit = generationModuleAudit(await readFile(path.join(origin, 'live/shard-1/code/server/src/services/generation.service.ts'), 'utf8'), await readFile(generationFile, 'utf8'));
    const unique = [...new Map(identities.map(row => [row.file, row])).values()];
    const limits = { maxSends: proof.plan.ceiling.maxSends, maxConservativeTokens: proof.plan.ceiling.maxConservativeTokens, maxInputTokens: 24000 };
    const controls: Controls = { version: 1, scope: 'quality-lab-heldout-transport-recovery-2026-10-17', origin: path.resolve(origin), planFile: await pin(planPath), proof,
      fixture, originalCells, identities: unique, provider: env.llmProvider, endpoint: endpoint.href, timeoutMs: 180000, offlineReviewMatches: matches,
      generationModuleAudit: generationAudit, parentLedger: await pin(declaration.ledger), limits, preparedAt: new Date().toISOString() };
    await verifyControls(controls); await save(path.join(output, 'controls.json'), controls, true);
    const declared: Declaration = { version: 1, scope: controls.scope, controls: await pin(path.join(output, 'controls.json')), limits, parentLedger: controls.parentLedger,
      protocol: 'Frozen held-out judge and original captureJson stream; only bounded transport deadline differs. Exact 30-gap overlay; immutable original ledger; no semantic repair or DB.', saved: 0, adopted: 0 };
    await save(path.join(output, 'declaration.json'), declared, true); return sha256(await readFile(path.join(output, 'declaration.json')));
  } finally { restore(); }
}
async function verifyControls(c: Controls): Promise<void> {
  assert.equal(c.version, 1); assert.equal(c.scope, 'quality-lab-heldout-transport-recovery-2026-10-17'); assert.equal(c.originalCells.length, 60);
  assert.equal(c.proof.plan.recoveryCells.length, 30); assert.equal(c.offlineReviewMatches.length, 10); assert.equal(c.limits.maxSends, 160); assert(c.limits.maxConservativeTokens <= 2_000_000);
  assert.equal(c.proof.protocol.correctionContract.historicalModuleStatementsSha256, c.proof.protocol.correctionContract.restoredModuleStatementsSha256);
  for (const p of [...c.identities, c.parentLedger, c.planFile]) assert.equal(sha256(await readFile(p.file)), p.sha256, `Frozen source/code drift: ${p.file}`);
}
export function recoverySummary(c: Controls, rows: RecoveredCell[]) {
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length); assert(rows.every(row => c.proof.plan.recoveryCells.some(gap => gap.id === row.id)));
  const recovered = new Map(rows.filter(row => row.status === 'reviewed' || row.status === 'invalid-candidate').map(row => [row.id, row]));
  const cells = c.originalCells.map(old => { const gap = c.proof.plan.recoveryCells.find(row => row.id === old.schedule.id), latest = recovered.get(old.schedule.id); return {
    id: old.schedule.id, schedule: old.schedule, originalCellHash: hashControl(old), recoveryRequired: Boolean(gap),
    state: gap ? latest?.status ?? 'transport-unresolved' : old.status, eligible: gap ? latest?.eligible ?? null : old.eligibleBeforeRepair,
    recoveryCandidateHash: latest?.normalizedCandidate ? hashControl(latest.normalizedCandidate) : null }; });
  return { requested: 60, recoveryScheduled: 30, recoveryComplete: recovered.size, recoveryUnresolved: 30 - recovered.size,
    retainedSuccessfulGenerations: 40, recordedLabEligible: cells.filter(row => row.eligible === true).length, cells,
    teacherAcceptance: null, saved: 0, adopted: 0, positiveSupplyRequested: 50, safetyNegativeRequested: 10 };
}
export async function executeHeldoutRecovery(declarationFile: string, digest: string, output: string): Promise<void> {
  assert.match(digest, /^[a-f0-9]{64}$/); assert.equal(sha256(await readFile(declarationFile)), digest);
  const d = await json<Declaration>(declarationFile); assert.equal(sha256(await readFile(d.controls.file)), d.controls.sha256); const c = await json<Controls>(d.controls.file);
  await verifyControls(c); assert.equal(d.version, 1); assert.equal(d.saved, 0); assert.equal(d.adopted, 0);
  assert.equal(d.scope, c.scope); assert.equal(hashControl(d.limits), hashControl(c.limits)); assert.equal(hashControl(d.parentLedger), hashControl(c.parentLedger));
  await mkdir(output, { recursive: false }); await save(path.join(path.dirname(declarationFile), 'execution-claim.json'), { declarationSha256: digest, pid: process.pid, output: path.resolve(output) }, true);
  const ledgerPath = path.join(output, 'ledger.json'); const parent = await json<ConservativeLedger>(c.parentLedger.file);
  const empty: ConservativeLedger = { version: 1, createdAt: new Date().toISOString(), scope: c.scope, limits: c.limits, accounting: 'conservative-reservations-v1', reservedSends: 0, conservativeTokens: 0, reservations: [] };
  assertCombinedRecoveryBudget(parent, empty, c.limits); await save(ledgerPath, { ...empty, declarationSha256: digest, parentLedger: c.parentLedger }, true);
  const [facade, generation, quality, budgetModule, { env }] = await Promise.all([import('../../server/src/components/genai/llm'), import('../../server/src/services/generation.service'),
    import('../../server/src/services/generation-quality.service'), import('../../server/src/services/authoring-budget.service'), import('../../server/src/config/env')]);
  assert.equal(env.llmProvider, c.provider); assert.equal(new URL(env.llmEndpoint || 'https://api.openai.com/v1').href, c.endpoint); assert.equal(env.llmRequestTimeoutMs, 180000);
  const budget = new budgetModule.AuthoringBudget(c.scope, { maxSends: c.limits.maxSends, maxInputTokens: 24000, maxOutputTokens: 8000, maxEstimatedTokens: c.limits.maxConservativeTokens });
  const rows: RecoveredCell[] = c.proof.plan.recoveryCells.map(gap => ({ id: gap.id, operation: gap.operation, status: gap.retained ? 'generated' : 'pending',
    originalCandidate: gap.retained ? c.originalCells.find(old => old.schedule.id === gap.id)!.originalCandidate as GeneratorOutput : null,
    normalizedCandidate: gap.retained?.candidate as GeneratorOutput ?? null, deterministic: gap.retained?.deterministic ?? null, quality: null, eligible: null, captures: [], mappings: [], error: null }));
  let status = 'running'; let error: unknown = null; const started = Date.now();
  const current = async () => { await verifyControls(c); assert.equal(sha256(await readFile(declarationFile)), digest); assert.equal(sha256(await readFile(d.controls.file)), d.controls.sha256);
    const child = await json<ConservativeLedger>(ledgerPath); assertCombinedRecoveryBudget(parent, child, c.limits); assert.equal((child as ConservativeLedger & { declarationSha256: string }).declarationSha256, digest); };
  const persist = async () => save(path.join(output, 'results.json'), { version: 1, schema: 'heldout-recovery-overlay-v1', status, declarationSha256: digest,
    startedAt: new Date(started).toISOString(), elapsedMs: Date.now() - started, summary: recoverySummary(c, rows), recoveredCells: rows,
    originalUsage: c.proof.originalUsage, newUsage: summarizeHarnessUsage(rows.flatMap(row => row.captures.flatMap(cap => cap.transcript.attempts.flatMap(a => a.events))), { coverageComplete: true, active: status === 'running' }),
    budget: budget.snapshot(), childLedger: await json(ledgerPath), parentLedger: c.parentLedger, parentLedgerReceipt: parent, error, saved: 0, adopted: 0, teacherAcceptance: null,
    comparisonPolicy: d.protocol, limitations: c.proof.limitations });
  const cellBudgets = new Map(rows.map(row => [row.id, new budgetModule.AuthoringBudget(row.id, { maxSends: 6, maxInputTokens: 24000, maxOutputTokens: 8000, maxEstimatedTokens: c.limits.maxConservativeTokens })]));
  const recorders = new Map(rows.map(row => [row.id, createCapturedCompletion({ directory: path.join(output, 'transcripts'), ledgerPath, scope: c.scope, limits: c.limits,
    cellId: row.id, complete: facade.completeJson, maxInputTokens: 24000, maxOutputTokens: 8000, maxSendsPerCompletion: 2, assertCurrent: current,
    onSnapshot: async (_transcript, _file) => { row.captures = recorders.get(row.id)!.captures; await persist(); } })]));
  const healthy = () => { const bad = rows.flatMap(row => row.captures).find(cap => cap.transcript?.status === 'failed'); if (bad) throw new Error(bad.transcript.error?.message ?? 'recovery-capture-failed'); };
  await persist();
  try {
    await budgetModule.withAuthoringBudget(budget, async () => {
      for (let shard = 3; shard < 6; shard++) {
        const group = c.proof.plan.recoveryCells.filter(gap => Math.floor(gap.schedule.order / 10) === shard);
        for (const gap of group.filter(gap => gap.operation === 'generate-then-review')) {
          await current(); const row = rows.find(item => item.id === gap.id)!; const item = c.fixture.cases.find(value => value.id === gap.schedule.caseId)!;
          const raw = await budgetModule.withAuthoringBudget(cellBudgets.get(row.id)!, () => recorders.get(row.id)!.complete(gap.originalFailedRequest.prompt, {
            model: gap.schedule.arm.model, reasoningEffort: gap.schedule.arm.effort, maxTokens: 8000, usageContext: { stage: 'model-comparison-generator' } }));
          healthy();
          try {
            row.originalCandidate = parseLabCandidate(raw, item.request.type); row.normalizedCandidate = generation.sanitizeGenerated(structuredClone(row.originalCandidate));
            if (row.normalizedCandidate.taskDescriptor) row.normalizedCandidate.taskDescriptor.passageIds = quality.rebindGenerationTaskPassages(item.packet, row.normalizedCandidate.taskDescriptor.passageIds);
            row.deterministic = { numerics: generation.verifyGeneratedNumerics(row.normalizedCandidate), variation: generation.requestedNumericalVariationFailure(item.request.instructions, row.normalizedCandidate) ?? null,
              evidenceLeak: generation.studentEvidenceIdLeak(row.normalizedCandidate, item.packet.passages.map(p => p.id)) ?? null, originalHash: hashControl(row.originalCandidate), normalizedHash: hashControl(row.normalizedCandidate) };
            row.status = 'generated';
          } catch (caught) { row.status = 'invalid-candidate'; row.eligible = false; row.error = safeError(caught); }
          await persist();
        }
        for (const gap of group) {
          const row = rows.find(item => item.id === gap.id)!; if (row.status !== 'generated') continue;
          await current(); const item = c.fixture.cases.find(value => value.id === gap.schedule.caseId)!;
          const initial = await readInitialPrompt(quality, item, row.normalizedCandidate!, gap.schedule.order);
          if (gap.operation === 'review-retained') assert.equal(initial.prompt, gap.originalFailedRequest.prompt);
          const completion = initial.prompt === null ? recorders.get(row.id)!.complete : frozenReviewCompletion(recorders.get(row.id)!.complete, initial.prompt,
            c.proof.protocol.correctionContract, quality.reviewCorrectionInstructions, mapping => { row.mappings.push(mapping); });
          const guarded = latchCompletionFailure(completion);
          row.quality = initial.prompt === null ? initial.assessment : await budgetModule.withAuthoringBudget(cellBudgets.get(row.id)!, () => quality.assessGenerationQuality({
            packet: structuredClone(item.packet), memory: structuredClone(item.memory), candidate: { ...structuredClone(row.normalizedCandidate!), type: item.request.type },
            requirements: structuredClone(item.requirements), item: gap.schedule.order, policy: 'grounded-memory-v2', step: { model: 'gpt-6.1-sol', reasoningEffort: 'medium' }, complete: guarded.complete }));
          guarded.assertSucceeded();
          healthy(); const check = row.deterministic as { numerics: { failure?: string }; variation: string | null; evidenceLeak: string | null };
          row.eligible = row.quality.status === 'eligible' && !check.numerics.failure && !check.variation && !check.evidenceLeak; row.status = 'reviewed'; await persist();
        }
      }
    });
    await current(); assert.equal(recoverySummary(c, rows).recoveryUnresolved, 0); status = 'completed';
  } catch (caught) { status = 'stopped'; error = safeError(caught); throw caught; }
  finally { await persist(); }
}
if (require.main === module) {
  const args = parseRecoveryArguments(process.argv.slice(2)), output = path.resolve(args['--output']);
  void (args['--live'] === undefined ? prepareHeldoutRecovery(path.resolve(args['--origin'] ?? 'audit-results/quality-lab-2026-10-16-heldout-phase-three'), output).then(digest => console.log(JSON.stringify({ preflight: output, declarationSha256: digest, providerCalls: 0, databaseCalls: 0 })))
    : executeHeldoutRecovery(path.resolve(args['--declaration']), args['--declaration-sha256'], output))
    .catch(error => { console.error(safeError(error)); process.exitCode = 1; });
}
