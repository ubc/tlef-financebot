import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { GeneratorOutput } from '../../server/src/services/generation.service';
import type { GenerationQualityAssessment } from '../../server/src/types/generation-quality';
import type { FrozenFixture } from './protocol';
import { hashControl, safeError, sha256, validateFixture } from './protocol';
import { loadPrivateAdmissionGates, structuralAdmissionIssues } from './production-admission';

interface MatrixResult {
  status: string; fixtureSha256: string; code: Array<{ file: string; snapshot: string; sha256: string }>;
  cells: Array<{ schedule: { id: string; caseId: string; arm: { id: string; model: string; effort: string }; repetition: number }; status: string;
    originalCandidate: GeneratorOutput | null; normalizedCandidate: GeneratorOutput | null;
    eligibleBeforeRepair: boolean | null; qualityBeforeRepair: GenerationQualityAssessment | null;
    captures: Array<{ transcript: { stage: string; parsed: unknown; status: string } }> }>;
}
const argument = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
async function main(): Promise<void> {
  const matrixPath = argument('--matrix'); const fixturePath = argument('--fixture'); const output = argument('--output');
  if (!matrixPath || !fixturePath || !output) throw new Error('Supply --matrix <terminal-results.json> --fixture <frozen.json> --output <new-audit.json>. This command never sends a model request.');
  const matrix = JSON.parse(await readFile(matrixPath, 'utf8')) as MatrixResult; if (!['completed', 'stopped'].includes(matrix.status)) throw new Error('quality-lab-matrix-still-live');
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as FrozenFixture; validateFixture(fixture);
  if (matrix.fixtureSha256 !== fixture.fixtureSha256) throw new Error('quality-lab-audit-fixture-mismatch');
  for (const identity of matrix.code) {
    if (sha256(await readFile(identity.file)) !== identity.sha256 || sha256(await readFile(identity.snapshot)) !== identity.sha256) throw new Error(`quality-lab-audit-code-mismatch:${identity.file}`);
  }
  const source = matrix.code.find(identity => identity.file === 'server/src/services/generation.service.ts'); if (!source) throw new Error('quality-lab-generation-source-snapshot-missing');
  const { gates, identities } = loadPrivateAdmissionGates(await readFile(source.snapshot, 'utf8'));
  const [generation, { isServable, isNumericQuestion }, { taskDescriptorSchema }, memory, quality, { AuthoringBudget, withAuthoringBudget }] = await Promise.all([
    import('../../server/src/services/generation.service'), import('../../server/src/services/numeric-gate.service'),
    import('../../server/src/services/authoring-task-plan.service'), import('../../server/src/services/generation-memory.service'),
    import('../../server/src/services/generation-quality.service'), import('../../server/src/services/authoring-budget.service'),
  ]);
  const budget = new AuthoringBudget('quality-lab-offline-admission-audit', { maxSends: 0 });
  const rows = await withAuthoringBudget(budget, async () => matrix.cells.map(cell => {
    const item = fixture.cases.find(value => value.id === cell.schedule.caseId); if (!item) throw new Error('quality-lab-audit-case-missing');
    const raw = cell.captures.find(capture => capture.transcript.stage === 'model-comparison-generator')?.transcript.parsed;
    const recoverable = raw && typeof raw === 'object' && 'stem' in raw && typeof raw.stem === 'string' && 'options' in raw && gates.optionShapeValid(item.request.type, raw.options);
    const fallback = recoverable ? raw as GeneratorOutput : null;
    if (!cell.normalizedCandidate && !fallback) return { cellId: cell.schedule.id, arm: cell.schedule.arm.id, caseId: item.id, generated: false,
      knownProductionAdmissionIssues: ['no-structurally-readable-candidate'], allCheckedDeterministicGatesPass: false, modelAssessedEligibility: cell.eligibleBeforeRepair,
      teacherAcceptance: null, productionReady: null, fullPipelineSaved: false };
    const posthocRawRecovery = cell.normalizedCandidate === null;
    const candidate = generation.sanitizeGenerated(structuredClone(cell.normalizedCandidate ?? fallback!));
    const issues = structuralAdmissionIssues(gates, item.request, candidate);
    if (posthocRawRecovery && candidate.taskDescriptor) {
      try { candidate.taskDescriptor = { ...candidate.taskDescriptor, passageIds: quality.rebindGenerationTaskPassages(item.packet, candidate.taskDescriptor.passageIds) }; }
      catch { issues.push('task-descriptor-binding-invalid'); }
    }
    let numerics: ReturnType<typeof generation.verifyGeneratedNumerics>;
    try { numerics = generation.verifyGeneratedNumerics(candidate); }
    catch (error) { numerics = { fields: {}, failure: `Malformed numerical output: ${safeError(error).message}` }; }
    if (numerics.failure) issues.push(`numeric-verification:${numerics.failure}`);
    const leakage = generation.studentEvidenceIdLeak(candidate, item.packet.passages.map(passage => passage.id)); if (leakage) issues.push(`evidence-leak:${leakage}`);
    try { const variation = generation.requestedNumericalVariationFailure(item.request.instructions, candidate); if (variation) issues.push(`requested-variation:${variation}`); }
    catch { issues.push('requested-variation-check-threw'); }
    let servable = false;
    try { servable = isServable({ ...candidate, ...numerics.fields }); } catch { issues.push('isServable-check-threw'); }
    if (!servable) issues.push('isServable-failed');
    const descriptor = taskDescriptorSchema.safeParse(candidate.taskDescriptor);
    if (!descriptor.success) issues.push('bounded-task-descriptor-invalid');
    else {
      if (descriptor.data.intent !== item.requirements.intent) issues.push('task-descriptor-intent-mismatch');
      if (descriptor.data.passageIds.some(id => !item.packet.passages.some(passage => passage.id === id))) issues.push('task-descriptor-source-out-of-scope');
    }
    const matches = memory.checkGenerationMemory({ ...candidate, type: item.request.type }, item.memory);
    if (item.requirements.intent === 'create-independent-task' && matches.some(match => match.kind === 'exact-duplicate')) issues.push('exact-current-bank-duplicate');
    const achieved = cell.qualityBeforeRepair?.achievedDifficulty ?? null;
    const semanticAssessmentContradictions: string[] = [];
    if (cell.qualityBeforeRepair?.status === 'eligible' && cell.qualityBeforeRepair.missingPremises?.length) semanticAssessmentContradictions.push('eligible-assessment-lists-missing-necessary-premises');
    return { cellId: cell.schedule.id, arm: cell.schedule.arm.id, caseId: item.id, generated: true, candidateSha256: hashControl(candidate), posthocRawRecovery,
      originalLabStatus: cell.status,
      knownProductionAdmissionIssues: issues, allCheckedDeterministicGatesPass: issues.length === 0, servable, detectedNumeric: isNumericQuestion({ ...candidate, ...numerics.fields }),
      requestedDifficulty: item.request.difficulty, candidateDifficulty: candidate.difficulty ?? null, assessedAchievedDifficulty: achieved,
      difficultyMismatch: achieved ? achieved !== item.request.difficulty : null,
      taskDescriptorValid: descriptor.success, memoryMatches: matches, familyIntent: item.requirements.intent,
      semanticAssessmentContradictions, missingPremises: cell.qualityBeforeRepair?.missingPremises ?? null,
      modelAssessedEligibility: cell.eligibleBeforeRepair, combinedCheckedEligibility: issues.length === 0 && semanticAssessmentContradictions.length === 0 && cell.qualityBeforeRepair?.status === 'eligible',
      unavailableChecks: ['Independent option-role validator was not called in this generator comparison.', 'Generic content Reviewer was not called in this generator comparison.',
        'Current live source/Bank recheck, active task reservations, course fence/transaction, createQuestion invariants, immutable family/version persistence and teacher approval were not run.'],
      teacherAcceptance: null, productionReady: null, fullPipelineSaved: false };
  }));
  const summary = { requested: matrix.cells.length, generated: rows.filter(row => row.generated).length,
    allCheckedDeterministicGatesPass: rows.filter(row => row.allCheckedDeterministicGatesPass).length,
    modelAssessedEligible: rows.filter(row => row.modelAssessedEligibility === true).length,
    combinedCheckedEligible: rows.filter(row => 'combinedCheckedEligibility' in row && row.combinedCheckedEligibility).length,
    teacherAccepted: null, saved: 0 };
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), providerCalls: budget.snapshot().observedSends,
    matrix: path.resolve(matrixPath), fixtureSha256: fixture.fixtureSha256, productionSourceSha256: source.sha256, privateGateIdentities: identities, summary, rows,
    limitations: ['Offline reconciliation reuses exact frozen private generation gates and exported deterministic helpers. Passing these checks plus a model source judgment is not full production admission or a saved Draft.',
      'The lab parser requires exactly one misconception role and a bounded generator schema; production optionShapeValid permits at least one misconception. Parsed raw candidates omitted only by stricter lab rules are separately recovered post hoc and never receive invented semantic judgments.',
      'Option shuffling is not replayed: it does not change keyed role counts or numeric servability. No new model calls, source/Bank reads, writes, family/version creation or teacher approval occur.'] }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ output: path.resolve(output), providerCalls: 0, summary }));
}
if (require.main === module) void main().catch(error => { console.error(safeError(error).message); process.exitCode = 1; });
