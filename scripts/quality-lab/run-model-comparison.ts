import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CompleteJsonOptions } from '../../server/src/components/genai/llm';
import type { GeneratorOutput } from '../../server/src/services/generation.service';
import type { GenerationQualityAssessment } from '../../server/src/types/generation-quality';
import { captureJson } from './capture';
import { parseLabCandidate } from './candidate';
import { comparisonPreflight, generatorRequest } from './preflight';
import { reserveLedger, type LedgerLimits } from './ledger';
import { hashControl, sha256, safeError, validateFixture, type CapturedCompletion, type FrozenFixture, type LabArm, type LabRequest, type ScheduledCell } from './protocol';
import { summarizeHarnessUsage } from '../prompt-ab/usage-summary';
import { assertHeldoutCli, readHeldoutPhase } from './heldout-phase';

const argument = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const positive = (name: string, fallback: number) => { const raw = argument(name); const value = raw === undefined ? fallback : Number(raw); if (!Number.isSafeInteger(value) || value < 1) throw new Error(`quality-lab-invalid-option:${name}`); return value; };
export const MODEL_COMPARISON_CODE_FILES = ['scripts/quality-lab/protocol.ts', 'scripts/quality-lab/capture.ts', 'scripts/quality-lab/candidate.ts', 'scripts/quality-lab/preflight.ts', 'scripts/quality-lab/ledger.ts', 'scripts/quality-lab/run-model-comparison.ts',
  'scripts/quality-lab/heldout-phase.ts', 'scripts/quality-lab/run-heldout-comparison.ts',
  'scripts/quality-lab/phase-declaration.ts',
  'server/src/services/generation.service.ts', 'server/src/services/generation-quality.service.ts', 'server/src/services/generation-citation-spans.ts',
  'server/src/services/generation-memory.service.ts', 'server/src/services/generation-semantic-repair.ts', 'server/src/services/numeric-verification.service.ts',
  'server/src/services/numeric-input-display.service.ts', 'server/src/services/generation-model-budget.ts', 'server/src/components/genai/llm/index.ts', 'server/src/components/genai/llm/model-call.ts',
  'server/src/components/genai/llm/model-capabilities.ts', 'server/src/components/genai/llm/openai-usage-adapter.ts', 'server/src/components/genai/llm/authoring-budget.ts'];
interface CellResult {
  schedule: ScheduledCell; inputControlsSha256: string; generatorPromptSha256: string;
  status: 'pending' | 'generated' | 'generation-failed' | 'invalid-candidate' | 'reviewed' | 'budget-stopped' | 'identity-stopped';
  captures: Array<{ file: string; transcript: CapturedCompletion }>;
  originalCandidate: GeneratorOutput | null;
  normalizedCandidate: GeneratorOutput | null;
  deterministic: unknown;
  qualityBeforeRepair: GenerationQualityAssessment | null;
  eligibleBeforeRepair: boolean | null;
  repaired: unknown;
  error: ReturnType<typeof safeError> | null;
  teacherAcceptance: null; saved: false; adopted: false;
}
export async function runModelComparison(): Promise<void> {
  const fixturePath = argument('--fixture'); const output = argument('--output');
  if (!fixturePath || !output) throw new Error('Supply --fixture and a NEW --output directory. Default is zero-call preflight; --live once is required for paid work.');
  const live = argument('--live'); if (live !== undefined && live !== 'once') throw new Error('quality-lab-live-must-be-once');
  const phaseFile = argument('--heldout-phase'), phaseDigest = argument('--heldout-phase-sha256');
  if (phaseFile || phaseDigest || argument('--shard-index') !== undefined) assertHeldoutCli(process.argv, ['--fixture', '--output', '--live', '--repetitions', '--max-sends', '--max-estimated-tokens', '--ledger-input-limit',
    '--generator-output', '--judge-output', '--ledger', '--scope', '--repair-candidates', '--heldout-phase', '--heldout-phase-sha256', '--shard-index']);
  if (Boolean(phaseFile) !== Boolean(phaseDigest)) throw new Error('quality-lab-heldout-phase-and-digest-required');
  const phase = phaseFile && phaseDigest ? await readHeldoutPhase(phaseFile, phaseDigest, !live) : undefined;
  const repetitions = positive('--repetitions', phase ? 2 : 1);
  const limits: LedgerLimits = phase?.declaration.limits ?? { maxSends: positive('--max-sends', 100), maxConservativeTokens: positive('--max-estimated-tokens', 2_000_000), maxInputTokens: positive('--ledger-input-limit', 200000) };
  if (!phase && (limits.maxSends > 100 || limits.maxConservativeTokens > 2_000_000)) throw new Error('quality-lab-phase-cap-exceeded');
  const generatorCap = positive('--generator-output', 8000); const judgeCap = positive('--judge-output', 6000);
  if (generatorCap > 8000 || judgeCap > 6000) throw new Error('quality-lab-output-cap-exceeded');
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as FrozenFixture; validateFixture(fixture);
  const shardRaw = argument('--shard-index'); const shardIndex = shardRaw === undefined ? NaN : Number(shardRaw);
  if (!phase && shardRaw !== undefined) throw new Error('quality-lab-heldout-shard-requires-declaration');
  const shard = phase?.plan.shards[shardIndex];
  const ledgerPath = argument('--ledger') ?? phase?.declaration.ledger; const scope = argument('--scope') ?? phase?.declaration.scope;
  const maxRepairCandidates = Number(argument('--repair-candidates') ?? 0);
  if (!Number.isSafeInteger(maxRepairCandidates) || maxRepairCandidates < 0 || maxRepairCandidates > 2) throw new Error('quality-lab-repair-candidate-cap');
  if (phase && (!Number.isSafeInteger(shardIndex) || !shard || repetitions !== 2 || generatorCap !== 8000 || judgeCap !== 6000 || maxRepairCandidates !== 0 ||
      path.resolve(fixturePath) !== phase.declaration.fixture.path || fixture.fixtureSha256 !== phase.fixture.fixtureSha256 ||
      ledgerPath !== phase.declaration.ledger || scope !== phase.declaration.scope ||
      [['--max-sends', limits.maxSends], ['--max-estimated-tokens', limits.maxConservativeTokens], ['--ledger-input-limit', limits.maxInputTokens]].some(([name, value]) => argument(String(name)) !== undefined && Number(argument(String(name))) !== value))) throw new Error('quality-lab-heldout-execution-controls-drift');
  const fullPreflight = comparisonPreflight(fixture, repetitions, limits, generatorCap, judgeCap);
  const preflight = shard ? { ...fullPreflight, schedule: shard.cells, rows: fullPreflight.rows.filter(row => shard.cellIds.includes(row.id)), scheduleSha256: shard.scheduleSha256,
    plannedGeneratorCells: shard.cells.length, plannedOneJudgePerSuccessfulCandidate: shard.cells.length, requestedOutputSlots: shard.cells.length,
    heldoutPhase: { declarationSha256: phase!.digest, globalScheduleSha256: phase!.plan.scheduleSha256, requestedPhaseSlots: 60, shardIndex: shard.index,
      executionOrder: phase!.plan.executionOrder, pragmaticHardStop: phase!.plan.completionPolicy, nativeMaximumSends: shard.maximumObservedSends,
      nativeMaximumConservativeTokens: shard.maximumConservativeTokensWithinPerSendCaps } } : fullPreflight;
  await mkdir(output, { recursive: false });
  await writeFile(path.join(output, 'fixture.json'), JSON.stringify(fixture, null, 2) + '\n', { flag: 'wx' });
  await writeFile(path.join(output, 'preflight.json'), JSON.stringify({ ...preflight, providerCalls: 0 }, null, 2) + '\n', { flag: 'wx' });
  if (!live) { console.log(JSON.stringify({ preflight: true, providerCalls: 0, output, generatorCells: preflight.plannedGeneratorCells })); return; }
  if (!ledgerPath || !scope) throw new Error('Paid work requires one persistent --ledger and --scope shared with all phase work.');
  const code: Array<{ file: string; snapshot: string; sha256: string }> = [];
  for (const file of MODEL_COMPARISON_CODE_FILES) {
    const bytes = await readFile(file); const snapshot = path.join(output, 'code', file); await mkdir(path.dirname(snapshot), { recursive: true });
    await writeFile(snapshot, bytes, { flag: 'wx' }); code.push({ file, snapshot, sha256: sha256(bytes) });
  }
  const [{ completeJson }, { AuthoringBudget, withAuthoringBudget }, generation, quality, { env }] = await Promise.all([
    import('../../server/src/components/genai/llm'), import('../../server/src/services/authoring-budget.service'),
    import('../../server/src/services/generation.service'), import('../../server/src/services/generation-quality.service'), import('../../server/src/config/env'),
  ]);
  if (!['openai', 'ubc-llm-sandbox'].includes(env.llmProvider)) throw new Error('quality-lab-provider-not-openai-compatible');
  const parent = new AuthoringBudget(scope, { maxSends: shard?.maximumObservedSends ?? limits.maxSends,
    maxEstimatedTokens: shard?.maximumConservativeTokensWithinPerSendCaps ?? limits.maxConservativeTokens, maxInputTokens: 24000, maxOutputTokens: generatorCap });
  const repairBudget = new AuthoringBudget(`${scope}:repairs`, { maxSends: 8, maxEstimatedTokens: limits.maxConservativeTokens, maxInputTokens: 24000, maxOutputTokens: generatorCap });
  const cellBudgets = new Map(preflight.schedule.map(cell => [cell.id, new AuthoringBudget(cell.id, { maxSends: 12, maxInputTokens: 24000, maxEstimatedTokens: limits.maxConservativeTokens, maxOutputTokens: generatorCap })]));
  const cells: CellResult[] = preflight.schedule.map(schedule => { const item = fixture.cases.find(value => value.id === schedule.caseId)!;
    return { schedule, inputControlsSha256: item.controlsSha256, generatorPromptSha256: item.generatorPromptSha256, status: 'pending', captures: [],
      originalCandidate: null, normalizedCandidate: null, deterministic: null, qualityBeforeRepair: null, eligibleBeforeRepair: null, repaired: null, error: null, teacherAcceptance: null, saved: false, adopted: false }; });
  let status: 'running' | 'completed' | 'stopped' = 'running'; let terminalError: ReturnType<typeof safeError> | null = null;
  const started = Date.now();
  const atomic = async (file: string, value: unknown) => { const temporary = `${file}.${randomUUID()}.tmp`; await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); await rename(temporary, file); };
  const save = async () => atomic(path.join(output, 'results.json'), { version: 1, status, startedAt: new Date(started).toISOString(), elapsedMs: Date.now() - started,
    fixtureSha256: fixture.fixtureSha256, scheduleSha256: preflight.scheduleSha256, code, provider: env.llmProvider, settingsMutation: false,
    ...('heldoutPhase' in preflight ? { heldoutPhase: preflight.heldoutPhase } : {}),
    requestedSlots: cells.length, cells, budget: parent.snapshot(), repairBudget: repairBudget.snapshot(), cellBudgets: Object.fromEntries([...cellBudgets].map(([id, budget]) => [id, budget.snapshot()])),
    ledger: path.resolve(ledgerPath), scope, usage: summarizeHarnessUsage(cells.flatMap(cell => cell.captures.flatMap(capture => capture.transcript.attempts.flatMap(attempt => attempt.events))), { coverageComplete: true }),
    teacherAcceptance: null, savedQuestions: 0, adoptedQuestions: 0, terminalError, limitations: [...fixture.limitations,
      'Fixed gpt-6.1-sol/medium judgment is a model assessment, not an independent human verdict; Sol generator arms share a family with this judge.',
      'Observed SDK calls exclude hidden provider/SDK retries, embeddings and parsing. Conservative byte estimates are admission controls, not a currency invoice.',
      'Question planning and retrieval are frozen controls in this generator comparison. It does not measure full public batch saved yield.',
      'All comparison arms receive the same 8000-token generator cap; the fixed medium-effort judge receives 6000 tokens, matching production medium-effort checks. Low-effort production generation uses a smaller cap; this controlled comparison does not measure that separate cost policy.',
      'Initial candidate eligibility and any repaired candidate are reported separately. Missing, invalid, failed and budget-stopped slots remain in the requested denominator.',
    ] });
  const assertCodeCurrent = async () => {
    for (const identity of code) if (sha256(await readFile(identity.file)) !== identity.sha256) throw new Error(`quality-lab-code-changed:${identity.file}`);
    if (phase) await readHeldoutPhase(phase.file, phase.digest);
  };
  const assertNoFatalCapture = (cell: CellResult) => {
    const failure = cell.captures.find(capture => capture.transcript.error && /quality-lab-(?:code-changed|unverified-actual-model|observed-option|model-fallback|fixed-judge|evidence-write)|ledger-/.test(capture.transcript.error.message));
    if (failure) throw new Error(failure.transcript.error!.message);
  };
  const runCapture = async <T>(cell: CellResult, request: LabRequest, supplied: CompleteJsonOptions = {}): Promise<T> => {
    await assertCodeCurrent();
    const file = path.join(output, 'transcripts', `${cell.schedule.id}--${cell.captures.length + 1}.json`);
    await mkdir(path.dirname(file), { recursive: true });
    const entry = { file, transcript: null as unknown as CapturedCompletion }; cell.captures.push(entry);
    const transcript = await captureJson<T>(request, completeJson, async snapshot => { entry.transcript = snapshot; await atomic(file, snapshot); }, {
      systemPrompt: supplied.systemPrompt, usageContext: supplied.usageContext,
      beforeRequest: async admission => {
        if (!admission) throw new Error('quality-lab-admission-missing');
        await assertCodeCurrent();
        await reserveLedger(ledgerPath, limits, scope, cell.schedule.id, request, admission.jsonAttempt, admission.prompt, admission.systemPrompt);
        return supplied.beforeRequest?.(admission);
      },
    });
    entry.transcript = transcript; await save();
    if (transcript.status !== 'succeeded') throw new Error(transcript.error?.message ?? 'quality-lab-completion-failed');
    return transcript.parsed as T;
  };
  const capturedFixedCompletion = (cell: CellResult) => async <T>(prompt: string, options: CompleteJsonOptions = {}): Promise<T> => {
    const model = options.model; const effort = options.reasoningEffort;
    if (!model || !effort || !['low', 'medium', 'high'].includes(effort)) throw new Error('quality-lab-stage-model-effort-unspecified');
    const generator = model === cell.schedule.arm.model && effort === cell.schedule.arm.effort && options.usageContext?.stage?.includes('generation');
    if (!generator && (model !== 'gpt-6.1-sol' || effort !== 'medium')) throw new Error('quality-lab-fixed-judge-options-drift');
    return runCapture<T>(cell, { stage: options.usageContext?.stage ?? 'quality-review', prompt, model, effort: effort as LabArm['effort'],
      maxOutputTokens: generator ? generatorCap : judgeCap, ...(options.maxTokens ? { productionRequestedOutputCap: options.maxTokens } : {}),
      maxInputTokens: 24000, allowedActualModels: generator ? cell.schedule.arm.allowedActualModels : ['gpt-6.1-sol'], maxSends: 2 }, options);
  };
  await save();
  try {
    await withAuthoringBudget(parent, async () => {
      // Generate every arm before judgment/repair so repair cannot starve later arms.
      for (const cell of cells) {
        const item = fixture.cases.find(value => value.id === cell.schedule.caseId)!;
        try {
          const budget = cellBudgets.get(cell.schedule.id)!; budget.reserveLogical('generator-attempt');
          const raw = await withAuthoringBudget(budget, () => runCapture<unknown>(cell, generatorRequest(item, cell.schedule.arm, generatorCap)));
          const original = parseLabCandidate(raw, item.request.type); cell.originalCandidate = structuredClone(original);
          const normalized = generation.sanitizeGenerated(structuredClone(original));
          if (normalized.taskDescriptor) normalized.taskDescriptor.passageIds = quality.rebindGenerationTaskPassages(item.packet, normalized.taskDescriptor.passageIds);
          cell.normalizedCandidate = normalized;
          const numerics = generation.verifyGeneratedNumerics(normalized);
          const variation = generation.requestedNumericalVariationFailure(item.request.instructions, normalized);
          const leakage = generation.studentEvidenceIdLeak(normalized, item.packet.passages.map(passage => passage.id));
          cell.deterministic = { numerics, variation: variation ?? null, evidenceLeak: leakage ?? null,
            originalHash: hashControl(original), normalizedHash: hashControl(normalized), normalization: 'Production sanitizer and exact S-to-original task-ID binding; no semantic rewrite.' };
          cell.status = 'generated';
        } catch (error) { cell.status = cell.captures.at(-1)?.transcript.status === 'succeeded' ? 'invalid-candidate' : 'generation-failed'; cell.error = safeError(error);
          if (/quality-lab-(?:code-changed|unverified-actual-model|observed-option|model-fallback|fixed-judge|evidence-write)|ledger-/.test(cell.error.message)) throw error; }
        await save(); console.log(JSON.stringify({ cell: cell.schedule.id, stage: 'generation', status: cell.status, sends: parent.snapshot().observedSends }));
      }
      for (const cell of cells.filter(value => value.status === 'generated')) {
        const item = fixture.cases.find(value => value.id === cell.schedule.caseId)!;
        try {
          cell.qualityBeforeRepair = await withAuthoringBudget(cellBudgets.get(cell.schedule.id)!, () => quality.assessGenerationQuality({ packet: structuredClone(item.packet), memory: structuredClone(item.memory),
            candidate: { ...structuredClone(cell.normalizedCandidate!), type: item.request.type }, requirements: structuredClone(item.requirements), item: cell.schedule.order,
            policy: 'grounded-memory-v2', step: { model: 'gpt-6.1-sol', reasoningEffort: 'medium' }, complete: capturedFixedCompletion(cell) }));
          assertNoFatalCapture(cell);
          const deterministic = cell.deterministic as { numerics: { failure?: string }; variation: string | null; evidenceLeak: string | null };
          cell.eligibleBeforeRepair = cell.qualityBeforeRepair.status === 'eligible' && !deterministic.numerics.failure && !deterministic.variation && !deterministic.evidenceLeak;
          cell.status = 'reviewed';
        } catch (error) { cell.error = safeError(error); throw error; }
        await save(); console.log(JSON.stringify({ cell: cell.schedule.id, stage: 'quality', status: cell.qualityBeforeRepair.status, sends: parent.snapshot().observedSends }));
      }
      const repairable = cells.filter(cell => cell.status === 'reviewed' && cell.qualityBeforeRepair?.status === 'withheld').slice(0, maxRepairCandidates);
      for (const cell of repairable) {
        const item = fixture.cases.find(value => value.id === cell.schedule.caseId)!;
        const before = hashControl(cell.normalizedCandidate);
        const assessment = structuredClone(cell.qualityBeforeRepair!);
        cell.repaired = await withAuthoringBudget(repairBudget, () => withAuthoringBudget(cellBudgets.get(cell.schedule.id)!, () => generation.repairGenerationQualityCandidate({
          loName: item.request.loName, type: item.request.type, candidate: structuredClone(cell.normalizedCandidate!), assessment,
          requirements: structuredClone(item.requirements), packet: structuredClone(item.packet), memory: structuredClone(item.memory),
          models: { embedding: 'not-used-frozen-retrieval', generator: { model: cell.schedule.arm.model, reasoningEffort: cell.schedule.arm.effort },
            validator: { model: 'gpt-6.1-sol', reasoningEffort: 'medium' }, reviewer: { model: 'gpt-6.1-sol', reasoningEffort: 'medium' } },
          difficulty: item.request.difficulty, prompt: item.request.instructions, kind: item.request.kind, complete: capturedFixedCompletion(cell),
        })));
        assertNoFatalCapture(cell);
        if (hashControl(cell.normalizedCandidate) !== before) throw new Error('quality-lab-original-candidate-mutated');
        cell.repaired = { result: cell.repaired ?? null, assessmentWithRepairAudit: assessment, beforeCandidateSha256: before, teacherAcceptance: null, saved: false, adopted: false };
        await save();
      }
    });
    status = 'completed';
  } catch (error) { status = 'stopped'; terminalError = safeError(error); for (const cell of cells.filter(value => value.status === 'pending')) cell.status = 'budget-stopped'; }
  finally { await save(); }
  console.log(JSON.stringify({ status, output: path.resolve(output), observedSends: parent.snapshot().observedSends,
    requestedSlots: cells.length, generated: cells.filter(cell => cell.normalizedCandidate !== null).length,
    initiallyEligible: cells.filter(cell => cell.eligibleBeforeRepair === true).length, teacherAcceptance: null }));
  if (status === 'stopped') process.exitCode = 1;
}
if (require.main === module) void runModelComparison().catch(error => { console.error(safeError(error).message); process.exitCode = 1; });
