jest.mock('../../server/src/config/env', () => { throw new Error('Recovery unit imported runtime environment.'); });
jest.mock('../../server/src/components/mongodb', () => { throw new Error('Recovery unit imported Mongo.'); });
jest.mock('../../server/src/components/mongodb/collections', () => { throw new Error('Recovery unit imported Mongo collections.'); });
jest.mock('../../server/src/components/genai/llm', () => { throw new Error('Recovery unit imported a provider.'); });
jest.mock('../../server/src/services/structure-generation.service', () => { throw new Error('Recovery unit imported the runtime structure service.'); });

import { assertAppendOnlyLedger, assertRecoveryCaptureLedger, assertRecoveryPrior, recoveryStopKind, RECOVERY_REQUIRED_PRIOR_CODE,
  type RecoveryControls, type RecoveryPrior } from '../../scripts/quality-lab/run-outline-recovery';
import { hashControl, sha256, type CapturedCompletion } from '../../scripts/quality-lab/protocol';
import type { ConservativeLedger } from '../../scripts/quality-lab/ledger';
import type { AuthoringBudgetReceipt } from '../../server/src/types/authoring-budget';

const STOP = 'authoring-budget-exhausted:total';
const date = '2026-10-16T00:00:00.000Z';
const id = (number: number) => number.toString(16).padStart(24, '0');
type Ledger = ConservativeLedger & { phaseDeclarationSha256: string };
type Attempt = CapturedCompletion['attempts'][number];
const inputEstimate = (attempt: Attempt) => Buffer.byteLength(JSON.stringify([{ role: 'user', content: attempt.input.prompt }]) + (attempt.input.systemPrompt ?? ''), 'utf8') + 32;

/** Synthetic offline admission receipts only. No real run/result/ledger is
 * read or changed, and no fixture is represented as provider evidence. */
function syntheticRecovery() {
  const controls: RecoveryControls = { version: 1, fixture: '/synthetic/corpus.json', fixtureSha256: sha256('synthetic fixture'), courseId: id(100),
    database: 'financebot_quality_smoke_retest_recovery_unit', actor: 'QUALITY-RETEST-FIXTURE-synthetic-recovery',
    model: 'gpt-6-luna', reasoningEffort: 'medium', maxOutputTokens: 24000, extractionOutputCap: 12000, synthesisOutputCap: 24000, sourceReviewOutputCap: 6000,
    options: { materialIds: Array.from({ length: 10 }, (_, index) => id(index + 1)), sourceBatchId: id(101), level: 'auto', emphasis: 'balanced' },
    sourceReceipt: { ready: true, included: [], excluded: [] }, structureSourceSha256: sha256('server/src/services/structure-generation.service.ts'),
    inventorySourceSha256: sha256('server/src/services/structure-source-inventory.ts'), ledger: '/synthetic/phase/ledger.json', scope: 'synthetic-ten-chapter-phase',
    coldCacheRequired: true, observedLedgerBefore: { reservedSends: 0, conservativeTokens: 0 },
    phaseDeclaration: { file: '/synthetic/phase/declaration.json', sha256: sha256('synthetic declaration') } };
  const captures: RecoveryPrior['captures'] = [];
  for (let index = 0; index < 11; index++) {
    const prepared = index === 10;
    const prompt = `Synthetic original section ${index}:` + 'x'.repeat(prepared ? 150000 : 177000);
    const options = { max_completion_tokens: 12000, reasoning_effort: 'medium', responseFormat: 'json', stream: true };
    const input: Attempt['input'] = { prompt, systemPrompt: null, messages: [{ role: 'user', content: prompt }],
      options: { ...options, model: controls.model }, provider: 'openai', model: controls.model, outputCap: 12000 };
    const base = { callId: `synthetic-call-${index}`, provider: 'openai', requestedModel: controls.model, actualModel: null, responseId: null,
      startedAt: date, retryVisibility: 'unknown' as const, usageContext: { stage: 'source-extraction', jsonAttempt: 0 } };
    const attempt: Attempt = { number: 0, input, inputSha256: hashControl(input), rawVisibleText: prepared ? '' : '{"sections":[]}',
      dispatch: prepared ? 'prepared' : 'finished', events: prepared ? [] : [
        { ...base, type: 'started', requestOptions: { ...options } },
        { ...base, type: 'finished', actualModel: controls.model, responseId: `synthetic-response-${index}`, requestOptions: { ...options },
          finishedAt: date, durationMs: 1, outcome: 'succeeded', usage: { inputTokens: null, outputTokens: null, totalTokens: null,
            reasoningTokens: null, cachedInputTokens: null, cacheWriteTokens: null, totalOrigin: 'unknown', countSource: 'unavailable' } },
      ] };
    const transcript: CapturedCompletion = { version: 1, stage: 'source-extraction', startedAt: date, elapsedMs: 1,
      request: { stage: 'source-extraction', prompt, model: controls.model, effort: 'medium', maxOutputTokens: 12000,
        maxInputTokens: 200000, maxSends: 2, allowedActualModels: [controls.model] },
      attempts: [attempt], status: prepared ? 'failed' : 'succeeded', parsed: prepared ? null : { sections: [] },
      error: prepared ? { name: 'AuthoringBudgetError', message: STOP } : null, modelIdentityVerified: !prepared,
      hiddenReasoning: 'not-captured', transport: 'toolkit-streamConversation-visible-content; JSON option is not strict native schema' };
    captures.push({ file: `/synthetic/captures/${index}.json`, transcript });
  }
  const observed = captures.flatMap(capture => capture.transcript.attempts).filter(attempt => attempt.dispatch === 'finished');
  const estimatedInputTokens = observed.reduce((sum, attempt) => sum + inputEstimate(attempt), 0);
  const reservedOutputTokens = observed.reduce((sum, attempt) => sum + attempt.input.outputCap, 0);
  const receipt: AuthoringBudgetReceipt = { version: 1, estimator: 'utf8-bytes-conservative-v1', retryVisibility: 'unknown', limitScope: 'process',
    observedSends: observed.length, estimatedInputTokens, reservedOutputTokens, admissionTokens: estimatedInputTokens + reservedOutputTokens,
    accounting: 'conservative-reservations-v1', pendingSends: 0, settledSends: 0, conservativeFinishedSends: observed.length,
    reportedInputTokens: null, reportedOutputTokens: null, usageCompleteness: 'unknown', queueWaitMs: 0, executionMs: 1, rejectedSends: 1,
    logical: { generatorAttempts: 0, repairCycles: 0, evidenceExpansions: 0, limits: { generatorAttempts: 2, repairCycles: 1, evidenceExpansions: 1 } },
    limits: { maxSends: 160, maxInputTokens: 200000, maxOutputTokens: 24000, maxEstimatedTokens: 2000000 } };
  const native = structuredClone(receipt); native.limits.maxSends = 256; native.rejectedSends = 0;
  const prior: RecoveryPrior = { version: 1, status: 'stopped', controlsSha256: hashControl(controls), runId: id(102), elapsedMs: 100,
    result: null, error: { name: 'AuthoringBudgetError', message: STOP }, budget: receipt,
    diagnosticRun: { _id: id(102), courseId: controls.courseId, requestedBy: controls.actor, kind: 'structure-generation', status: 'failed',
      input: structuredClone(controls.options), structureDiagnostics: { budget: native }, error: { code: 'quality-lab-outline-stopped', message: STOP } },
    liveCorpus: { fingerprint: sha256('exact synthetic full ten originals') }, captures,
    code: RECOVERY_REQUIRED_PRIOR_CODE.map(file => ({ file, snapshot: `/synthetic/code/${file}`, sha256: sha256(file) })) };
  const reservations: Ledger['reservations'] = captures.flatMap((capture, index) => capture.transcript.attempts.map(attempt => ({
    id: `synthetic-reservation-${index}`, cellId: 'outline', stage: capture.transcript.stage, jsonAttempt: attempt.number,
    inputSha256: hashControl({ actualPrompt: attempt.input.prompt, systemPrompt: attempt.input.systemPrompt ?? '' }), inputEstimate: inputEstimate(attempt),
    outputReservation: attempt.input.outputCap, reservedAt: date,
  })));
  const ledger: Ledger = { version: 1, createdAt: date, scope: controls.scope, accounting: 'conservative-reservations-v1', phaseDeclarationSha256: controls.phaseDeclaration.sha256,
    limits: { maxSends: 160, maxConservativeTokens: 4000000, maxInputTokens: 200000 }, reservedSends: reservations.length,
    conservativeTokens: reservations.reduce((sum, row) => sum + row.inputEstimate + row.outputReservation, 0), reservations };
  return { controls, prior, ledger };
}

function recount(ledger: ConservativeLedger): void {
  ledger.reservedSends = ledger.reservations.length;
  ledger.conservativeTokens = ledger.reservations.reduce((sum, row) => sum + row.inputEstimate + row.outputReservation, 0);
}
const rehashInput = (attempt: Attempt) => { attempt.inputSha256 = hashControl(attempt.input); };

/** Mirrors the observed terminal shape, not real content: one truncated failed
 * stream with an identified model, then one empty timeout with no model ID. */
function syntheticTransportRecovery() {
  const value = syntheticRecovery(); const { prior, ledger } = value;
  prior.captures = prior.captures.slice(0, 4); ledger.reservations = ledger.reservations.slice(0, 4); recount(ledger);
  for (const [offset, capture] of prior.captures.slice(2).entries()) {
    const transcript = capture.transcript; const attempt = transcript.attempts[0];
    transcript.status = 'failed'; transcript.parsed = null; transcript.modelIdentityVerified = false;
    transcript.error = { name: 'APIError', message: offset === 0 ? 'Unknown error occurred while calling OpenAI API' : 'Request timed out.' };
    attempt.rawVisibleText = offset === 0 ? '{"sections":[' : '';
    const finished = attempt.events.find(event => event.type === 'finished')!;
    finished.outcome = 'failed'; finished.actualModel = offset === 0 ? value.controls.model : null;
    finished.responseId = offset === 0 ? 'synthetic-partial-response' : null;
  }
  prior.error = { name: 'Error', message: 'Unknown error occurred while calling OpenAI API' };
  prior.diagnosticRun.error!.message = prior.error.message;
  const observed = prior.captures.flatMap(capture => capture.transcript.attempts);
  prior.budget.observedSends = observed.length; prior.budget.conservativeFinishedSends = observed.length;
  prior.budget.estimatedInputTokens = observed.reduce((sum, attempt) => sum + inputEstimate(attempt), 0);
  prior.budget.reservedOutputTokens = observed.reduce((sum, attempt) => sum + attempt.input.outputCap, 0);
  prior.budget.admissionTokens = prior.budget.estimatedInputTokens + prior.budget.reservedOutputTokens; prior.budget.rejectedSends = 0;
  const native = structuredClone(prior.budget); native.limits.maxSends = 256;
  prior.diagnosticRun.structureDiagnostics!.budget = native;
  return value;
}

it('imports only offline helpers while environment, database, provider and structure entrypoints throw', () => {
  expect(typeof assertRecoveryPrior).toBe('function'); expect(typeof assertAppendOnlyLedger).toBe('function'); expect(typeof assertRecoveryCaptureLedger).toBe('function');
});

it('admits an exact owned terminal native-total stop and reconciles finished sends plus a charged prepared denial', () => {
  const { controls, prior, ledger } = syntheticRecovery();
  expect(prior.budget.admissionTokens).toBeLessThan(2000000);
  expect(prior.budget.admissionTokens! + inputEstimate(prior.captures.at(-1)!.transcript.attempts[0]) + 12000).toBeGreaterThan(2000000);
  expect(ledger.reservedSends).toBe(prior.budget.observedSends + 1);
  expect(() => assertRecoveryPrior(controls, prior)).not.toThrow();
  expect(() => assertRecoveryCaptureLedger(controls, prior, ledger)).not.toThrow();
  expect(() => assertAppendOnlyLedger(ledger, structuredClone(ledger))).not.toThrow();
});

it('refuses a running or completed prior and unrelated budget, validation or semantic failures', () => {
  for (const change of [{ status: 'running' }, { status: 'completed' }, { error: { name: 'Error', message: 'quality-lab-ledger-token-cap' } },
    { error: { name: 'Error', message: 'structure-grounding-no-supported-objectives' } }, { result: {} }]) {
    const { controls, prior } = syntheticRecovery(); Object.assign(prior, change);
    expect(() => assertRecoveryPrior(controls, prior)).toThrow();
  }
});

it('requires the failed durable run to retain its exact owner, course, kind, input and empty result', () => {
  for (const change of [{ requestedBy: 'another actor' }, { courseId: id(999) }, { _id: id(999) }, { kind: 'question-generation' },
    { status: 'running' }, { structureResult: {} }, { input: { materialIds: [] } }, { error: { code: 'different', message: STOP } }]) {
    const { controls, prior } = syntheticRecovery(); Object.assign(prior.diagnosticRun, change);
    expect(() => assertRecoveryPrior(controls, prior)).toThrow('failed-owned-native-run-required');
  }
});

it('keeps the full ten-file batch, cold declaration, requested model and production stage caps fixed', () => {
  for (const change of [{ model: 'gpt-6.1-sol' }, { reasoningEffort: 'high' }, { coldCacheRequired: false },
    { extractionOutputCap: 10000 }, { synthesisOutputCap: 12000 }, { sourceReviewOutputCap: 3000 }, { maxOutputTokens: 12000 },
    { options: { materialIds: [id(1)], sourceBatchId: id(101) } }, { options: { materialIds: Array(10).fill(id(1)), sourceBatchId: id(101) } },
    { options: { materialIds: Array.from({ length: 10 }, (_, index) => id(index + 1)) } }, { observedLedgerBefore: { reservedSends: 1, conservativeTokens: 1 } }]) {
    const { controls, prior } = syntheticRecovery(); Object.assign(controls, change); prior.controlsSha256 = hashControl(controls); prior.diagnosticRun.input = structuredClone(controls.options);
    expect(() => assertRecoveryPrior(controls, prior)).toThrow('terminal-cold-native-total-stop-required');
  }
});

it('rejects unfinished, raised, settled, negative or arithmetically inconsistent native budget receipts', () => {
  for (const change of [{ pendingSends: 1 }, { admissionTokens: -1 }, { estimatedInputTokens: -1 }, { reservedOutputTokens: -1 },
    { accounting: 'reported-usage-settlement-v1' }, { settledSends: 1 }, { conservativeFinishedSends: 0 }, { admissionTokens: 1999999 }]) {
    const { controls, prior } = syntheticRecovery(); Object.assign(prior.budget, change);
    expect(() => assertRecoveryPrior(controls, prior)).toThrow('failed-owned-native-run-required');
  }
  const raised = syntheticRecovery(); raised.prior.budget.limits.maxEstimatedTokens = 4000000;
  expect(() => assertRecoveryPrior(raised.controls, raised.prior)).toThrow('failed-owned-native-run-required');
  const inner = syntheticRecovery(); inner.prior.diagnosticRun.structureDiagnostics!.budget!.limits.maxInputTokens = 400000;
  expect(() => assertRecoveryPrior(inner.controls, inner.prior)).toThrow('failed-owned-native-run-required');
});

it('requires every frozen core code identity once with a retained snapshot and valid hash', () => {
  for (const change of ['missing', 'duplicate', 'hash', 'snapshot']) {
    const { controls, prior } = syntheticRecovery();
    if (change === 'missing') prior.code.pop();
    if (change === 'duplicate') prior.code.push({ ...prior.code[0] });
    if (change === 'hash') prior.code[0].sha256 = 'unverified';
    if (change === 'snapshot') prior.code[0].snapshot = '';
    expect(() => assertRecoveryPrior(controls, prior)).toThrow('complete-cold-code-manifest-required');
  }
});

it('permits genuine appended reservations while retaining unknown or undispatched old charges', () => {
  const { ledger } = syntheticRecovery(); const next = structuredClone(ledger);
  next.reservations.push({ ...next.reservations[0], id: 'new-recovery-reservation', cellId: 'outline-recovery', inputEstimate: 1000 }); recount(next);
  expect(() => assertAppendOnlyLedger(ledger, next)).not.toThrow();
  expect(next.reservations[ledger.reservations.length - 1]).toEqual(ledger.reservations.at(-1));
});

it('rejects immutable header changes, historical reservation replacement and a shortened ledger', () => {
  for (const field of ['createdAt', 'scope', 'phaseDeclarationSha256']) {
    const { ledger } = syntheticRecovery(); const next = structuredClone(ledger); next[field as 'createdAt' | 'scope' | 'phaseDeclarationSha256'] = 'changed';
    expect(() => assertAppendOnlyLedger(ledger, next)).toThrow('ledger-prefix-changed');
  }
  const changed = syntheticRecovery(); const edited = structuredClone(changed.ledger); edited.reservations[0].inputSha256 = sha256('rewritten old input');
  expect(() => assertAppendOnlyLedger(changed.ledger, edited)).toThrow('ledger-prefix-changed');
  const short = structuredClone(changed.ledger); short.reservations.pop(); recount(short);
  expect(() => assertAppendOnlyLedger(changed.ledger, short)).toThrow('ledger-prefix-changed');
});

it('rejects duplicate reservation identities and inconsistent ledger counters even when totals appear plausible', () => {
  const duplicate = syntheticRecovery(); const next = structuredClone(duplicate.ledger); next.reservations.push({ ...next.reservations[0] }); recount(next);
  expect(() => assertAppendOnlyLedger(duplicate.ledger, next)).toThrow('ledger-prefix-changed');
  const invalid = syntheticRecovery(); invalid.ledger.reservedSends++;
  expect(() => assertAppendOnlyLedger(invalid.ledger, invalid.ledger)).toThrow('ledger-invalid');
});

it('rejects missing, unrelated extra or changed reservations in exact cold capture reconciliation', () => {
  for (const change of ['missing', 'extra', 'input', 'output', 'stage', 'attempt']) {
    const { controls, prior, ledger } = syntheticRecovery();
    if (change === 'missing') ledger.reservations.pop();
    if (change === 'extra') ledger.reservations.push({ ...ledger.reservations[0], id: 'extra', cellId: 'unrelated' });
    if (change === 'input') ledger.reservations[0].inputSha256 = sha256('different request');
    if (change === 'output') ledger.reservations[0].outputReservation = 24000;
    if (change === 'stage') ledger.reservations[0].stage = 'unrelated-stage';
    if (change === 'attempt') ledger.reservations[0].jsonAttempt = 1;
    recount(ledger); expect(() => assertRecoveryCaptureLedger(controls, prior, ledger)).toThrow('cold-ledger-does-not-reconcile');
  }
});

it('allows only an empty event-free prepared native denial and rejects in-flight or invented provider work', () => {
  for (const change of ['started', 'text', 'events', 'wrong-error', 'fake-observed']) {
    const { controls, prior, ledger } = syntheticRecovery(); const prepared = prior.captures.at(-1)!.transcript;
    if (change === 'started') prepared.attempts[0].dispatch = 'started';
    if (change === 'text') prepared.attempts[0].rawVisibleText = 'Unobserved output';
    if (change === 'events') prepared.attempts[0].events.push(structuredClone(prior.captures[0].transcript.attempts[0].events[0]));
    if (change === 'wrong-error') prepared.error!.message = 'provider timeout';
    if (change === 'fake-observed') prior.budget.observedSends++;
    expect(() => assertRecoveryCaptureLedger(controls, prior, ledger)).toThrow();
  }
});

it('requires complete raw observed outputs and exact transcript/request model, effort, stage and cap identities', () => {
  for (const change of ['raw', 'transcript', 'unverified', 'model', 'effort', 'stage', 'cap']) {
    const { controls, prior, ledger } = syntheticRecovery(); const transcript = prior.captures[0].transcript;
    if (change === 'raw') transcript.attempts[0].rawVisibleText = '';
    if (change === 'transcript') prior.captures[0].transcript = null as never;
    if (change === 'unverified') transcript.modelIdentityVerified = false;
    if (change === 'model') transcript.request.model = 'gpt-6.1-sol';
    if (change === 'effort') transcript.request.effort = 'high';
    if (change === 'stage') transcript.request.stage = 'different';
    if (change === 'cap') transcript.request.maxOutputTokens = 24000;
    expect(() => assertRecoveryCaptureLedger(controls, prior, ledger)).toThrow();
  }
});

it('binds the exact captured input hash, messages and native model options rather than trusting a recomputed tampered hash', () => {
  for (const change of ['hash', 'messages', 'model', 'effort', 'output', 'temperature']) {
    const { controls, prior, ledger } = syntheticRecovery(); const attempt = prior.captures[0].transcript.attempts[0];
    if (change === 'hash') attempt.inputSha256 = sha256('different captured input');
    if (change === 'messages') attempt.input.messages[0].content = 'A different actual request';
    if (change === 'model') attempt.input.options.model = 'gpt-6.1-sol';
    if (change === 'effort') attempt.input.options.reasoning_effort = 'high';
    if (change === 'output') attempt.input.options.max_completion_tokens = 24000;
    if (change === 'temperature') attempt.input.options.temperature = 0;
    if (change !== 'hash') rehashInput(attempt);
    expect(() => assertRecoveryCaptureLedger(controls, prior, ledger)).toThrow('cold-ledger-does-not-reconcile');
  }
});

it('binds start and finish events to one unique call, provider, outcome, context and exact dispatched options', () => {
  for (const change of ['call', 'duplicate-call', 'start-time', 'provider', 'model', 'context', 'effort', 'output', 'outcome']) {
    const { controls, prior, ledger } = syntheticRecovery(); const attempt = prior.captures[1].transcript.attempts[0];
    const started = attempt.events[0]; const finished = attempt.events[1];
    if (change === 'call') finished.callId = 'another call';
    if (change === 'duplicate-call') { started.callId = prior.captures[0].transcript.attempts[0].events[0].callId; finished.callId = started.callId; }
    if (change === 'start-time') finished.startedAt = '2026-10-17T00:00:00Z';
    if (change === 'provider') finished.provider = 'unobserved-provider';
    if (change === 'model') started.requestedModel = 'gpt-6.1-sol';
    if (change === 'context') finished.usageContext.jsonAttempt = 1;
    if (change === 'effort') started.requestOptions.reasoning_effort = 'high';
    if (change === 'output') finished.requestOptions.max_completion_tokens = 24000;
    if (change === 'outcome' && finished.type === 'finished') finished.outcome = 'failed';
    expect(() => assertRecoveryCaptureLedger(controls, prior, ledger)).toThrow('cold-capture-in-flight');
  }
});

it('reconciles observed budget sums and refuses a prepared denial that could still fit under the native total cap', () => {
  const sums = syntheticRecovery(); sums.prior.budget.estimatedInputTokens--;
  expect(() => assertRecoveryCaptureLedger(sums.controls, sums.prior, sums.ledger)).toThrow('cold-ledger-does-not-reconcile');
  const room = syntheticRecovery(); room.prior.budget.admissionTokens = 1;
  expect(() => assertRecoveryCaptureLedger(room.controls, room.prior, room.ledger)).toThrow('cold-ledger-does-not-reconcile');
});

it('admits a separate cache-assisted continuation after a truncated failed stream and an empty timeout without releasing their charges', () => {
  const { controls, prior, ledger } = syntheticTransportRecovery(); const original = hashControl({ prior, ledger });
  expect(recoveryStopKind(prior)).toBe('provider-transport');
  expect(() => assertRecoveryPrior(controls, prior)).not.toThrow();
  expect(() => assertRecoveryCaptureLedger(controls, prior, ledger)).not.toThrow();
  expect(ledger.reservedSends).toBe(prior.budget.observedSends);
  expect(ledger.conservativeTokens).toBe(prior.budget.admissionTokens);
  expect(hashControl({ prior, ledger })).toBe(original);
});

it('does not mistake a terminal unknown API message for proven transport failure without matching retained failed calls', () => {
  for (const change of ['missing', 'different-error', 'semantic-error', 'wrong-name', 'invented-top-error']) {
    const { controls, prior, ledger } = syntheticTransportRecovery();
    if (change === 'missing') prior.captures = prior.captures.slice(0, 2);
    if (change === 'different-error') prior.error.message = 'Request timed out.';
    if (change === 'semantic-error') prior.captures.at(-1)!.transcript.error!.message = 'structure-grounding-no-supported-objectives';
    if (change === 'wrong-name') prior.captures.at(-1)!.transcript.error!.name = 'ValidationError';
    if (change === 'invented-top-error') prior.error = { name: 'ValidationError', message: 'Unknown error occurred while calling OpenAI API' };
    if (change === 'different-error') prior.captures.at(-1)!.transcript.error!.message = 'Unknown error occurred while calling OpenAI API';
    expect(() => assertRecoveryCaptureLedger(controls, prior, ledger)).toThrow();
  }
});

it('requires exact terminal failed owned durable state and a transport-only zero-rejection native budget', () => {
  for (const change of ['running', 'foreign', 'durable-error', 'pending', 'outer-rejection', 'inner-rejection', 'unmatched-native-input']) {
    const { controls, prior } = syntheticTransportRecovery();
    if (change === 'running') prior.diagnosticRun.status = 'running';
    if (change === 'foreign') prior.diagnosticRun.requestedBy = 'unrelated actor';
    if (change === 'durable-error') prior.diagnosticRun.error!.message = 'Request timed out.';
    if (change === 'pending') prior.budget.pendingSends = 1;
    if (change === 'outer-rejection') prior.budget.rejectedSends = 1;
    if (change === 'inner-rejection') prior.diagnosticRun.structureDiagnostics!.budget!.rejectedSends = 1;
    if (change === 'unmatched-native-input') prior.diagnosticRun.structureDiagnostics!.budget!.estimatedInputTokens--;
    expect(() => assertRecoveryPrior(controls, prior)).toThrow('failed-owned-native-run-required');
  }
});

it('rejects in-flight or undispatched transport claims even when their conservative reservations exist', () => {
  for (const change of ['started', 'prepared', 'missing-finish', 'successful-finish', 'parsed-output', 'verified-failure']) {
    const { controls, prior, ledger } = syntheticTransportRecovery(); const transcript = prior.captures.at(-1)!.transcript;
    const attempt = transcript.attempts[0];
    if (change === 'started') attempt.dispatch = 'started';
    if (change === 'prepared') { attempt.dispatch = 'prepared'; attempt.events = []; }
    if (change === 'missing-finish') attempt.events.pop();
    if (change === 'successful-finish' && attempt.events[1].type === 'finished') attempt.events[1].outcome = 'succeeded';
    if (change === 'parsed-output') transcript.parsed = {};
    if (change === 'verified-failure') transcript.modelIdentityVerified = true;
    expect(() => assertRecoveryCaptureLedger(controls, prior, ledger)).toThrow();
  }
});

it('permits a nullable model identity only on terminal failed transport calls while successful calls remain verified', () => {
  for (const change of ['success-null', 'success-unverified', 'failure-foreign', 'start-foreign', 'requested-foreign']) {
    const { controls, prior, ledger } = syntheticTransportRecovery();
    const success = prior.captures[0].transcript; const failed = prior.captures.at(-1)!.transcript.attempts[0];
    if (change === 'success-null') success.attempts[0].events[1].actualModel = null;
    if (change === 'success-unverified') success.modelIdentityVerified = false;
    if (change === 'failure-foreign') failed.events[1].actualModel = 'gpt-6.1-sol';
    if (change === 'start-foreign') failed.events[0].actualModel = 'gpt-6.1-sol';
    if (change === 'requested-foreign') failed.events[0].requestedModel = 'gpt-6.1-sol';
    expect(() => assertRecoveryCaptureLedger(controls, prior, ledger)).toThrow();
  }
});

it('retains completely unknown failed usage and refuses invented zero or settled usage', () => {
  for (const field of ['inputTokens', 'outputTokens', 'totalTokens', 'reasoningTokens', 'cachedInputTokens', 'cacheWriteTokens', 'totalOrigin', 'countSource']) {
    const { controls, prior, ledger } = syntheticTransportRecovery(); const finished = prior.captures.at(-1)!.transcript.attempts[0].events[1];
    if (finished.type !== 'finished') throw new Error('Synthetic fixture missing finish.');
    Object.assign(finished.usage, { [field]: field === 'totalOrigin' ? 'provider' : field === 'countSource' ? 'provider-reported' : 0 });
    expect(() => assertRecoveryCaptureLedger(controls, prior, ledger)).toThrow('cold-failed-usage-must-remain-unknown');
  }
});

it('reconciles every observed failed charge and rejects omissions, unrelated appends or undercounted native totals', () => {
  for (const change of ['missing-charge', 'extra-charge', 'underreported-observed', 'underreported-input', 'underreported-output']) {
    const { controls, prior, ledger } = syntheticTransportRecovery();
    if (change === 'missing-charge') ledger.reservations.pop();
    if (change === 'extra-charge') ledger.reservations.push({ ...ledger.reservations[0], id: 'unrelated', cellId: 'other-run' });
    if (change === 'underreported-observed') prior.budget.observedSends--;
    if (change === 'underreported-input') prior.budget.estimatedInputTokens--;
    if (change === 'underreported-output') prior.budget.reservedOutputTokens -= 12000;
    recount(ledger); expect(() => assertRecoveryCaptureLedger(controls, prior, ledger)).toThrow('cold-ledger-does-not-reconcile');
  }
});

it('binds full dispatched JSON/stream options on failed and successful calls and exact allowed model identities', () => {
  for (const change of ['response-format', 'stream', 'allowed-model', 'json-cap', 'input-cap']) {
    const { controls, prior, ledger } = syntheticTransportRecovery(); const failed = prior.captures.at(-1)!.transcript;
    if (change === 'response-format') failed.attempts[0].events[1].requestOptions.responseFormat = 'text';
    if (change === 'stream') failed.attempts[0].events[1].requestOptions.stream = false;
    if (change === 'allowed-model') failed.request.allowedActualModels.push('gpt-6.1-sol');
    if (change === 'json-cap') failed.request.maxSends = 1;
    if (change === 'input-cap') failed.request.maxInputTokens = 400000;
    expect(() => assertRecoveryCaptureLedger(controls, prior, ledger)).toThrow();
  }
});
