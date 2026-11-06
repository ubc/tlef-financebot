import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { StructureResult } from '../../server/src/types/structure';
import type { StructureGenerationObserver } from '../../server/src/services/structure-generation.service';
import type { ConservativeLedger, LedgerLimits } from './ledger';
import type { RecoveryControls, RecoveryPrior } from './run-outline-recovery';
import { assertAppendOnlyLedger } from './run-outline-recovery';
import { assertLedgerIntegrity } from './phase-declaration';
import { fixtureSections, outlineOptionsForFixture, type OutlineCorpusFixture } from './outline-controls';
import { createCapturedCompletion } from './completion';
import { serializeAdmission } from './serialize-admission';
import { hashControl, safeError, sha256 } from './protocol';
import { summarizeHarnessUsage } from '../prompt-ab/usage-summary';

export const OUTLINE_V2_SCOPE = 'quality-lab-2026-10-16-outline-v2-acceptance';
export const OUTLINE_V2_LIMITS: LedgerLimits = { maxSends: 100, maxConservativeTokens: 2_000_000, maxInputTokens: 200000 };
export const OUTLINE_V2_COLD_RUN = '6ad2adfee0053b5beee70fc8';
export const OUTLINE_V2_RECOVERY_RUN = '6ad2cae88e3e260e233c924c';
const COURSE = '6ad2ad04e474ab8460b47c07'; const BATCH = '6ad2ad05e474ab8460b47c09';
const DATABASE = 'financebot_quality_smoke_retest_20261016';
const ACTOR = 'QUALITY-RETEST-FIXTURE-81eeb3b2-c89e-4dc3-be9f-4d097eddbecd';
const FINGERPRINT = '32c828c5aa9a4778b8f6b0802026a2861968d09bc0362a7be833c14b310a97ed';
interface FilePin { path: string; sha256: string }
interface CodePin { file: string; sha256: string }
interface AttemptPins { runId: string; controls: FilePin; results: FilePin }
export interface OutlineV2AcceptanceDeclaration {
  version: 1; phase: 'ten-chapter-outline-v2-acceptance'; createdAt: string; scope: string; ledger: string; limits: LedgerLimits;
  model: { model: 'gpt-6-luna'; reasoningEffort: 'medium' }; maximumOutputTokens: 24000;
  extractionOutputCap: 12000; synthesisOutputCap: 24000; sourceReviewOutputCap: 6000;
  fixture: FilePin; sourceFingerprint: string; code: CodePin[]; purpose: string;
  priorLedgers: Array<FilePin & { scope: string; reservedSends: number; conservativeTokens: number; immutable: true }>;
  history: { cold: AttemptPins; recovery: AttemptPins & { ledgerAfter: FilePin } };
  reviewProbe: FilePin; rootAgentReviewedAfterProbe: true;
}
export interface OutlineV2AcceptanceLedger extends ConservativeLedger { phaseDeclarationSha256: string }
type Prior = RecoveryPrior & { diagnosticRun: RecoveryPrior['diagnosticRun'] & { completedUnits?: number; totalUnits?: number;
  structureSynthesisPacks?: Array<{ key: string; evidenceIds: string[]; [key: string]: unknown }> } };
function fail(reason: string): never { throw new Error(`quality-lab-outline-v2-${reason}`); }
const isHash = (value: string) => /^[a-f0-9]{64}$/.test(value);
const validPin = (pin: FilePin) => Boolean(pin && path.isAbsolute(pin.path) && isHash(pin.sha256));

/** Prospective declaration only: previous phase hashes must already be final.
 * This helper neither creates a declaration nor initializes/resets its ledger. */
export function assertOutlineV2Declaration(declaration: OutlineV2AcceptanceDeclaration): void {
  if (declaration.version !== 1 || declaration.phase !== 'ten-chapter-outline-v2-acceptance' || declaration.scope !== OUTLINE_V2_SCOPE ||
      !path.isAbsolute(declaration.ledger) || hashControl(declaration.limits) !== hashControl(OUTLINE_V2_LIMITS) ||
      declaration.maximumOutputTokens !== 24000 || declaration.extractionOutputCap !== 12000 || declaration.synthesisOutputCap !== 24000 || declaration.sourceReviewOutputCap !== 6000 ||
      declaration.model.model !== 'gpt-6-luna' || declaration.model.reasoningEffort !== 'medium' || declaration.sourceFingerprint !== FINGERPRINT ||
      !validPin(declaration.fixture) || !validPin(declaration.reviewProbe) || declaration.rootAgentReviewedAfterProbe !== true ||
      !declaration.purpose.trim() || !Number.isFinite(Date.parse(declaration.createdAt))) fail('declaration-invalid');
  const phases = ['quality-lab-2026-10-16-phase-one', 'quality-lab-2026-10-16-ten-chapter-phase-two'];
  if (declaration.priorLedgers.length !== 2 || declaration.priorLedgers.some((pin, index) => !validPin(pin) || pin.scope !== phases[index] || pin.immutable !== true ||
      pin.path === declaration.ledger || !Number.isSafeInteger(pin.reservedSends) || !Number.isSafeInteger(pin.conservativeTokens)) ||
      declaration.priorLedgers[0]!.reservedSends !== 64 || declaration.priorLedgers[0]!.conservativeTokens !== 1799920 ||
      declaration.priorLedgers[1]!.reservedSends < 90 || declaration.priorLedgers[1]!.conservativeTokens < 3404208 ||
      new Set(declaration.priorLedgers.map(pin => pin.path)).size !== 2) fail('prior-phase-lineage-required');
  if (declaration.history.cold.runId !== OUTLINE_V2_COLD_RUN || declaration.history.recovery.runId !== OUTLINE_V2_RECOVERY_RUN ||
      [declaration.history.cold, declaration.history.recovery].some(attempt => !validPin(attempt.controls) || !validPin(attempt.results)) ||
      !validPin(declaration.history.recovery.ledgerAfter)) fail('exact-terminal-history-required');
  if (!declaration.code.length || new Set(declaration.code.map(pin => pin.file)).size !== declaration.code.length ||
      declaration.code.some(pin => !isHash(pin.sha256) || path.isAbsolute(pin.file) || pin.file.split(/[\\/]/).includes('..')) ||
      !['scripts/quality-lab/run-outline-v2-acceptance.ts', 'server/src/services/structure-outline-grounding.ts', 'server/src/services/structure-generation.service.ts',
        'server/src/components/genai/document-parsing/index.ts', 'server/src/services/source-readiness.service.ts', 'package.json', 'package-lock.json'].every(file => declaration.code.some(pin => pin.file === file))) fail('complete-current-code-manifest-required');
}

export function emptyOutlineV2AcceptanceLedger(declaration: OutlineV2AcceptanceDeclaration, declarationSha256: string): OutlineV2AcceptanceLedger {
  assertOutlineV2Declaration(declaration); if (!isHash(declarationSha256)) fail('declaration-hash-invalid');
  return { version: 1, createdAt: declaration.createdAt, scope: declaration.scope, accounting: 'conservative-reservations-v1', limits: { ...declaration.limits },
    phaseDeclarationSha256: declarationSha256, reservedSends: 0, conservativeTokens: 0, reservations: [] };
}

export function assertOutlineV2Ledgers(declaration: OutlineV2AcceptanceDeclaration, prior: ConservativeLedger[], current: OutlineV2AcceptanceLedger,
  declarationSha256: string, recoveryAfter: ConservativeLedger): void {
  if (prior.length !== 2) fail('prior-phase-lineage-required');
  for (const [index, ledger] of prior.entries()) {
    assertLedgerIntegrity(ledger); const pin = declaration.priorLedgers[index]!;
    if (ledger.scope !== pin.scope || ledger.reservedSends !== pin.reservedSends || ledger.conservativeTokens !== pin.conservativeTokens ||
        hashControl(ledger.limits) !== hashControl(index === 0 ? OUTLINE_V2_LIMITS : { maxSends: 160, maxConservativeTokens: 4_000_000, maxInputTokens: 200000 })) fail('prior-ledger-mismatch');
  }
  assertAppendOnlyLedger(recoveryAfter, prior[1]!); assertLedgerIntegrity(current);
  if (!isHash(declarationSha256) || current.scope !== declaration.scope || current.phaseDeclarationSha256 !== declarationSha256 ||
      current.createdAt !== declaration.createdAt || hashControl(current.limits) !== hashControl(OUTLINE_V2_LIMITS) ||
      current.reservations.some(row => row.cellId !== 'outline-v2-acceptance')) fail('declared-ledger-mismatch');
}

/** Cache warmth is not assumed from row counts. The real pipeline must resolve
 * its exact validated cache identities before reaching these paid stages. */
export function assertOutlineV2PaidStage(stage: string | undefined, outputCap: number | undefined): void {
  const expected = stage === 'outline-organization' ? 24000 : stage === 'outline-source-review' ? 6000 : undefined;
  if (!expected || outputCap !== expected) fail('validated-warm-cache-or-stage-cap-required');
}

/** A changed implementation is intentional here. Original failed results and
 * their costs remain immutable; neither old final output nor old verdicts are
 * substituted for the new production organization and complete v2 review. */
export function assertOutlineV2History(declaration: OutlineV2AcceptanceDeclaration, fixture: OutlineCorpusFixture,
  coldControls: RecoveryControls, cold: Prior, recoveryControls: RecoveryControls & { priorRunId: string; priorControlsSha256: string; priorResultsSha256: string }, recovery: Prior): void {
  if (fixture.fixtureKind !== 'http-upload-real-index' || fixture.copiedCacheRows !== 0 || fixture.courseId !== COURSE || fixture.sourceBatchId !== BATCH ||
      fixture.database !== DATABASE || fixture.actor !== ACTOR || fixture.sources.length !== 10 || new Set(fixture.sources.map(source => source.materialId)).size !== 10 ||
      fixture.sources.reduce((sum, source) => sum + source.pages, 0) !== 599 || fixture.sources.reduce((sum, source) => sum + source.chunks.length, 0) !== 671 ||
      fixture.sources.map(source => source.chapter).sort((a, b) => a - b).join(',') !== '2,3,4,5,6,8,9,10,11,12') fail('exact-ten-originals-required');
  const options = outlineOptionsForFixture(fixture);
  for (const [index, result] of [cold, recovery].entries()) {
    const controls = index === 0 ? coldControls : recoveryControls; const run = result.diagnosticRun;
    const expectedError = index === 0 ? 'Unknown error occurred while calling OpenAI API' : 'structure-grounding-review-source';
    const native = run.structureDiagnostics?.budget;
    if (result.status !== 'stopped' || result.result !== null || result.runId !== (index === 0 ? OUTLINE_V2_COLD_RUN : OUTLINE_V2_RECOVERY_RUN) || result.error?.message !== expectedError ||
        result.controlsSha256 !== hashControl(controls) || controls.courseId !== COURSE || controls.actor !== ACTOR || controls.database !== DATABASE ||
        controls.fixture !== declaration.fixture.path || controls.fixtureSha256 !== declaration.fixture.sha256 || hashControl(controls.options) !== hashControl(options) ||
        controls.model !== 'gpt-6-luna' || controls.reasoningEffort !== 'medium' || controls.maxOutputTokens !== 24000 ||
        controls.extractionOutputCap !== 12000 || controls.synthesisOutputCap !== 24000 || controls.sourceReviewOutputCap !== 6000 ||
        run._id !== result.runId || run.courseId !== COURSE || run.requestedBy !== ACTOR || run.kind !== 'structure-generation' || run.status !== 'failed' || run.structureResult ||
        run.error?.message !== expectedError || run.error.code !== (index === 0 ? 'quality-lab-outline-stopped' : 'quality-lab-outline-recovery-stopped') || hashControl(run.input) !== hashControl(options) ||
        result.liveCorpus.fingerprint !== declaration.sourceFingerprint || !native || native.pendingSends !== 0 || native.limits.maxEstimatedTokens !== 2_000_000 ||
        native.limits.maxInputTokens !== 200000 || native.limits.maxOutputTokens !== 24000 || native.observedSends !== (index === 0 ? 64 : 26) ||
        native.admissionTokens !== (index === 0 ? 1575756 : 1828452) || result.budget.observedSends !== native.observedSends || result.budget.admissionTokens !== native.admissionTokens ||
        [native, result.budget].some(receipt => receipt.accounting !== 'conservative-reservations-v1' || receipt.settledSends !== 0 ||
          receipt.conservativeFinishedSends !== receipt.observedSends || receipt.admissionTokens !== receipt.estimatedInputTokens + receipt.reservedOutputTokens) ||
        result.budget.pendingSends !== 0 || result.captures.reduce((sum, capture) => sum + capture.transcript.attempts.length, 0) !== native.observedSends || result.captures.some(capture =>
          !capture.transcript || !['succeeded', 'failed'].includes(capture.transcript.status) || capture.transcript.attempts.some(attempt => attempt.dispatch !== 'finished'))) fail('terminal-owned-history-mismatch');
  }
  if (!coldControls.coldCacheRequired || recoveryControls.coldCacheRequired || recoveryControls.priorRunId !== cold.runId ||
      recoveryControls.priorControlsSha256 !== declaration.history.cold.controls.sha256 || recoveryControls.priorResultsSha256 !== declaration.history.cold.results.sha256 ||
      recovery.diagnosticRun.structureSynthesisPacks?.length !== 5 || recovery.diagnosticRun.completedUnits !== 671 || recovery.diagnosticRun.totalUnits !== 671) fail('recovery-lineage-mismatch');
}

/** Enumerate source files without importing their runtime environment. A new
 * transitive source file invalidates the prospective code manifest too. */
export async function outlineV2CodeFiles(): Promise<string[]> {
  const scan = async (directory: string): Promise<string[]> => {
    const rows = await readdir(directory, { withFileTypes: true }); const found: string[] = [];
    for (const row of rows) { const file = `${directory}/${row.name}`;
      if (row.isSymbolicLink()) fail('symlink-in-controlled-code');
      if (row.isDirectory()) found.push(...await scan(file)); else if (row.isFile() && file.endsWith('.ts')) found.push(file);
    }
    return found;
  };
  return [...await scan('server/src'), ...await scan('scripts/quality-lab'), 'package.json', 'package-lock.json', 'tsconfig.base.json', 'server/tsconfig.json'].sort();
}

const arg = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
async function main(): Promise<void> {
  const declarationFile = arg('--declaration'); const digest = arg('--declaration-sha256'); const output = arg('--output'); const live = arg('--live');
  if (!declarationFile || !digest || !output || (live !== undefined && live !== 'once')) fail('supply-declaration-hash-new-output-optional-live-once');
  const readPinned = async (pin: FilePin) => { const raw = await readFile(pin.path, 'utf8'); if (sha256(raw) !== pin.sha256) fail(`frozen-file-changed:${pin.path}`); return raw; };
  const declarationRaw = await readPinned({ path: path.resolve(declarationFile), sha256: digest });
  const declaration = JSON.parse(declarationRaw) as OutlineV2AcceptanceDeclaration; assertOutlineV2Declaration(declaration);
  const fixtureRaw = await readPinned(declaration.fixture); const fixture = JSON.parse(fixtureRaw) as OutlineCorpusFixture; const corpus = fixtureSections(fixture);
  const [coldControlsRaw, coldRaw, recoveryControlsRaw, recoveryRaw, afterRaw, probeRaw] = await Promise.all([
    declaration.history.cold.controls, declaration.history.cold.results, declaration.history.recovery.controls,
    declaration.history.recovery.results, declaration.history.recovery.ledgerAfter, declaration.reviewProbe,
  ].map(readPinned));
  const coldControls = JSON.parse(coldControlsRaw!); const cold = JSON.parse(coldRaw!) as Prior;
  const recoveryControls = JSON.parse(recoveryControlsRaw!); const recovery = JSON.parse(recoveryRaw!) as Prior;
  const recoveryAfter = JSON.parse(afterRaw!) as ConservativeLedger;
  const probe = JSON.parse(probeRaw!) as { status?: string };
  if (!['completed', 'stopped', 'failed'].includes(probe.status ?? '')) fail('terminal-review-probe-required');
  assertOutlineV2History(declaration, fixture, coldControls, cold, recoveryControls, recovery);
  const retained: FilePin[] = [{ path: path.resolve(declarationFile), sha256: digest }, declaration.fixture, declaration.reviewProbe,
    ...declaration.priorLedgers, declaration.history.cold.controls, declaration.history.cold.results,
    declaration.history.recovery.controls, declaration.history.recovery.results, declaration.history.recovery.ledgerAfter];
  for (const result of [cold, recovery]) {
    for (const code of result.code) { await readPinned({ path: code.snapshot, sha256: code.sha256 }); retained.push({ path: code.snapshot, sha256: code.sha256 }); }
    for (const capture of result.captures) { const raw = await readFile(capture.file, 'utf8'); if (hashControl(JSON.parse(raw)) !== hashControl(capture.transcript)) fail('historical-capture-changed'); retained.push({ path: capture.file, sha256: sha256(raw) }); }
  }
  for (const source of fixture.sources) { const bytes = await readFile(source.publicPdf); if (sha256(bytes) !== source.pdfSha256) fail('original-pdf-changed'); retained.push({ path: source.publicPdf, sha256: source.pdfSha256 }); }
  const assertCode = async () => {
    if (hashControl(await outlineV2CodeFiles()) !== hashControl(declaration.code.map(pin => pin.file).sort())) fail('controlled-code-set-changed');
    for (const pin of declaration.code) if (sha256(await readFile(pin.file)) !== pin.sha256) fail(`current-code-changed:${pin.file}`);
  };
  const prior = await Promise.all(declaration.priorLedgers.map(async pin => JSON.parse(await readPinned(pin)) as ConservativeLedger));
  const readLedger = async (allowMissing = false) => {
    let current: OutlineV2AcceptanceLedger;
    try { current = JSON.parse(await readFile(declaration.ledger, 'utf8')); }
    catch (error) { if (!allowMissing || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; current = emptyOutlineV2AcceptanceLedger(declaration, digest); }
    assertOutlineV2Ledgers(declaration, prior, current, digest, recoveryAfter); return current;
  };
  await assertCode(); const before = await readLedger(!live);
  if (before.reservedSends || before.conservativeTokens) fail('one-new-run-fresh-declared-ledger-required');
  const controls = { version: 1, mode: 'prospectively-declared-source-cache-assisted-v2-acceptance', createdAt: new Date().toISOString(),
    declaration: { file: path.resolve(declarationFile), sha256: digest }, fixture: declaration.fixture, courseId: fixture.courseId, actor: fixture.actor, database: fixture.database,
    sourceFingerprint: declaration.sourceFingerprint, options: outlineOptionsForFixture(fixture), model: declaration.model, stageCaps: { extraction: 12000, synthesis: 24000, review: 6000 },
    coldCacheRequired: false, cacheWarmthBeforeLive: 'unverified', nativeBudgetPolicy: 'Unchanged normal per-run2m/200k/24k limits; this distinct shared phase also caps100sends/2m. No counter reset or successful-usage settlement.',
    retained, priorAttemptSummary: [cold, recovery].map(result => ({ runId: result.runId, status: result.status, error: result.error, elapsedMs: result.elapsedMs, budget: result.budget })),
    mutationScope: 'One new owned diagnostic contentRun and normal validated production cache reuse/writes. No source mutation, Topic/LO Apply, questions, student records, Canvas or Admin configuration.',
    limitations: ['Preflight is file-only. Source-cache reuse and five pack reuses must be observed in the new production run, never assumed from historical counts. A request to extract fresh sources or organize new packs stops before dispatch.',
      'A new organization and all source-derived v2 final reviews run normally. Historical failed output and v1 verdicts are not substituted or reclassified.',
      'Cold and recovery failures retain their original costs/time. This is a distinct prospective attempt, not completed cold latency or an unlimited retry.',
      'Semantic coverage and teacher acceptance remain unmeasured; IDs and model judgments alone do not establish either. Hidden SDK retries and embedding costs remain separate.'] };
  await mkdir(output, { recursive: false }); await writeFile(path.join(output, 'controls.json'), JSON.stringify(controls, null, 2) + '\n', { flag: 'wx' });
  await writeFile(path.join(output, 'ledger-before.json'), JSON.stringify(before, null, 2) + '\n', { flag: 'wx' });
  const code = await Promise.all(declaration.code.map(async pin => { const snapshot = path.join(output, 'code', pin.file); await mkdir(path.dirname(snapshot), { recursive: true });
    const bytes = await readFile(pin.file); if (sha256(bytes) !== pin.sha256) fail(`current-code-changed:${pin.file}`);
    await writeFile(snapshot, bytes, { flag: 'wx' }); return { ...pin, snapshot }; }));
  if (!live) { console.log(JSON.stringify({ preflight: true, output, providerCalls: 0, databaseCalls: 0, files: fixture.sources.length, sections: corpus.sections.length, cacheWarmth: 'unverified' })); return; }
  const [{ env }, mongo, { ObjectId }, collections, structure, runs, commits, authoring, { completeJson }] = await Promise.all([
    import('../../server/src/config/env'), import('../../server/src/components/mongodb'), import('mongodb'), import('../../server/src/components/mongodb/collections'),
    import('../../server/src/services/structure-generation.service'), import('../../server/src/services/content-runs.service'), import('../../server/src/services/authoring-commit.service'),
    import('../../server/src/services/authoring-budget.service'), import('../../server/src/components/genai/llm'),
  ]);
  const address = new URL(env.mongodbUri);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(address.hostname) || address.port !== '27029' || env.mongodbDbName !== DATABASE) fail('owned-local-27029-database-required');
  const nativeLimits = authoring.defaultAuthoringLimits({ maxInputTokens: env.authoringStructureMaxInputTokens });
  if (nativeLimits.maxEstimatedTokens !== 2_000_000 || nativeLimits.maxInputTokens !== 200000 || nativeLimits.maxOutputTokens !== 24000 || nativeLimits.maxSends !== 256) fail('native-limits-changed');
  const assertCurrent = async () => {
    for (const pin of retained) if (sha256(await readFile(pin.path)) !== pin.sha256) fail(`retained-control-changed:${pin.path}`);
    for (const pin of code) if (sha256(await readFile(pin.snapshot)) !== pin.sha256) fail(`current-code-snapshot-changed:${pin.file}`);
    await assertCode(); assertAppendOnlyLedger(before, await readLedger());
  };
  const budget = new authoring.AuthoringBudget(`${OUTLINE_V2_SCOPE}:outline`, { maxSends: 100, maxInputTokens: 200000, maxOutputTokens: 24000, maxEstimatedTokens: 2_000_000 });
  const recorder = createCapturedCompletion({ directory: path.join(output, 'transcripts'), ledgerPath: declaration.ledger, scope: declaration.scope,
    limits: declaration.limits, cellId: 'outline-v2-acceptance', complete: serializeAdmission(completeJson), maxInputTokens: 200000, maxOutputTokens: 24000, assertCurrent });
  let status = 'preparing-live'; let result: StructureResult | null = null; let error: ReturnType<typeof safeError> | null = null;
  let diagnosticRun: unknown = null; let liveCorpus: unknown = null; let cacheBefore: unknown = null; let runId: InstanceType<typeof ObjectId> | undefined;
  const events: Parameters<StructureGenerationObserver['record']>[0][] = []; const started = Date.now();
  const save = async () => { const file = path.join(output, 'results.json'); const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify({ version: 1, status, elapsedMs: Date.now() - started, controlsSha256: hashControl(controls), code, runId: runId?.toHexString() ?? null,
      diagnosticRun, liveCorpus, cacheBefore, result, error, events, captures: recorder.captures, budget: budget.snapshot(),
      usage: summarizeHarnessUsage(recorder.captures.filter(row => row.transcript).flatMap(row => row.transcript.attempts.flatMap(attempt => attempt.events)), { coverageComplete: true }),
      priorAttemptSummary: controls.priorAttemptSummary, saved: 0, adopted: 0, teacherAcceptance: null, semanticCoverage: null, limitations: controls.limitations }, null, 2) + '\n', { flag: 'wx' }); await rename(temporary, file); };
  await save();
  try {
    const db = await mongo.connectMongo(); const courseId = new ObjectId(COURSE); const course = await collections.coursesCol().findOne({ _id: courseId });
    if (course?.ownerPuid !== ACTOR || course.authoringDeletionStartedAt || course.lifecycle === 'archived' || course.archivedAt || !(await commits.initializeAuthoringCommitSupport()).available) fail('owned-active-replica-course-required');
    await assertCurrent();
    for (const expected of [cold, recovery]) if (hashControl(JSON.parse(JSON.stringify(await runs.getContentRun(new ObjectId(expected.runId))))) !== hashControl(expected.diagnosticRun)) fail('durable-history-changed');
    if (await db.collection('contentRuns').countDocuments({ courseId, status: { $in: ['queued', 'running'] } })) fail('other-active-course-run');
    const loaded = await structure.loadStructureCorpus(courseId, controls.options.materialIds, controls.options.sourceBatchId);
    const normalize = (sections: typeof loaded.sections) => sections.map(({ materialId, materialName, chunkIndex, localId, text }) => ({ materialId, materialName, chunkIndex, localId, text })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    if (loaded.fingerprint !== FINGERPRINT || hashControl(normalize(loaded.sections)) !== hashControl(normalize(corpus.sections))) fail('live-original-source-drift');
    liveCorpus = loaded; cacheBefore = { sourceEvidenceExtractions: await db.collection('sourceEvidenceExtractions').countDocuments({ courseId }),
      priorRunPacks: recovery.diagnosticRun.structureSynthesisPacks!.map(pack => ({ key: pack.key, evidenceIds: pack.evidenceIds })) };
    await writeFile(path.join(output, 'live-corpus-before.json'), JSON.stringify(liveCorpus, null, 2) + '\n', { flag: 'wx' });
    const run = await runs.createStructureGenerationRun({ courseId, requestedBy: ACTOR, options: controls.options }); runId = run._id;
    diagnosticRun = await runs.updateContentRun(runId, { status: 'running', stage: 'analyzing' }); status = 'running-cache-assisted-v2'; await save();
    result = await authoring.withAuthoringBudget(budget, () => structure.generateStructure(courseId, controls.options, runId, {
      model: declaration.model, maxOutputTokens: 24000, complete: (prompt, options) => {
        assertOutlineV2PaidStage(options?.usageContext?.stage, options?.maxTokens); return recorder.complete(prompt, options);
      }, record: async event => { events.push(event); await save(); },
    }));
    await assertCurrent(); if ((await structure.loadStructureCorpus(courseId, controls.options.materialIds, controls.options.sourceBatchId)).fingerprint !== FINGERPRINT) fail('live-original-source-drift');
    if (result.coverage.cache.reusedSections !== 671 || result.coverage.cache.extractedSections !== 0 || result.coverage.synthesisInput?.reusedPacks !== 5 || result.coverage.synthesisInput.newPacks !== 0) fail('observed-validated-cache-reuse-required');
    if (!result.coverage.outlineGrounding?.complete || result.coverage.outlineGrounding.version !== 'original-final-lo-review-v2') fail('complete-new-v2-review-required');
    diagnosticRun = await runs.updateContentRun(runId, { status: 'completed', stage: 'checking', structureResult: result }); status = 'completed';
  } catch (caught) {
    status = 'stopped'; error = safeError(caught); process.exitCode = 1;
    if (runId) { const active = await runs.getContentRun(runId); if (active && (active.status === 'queued' || active.status === 'running')) await runs.failContentRun(runId,
      { code: 'quality-lab-outline-v2-acceptance-stopped', message: error.message, atStage: active.stage, retryable: false }); diagnosticRun = await runs.getContentRun(runId); }
  } finally {
    try { await assertCurrent(); await writeFile(path.join(output, 'ledger-after.json'), JSON.stringify(await readLedger(), null, 2) + '\n', { flag: 'wx' }); }
    catch (caught) { status = 'stopped'; error = safeError(caught); process.exitCode = 1; }
    try { await save(); } finally { await mongo.closeMongo(); }
  }
  console.log(JSON.stringify({ status, output: path.resolve(output), runId: runId?.toHexString(), observedSends: budget.snapshot().observedSends,
    files: result?.coverage.materials.length ?? null, cache: result?.coverage.cache ?? null, synthesis: result?.coverage.synthesisInput ?? null,
    reviewedObjectives: result?.coverage.outlineGrounding?.reviewedObjectives ?? null, saved: 0, adopted: 0, teacherAcceptance: null }));
}
if (require.main === module) void main().catch(error => { console.error(safeError(error).message); process.exitCode = 1; });
