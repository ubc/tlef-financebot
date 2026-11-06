/** File-only recovery design. This module cannot send a model request or write a ledger. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { readHeldoutPhase, aggregateHeldoutResults, type HeldoutShardReceipt } from './heldout-phase';
import { hashControl, sha256, type CapturedCompletion, type FrozenFixture, type ScheduledCell, type LabRequest } from './protocol';
import type { ConservativeLedger } from './ledger';
import { extractFrozenCorrectionContract } from './heldout-historical-review-adapter';

export type RecoveryInputCell = HeldoutShardReceipt['cells'][number] & {
  captures: Array<{ file: string; transcript: CapturedCompletion }>;
  deterministic: unknown; qualityBeforeRepair: unknown;
};
interface RecoveryRow {
  id: string; schedule: ScheduledCell; operation: 'generate-then-review' | 'review-retained'; originalCellHash: string;
  originalFailedRequest: LabRequest; originalCaptureFile: string; originalCaptureHash: string; failedCallIds: string[]; partialVisibleCharacters: number;
  inputControlsSha256: string; generatorPromptSha256: string;
  retained: null | { candidate: unknown; candidateHash: string; originalCandidateHash: string; deterministic: unknown; deterministicHash: string; previousUnavailableAssessment: unknown };
  initialRequestEstimate: number; nominalSendCount: number; maximumNativeSends: number; baseFirstSendConservativeUpper: number; maximumConservativeUpper: number;
  historicalTransport: string; observedNativeStream: true;
}
export const RECOVERY_CEILING = Object.freeze({ maxSends: 160, maxConservativeTokens: 2_000_000, maxInputTokens: 24000,
  generatorOutput: 8000, judgeOutput: 6000, maxSemanticRepairs: 0 });
const envelope = (prompt: string) => Buffer.byteLength(JSON.stringify([{ role: 'user', content: prompt }]), 'utf8') + 32;
const correction = '\n\nYour previous reply was not valid JSON. Respond with ONLY the JSON value — no prose, no explanation, no code fences.';
const FIXED_JUDGE = { model: 'gpt-6.1-sol', effort: 'medium', maxOutputTokens: 6000 };

/** A failed native call is unavailable evidence, not a negative semantic label.
 * Successful-but-invalid content, explicit refusals and judged negatives cannot enter recovery. */
export function classifyTransportGap(cell: RecoveryInputCell): 'generate-then-review' | 'review-retained' | null {
  const last = cell.captures.at(-1)?.transcript;
  if (!last || last.status !== 'failed') return null;
  const attempts = last.attempts;
  assert.equal(attempts.length, 1, 'Unrecognized historical failure path; inspect rather than retry.');
  const finished = attempts[0].events.filter(event => event.type === 'finished');
  assert.equal(finished.length, 1); assert.equal(finished[0].outcome, 'failed', 'A content or identity rejection is not a transport gap.');
  assert.equal(last.transport, 'toolkit-streamConversation-visible-content; JSON option is not strict native schema');
  assert.equal(finished[0].requestOptions.stream, true, 'Preserve the observed historical stream; pre-dispatch options alone are insufficient.');
  assert.equal(last.parsed, null); assert.equal(attempts[0].dispatch, 'finished');
  assert(last.error?.name === 'APIError' && ['Connection error.', 'Unknown error occurred while calling OpenAI API'].includes(last.error.message), 'Unrecognized failure reason.');
  if (cell.status === 'generation-failed') {
    assert.equal(cell.originalCandidate, null); assert.equal(cell.normalizedCandidate, null); assert.equal(last.stage, 'model-comparison-generator');
    return 'generate-then-review';
  }
  assert.equal(cell.status, 'reviewed'); assert.equal(last.stage, 'quality-review');
  assert(cell.originalCandidate !== null && cell.normalizedCandidate !== null && cell.deterministic !== null);
  assert(cell.captures.some(capture => capture.transcript.stage === 'model-comparison-generator' && capture.transcript.status === 'succeeded'));
  return 'review-retained';
}

export function planTransportRecovery(schedule: ScheduledCell[], fixture: FrozenFixture, cells: RecoveryInputCell[], ledger: ConservativeLedger) {
  assert.equal(schedule.length, 60); assert.equal(cells.length, 60); assert.equal(new Set(cells.map(c => c.schedule.id)).size, 60);
  const recovery: RecoveryRow[] = []; const preserve = []; let baseUpper = 0; let worstUpper = 0;
  for (const [index, expected] of schedule.entries()) {
    const cell = cells[index]; assert.equal(hashControl(cell.schedule), hashControl(expected), 'Do not reorder or replace scheduled cells.');
    const item = fixture.cases.find(row => row.id === expected.caseId); assert(item);
    assert.equal(cell.inputControlsSha256, item.controlsSha256); assert.equal(cell.generatorPromptSha256, item.generatorPromptSha256);
    const kind = classifyTransportGap(cell);
    if (!kind) { assert(['reviewed', 'invalid-candidate'].includes(cell.status), 'Unresolved execution is not a completed retained outcome.'); preserve.push({ id: expected.id, status: cell.status, normalizedHash: cell.normalizedCandidate === null ? null : hashControl(cell.normalizedCandidate),
      rawCandidateHash: cell.originalCandidate === null ? null : hashControl(cell.originalCandidate), originalCellHash: hashControl(cell) }); continue; }
    assert.equal(expected.repetition, 2, 'This terminal recovery cohort is repetition 2 only.');
    const transcript = cell.captures.at(-1)!.transcript; const attempt = transcript.attempts[0];
    const generator = kind === 'generate-then-review';
    assert.equal(transcript.request.model, generator ? expected.arm.model : FIXED_JUDGE.model);
    assert.equal(transcript.request.effort, generator ? expected.arm.effort : FIXED_JUDGE.effort);
    assert.equal(transcript.request.maxOutputTokens, generator ? 8000 : 6000);
    assert.equal(transcript.request.prompt, attempt.input.prompt); assert.equal(attempt.input.options.stream, undefined);
    assert.equal(attempt.input.outputCap, generator ? 8000 : 6000); assert.equal(attempt.input.options.reasoning_effort, generator ? expected.arm.effort : 'medium');
    if (generator) assert.equal(transcript.request.prompt, item.generatorPrompt);
    const input = envelope(transcript.request.prompt); assert(input <= 24000);
    const base = generator ? input + 8000 + 24000 + 6000 : input + 6000;
    const worst = generator ? input + 8000 + envelope(transcript.request.prompt + correction) + 8000 + 4 * (24000 + 6000) : 4 * (24000 + 6000);
    baseUpper += base; worstUpper += worst;
    recovery.push({ id: expected.id, schedule: expected, operation: kind, originalCellHash: hashControl(cell), originalFailedRequest: transcript.request,
      originalCaptureFile: cell.captures.at(-1)!.file, originalCaptureHash: hashControl(transcript), failedCallIds: attempt.events.filter(e => e.type === 'finished').map(e => e.callId),
      partialVisibleCharacters: attempt.rawVisibleText.length, inputControlsSha256: item.controlsSha256, generatorPromptSha256: item.generatorPromptSha256,
      retained: generator ? null : { candidate: cell.normalizedCandidate, candidateHash: hashControl(cell.normalizedCandidate), originalCandidateHash: hashControl(cell.originalCandidate),
        deterministic: cell.deterministic, deterministicHash: hashControl(cell.deterministic), previousUnavailableAssessment: cell.qualityBeforeRepair },
      initialRequestEstimate: input, nominalSendCount: generator ? 2 : 1, maximumNativeSends: generator ? 6 : 4,
      historicalTransport: transcript.transport, observedNativeStream: true,
      baseFirstSendConservativeUpper: base, maximumConservativeUpper: worst });
  }
  const byCase = fixture.cases.map(item => { const rows = recovery.filter(row => row.schedule.caseId === item.id); return { id: item.id,
    generate: rows.filter(row => row.operation === 'generate-then-review').length, reviewOnly: rows.filter(row => row.operation === 'review-retained').length,
    arms: rows.map(row => row.schedule.arm.id) }; });
  assert.equal(recovery.length, 30); assert.equal(recovery.filter(row => row.operation === 'generate-then-review').length, 20);
  assert.equal(recovery.filter(row => row.operation === 'review-retained').length, 10);
  assert(byCase.every(row => row.arms.length === 5 && new Set(row.arms).size === 5), 'No arm or case may be cherry-picked.');
  const ceiling = { ...RECOVERY_CEILING, maxSends: Math.min(160, ledger.limits.maxSends - ledger.reservedSends),
    maxConservativeTokens: Math.min(2_000_000, ledger.limits.maxConservativeTokens - ledger.conservativeTokens) };
  assert.equal(ceiling.maxSends, 160); assert(ceiling.maxConservativeTokens >= baseUpper, 'The recovery allowance cannot cover even the nominal first-send upper bound.');
  return { denominator: 60, recoveryCells: recovery, preservedCells: preserve, byCase,
    retainedSuccessfulGenerations: cells.filter(c => c.captures.some(cap => cap.transcript.stage === 'model-comparison-generator' && cap.transcript.status === 'succeeded')).length,
    normalizedCandidatesRetained: cells.filter(c => c.normalizedCandidate !== null).length,
    completedAssessmentsRetained: cells.filter(c => c.captures.some(cap => cap.transcript.stage === 'quality-review' && cap.transcript.status === 'succeeded')).length,
    baselineLedger: { sha256OfCanonicalReceipt: hashControl(ledger), observedReservations: ledger.reservedSends, conservativeUnits: ledger.conservativeTokens,
      remainingDeclaredSends: ledger.limits.maxSends - ledger.reservedSends, remainingDeclaredUnits: ledger.limits.maxConservativeTokens - ledger.conservativeTokens },
    ceiling, nominalStagesIfNewCandidatesAreValid: recovery.reduce((n, row) => n + row.nominalSendCount, 0),
    guaranteedInitialStages: recovery.length, maximumNativeSends: recovery.reduce((n, row) => n + row.maximumNativeSends, 0),
    baseFirstSendConservativeUpper: baseUpper, allPermittedCorrectionPathsConservativeUpper: worstUpper,
    allCorrectionPathsFitCeiling: worstUpper <= ceiling.maxConservativeTokens,
    completionPolicy: 'Pragmatic hard stop. Preserve every denominator and stop globally at the first new transport/identity/evidence failure. No automatic retry phase or new generator draw after a successful parsed generation.',
    executionOrder: 'Resume original missing stages: shard 4 reviews its retained ten candidates; shard 5 generates its ten missing candidates then judges valid ones; shard 6 does the same. Preserve the original rotated arm order inside each shard.',
    saved: 0, adopted: 0, teacherAcceptance: null };
}

function functionText(source: string, name: string): string | null {
  const ast = ts.createSourceFile('trusted-repository.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const rows = ast.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert(rows.length <= 1); return rows[0]?.getText(ast) ?? null;
}
export function auditFrozenJudge(historical: string, current: string) {
  const names = ['renderGenerationQualityReviewPrompt', 'authoringIntentInstruction', 'parseV2Review', 'comparisonIssues', 'snapshotQualityCandidate', 'citationIssues', 'verifiedCitation'];
  const unchanged = names.map(name => { const old = functionText(historical, name), now = functionText(current, name); assert(old && now); return { name, historicalSha256: sha256(old), currentSha256: sha256(now), identical: old === now }; });
  const old = functionText(historical, 'assessGenerationQuality'), now = functionText(current, 'assessGenerationQuality'); assert(old && now);
  const added = '\\n${reviewCorrectionInstructions(finalIssues)}';
  return { unchanged, historicalAssessorSha256: sha256(old), currentAssessorSha256: sha256(now), initialRendererIdentical: unchanged.every(row => row.identical),
    historicalAssessorIdentical: old === now, onlyChangeIsExplicitCorrectionGuidance: now.split(added).length === 2 && now.replace(added, '') === old,
    currentDirectRecoveryAllowed: old === now,
    correctionContract: extractFrozenCorrectionContract(historical, current),
    requiredPolicy: 'Recover under the frozen historical assessor behavior, including its exact same-candidate correction prompt and parsing/gating. The strict injected-completion adapter may remove only the exact computed extra guidance suffix after proving the complete archived/current template and assessor difference. Transport deadline may change only as an explicitly declared fault boundary with unchanged request bodies. Current judge correction guidance belongs to a separate cohort unless all valid candidates are reassessed uniformly.' };
}

export async function writeRecoveryPlan(directory: string, output: string): Promise<void> {
  const declarationFile = path.join(directory, 'declaration.json'); const declarationBytes = await readFile(declarationFile);
  const phase = await readHeldoutPhase(declarationFile, sha256(declarationBytes)); const receipts = [];
  const pins: Array<{ file: string; sha256: string }> = [];
  const pin = async (file: string) => { const bytes = await readFile(file); pins.push({ file: path.resolve(file), sha256: sha256(bytes) }); return bytes; };
  await pin(declarationFile); await pin(phase.declaration.fixture.path); await pin(phase.declaration.ledger);
  for (const shard of phase.plan.shards) {
    const file = path.join(directory, 'live', shard.id, 'results.json'); const receipt = JSON.parse((await pin(file)).toString()) as HeldoutShardReceipt;
    assert.equal(receipt.status, 'completed'); receipts.push(receipt);
  }
  const aggregate = aggregateHeldoutResults(phase.plan, phase.fixture, phase.digest, receipts, true, receipts[0].code);
  const cells = aggregate.cells as RecoveryInputCell[];
  for (const cell of cells) for (const capture of cell.captures) assert.equal(hashControl(JSON.parse((await pin(capture.file)).toString())), hashControl(capture.transcript), 'Embedded/file transcript mismatch.');
  const analyzerFile = path.join(directory, 'heldout-receipt-analysis-final-2026-10-16.json');
  const analyzer = JSON.parse((await pin(analyzerFile)).toString()) as { summary: { declaredCells: number; allObservedSdkCalls: { actualObservedSends: number; unknownUsageCalls: number; inputTokensKnownSum: number; outputTokensKnownSum: number } }; cells: Array<{ cellId: string; qualityState: string; executionCellStatus: string }> };
  assert.equal(analyzer.summary.declaredCells, 60);
  const plan = planTransportRecovery(phase.plan.schedule, phase.fixture, cells, phase.ledger);
  assert.deepEqual(plan.recoveryCells.map(row => row.id).sort(), analyzer.cells.filter(row => row.qualityState === 'transport-unavailable' || row.executionCellStatus === 'generation-failed').map(row => row.cellId).sort());
  const qualityFile = 'server/src/services/generation-quality.service.ts'; const frozenFile = path.join(directory, 'live/shard-1/code', qualityFile);
  const frozen = await pin(frozenFile); assert.equal(sha256(frozen), receipts[0].code?.find(row => row.file === qualityFile)?.sha256);
  const current = await pin(qualityFile); const protocol = auditFrozenJudge(frozen.toString(), current.toString());
  const functionAudit = [];
  for (const [file, names] of [
    ['server/src/services/generation.service.ts', ['sanitizeGenerated', 'verifyGeneratedNumerics', 'requestedNumericalVariationFailure', 'studentEvidenceIdLeak']],
    ['server/src/components/genai/llm/index.ts', ['completeJson']],
  ] as const) {
    const oldFile = path.join(directory, 'live/shard-1/code', file); const old = (await pin(oldFile)).toString(); const now = (await pin(file)).toString();
    assert.equal(sha256(old), receipts[0].code?.find(row => row.file === file)?.sha256);
    for (const name of names) { const a = functionText(old, name), b = functionText(now, name); assert(a && b); functionAudit.push({ file, name, identical: a === b, historicalSha256: sha256(a), currentSha256: sha256(b) }); }
  }
  const rawUsage = analyzer.summary.allObservedSdkCalls;
  await writeFile(output, JSON.stringify({ version: 1, createdAt: new Date().toISOString(), providerCalls: 0, databaseCalls: 0, runnableProviderPhase: false,
    status: 'offline-proposal-requires-historical-protocol-adapter', declarationSha256: phase.digest, fixtureSha256: phase.fixture.fixtureSha256,
    scheduleSha256: phase.plan.scheduleSha256, plan, protocol, functionAudit, originalUsage: rawUsage, identities: pins,
    ledgerPolicy: 'Keep the original 99-reservation ledger and every old receipt immutable. A future child ledger must pin this original hash, charge new calls separately, and enforce combined original+recovery limits. Failed/unknown old usage remains unknown and reserved.',
    limitations: ['This plan is not permission to dispatch. A new declared, exclusive, capped recovery runner and frozen semantic-protocol adapter need review and offline tests first.',
      'No successful generator cell, schema-invalid response or model-rejected candidate may be regenerated to improve a score. Recover only the exact 30 transport gaps.',
      'There are 60 fixed requested cells: 50 positive-supply and 10 chart safety-negative cells. Maximum 59 semantic judgments are possible if the 20 recovered generations all normalize; the original invalid candidate stays invalid.',
      'Recovery happens later and every missing cell is repetition 2. Preserve cohort/time labels; the same public model ID cannot guarantee identical deployment weights. Do not pool outage-tainted latency into a fair model-speed ranking.',
      'A completed safe chart fallback is not fulfillment of its numerical request. Requested-kind, difficulty, semantic eligibility, source safety and teacher acceptance remain separate.',
      'Recorded SDK calls are not hidden retry counts or a complete provider invoice. Prior 30 failed-call token totals remain unknown after recovery. Saved/adopted stay zero.'] }, null, 2) + '\n', { flag: 'wx' });
}
if (require.main === module) {
  const args = process.argv.slice(2); assert.equal(args.length, 2, 'Use: plan-heldout-transport-recovery.ts <terminal-phase-directory> <NEW-plan.json>');
  void writeRecoveryPlan(path.resolve(args[0]), path.resolve(args[1])).then(() => console.log(JSON.stringify({ output: path.resolve(args[1]), providerCalls: 0, databaseCalls: 0, runnable: false })))
    .catch(error => { console.error(error instanceof Error ? error.message : 'offline-planner-failed'); process.exitCode = 1; });
}
