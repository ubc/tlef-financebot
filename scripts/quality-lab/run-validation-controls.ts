import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { GeneratorOutput } from '../../server/src/services/generation.service';
import type { GenerationEvidencePacket } from '../../server/src/types/generation-evidence';
import type { GenerationMemorySnapshot } from '../../server/src/services/generation-memory.service';
import type { AuthoringRequirements, GenerationQualityAssessment } from '../../server/src/types/generation-quality';
import type { FrozenFixture } from './protocol';
import { hashControl, safeError, sha256 } from './protocol';
import { parseLabCandidate } from './candidate';
import { createCapturedCompletion } from './completion';
import { summarizeHarnessUsage } from '../prompt-ab/usage-summary';

interface RetainedProbe {
  name: string; candidate: GeneratorOutput & { type: 'mcq' | 'true-false' }; packet: GenerationEvidencePacket;
  memory: GenerationMemorySnapshot; requirements: AuthoringRequirements; item: number; negativeControl: boolean;
  originalObservation: { runId: string; item: number }; comparatorProvenance?: unknown;
}
interface RetainedProbeFile { controls: { sourceControls: FrozenFixture['sourceControls']; bankHeads: unknown[]; bankVersions: unknown[]; probes: RetainedProbe[] }; outcomes: unknown[] }
const DEFAULT_NAMES = ['investor-firm-row-negative', 'capm-fraction-variant-negative'];
const CODE_FILES = ['scripts/quality-lab/run-validation-controls.ts', 'scripts/quality-lab/completion.ts', 'scripts/quality-lab/capture.ts', 'scripts/quality-lab/protocol.ts', 'scripts/quality-lab/ledger.ts',
  'server/src/services/generation.service.ts', 'server/src/services/generation-quality.service.ts', 'server/src/services/generation-semantic-repair.ts', 'server/src/services/generation-model-budget.ts',
  'server/src/services/generation-citation-spans.ts', 'server/src/services/generation-memory.service.ts', 'server/src/services/numeric-verification.service.ts',
  'server/src/services/numeric-input-display.service.ts', 'server/src/components/genai/llm/index.ts', 'server/src/components/genai/llm/model-call.ts', 'server/src/components/genai/llm/model-capabilities.ts',
  'server/src/components/genai/llm/openai-usage-adapter.ts', 'server/src/components/genai/llm/authoring-budget.ts'];
const argument = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };

export function selectRetainedValidationControls(raw: string, names: readonly string[] = DEFAULT_NAMES) {
  const input = JSON.parse(raw) as RetainedProbeFile;
  if (!names.length || names.length > 4 || new Set(names).size !== names.length) throw new Error('quality-lab-invalid-validation-control-selection');
  const probes = names.map(name => {
    const probe = input.controls.probes.find(value => value.name === name); if (!probe) throw new Error('quality-lab-retained-control-missing');
    const original = probe.candidate;
    const candidate = parseLabCandidate({ stem: original.stem, difficulty: original.difficulty, numericKind: original.numericKind,
      paramSlots: original.paramSlots, derivedValues: original.derivedValues, options: original.options, taskDescriptor: original.taskDescriptor,
      ...(original.hardnessMove ? { hardnessMove: original.hardnessMove } : {}) }, original.type);
    for (const passage of probe.packet.passages) {
      const source = input.controls.sourceControls.find(value => value.material._id === passage.materialId);
      const chunk = source?.chunks.find(value => value.index === passage.chunkIndex);
      if (!chunk || chunk.text.slice(passage.start, passage.end) !== passage.text) throw new Error('quality-lab-retained-control-source-coordinate-mismatch');
    }
    return { ...structuredClone(probe), candidate: { ...candidate, type: original.type }, originalSemanticSha256: hashControl(candidate),
      loName: probe.name.startsWith('capm-') ? 'Calculate the cost of equity using CAPM, preserving the source notation and units.' : 'Distinguish firm-specific and market risk and explain diversification.',
      controlSha256: hashControl({ candidate, packet: probe.packet, memory: probe.memory, requirements: probe.requirements }),
      teacherAcceptance: null, saved: false, adopted: false };
  });
  return { version: 1, sourceFileSha256: sha256(raw), sourceControls: input.controls.sourceControls, bankHeads: input.controls.bankHeads, bankVersions: input.controls.bankVersions, probes,
    purpose: 'Review the exact retained known negative candidates, then attempt one production evidence-bound repair. No new initial question generation or adoption.',
    limitations: ['Historical October 14 outcomes used a different model/cap/protocol and are context only, not a paired validation-layer causal comparison.',
      'Known negative-control selection is an engineering label. Teacher acceptance remains null; post-repair quality requires independent original-source checking.',
      'The fractional CAPM comparator is an explicit retained same-batch candidate, not a persisted Bank write. Its original comparator provenance is preserved.',
      'The source/Bank/request/candidate controls stay frozen. A repaired candidate is separately hashed and cannot replace the original record.'] };
}
async function main(): Promise<void> {
  const sourcePath = argument('--probes'); const output = argument('--output');
  if (!sourcePath || !output) throw new Error('Supply --probes <retained-probes.json> and a NEW --output directory. --live once is explicit paid execution.');
  const names = argument('--names')?.split(','); const controls = selectRetainedValidationControls(await readFile(sourcePath, 'utf8'), names);
  const live = argument('--live'); if (live !== undefined && live !== 'once') throw new Error('quality-lab-live-must-be-once');
  await mkdir(output, { recursive: false }); await writeFile(path.join(output, 'controls.json'), JSON.stringify(controls, null, 2) + '\n', { flag: 'wx' });
  if (!live) { console.log(JSON.stringify({ preflight: true, controls: controls.probes.map(probe => probe.name), providerCalls: 0, output })); return; }
  const ledgerPath = argument('--ledger'); const scope = argument('--scope');
  if (!ledgerPath || !scope) throw new Error('Paid controls require the SAME --ledger and --scope as all other phase work.');
  const code: Array<{ file: string; snapshot: string; sha256: string }> = [];
  for (const file of CODE_FILES) { const bytes = await readFile(file); const snapshot = path.join(output, 'code', file); await mkdir(path.dirname(snapshot), { recursive: true });
    await writeFile(snapshot, bytes, { flag: 'wx' }); code.push({ file, snapshot, sha256: sha256(bytes) }); }
  const pairedMatrix = argument('--paired-matrix');
  if (pairedMatrix) {
    const matrix = JSON.parse(await readFile(pairedMatrix, 'utf8')) as { code: Array<{ file: string; sha256: string }>; scope: string; ledger: string };
    if (matrix.scope !== scope || path.resolve(matrix.ledger) !== path.resolve(ledgerPath)) throw new Error('quality-lab-paired-matrix-ledger-mismatch');
    for (const identity of matrix.code) { const now = code.find(value => value.file === identity.file); if (now && now.sha256 !== identity.sha256) throw new Error(`quality-lab-paired-matrix-code-mismatch:${identity.file}`); }
  }
  const [{ completeJson }, { AuthoringBudget, withAuthoringBudget }, generation, quality] = await Promise.all([
    import('../../server/src/components/genai/llm'), import('../../server/src/services/authoring-budget.service'),
    import('../../server/src/services/generation.service'), import('../../server/src/services/generation-quality.service'),
  ]);
  const limits = { maxSends: 100, maxConservativeTokens: 2_000_000, maxInputTokens: 200000 };
  const parent = new AuthoringBudget(scope, { maxSends: 100, maxInputTokens: 24000, maxOutputTokens: 8000, maxEstimatedTokens: 2_000_000 });
  const repairBudget = new AuthoringBudget(`${scope}:validation-controls-repairs`, { maxSends: 8, maxInputTokens: 24000, maxOutputTokens: 8000, maxEstimatedTokens: 2_000_000 });
  const outcomes: Array<Record<string, unknown>> = [];
  const recorders: Array<ReturnType<typeof createCapturedCompletion>> = [];
  const allTranscripts = () => recorders.flatMap(recorder => recorder.captures);
  const assertCurrent = async () => { for (const identity of code) if (sha256(await readFile(identity.file)) !== identity.sha256) throw new Error(`quality-lab-code-changed:${identity.file}`); };
  let status = 'running'; let error: ReturnType<typeof safeError> | null = null; const started = Date.now();
  const save = async () => { const file = path.join(output, 'results.json'); const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify({ version: 1, status, elapsedMs: Date.now() - started, sourcePath: path.resolve(sourcePath), controlsSha256: hashControl(controls),
      ledger: path.resolve(ledgerPath), scope, code, outcomes, transcripts: allTranscripts().map(item => ({ file: item.file, transcript: item.transcript })),
      budget: parent.snapshot(), repairBudget: repairBudget.snapshot(), usage: summarizeHarnessUsage(allTranscripts().filter(item => item.transcript).flatMap(item => item.transcript.attempts.flatMap(attempt => attempt.events)), { coverageComplete: true }),
      teacherAcceptance: null, savedQuestions: 0, adoptedQuestions: 0, error, limitations: controls.limitations }, null, 2) + '\n', { flag: 'wx' }); await rename(temporary, file); };
  await save();
  try {
    await withAuthoringBudget(parent, async () => {
      for (const probe of controls.probes) {
        const leaf = new AuthoringBudget(`${scope}:${probe.name}`, { maxSends: 12, maxInputTokens: 24000, maxOutputTokens: 8000, maxEstimatedTokens: 2_000_000 });
        leaf.reserveLogical('generator-attempt'); // The original candidate already exists; permit only one additional content generation.
        const recorder = createCapturedCompletion({ directory: path.join(output, 'transcripts'), ledgerPath, scope, limits, cellId: probe.name,
          complete: completeJson, maxInputTokens: 24000, maxOutputTokens: 8000, assertCurrent });
        recorders.push(recorder);
        const row: Record<string, unknown> = { name: probe.name, negativeControl: probe.negativeControl, originalCandidate: structuredClone(probe.candidate),
          originalSemanticSha256: probe.originalSemanticSha256, teacherAcceptance: null, saved: false, adopted: false, qualityBeforeRepair: null, repair: null };
        outcomes.push(row);
        const candidate = generation.sanitizeGenerated(structuredClone(probe.candidate));
        if (candidate.taskDescriptor) candidate.taskDescriptor.passageIds = quality.rebindGenerationTaskPassages(probe.packet, candidate.taskDescriptor.passageIds);
        const assessment = await withAuthoringBudget(leaf, () => quality.assessGenerationQuality({ packet: structuredClone(probe.packet), memory: structuredClone(probe.memory),
          candidate: { ...candidate, type: probe.candidate.type }, requirements: structuredClone(probe.requirements), item: probe.item, policy: 'grounded-memory-v2',
          step: { model: 'gpt-6.1-sol', reasoningEffort: 'medium' }, complete: recorder.complete }));
        row.qualityBeforeRepair = structuredClone(assessment); await save();
        if (assessment.status === 'withheld') {
          const repairAssessment: GenerationQualityAssessment = structuredClone(assessment);
          const repaired = await withAuthoringBudget(repairBudget, () => withAuthoringBudget(leaf, () => generation.repairGenerationQualityCandidate({ loName: probe.loName,
            type: probe.candidate.type, candidate: structuredClone(candidate), assessment: repairAssessment, requirements: structuredClone(probe.requirements),
            packet: structuredClone(probe.packet), memory: structuredClone(probe.memory), difficulty: probe.requirements.requestedDifficulty,
            prompt: probe.requirements.requiredChanges.join('\n'), kind: probe.candidate.numericKind === 'numeric' ? 'calculation' : 'conceptual',
            models: { embedding: 'not-used-frozen-retrieval', generator: { model: 'gpt-6.1-sol', reasoningEffort: 'medium' },
              validator: { model: 'gpt-6.1-sol', reasoningEffort: 'medium' }, reviewer: { model: 'gpt-6.1-sol', reasoningEffort: 'medium' } }, complete: recorder.complete })));
          row.repair = { result: repaired ?? null, assessmentWithRepairAudit: repairAssessment,
            afterSemanticSha256: repaired ? hashControl(repaired.generated) : null };
        }
        if (hashControl(controls.probes.find(value => value.name === probe.name)!.candidate) !== hashControl(row.originalCandidate)) throw new Error('quality-lab-control-original-mutated');
        row.leafBudget = leaf.snapshot(); await save();
        console.log(JSON.stringify({ control: probe.name, status: assessment.status, repair: (row.repair as { result?: unknown } | null)?.result ? 'candidate-recorded' : 'none', sends: parent.snapshot().observedSends }));
        const fatal = allTranscripts().find(item => item.transcript.error && /quality-lab-(?:code-changed|unverified-actual-model|observed-option|model-fallback|evidence-write)|ledger-/.test(item.transcript.error.message));
        if (fatal) throw new Error(fatal.transcript.error!.message);
      }
    });
    status = 'completed';
  } catch (caught) { status = 'stopped'; error = safeError(caught); process.exitCode = 1; }
  finally { await save(); }
  console.log(JSON.stringify({ status, output: path.resolve(output), observedSends: parent.snapshot().observedSends, teacherAcceptance: null }));
}
if (require.main === module) void main().catch(error => { console.error(safeError(error).message); process.exitCode = 1; });
