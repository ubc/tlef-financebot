import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { GeneratorOutput } from '../../server/src/services/generation.service';
import type { GenerationQualityAssessment } from '../../server/src/types/generation-quality';
import type { CompleteJsonOptions } from '../../server/src/components/genai/llm';
import { createCapturedCompletion } from './completion';
import { hashControl, safeError, sha256, validateFixture, type CapturedCompletion, type FrozenFixture, type JsonCompletion, type ScheduledCell } from './protocol';
import type { ConservativeLedger, LedgerLimits } from './ledger';
import { parseLabCandidate } from './candidate';
import { summarizeHarnessUsage } from '../prompt-ab/usage-summary';

export const RECORDED_REPAIR_IDENTITY = {
  cellId: 'capm-decimal-notation--luna-medium--r1',
  fixtureSha256: '18ae3941fbe6feffcec5d88cf107ae9800e63b256a1336395db8fa037c8db0e9',
  matrixSha256: 'd310de912b5641940a7ece162559b2c41086b152be30157109b8d397178f7504',
} as const;
export const RECORDED_REPAIR_LIMITS: LedgerLimits = { maxSends: 100, maxConservativeTokens: 2_000_000, maxInputTokens: 200000 };
export const RECORDED_REPAIR_STAGES = [
  { stage: 'generation-repair', output: 8000 }, { stage: 'validation-repair', output: 6000 },
  { stage: 'review-repair', output: 6000 }, { stage: 'quality-review', output: 6000 },
] as const;
export const RECORDED_REPAIR_WORST_CASE = RECORDED_REPAIR_STAGES.reduce((sum, stage) => sum + 24000 + stage.output, 0);

interface CodeIdentity { file: string; snapshot: string; sha256: string }
interface RecordedCell {
  schedule: ScheduledCell; inputControlsSha256: string; generatorPromptSha256: string; status: string;
  originalCandidate: GeneratorOutput | null; normalizedCandidate: GeneratorOutput | null;
  deterministic: { normalizedHash: string; numerics: { failure?: string } };
  qualityBeforeRepair: GenerationQualityAssessment | null; repaired: unknown;
  captures: Array<{ file: string; transcript: CapturedCompletion }>;
}
interface RecordedMatrix { status: string; fixtureSha256: string; scope: string; ledger: string; code: CodeIdentity[]; cells: RecordedCell[] }

/** Pure control selection. Expected identities are prospective, not recalculated
 * from a changed input and silently accepted as a new original experiment. */
export function selectRecordedRepairControl(matrixRaw: string, fixtureRaw: string,
  expected: { cellId: string; fixtureSha256: string; matrixSha256: string } = RECORDED_REPAIR_IDENTITY) {
  if (sha256(matrixRaw) !== expected.matrixSha256) throw new Error('quality-lab-recorded-matrix-hash-mismatch');
  const fixture = JSON.parse(fixtureRaw) as FrozenFixture; validateFixture(fixture);
  const matrix = JSON.parse(matrixRaw) as RecordedMatrix;
  if (matrix.status !== 'completed' || matrix.fixtureSha256 !== expected.fixtureSha256 || fixture.fixtureSha256 !== expected.fixtureSha256) throw new Error('quality-lab-recorded-matrix-not-exact-terminal-fixture');
  const cells = matrix.cells.filter(cell => cell.schedule.id === expected.cellId);
  if (cells.length !== 1) throw new Error('quality-lab-recorded-cell-missing-or-duplicate');
  const cell = cells[0]; const item = fixture.cases.find(value => value.id === cell.schedule.caseId);
  if (!item || cell.status !== 'reviewed' || !cell.originalCandidate || !cell.normalizedCandidate || !cell.qualityBeforeRepair ||
      cell.repaired !== null || cell.inputControlsSha256 !== item.controlsSha256 || cell.generatorPromptSha256 !== item.generatorPromptSha256) throw new Error('quality-lab-recorded-cell-controls-mismatch');
  const candidate = parseLabCandidate(cell.normalizedCandidate, item.request.type);
  if (hashControl(candidate) !== cell.deterministic.normalizedHash) throw new Error('quality-lab-recorded-candidate-hash-mismatch');
  const assessment = cell.qualityBeforeRepair;
  if (assessment.policy !== 'grounded-memory-v2' || assessment.status !== 'withheld' || assessment.semanticRepair ||
      assessment.evidencePacketId !== item.packet.id || assessment.memoryDigest !== item.memory.snapshotDigest ||
      !assessment.candidate || assessment.candidate.truncated || !cell.deterministic.numerics.failure) throw new Error('quality-lab-recorded-assessment-not-repairable');
  const known = new Map(item.packet.passages.map(passage => [passage.id, passage]));
  if (!assessment.findings?.some(finding => finding.kind === 'answer-semantics' && finding.target === 'parameters' && finding.status === 'defect' &&
      finding.correction.trim() && finding.passageIds.length && finding.passageIds.every(id => known.has(id)))) throw new Error('quality-lab-recorded-parameter-finding-missing');
  if (assessment.citations.some(citation => !known.get(citation.passageId)?.text.includes(citation.quote))) throw new Error('quality-lab-recorded-assessment-citation-mismatch');
  const generators = cell.captures.filter(capture => capture.transcript.stage === 'model-comparison-generator');
  const reviews = cell.captures.filter(capture => capture.transcript.stage === 'quality-review');
  if (generators.length !== 1 || reviews.length !== 1) throw new Error('quality-lab-recorded-original-captures-missing');
  for (const capture of [...generators, ...reviews]) {
    if (capture.transcript.status !== 'succeeded' || !capture.transcript.modelIdentityVerified || !capture.transcript.attempts.length ||
        capture.transcript.attempts.some(attempt => !attempt.rawVisibleText || attempt.dispatch !== 'finished')) throw new Error('quality-lab-recorded-original-capture-incomplete');
  }
  if (hashControl(generators[0].transcript.parsed) !== hashControl(cell.originalCandidate) ||
      generators[0].transcript.request.model !== cell.schedule.arm.model || generators[0].transcript.request.effort !== cell.schedule.arm.effort ||
      sha256(generators[0].transcript.attempts[0].input.prompt) !== item.generatorPromptSha256 ||
      reviews[0].transcript.request.model !== 'gpt-6.1-sol' || reviews[0].transcript.request.effort !== 'medium') throw new Error('quality-lab-recorded-original-provenance-mismatch');
  const rawReview = reviews[0].transcript.parsed as { findings?: Array<{ observation: string; correction: string; kind: string; target: string; status: string }> };
  if (assessment.findings.some(finding => !rawReview?.findings?.some(raw => raw.observation === finding.observation && raw.correction === finding.correction &&
      raw.kind === finding.kind && raw.target === finding.target && raw.status === finding.status))) throw new Error('quality-lab-recorded-assessment-not-observed');
  return { fixture, matrix, cell, item, candidate, assessment: structuredClone(assessment), identity: { ...expected, fixtureFileSha256: sha256(fixtureRaw),
    candidateSha256: hashControl(candidate), recordedAssessmentSha256: hashControl(assessment),
    generatorCaptureSha256: hashControl(generators[0].transcript), qualityCaptureSha256: hashControl(reviews[0].transcript) } };
}

/** A fresh four-stage allowance must fit before the first provider call. The
 * append-only shared ledger remains authoritative before every actual send. */
export function assertRecordedRepairRoom(ledger: ConservativeLedger, scope: string): void {
  if (ledger.version !== 1 || ledger.accounting !== 'conservative-reservations-v1' || ledger.scope !== scope || hashControl(ledger.limits) !== hashControl(RECORDED_REPAIR_LIMITS)) throw new Error('quality-lab-recorded-repair-ledger-scope-mismatch');
  if (!Number.isSafeInteger(ledger.reservedSends) || !Number.isSafeInteger(ledger.conservativeTokens) || ledger.reservedSends < 0 || ledger.conservativeTokens < 0 ||
      ledger.reservedSends !== ledger.reservations.length || ledger.reservations.some(row => !Number.isSafeInteger(row.inputEstimate) || row.inputEstimate < 0 || !Number.isSafeInteger(row.outputReservation) || row.outputReservation < 0) ||
      ledger.conservativeTokens !== ledger.reservations.reduce((sum, row) => sum + row.inputEstimate + row.outputReservation, 0)) throw new Error('quality-lab-recorded-repair-ledger-receipt-mismatch');
  if (ledger.reservedSends + RECORDED_REPAIR_STAGES.length > ledger.limits.maxSends ||
      ledger.conservativeTokens + RECORDED_REPAIR_WORST_CASE > ledger.limits.maxConservativeTokens) throw new Error('quality-lab-recorded-repair-insufficient-four-send-room');
}

/** Production repair deliberately converts some completion failures into a
 * withheld outcome. Harness admission failures must still terminate the run. */
export function createRecordedRepairStageGuard(complete: JsonCompletion, beforeFirst: () => Promise<void>) {
  let completeCalls = 0; let failure: Error | null = null;
  return {
    get completeCalls() { return completeCalls; },
    assertNoFailure() { if (failure) throw failure; },
    complete: async <T>(prompt: string, options: CompleteJsonOptions = {}): Promise<T> => {
      try {
        if (failure) throw failure;
        const expected = RECORDED_REPAIR_STAGES[completeCalls];
        if (!expected || options.usageContext?.stage !== expected.stage || options.model !== 'gpt-6.1-sol' || options.reasoningEffort !== 'medium' || options.maxTokens !== expected.output) throw new Error('quality-lab-recorded-repair-stage-cap-or-drift');
        if (!completeCalls) await beforeFirst();
        completeCalls++; return await complete<T>(prompt, options);
      } catch (caught) {
        failure ??= caught instanceof Error ? caught : new Error('quality-lab-recorded-repair-admission-failed');
        throw failure;
      }
    },
  };
}

/** Original temporary upload paths may have been cleaned. An explicit retained
 * directory supplies bytes only when their hash matches the frozen source. */
export async function resolveRecordedRepairSources(fixture: FrozenFixture, retainedDirectory?: string) {
  const retained = new Map<string, string>();
  if (retainedDirectory) for (const name of (await readdir(retainedDirectory)).filter(name => name.endsWith('.pdf')).sort()) {
    const file = path.resolve(retainedDirectory, name); retained.set(sha256(await readFile(file)), file);
  }
  const sources: Array<{ materialId: string; originalStoragePath: string | null; resolution: string; file: string; sha256: string }> = [];
  for (const source of fixture.sourceControls) {
    const original = typeof source.material.storagePath === 'string' ? source.material.storagePath : null;
    const file = retainedDirectory ? retained.get(source.pdfSha256) : original;
    if (!file || sha256(await readFile(file)) !== source.pdfSha256) throw new Error('quality-lab-recorded-original-pdf-mismatch');
    sources.push({ materialId: source.material._id, originalStoragePath: original, resolution: retainedDirectory ? 'hash-matched-retained-pdf' : 'recorded-upload', file: path.resolve(file), sha256: source.pdfSha256 });
  }
  return sources;
}

const CODE_FILES = ['scripts/quality-lab/run-recorded-repair.ts', 'scripts/quality-lab/completion.ts', 'scripts/quality-lab/capture.ts', 'scripts/quality-lab/protocol.ts', 'scripts/quality-lab/ledger.ts', 'scripts/quality-lab/candidate.ts',
  'server/src/services/generation.service.ts', 'server/src/services/generation-quality.service.ts', 'server/src/services/generation-semantic-repair.ts', 'server/src/services/generation-model-budget.ts',
  'server/src/services/generation-citation-spans.ts', 'server/src/services/generation-memory.service.ts', 'server/src/services/authoring-context.service.ts', 'server/src/services/authoring-task-plan.service.ts',
  'server/src/services/numeric-verification.service.ts', 'server/src/services/numeric-input-display.service.ts', 'server/src/services/numeric-gate.service.ts', 'server/src/services/parameter-display.ts', 'server/src/services/params.service.ts', 'server/src/services/option-order.service.ts',
  'server/src/types/generation-quality.ts', 'server/src/types/authoring-task.ts', 'server/src/types/domain.ts', 'package.json', 'package-lock.json'];
const argument = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };

async function main(): Promise<void> {
  const matrixPath = argument('--matrix'); const fixturePath = argument('--fixture'); const output = argument('--output');
  const ledgerPath = argument('--ledger'); const scope = argument('--scope'); const live = argument('--live');
  const retainedPdfDirectory = argument('--source-pdf-directory');
  if (!matrixPath || !fixturePath || !output || !ledgerPath || !scope) throw new Error('Supply --matrix, --fixture, NEW --output, and the SAME phase --ledger/--scope. Default is zero-call preflight; --live once requires root authorization.');
  if (live !== undefined && live !== 'once') throw new Error('quality-lab-live-must-be-once');
  const control = selectRecordedRepairControl(await readFile(matrixPath, 'utf8'), await readFile(fixturePath, 'utf8'));
  if (control.matrix.scope !== scope || path.resolve(control.matrix.ledger) !== path.resolve(ledgerPath)) throw new Error('quality-lab-recorded-repair-matrix-ledger-mismatch');
  const originalCaptures: Array<{ file: string; sha256: string }> = [];
  for (const capture of control.cell.captures) {
    const bytes = await readFile(capture.file, 'utf8');
    if (hashControl(JSON.parse(bytes)) !== hashControl(capture.transcript)) throw new Error('quality-lab-recorded-capture-file-mismatch');
    originalCaptures.push({ file: capture.file, sha256: sha256(bytes) });
  }
  for (const original of control.matrix.code) if (sha256(await readFile(original.snapshot)) !== original.sha256) throw new Error('quality-lab-recorded-code-snapshot-mismatch');
  const sourceFiles = await resolveRecordedRepairSources(control.fixture, retainedPdfDirectory);
  const ledgerBefore = JSON.parse(await readFile(ledgerPath, 'utf8')) as ConservativeLedger;
  let preflightStop: ReturnType<typeof safeError> | null = null;
  try { assertRecordedRepairRoom(ledgerBefore, scope); } catch (error) { preflightStop = safeError(error); }
  await mkdir(output, { recursive: false });
  const controls = { version: 1, original: { matrix: path.resolve(matrixPath), fixture: path.resolve(fixturePath), ...control.identity, originalCaptures, code: control.matrix.code },
    sourceFiles, case: control.item, originalCandidate: control.candidate, originalRecordedAssessment: control.assessment,
    originalDeterministic: control.cell.deterministic, repairModel: { model: 'gpt-6.1-sol', reasoningEffort: 'medium' },
    allowedStages: RECORDED_REPAIR_STAGES, maximumObservedSends: 4, maximumInputPerSend: 24000, worstCaseConservativeReservation: RECORDED_REPAIR_WORST_CASE,
    ledger: path.resolve(ledgerPath), scope, limits: RECORDED_REPAIR_LIMITS, ledgerBefore, preflightStop,
    purpose: 'One production corrective attempt from the unchanged actual matrix candidate and recorded assessment. No initial response or initial review is generated or fabricated.',
    limitations: ['The selected real failure is a tuning case, not an arm-balanced repair comparison or a guarantee of successful correction.',
      'Original generation/assessment used archived matrix code; this repair records current production code separately. It is not a same-code causal comparison.',
      'A repaired candidate must pass numerical, role, content and source/notation/novelty checks. Failure or uncertainty remains a real failed/withheld outcome.',
      'Only frozen source/Bank controls and physical original PDF hashes are rechecked. Live DB currentness, coordinated persistence, teacher acceptance, saved yield and adoption are not tested.',
      'Four sends include all observed invocations. JSON retries and second quality-response corrections have no additional allowance. Hidden provider/SDK retries remain unknown.'],
  };
  await writeFile(path.join(output, 'controls.json'), JSON.stringify(controls, null, 2) + '\n', { flag: 'wx' });
  if (!live || preflightStop) { console.log(JSON.stringify({ preflight: true, providerCalls: 0, output, preflightStop, worstCaseConservativeReservation: RECORDED_REPAIR_WORST_CASE })); if (live && preflightStop) process.exitCode = 1; return; }
  const code: CodeIdentity[] = [];
  const files = [...CODE_FILES, ...(await readdir('server/src/components/genai/llm')).filter(file => file.endsWith('.ts')).map(file => `server/src/components/genai/llm/${file}`),
    ...(await readdir('server/src/components/formula')).filter(file => file.endsWith('.ts')).map(file => `server/src/components/formula/${file}`)];
  for (const file of [...new Set(files)].sort()) {
    const bytes = await readFile(file); const snapshot = path.join(output, 'code', file); await mkdir(path.dirname(snapshot), { recursive: true });
    await writeFile(snapshot, bytes, { flag: 'wx' }); code.push({ file, snapshot, sha256: sha256(bytes) });
  }
  const assertCurrent = async () => {
    if (sha256(await readFile(matrixPath)) !== control.identity.matrixSha256 || sha256(await readFile(fixturePath)) !== control.identity.fixtureFileSha256) throw new Error('quality-lab-recorded-input-changed');
    for (const identity of [...code, ...originalCaptures, ...sourceFiles]) if (sha256(await readFile(identity.file)) !== identity.sha256) throw new Error('quality-lab-recorded-code-or-original-changed');
  };
  await assertCurrent();
  const [{ completeJson }, { AuthoringBudget, withAuthoringBudget }, generation, quality, { isServable }, { env }] = await Promise.all([
    import('../../server/src/components/genai/llm'), import('../../server/src/services/authoring-budget.service'), import('../../server/src/services/generation.service'),
    import('../../server/src/services/generation-quality.service'), import('../../server/src/services/numeric-gate.service'), import('../../server/src/config/env'),
  ]);
  if (!['openai', 'ubc-llm-sandbox'].includes(env.llmProvider)) throw new Error('quality-lab-provider-not-openai-compatible');
  if (quality.snapshotQualityCandidate({ ...control.candidate, type: control.item.request.type }).contentHash !== control.assessment.candidate?.contentHash) throw new Error('quality-lab-recorded-assessment-candidate-binding-mismatch');
  const budget = new AuthoringBudget(`${scope}:recorded-repair`, { maxSends: 4, maxInputTokens: 24000, maxOutputTokens: 8000, maxEstimatedTokens: RECORDED_REPAIR_WORST_CASE });
  budget.reserveLogical('generator-attempt'); // The actual retained generator attempt already exists.
  const assessment = structuredClone(control.assessment); const assessmentBeforeSha256 = hashControl(assessment);
  let status = 'running'; let error: ReturnType<typeof safeError> | null = null; let repaired: Awaited<ReturnType<typeof generation.repairGenerationQualityCandidate>> = undefined;
  let candidateEligible = false;
  const started = Date.now();
  const recorder = createCapturedCompletion({ directory: path.join(output, 'transcripts'), ledgerPath, scope, limits: RECORDED_REPAIR_LIMITS,
    cellId: control.cell.schedule.id, complete: completeJson, maxInputTokens: 24000, maxOutputTokens: 8000, maxSendsPerCompletion: 1, assertCurrent });
  const guard = createRecordedRepairStageGuard(recorder.complete, async () => assertRecordedRepairRoom(JSON.parse(await readFile(ledgerPath, 'utf8')) as ConservativeLedger, scope));
  const save = async () => {
    const file = path.join(output, 'results.json'); const temporary = `${file}.${randomUUID()}.tmp`;
    const numerics = repaired ? generation.verifyGeneratedNumerics(repaired.generated) : null;
    candidateEligible = Boolean(repaired && repaired.quality.status === 'eligible' && !numerics?.failure && isServable({ ...repaired.generated, ...numerics!.fields }));
    await writeFile(temporary, JSON.stringify({ version: 1, status, elapsedMs: Date.now() - started, controlsSha256: hashControl(controls), code,
      lineage: { originalMatrixSha256: control.identity.matrixSha256, originalRecordedAssessmentSha256: assessmentBeforeSha256,
        originalCode: control.matrix.code.map(original => ({ file: original.file, sha256: original.sha256 })),
        changedCode: code.filter(current => control.matrix.code.some(original => original.file === current.file && original.sha256 !== current.sha256)).map(current => current.file) },
      outcome: { originalRecordedAssessment: control.assessment, assessmentWithRepairAudit: assessment, repair: repaired ?? null,
        repairedCandidateSha256: repaired ? hashControl(repaired.generated) : null, freshNumericVerification: numerics,
        frozenControlCandidateEligible: candidateEligible,
        teacherAcceptance: null, saved: false, adopted: false, fullPipelineSaved: false },
      transcripts: recorder.captures, budget: budget.snapshot(), completeCalls: guard.completeCalls, usage: summarizeHarnessUsage(recorder.captures.filter(capture => capture.transcript).flatMap(capture => capture.transcript.attempts.flatMap(attempt => attempt.events)), { coverageComplete: true }),
      ledger: path.resolve(ledgerPath), scope, error, limitations: controls.limitations }, null, 2) + '\n', { flag: 'wx' }); await rename(temporary, file);
  };
  await save();
  try {
    repaired = await withAuthoringBudget(budget, () => generation.repairGenerationQualityCandidate({ loName: control.item.request.loName, type: control.item.request.type,
      candidate: structuredClone(control.candidate), assessment, requirements: structuredClone(control.item.requirements), packet: structuredClone(control.item.packet), memory: structuredClone(control.item.memory),
      prompt: control.item.request.instructions, kind: control.item.request.kind, difficulty: control.item.request.difficulty,
      models: { embedding: 'not-used-frozen-retrieval', generator: { model: 'gpt-6.1-sol', reasoningEffort: 'medium' },
        validator: { model: 'gpt-6.1-sol', reasoningEffort: 'medium' }, reviewer: { model: 'gpt-6.1-sol', reasoningEffort: 'medium' } }, complete: guard.complete }));
    guard.assertNoFailure();
    await assertCurrent();
    if (hashControl(control.assessment) !== assessmentBeforeSha256 || hashControl(control.candidate) !== control.identity.candidateSha256) throw new Error('quality-lab-recorded-original-mutated');
    const failed = recorder.captures.find(capture => capture.transcript.status !== 'succeeded');
    if (failed) throw new Error(failed.transcript.error?.message ?? 'quality-lab-recorded-completion-failed');
    status = 'completed';
  } catch (caught) { status = 'stopped'; error = safeError(caught); process.exitCode = 1; }
  finally { await save(); }
  console.log(JSON.stringify({ status, output: path.resolve(output), observedSends: budget.snapshot().observedSends,
    repairOutcome: assessment.semanticRepair?.outcome ?? null, candidateEligible, saved: 0, adopted: 0 }));
}
if (require.main === module) void main().catch(error => { console.error(safeError(error).message); process.exitCode = 1; });
