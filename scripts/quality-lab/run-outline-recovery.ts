import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { StructureOptions, StructureResult } from '../../server/src/types/structure';
import type { AuthoringBudgetReceipt } from '../../server/src/types/authoring-budget';
import type { StructureGenerationObserver } from '../../server/src/services/structure-generation.service';
import type { ConservativeLedger } from './ledger';
import { assertLedgerIntegrity, readDeclaredOutlinePhase } from './phase-declaration';
import { fixtureSections, outlineOptionsForFixture, validateDeclaredColdFixture, type OutlineCorpusFixture } from './outline-controls';
import { createCapturedCompletion } from './completion';
import { serializeAdmission } from './serialize-admission';
import { hashControl, safeError, sha256, type CapturedCompletion } from './protocol';
import { summarizeHarnessUsage } from '../prompt-ab/usage-summary';

export interface RecoveryControls {
  version: number; fixture: string; fixtureSha256: string; courseId: string; database: string; actor: string;
  model: string; reasoningEffort: string; maxOutputTokens: number; extractionOutputCap: number; synthesisOutputCap: number; sourceReviewOutputCap: number;
  options: StructureOptions & { materialIds: string[] }; sourceReceipt: unknown; structureSourceSha256: string; inventorySourceSha256: string;
  ledger: string; scope: string; coldCacheRequired: boolean; observedLedgerBefore: { reservedSends: number; conservativeTokens: number };
  phaseDeclaration: { file: string; sha256: string };
}
interface DiagnosticRun {
  _id: string; courseId: string; requestedBy: string; kind: string; status: string; input: StructureOptions;
  structureResult?: unknown; structureDiagnostics?: { budget?: AuthoringBudgetReceipt; [key: string]: unknown };
  error?: { code: string; message: string };
}
export interface RecoveryPrior {
  version: number; status: string; controlsSha256: string; runId: string; elapsedMs: number; result: null;
  error: { name: string; message: string }; budget: AuthoringBudgetReceipt; diagnosticRun: DiagnosticRun;
  liveCorpus: { fingerprint: string; [key: string]: unknown }; captures: Array<{ file: string; transcript: CapturedCompletion }>;
  code: Array<{ file: string; snapshot: string; sha256: string }>;
}
const BUDGET_STOP = 'authoring-budget-exhausted:total';
const TRANSPORT_STOPS = new Set(['Request timed out.', 'Unknown error occurred while calling OpenAI API']);
export type RecoveryStopKind = 'native-total' | 'provider-transport';
export const RECOVERY_REQUIRED_PRIOR_CODE = [
  'scripts/quality-lab/run-outline-experiment.ts', 'scripts/quality-lab/outline-controls.ts', 'scripts/quality-lab/serialize-admission.ts',
  'scripts/quality-lab/completion.ts', 'scripts/quality-lab/capture.ts', 'scripts/quality-lab/ledger.ts', 'scripts/quality-lab/phase-declaration.ts',
  'server/src/services/structure-generation.service.ts', 'server/src/services/structure-source-inventory.ts', 'server/src/services/source-evidence-cache.service.ts',
  'server/src/services/source-readiness.service.ts', 'server/src/services/structure-outline-grounding.ts', 'server/src/types/structure.ts',
  'server/src/services/content-runs.service.ts', 'server/src/components/genai/llm/index.ts', 'server/src/components/genai/llm/model-capabilities.ts',
  'server/src/components/genai/llm/model-call.ts', 'server/src/components/genai/llm/authoring-budget.ts',
] as const;
function fail(reason: string): never { throw new Error(`quality-lab-outline-recovery-${reason}`); }

/** A generic API message alone is insufficient. Capture reconciliation must also
 * prove a terminal, failed provider dispatch with retained unknown usage. */
export function recoveryStopKind(prior: RecoveryPrior): RecoveryStopKind {
  if (prior.error?.message === BUDGET_STOP) return 'native-total';
  if (['Error', 'APIError'].includes(prior.error?.name) && TRANSPORT_STOPS.has(prior.error?.message)) return 'provider-transport';
  return fail('terminal-cold-native-total-stop-required');
}

/** Narrowly admits a new cache-assisted attempt after a terminal native-total
 * or evidenced transport stop. The failed cold attempt remains unchanged. */
export function assertRecoveryPrior(controls: RecoveryControls, prior: RecoveryPrior): void {
  const stopKind = recoveryStopKind(prior);
  if (prior.version !== 1 || prior.status !== 'stopped' || prior.result !== null ||
      !/^[a-f0-9]{24}$/.test(prior.runId) || prior.controlsSha256 !== hashControl(controls) ||
      controls.version !== 1 || !controls.coldCacheRequired || !controls.phaseDeclaration || controls.model !== 'gpt-6-luna' || controls.reasoningEffort !== 'medium' ||
      controls.maxOutputTokens !== 24000 || controls.extractionOutputCap !== 12000 || controls.synthesisOutputCap !== 24000 || controls.sourceReviewOutputCap !== 6000 ||
      !controls.actor.startsWith('QUALITY-RETEST-FIXTURE-') || !/^financebot_quality_smoke_retest_[a-z0-9_]+$/.test(controls.database) ||
      controls.options.materialIds.length !== 10 || new Set(controls.options.materialIds).size !== 10 || !/^[a-f0-9]{24}$/.test(controls.options.sourceBatchId ?? '') ||
      controls.observedLedgerBefore.reservedSends !== 0 || controls.observedLedgerBefore.conservativeTokens !== 0) fail('terminal-cold-native-total-stop-required');
  const run = prior.diagnosticRun; const native = run?.structureDiagnostics?.budget; const outer = prior.budget;
  if (!run || run._id !== prior.runId || run.courseId !== controls.courseId || run.requestedBy !== controls.actor || run.kind !== 'structure-generation' ||
      run.status !== 'failed' || run.structureResult || run.error?.code !== 'quality-lab-outline-stopped' || run.error.message !== prior.error.message ||
      hashControl(run.input) !== hashControl(controls.options) || !prior.liveCorpus?.fingerprint || !native ||
      [outer, native].some(receipt => receipt.accounting !== 'conservative-reservations-v1' || receipt.pendingSends !== 0 ||
        receipt.limits.maxEstimatedTokens !== 2_000_000 || receipt.limits.maxInputTokens !== 200000 || receipt.limits.maxOutputTokens !== 24000 ||
        !Number.isSafeInteger(receipt.observedSends) || receipt.observedSends < 1 || !Number.isSafeInteger(receipt.admissionTokens) || receipt.admissionTokens! < 0 || receipt.admissionTokens! > 2_000_000 ||
        !Number.isSafeInteger(receipt.estimatedInputTokens) || receipt.estimatedInputTokens < 0 || !Number.isSafeInteger(receipt.reservedOutputTokens) || receipt.reservedOutputTokens < 0 ||
        receipt.admissionTokens !== receipt.estimatedInputTokens + receipt.reservedOutputTokens || receipt.conservativeFinishedSends !== receipt.observedSends || receipt.settledSends !== 0 ||
        !Number.isSafeInteger(receipt.rejectedSends) || receipt.rejectedSends < 0) ||
      (stopKind === 'native-total' ? outer.rejectedSends < 1 : outer.rejectedSends !== 0 || native.rejectedSends !== 0) ||
      native.observedSends !== outer.observedSends || native.admissionTokens !== outer.admissionTokens ||
      native.estimatedInputTokens !== outer.estimatedInputTokens || native.reservedOutputTokens !== outer.reservedOutputTokens) fail('failed-owned-native-run-required');
  if (new Set(prior.code.map(identity => identity.file)).size !== prior.code.length ||
      RECOVERY_REQUIRED_PRIOR_CODE.some(file => !prior.code.some(identity => identity.file === file && /^[a-f0-9]{64}$/.test(identity.sha256) && identity.snapshot))) fail('complete-cold-code-manifest-required');
}

/** Counters alone do not make a ledger append-only: every old reservation and
 * immutable header must remain identical, including unknown/rejected work. */
export function assertAppendOnlyLedger(before: ConservativeLedger, current: ConservativeLedger): void {
  assertLedgerIntegrity(before); assertLedgerIntegrity(current);
  const header = (ledger: ConservativeLedger) => { const { reservedSends: _sends, conservativeTokens: _tokens, reservations: _rows, ...rest } = ledger; void _sends; void _tokens; void _rows; return rest; };
  if (hashControl(header(before)) !== hashControl(header(current)) || current.reservations.length < before.reservations.length ||
      hashControl(current.reservations.slice(0, before.reservations.length)) !== hashControl(before.reservations) ||
      new Set(current.reservations.map(row => row.id)).size !== current.reservations.length) fail('ledger-prefix-changed');
}

/** Reconcile the entire new phase's cold ledger, including prepared attempts
 * rejected by the native budget. No unrelated or concurrent phase work fits. */
export function assertRecoveryCaptureLedger(controls: RecoveryControls, prior: RecoveryPrior, ledger: ConservativeLedger): void {
  assertLedgerIntegrity(ledger);
  const stopKind = recoveryStopKind(prior);
  const available = [...ledger.reservations]; let observed = 0; let observedInput = 0; let observedOutput = 0; let nativeTotalRejectionProved = false;
  const callIds = new Set<string>(); let transportFailures = 0; let matchingTransportFailure = false;
  if (ledger.scope !== controls.scope || !available.length || new Set(available.map(row => row.id)).size !== available.length) fail('cold-ledger-does-not-reconcile');
  for (const capture of prior.captures) {
    const transcript = capture.transcript;
    const expectedCap = transcript?.stage === 'source-extraction' ? 12000 : transcript?.stage === 'outline-source-review' ? 6000 :
      ['outline-synthesis', 'outline-organization'].includes(transcript?.stage) ? 24000 : null;
    if (!transcript || !expectedCap || transcript.request.model !== controls.model || transcript.request.effort !== controls.reasoningEffort ||
        transcript.request.stage !== transcript.stage || transcript.request.maxOutputTokens !== expectedCap || !transcript.attempts.length ||
        transcript.request.maxInputTokens !== 200000 || transcript.request.maxSends !== 2 ||
        hashControl(transcript.request.allowedActualModels) !== hashControl([controls.model]) ||
        !['succeeded', 'failed'].includes(transcript.status) ||
        (transcript.status === 'failed' && (stopKind === 'native-total' ? transcript.error?.message !== BUDGET_STOP :
          transcript.error?.name !== 'APIError' || !TRANSPORT_STOPS.has(transcript.error.message) || transcript.parsed !== null || transcript.modelIdentityVerified)) ||
        (transcript.status === 'succeeded' && (!transcript.modelIdentityVerified || transcript.error !== null || transcript.parsed === null))) fail('cold-capture-incomplete');
    for (const [attemptIndex, attempt] of transcript.attempts.entries()) {
      const systemPrompt = attempt.input.systemPrompt ?? ''; const inputHash = hashControl({ actualPrompt: attempt.input.prompt, systemPrompt });
      const inputEstimate = Buffer.byteLength(JSON.stringify([{ role: 'user', content: attempt.input.prompt }]) + systemPrompt, 'utf8') + 32;
      const index = available.findIndex(row => row.cellId === 'outline' && row.stage === transcript.stage && row.jsonAttempt === attempt.number &&
        row.inputSha256 === inputHash && row.inputEstimate === inputEstimate && row.outputReservation === expectedCap);
      if (index < 0 || inputEstimate > 200000 || attempt.inputSha256 !== hashControl(attempt.input) || attempt.input.model !== controls.model || attempt.input.outputCap !== expectedCap ||
          hashControl(attempt.input.messages) !== hashControl([{ role: 'user', content: attempt.input.prompt }]) ||
          attempt.input.options.model !== controls.model || attempt.input.options.reasoning_effort !== controls.reasoningEffort ||
          attempt.input.options.max_completion_tokens !== expectedCap || 'temperature' in attempt.input.options || ![0, 1].includes(attempt.number)) fail('cold-ledger-does-not-reconcile');
      available.splice(index, 1);
      const started = attempt.events.filter(event => event.type === 'started'); const finished = attempt.events.filter(event => event.type === 'finished');
      if (attempt.dispatch === 'prepared') {
        if (stopKind !== 'native-total' || attempt.events.length || attempt.rawVisibleText || transcript.status !== 'failed' || transcript.error?.message !== BUDGET_STOP) fail('cold-capture-in-flight');
        nativeTotalRejectionProved ||= prior.budget.admissionTokens! + inputEstimate + expectedCap > prior.budget.limits.maxEstimatedTokens;
      } else {
        const failedTransport = stopKind === 'provider-transport' && transcript.status === 'failed' && attemptIndex === transcript.attempts.length - 1;
        const { model: _model, ...nativeOptions } = attempt.input.options; void _model;
        if (attempt.dispatch !== 'finished' || (!failedTransport && !attempt.rawVisibleText) || attempt.events.length !== 2 || started.length !== 1 || finished.length !== 1 ||
            (!failedTransport && finished[0]!.actualModel !== controls.model) ||
            (failedTransport && finished[0]!.actualModel !== null && finished[0]!.actualModel !== controls.model) ||
            finished[0]!.requestedModel !== controls.model || finished[0]!.outcome !== (failedTransport ? 'failed' : 'succeeded') ||
            !started[0]!.callId || callIds.has(started[0]!.callId) || started[0]!.callId !== finished[0]!.callId ||
            started[0]!.startedAt !== finished[0]!.startedAt || hashControl(started[0]!.usageContext) !== hashControl(finished[0]!.usageContext) ||
            !Number.isFinite(Date.parse(started[0]!.startedAt)) || !Number.isFinite(Date.parse(finished[0]!.finishedAt)) ||
            Date.parse(finished[0]!.finishedAt) < Date.parse(started[0]!.startedAt) || !Number.isFinite(finished[0]!.durationMs) || finished[0]!.durationMs < 0 ||
            attempt.events.some(event => event.provider !== attempt.input.provider || event.requestedModel !== controls.model ||
              (event.actualModel !== null && event.actualModel !== controls.model) || hashControl(event.requestOptions) !== hashControl({ ...nativeOptions, stream: true }) ||
              event.requestOptions.reasoning_effort !== controls.reasoningEffort || event.requestOptions.max_completion_tokens !== expectedCap ||
              'temperature' in event.requestOptions || event.usageContext.stage !== transcript.stage || event.usageContext.jsonAttempt !== attempt.number)) fail('cold-capture-in-flight');
        if (failedTransport) {
          const usage = finished[0]!.usage;
          if (!usage || usage.inputTokens !== null || usage.outputTokens !== null || usage.totalTokens !== null || usage.reasoningTokens !== null ||
              usage.cachedInputTokens !== null || usage.cacheWriteTokens != null || usage.totalOrigin !== 'unknown' || usage.countSource !== 'unavailable') fail('cold-failed-usage-must-remain-unknown');
          transportFailures++; matchingTransportFailure ||= transcript.error!.message === prior.error.message;
        }
        callIds.add(started[0]!.callId); observed++; observedInput += inputEstimate; observedOutput += expectedCap;
      }
    }
  }
  if (available.length || observed !== prior.budget.observedSends || observedInput !== prior.budget.estimatedInputTokens || observedOutput !== prior.budget.reservedOutputTokens ||
      (stopKind === 'native-total' ? !nativeTotalRejectionProved || transportFailures !== 0 : transportFailures < 1 || !matchingTransportFailure || nativeTotalRejectionProved)) fail('cold-ledger-does-not-reconcile');
}

const argument = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };

async function main(): Promise<void> {
  const priorDirectory = argument('--prior'); const output = argument('--output'); const live = argument('--live');
  if (!priorDirectory || !output || (live !== undefined && live !== 'once')) fail('supply-prior-new-output-and-optional-live-once');
  const [controlsRaw, priorRaw] = await Promise.all([readFile(path.join(priorDirectory, 'controls.json'), 'utf8'), readFile(path.join(priorDirectory, 'results.json'), 'utf8')]);
  const cold = JSON.parse(controlsRaw) as RecoveryControls; const prior = JSON.parse(priorRaw) as RecoveryPrior; assertRecoveryPrior(cold, prior);
  const stopKind = recoveryStopKind(prior);
  const phase = await readDeclaredOutlinePhase(cold.phaseDeclaration.file, cold.phaseDeclaration.sha256, cold.ledger, cold.scope);
  assertRecoveryCaptureLedger(cold, prior, phase.ledger);
  const fixtureRaw = await readFile(cold.fixture, 'utf8'); if (sha256(fixtureRaw) !== cold.fixtureSha256) fail('fixture-changed');
  const fixture = JSON.parse(fixtureRaw) as OutlineCorpusFixture;
  const origin = JSON.parse(await readFile(phase.declaration.sourceFixtureOrigin.path, 'utf8')) as OutlineCorpusFixture;
  validateDeclaredColdFixture(fixture, origin); const corpusPlan = fixtureSections(fixture);
  if (fixture.fixtureKind !== 'http-upload-real-index' || fixture.courseId !== cold.courseId || fixture.actor !== cold.actor || fixture.database !== cold.database ||
      hashControl(outlineOptionsForFixture(fixture)) !== hashControl(cold.options)) fail('exact-full-ten-scope-required');
  const retained = [{ file: path.join(priorDirectory, 'controls.json'), sha256: sha256(controlsRaw) }, { file: path.join(priorDirectory, 'results.json'), sha256: sha256(priorRaw) }];
  for (const identity of prior.code) {
    const [snapshot, current] = await Promise.all([readFile(identity.snapshot), readFile(identity.file)]);
    if (sha256(snapshot) !== identity.sha256 || sha256(current) !== identity.sha256) fail(`code-drift:${identity.file}`);
    retained.push({ file: identity.snapshot, sha256: identity.sha256 });
  }
  for (const capture of prior.captures) {
    const raw = await readFile(capture.file, 'utf8'); if (hashControl(JSON.parse(raw)) !== hashControl(capture.transcript)) fail('retained-capture-drift');
    retained.push({ file: capture.file, sha256: sha256(raw) });
  }
  for (const source of fixture.sources) if (sha256(await readFile(source.publicPdf)) !== source.pdfSha256) fail('pdf-drift');
  if (prior.code.find(identity => identity.file === 'server/src/services/structure-generation.service.ts')?.sha256 !== cold.structureSourceSha256 ||
      prior.code.find(identity => identity.file === 'server/src/services/structure-source-inventory.ts')?.sha256 !== cold.inventorySourceSha256) fail('production-control-hash-mismatch');
  const remaining = { sends: phase.ledger.limits.maxSends - phase.ledger.reservedSends, conservativeTokens: phase.ledger.limits.maxConservativeTokens - phase.ledger.conservativeTokens };
  if (remaining.sends < 1 || remaining.conservativeTokens <= cold.synthesisOutputCap + 32) fail('remaining-phase-room-insufficient');
  const controls = { ...cold, createdAt: new Date().toISOString(), mode: `one-cache-assisted-new-run-after-${stopKind}-stop`, coldCacheRequired: false,
    priorStopKind: stopKind, priorError: prior.error,
    prior: path.resolve(priorDirectory), priorRunId: prior.runId, priorControlsSha256: sha256(controlsRaw), priorResultsSha256: sha256(priorRaw),
    priorSourceFingerprint: prior.liveCorpus.fingerprint, retained, priorObservedModelSends: prior.budget.observedSends, priorElapsedMs: prior.elapsedMs,
    ledgerBeforeSha256: hashControl(phase.ledger), observedLedgerBefore: { reservedSends: phase.ledger.reservedSends, conservativeTokens: phase.ledger.conservativeTokens }, remaining,
    coldMinimumGuardExemption: 'Only this explicitly separate cache-assisted attempt skips the full cold-extraction estimate. Exact originals, scope, model, current production cache validators, native per-run2m and append-only shared160/4m limits remain mandatory. No historical final output is substituted.',
    mutationScope: 'One new owned diagnostic contentRun and normal validated source/pack cache reuse or writes; no Agenda, source mutation, Topic/LO Apply, questions or student writes.',
    limitations: ['The original cold attempt remains stopped. This is a new cache-assisted attempt with its own normal native budget and no completion guarantee.',
      'Prepared-but-undispatched and unknown reservations remain charged. Shared phase accounting is never reset or settled from successful reported usage.',
      'The cold run did not retain an endpoint-identity hash; current production cache keys still bind the configured endpoint, source, prompt, schema and model.',
      'Coverage IDs, cache reuse and model source verdicts do not establish teacher acceptance or complete pedagogical coverage.'] };
  await mkdir(output, { recursive: false });
  await writeFile(path.join(output, 'controls.json'), JSON.stringify(controls, null, 2) + '\n', { flag: 'wx' });
  await writeFile(path.join(output, 'ledger-before.json'), JSON.stringify(phase.ledger, null, 2) + '\n', { flag: 'wx' });
  const code: Array<{ file: string; snapshot: string; sha256: string }> = [];
  for (const file of [...prior.code.map(identity => identity.file), 'scripts/quality-lab/run-outline-recovery.ts']) {
    const bytes = await readFile(file); const snapshot = path.join(output, 'code', file); await mkdir(path.dirname(snapshot), { recursive: true });
    await writeFile(snapshot, bytes, { flag: 'wx' }); code.push({ file, snapshot, sha256: sha256(bytes) });
  }
  if (!live) { console.log(JSON.stringify({ preflight: true, providerCalls: 0, databaseCalls: 0, output, priorRunId: prior.runId, remaining, files: fixture.sources.length })); return; }
  const [{ env }, mongo, { ObjectId }, collections, structure, runs, commits, authoring, { completeJson }] = await Promise.all([
    import('../../server/src/config/env'), import('../../server/src/components/mongodb'), import('mongodb'), import('../../server/src/components/mongodb/collections'),
    import('../../server/src/services/structure-generation.service'), import('../../server/src/services/content-runs.service'), import('../../server/src/services/authoring-commit.service'),
    import('../../server/src/services/authoring-budget.service'), import('../../server/src/components/genai/llm'),
  ]);
  const address = new URL(env.mongodbUri);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(address.hostname) || address.port !== '27029' || env.mongodbDbName !== cold.database) fail('owned-local-27029-database-required');
  if (hashControl(authoring.defaultAuthoringLimits({ maxInputTokens: env.authoringStructureMaxInputTokens })) !== hashControl(prior.diagnosticRun.structureDiagnostics!.budget!.limits) ||
      prior.captures.some(capture => capture.transcript.attempts.some(attempt => attempt.input.provider !== env.llmProvider))) fail('effective-native-config-changed');
  const assertCurrent = async () => {
    if (sha256(await readFile(cold.fixture)) !== cold.fixtureSha256) fail('fixture-changed');
    const current = await readDeclaredOutlinePhase(cold.phaseDeclaration.file, cold.phaseDeclaration.sha256, cold.ledger, cold.scope);
    assertAppendOnlyLedger(phase.ledger, current.ledger);
    if (current.ledger.reservations.slice(phase.ledger.reservations.length).some(row => row.cellId !== `outline-recovery-${prior.runId}`)) fail('unrelated-phase-ledger-work');
    for (const control of [...retained, ...code]) if (sha256(await readFile(control.file)) !== control.sha256) fail(`retained-control-changed:${control.file}`);
    for (const source of fixture.sources) if (sha256(await readFile(source.publicPdf)) !== source.pdfSha256) fail('pdf-drift');
  };
  const budget = new authoring.AuthoringBudget(`${cold.scope}:outline-recovery`, { maxSends: remaining.sends, maxInputTokens: 200000, maxOutputTokens: 24000, maxEstimatedTokens: remaining.conservativeTokens });
  const recorder = createCapturedCompletion({ directory: path.join(output, 'transcripts'), ledgerPath: cold.ledger, scope: cold.scope, limits: phase.ledger.limits,
    cellId: `outline-recovery-${prior.runId}`, complete: serializeAdmission(completeJson), maxInputTokens: 200000, maxOutputTokens: 24000, assertCurrent });
  let status = 'preparing-live'; let result: StructureResult | null = null; let error: ReturnType<typeof safeError> | null = null;
  let diagnosticRun: unknown = null; let runId: InstanceType<typeof ObjectId> | undefined; let liveCorpus: unknown = null; let cacheBefore: unknown = null;
  const events: Parameters<StructureGenerationObserver['record']>[0][] = []; const started = Date.now();
  const save = async () => { const file = path.join(output, 'results.json'); const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify({ version: 1, status, elapsedMs: Date.now() - started, controlsSha256: hashControl(controls), code, runId: runId?.toHexString() ?? null,
      diagnosticRun, liveCorpus, cacheBefore, result, error, captures: recorder.captures, events, budget: budget.snapshot(),
      usage: summarizeHarnessUsage(recorder.captures.filter(row => row.transcript).flatMap(row => row.transcript.attempts.flatMap(attempt => attempt.events)), { coverageComplete: true }),
      priorAttempt: { directory: controls.prior, runId: prior.runId, status: prior.status, observedSends: prior.budget.observedSends, elapsedMs: prior.elapsedMs },
      saved: 0, adopted: 0, teacherAcceptance: null, semanticCoverage: null, limitations: controls.limitations }, null, 2) + '\n', { flag: 'wx' }); await rename(temporary, file); };
  await save();
  try {
    const db = await mongo.connectMongo(); const courseId = new ObjectId(cold.courseId);
    const course = await collections.coursesCol().findOne({ _id: courseId });
    if (course?.ownerPuid !== cold.actor || course.authoringDeletionStartedAt || course.lifecycle === 'archived' || course.archivedAt || !(await commits.initializeAuthoringCommitSupport()).available) fail('owned-active-replica-course-required');
    await assertCurrent();
    const currentPrior = await runs.getContentRun(new ObjectId(prior.runId));
    if (!currentPrior || hashControl(JSON.parse(JSON.stringify(currentPrior))) !== hashControl(prior.diagnosticRun)) fail('durable-prior-changed');
    if (await db.collection('contentRuns').countDocuments({ courseId, status: { $in: ['queued', 'running'] } })) fail('other-active-course-run');
    const loaded = await structure.loadStructureCorpus(courseId, cold.options.materialIds, cold.options.sourceBatchId);
    const normalize = (sections: typeof loaded.sections) => sections.map(({ materialId, materialName, chunkIndex, localId, text }) => ({ materialId, materialName, chunkIndex, localId, text })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    if (loaded.fingerprint !== prior.liveCorpus.fingerprint || hashControl(normalize(loaded.sections)) !== hashControl(normalize(corpusPlan.sections))) fail('live-original-source-drift');
    liveCorpus = loaded; cacheBefore = { sourceEvidenceExtractions: await db.collection('sourceEvidenceExtractions').countDocuments({ courseId }),
      priorStructureRuns: await db.collection('contentRuns').countDocuments({ courseId, kind: 'structure-generation' }) };
    if (!(cacheBefore as { sourceEvidenceExtractions: number }).sourceEvidenceExtractions) fail('no-validated-source-cache-to-recover');
    const run = await runs.createStructureGenerationRun({ courseId, requestedBy: cold.actor, options: cold.options }); runId = run._id;
    diagnosticRun = await runs.updateContentRun(runId, { status: 'running', stage: 'analyzing' }); status = 'running-cache-assisted'; await save();
    result = await authoring.withAuthoringBudget(budget, () => structure.generateStructure(courseId, cold.options, runId, {
      model: { model: 'gpt-6-luna', reasoningEffort: 'medium' }, maxOutputTokens: 24000, complete: recorder.complete,
      record: async event => { events.push(event); await save(); },
    }));
    await assertCurrent();
    if ((await structure.loadStructureCorpus(courseId, cold.options.materialIds, cold.options.sourceBatchId)).fingerprint !== prior.liveCorpus.fingerprint) fail('live-original-source-drift');
    diagnosticRun = await runs.updateContentRun(runId, { status: 'completed', stage: 'checking', structureResult: result }); status = 'completed';
  } catch (caught) {
    status = 'stopped'; error = safeError(caught); process.exitCode = 1;
    if (runId) {
      const active = await runs.getContentRun(runId);
      if (active && (active.status === 'queued' || active.status === 'running')) await runs.failContentRun(runId, { code: 'quality-lab-outline-recovery-stopped', message: error.message, atStage: active.stage, retryable: false });
      diagnosticRun = await runs.getContentRun(runId);
    }
  } finally {
    try {
      const current = await readDeclaredOutlinePhase(cold.phaseDeclaration.file, cold.phaseDeclaration.sha256, cold.ledger, cold.scope); assertAppendOnlyLedger(phase.ledger, current.ledger);
      await writeFile(path.join(output, 'ledger-after.json'), JSON.stringify(current.ledger, null, 2) + '\n', { flag: 'wx' });
    } catch (caught) { status = 'stopped'; error = safeError(caught); process.exitCode = 1; }
    try { await save(); } finally { await mongo.closeMongo(); }
  }
  console.log(JSON.stringify({ status, output: path.resolve(output), priorColdStatus: prior.status, observedModelSends: budget.snapshot().observedSends,
    aggregateColdAndRecoveryObservedSends: prior.budget.observedSends + budget.snapshot().observedSends,
    files: result?.coverage.materials.length ?? null, teacherAcceptance: null, semanticCoverage: null, saved: 0, adopted: 0 }));
}

if (require.main === module) void main().catch(error => { console.error(safeError(error).message); process.exitCode = 1; });
