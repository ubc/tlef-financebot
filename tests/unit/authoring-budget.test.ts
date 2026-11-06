const sendMessage = jest.fn();
jest.mock('../../server/src/config/env', () => ({ env: { llmProvider: 'ollama', llmDefaultModel: 'synthetic-model', llmEndpoint: 'http://synthetic.invalid',
  llmApiKey: '', genaiDebug: false, authoringProviderConcurrency: 2 } }));
jest.mock('ubc-genai-toolkit-llm', () => ({ LLMModule: jest.fn().mockImplementation(() => ({ sendMessage, getAvailableModels: jest.fn() })) }));
import { completeJson, llm } from '../../server/src/components/genai/llm';
import { AuthoringBudget, AuthoringBudgetError, AuthoringSendGate, admitAuthoringSend, defaultAuthoringLimits, estimateAuthoringTokens, withAuthoringBudget, type ModelSendAdmission } from '../../server/src/components/genai/llm/authoring-budget';

beforeEach(() => sendMessage.mockReset());
const response = { content: '{"ok":true}', usage: { promptTokens: 9, completionTokens: 4 } };

it('charges JSON correction sends against actual prompts and reconciles nullable reported usage', async () => {
  sendMessage.mockResolvedValueOnce({ content: 'not JSON' }).mockResolvedValueOnce(response);
  const hook = jest.fn(async (_request?: ModelSendAdmission) => undefined);
  const budget = new AuthoringBudget('course', { maxSends: 2 });
  await expect(withAuthoringBudget(budget, () => completeJson('original', { maxTokens: 300, beforeRequest: hook }))).resolves.toEqual({ ok: true });
  const receipt = budget.snapshot();
  expect(receipt.observedSends).toBe(2);
  expect(receipt.estimatedInputTokens).toBe(estimateAuthoringTokens('original') + estimateAuthoringTokens(sendMessage.mock.calls[1][0]));
  expect(receipt.reservedOutputTokens).toBe(600);
  expect(receipt.reportedInputTokens).toBe(9);
  expect(receipt.usageCompleteness).toBe('partial');
  expect(receipt.retryVisibility).toBe('unknown');
  expect(hook.mock.calls[1][0]).toMatchObject({ jsonAttempt: 1, outputCap: 300, provider: 'ollama', model: 'synthetic-model' });
});

it('refuses a larger repair before dispatch without truncating the prompt', async () => {
  sendMessage.mockResolvedValue({ content: 'not JSON' });
  const budget = new AuthoringBudget('course', { maxInputTokens: estimateAuthoringTokens('original') + 2 });
  await expect(withAuthoringBudget(budget, () => completeJson('original', { maxTokens: 30 }))).rejects.toBeInstanceOf(AuthoringBudgetError);
  expect(sendMessage).toHaveBeenCalledTimes(1);
  expect(sendMessage.mock.calls[0][0]).toBe('original');
  expect(budget.snapshot()).toMatchObject({ observedSends: 1, rejectedSends: 1, usageCompleteness: 'unknown' });
});

it('charges both run and slot scopes so a nested retry cannot reset the enclosing allowance', async () => {
  sendMessage.mockResolvedValueOnce(response).mockResolvedValueOnce({ content: 'invalid' });
  const run = new AuthoringBudget('course', { maxSends: 2 });
  const slot = new AuthoringBudget('slot', { maxSends: 8 });
  await withAuthoringBudget(run, async () => {
    await completeJson('planning', { maxTokens: 100 });
    await expect(withAuthoringBudget(slot, () => completeJson('generate', { maxTokens: 100 }))).rejects.toThrow('authoring-budget-exhausted:sends');
  });
  expect(sendMessage).toHaveBeenCalledTimes(2);
  expect(run.snapshot().observedSends).toBe(2);
  expect(slot.snapshot().observedSends).toBe(1);
});

it('admits direct facade sends with shaped output limits and counts failures', async () => {
  sendMessage.mockRejectedValueOnce(new Error('provider-failed')).mockResolvedValueOnce(response);
  const budget = new AuthoringBudget('course', { maxSends: 2, maxOutputTokens: 500 });
  await withAuthoringBudget(budget, async () => {
    await expect(llm.sendMessage('first', { max_completion_tokens: 400 })).rejects.toThrow('provider-failed');
    await llm.sendMessage('second', { max_completion_tokens: 400 });
  });
  expect(budget.snapshot()).toMatchObject({ observedSends: 2, reservedOutputTokens: 800, usageCompleteness: 'partial' });
});

it('rejects output/total budgets before provider work and releases hook permits on failure', async () => {
  const release = jest.fn(); const beforeRequest = jest.fn(async () => release);
  const output = new AuthoringBudget('course', { maxOutputTokens: 100 });
  await expect(withAuthoringBudget(output, () => completeJson('prompt', { maxTokens: 101, beforeRequest }))).rejects.toThrow('authoring-budget-exhausted:output');
  expect(release).toHaveBeenCalledTimes(1);
  const total = new AuthoringBudget('course', { maxEstimatedTokens: 40 });
  await expect(withAuthoringBudget(total, () => completeJson('prompt', { maxTokens: 100 }))).rejects.toThrow('authoring-budget-exhausted:total');
  expect(sendMessage).not.toHaveBeenCalled();
});

it('rechecks cancellation after queue admission and never starts a waiting request after Stop', async () => {
  const releases: Array<() => void> = [];
  sendMessage.mockImplementation(() => new Promise(resolve => releases.push(() => resolve(response))));
  const first = completeJson('first'); const second = completeJson('second');
  while (releases.length < 2) await new Promise(resolve => setImmediate(resolve));
  let active = true;
  const cancelled = new AuthoringBudget('other-course', {}, async () => { if (!active) throw new Error('content-run-conflict'); });
  const waiting = withAuthoringBudget(cancelled, () => completeJson('must-not-send'));
  // Attach the rejection handler before releasing a permit.
  const assertion = expect(waiting).rejects.toThrow('content-run-conflict');
  await new Promise(resolve => setImmediate(resolve)); active = false;
  releases.forEach(release => release());
  await Promise.all([first, second, assertion]);
  expect(sendMessage).toHaveBeenCalledTimes(2);
  expect(cancelled.snapshot().observedSends).toBe(0);
});

it('releases process permits in finally after provider failures', async () => {
  sendMessage.mockRejectedValue(new Error('provider-failed'));
  await Promise.allSettled([completeJson('one'), completeJson('two'), completeJson('three')]);
  sendMessage.mockResolvedValue(response);
  await expect(completeJson('four')).resolves.toEqual({ ok: true });
  expect(sendMessage).toHaveBeenCalledTimes(4);
});

it('rotates waiting course groups and makes releases idempotent', async () => {
  const gate = new AuthoringSendGate(1);
  const initial = await gate.acquire('course-a');
  const order: string[] = [];
  const a = gate.acquire('course-a').then(release => { order.push('a'); release(); release(); });
  const b = gate.acquire('course-b').then(release => { order.push('b'); release(); });
  initial(); initial(); await Promise.all([a, b]);
  expect(order).toEqual(['b', 'a']);
});

it('limits logical generation/repair/expansion in the slot without charging a run-wide two-attempt limit', () => {
  const run = new AuthoringBudget('run'); const slot = new AuthoringBudget('slot');
  withAuthoringBudget(run, () => withAuthoringBudget(slot, () => {
    slot.reserveLogical('generator-attempt'); slot.reserveLogical('generator-attempt');
    slot.reserveLogical('repair-cycle'); slot.reserveLogical('evidence-expansion');
    expect(() => slot.reserveLogical('generator-attempt')).toThrow('authoring-budget-exhausted:generator-attempt');
    expect(() => slot.reserveLogical('repair-cycle')).toThrow('authoring-budget-exhausted:repair-cycle');
    expect(() => slot.reserveLogical('evidence-expansion')).toThrow('authoring-budget-exhausted:evidence-expansion');
  }));
  expect(slot.snapshot().logical).toMatchObject({ generatorAttempts: 2, repairCycles: 1, evidenceExpansions: 1 });
  expect(run.snapshot().logical.generatorAttempts).toBe(0);
});

it('cannot bypass global send/total ceilings through a larger caller override', () => {
  const limits = defaultAuthoringLimits({ maxSends: 10000, maxEstimatedTokens: 9_000_000, maxInputTokens: 200000 });
  expect(limits.maxSends).toBe(256);
  expect(limits.maxEstimatedTokens).toBe(2_000_000);
  expect(limits.maxInputTokens).toBe(200000);
});

it('supplies a real output cap for scoped JSON calls and rejects uncapped direct facade calls', async () => {
  sendMessage.mockResolvedValue(response);
  const budget = new AuthoringBudget('course', { maxOutputTokens: 500 });
  await withAuthoringBudget(budget, async () => {
    await completeJson('bounded by the scope');
    await expect(llm.sendMessage('uncapped direct call')).rejects.toThrow('authoring-budget-exhausted:output');
  });
  expect(sendMessage).toHaveBeenCalledTimes(1);
  expect(sendMessage.mock.calls[0][1].maxTokens).toBe(500);
  expect(budget.snapshot().observedSends).toBe(1);
});

const settlement = { accounting: 'reported-usage-settlement-v1' as const };
const admission = (prompt = 'one', outputCap = 100): ModelSendAdmission => ({ prompt, outputCap, provider: 'ollama', model: 'synthetic-model', options: {}, jsonAttempt: 0 });

it('only explicit successful reported-usage settlement frees unused reservations; cumulative estimates remain audit data', async () => {
  sendMessage.mockResolvedValue(response);
  const conservative = new AuthoringBudget('default', { maxEstimatedTokens: 150 });
  await withAuthoringBudget(conservative, async () => {
    await completeJson('one', { maxTokens: 100 });
    await expect(completeJson('two', { maxTokens: 100 })).rejects.toThrow('authoring-budget-exhausted:total');
  });
  expect(conservative.snapshot()).toMatchObject({ accounting: 'conservative-reservations-v1', admissionTokens: 135, settledSends: 0 });
  const experiment = new AuthoringBudget('experiment', { maxEstimatedTokens: 150 }, undefined, settlement);
  await withAuthoringBudget(experiment, async () => {
    await completeJson('one', { maxTokens: 100 });
    await completeJson('two', { maxTokens: 100 });
  });
  expect(experiment.snapshot()).toMatchObject({ observedSends: 2, estimatedInputTokens: 70, reservedOutputTokens: 200,
    admissionTokens: 26, reportedInputTokens: 18, reportedOutputTokens: 8, settledSends: 2, pendingSends: 0, conservativeFinishedSends: 0 });
});

it('pending calls retain full reservations and parallel completion cannot release another call allowance', async () => {
  const budget = new AuthoringBudget('experiment', { maxEstimatedTokens: 300 }, undefined, settlement);
  await withAuthoringBudget(budget, async () => {
    const first = await admitAuthoringSend(admission('one')); const second = await admitAuthoringSend(admission('two'));
    expect(budget.snapshot()).toMatchObject({ admissionTokens: 270, pendingSends: 2 });
    first({ promptTokens: 9, completionTokens: 4 }, 'succeeded');
    expect(budget.snapshot()).toMatchObject({ admissionTokens: 148, pendingSends: 1 });
    first({ promptTokens: 0, completionTokens: 0 }, 'succeeded');
    expect(budget.snapshot()).toMatchObject({ admissionTokens: 148, pendingSends: 1, settledSends: 1 });
    second(undefined, 'cancelled');
    expect(budget.snapshot()).toMatchObject({ admissionTokens: 148, pendingSends: 0, settledSends: 1, conservativeFinishedSends: 1 });
  });
});

it.each([
  ['partial input', { promptTokens: 9 }, 'succeeded'],
  ['partial output', { completionTokens: 4 }, 'succeeded'],
  ['no usage', undefined, 'succeeded'],
  ['failed known', { promptTokens: 9, completionTokens: 4 }, 'failed'],
  ['cancelled known', { promptTokens: 9, completionTokens: 4 }, 'cancelled'],
  ['unknown outcome', { promptTokens: 9, completionTokens: 4 }, undefined],
  ['invalid negative', { promptTokens: -1, completionTokens: 4 }, 'succeeded'],
  ['invalid fraction', { promptTokens: 1.5, completionTokens: 4 }, 'succeeded'],
  ['invalid sum', { promptTokens: Number.MAX_SAFE_INTEGER, completionTokens: 4 }, 'succeeded'],
] as const)('keeps the conservative reservation for %s completion', (_label, usage, outcome) => {
  const budget = new AuthoringBudget('experiment', {}, undefined, settlement);
  const id = budget.reserve(admission()); budget.finish(id, usage, outcome);
  expect(budget.snapshot()).toMatchObject({ admissionTokens: 135, pendingSends: 0, settledSends: 0, conservativeFinishedSends: 1 });
});

it('charges known usage larger than a reservation and never creates negative allowance or duplicate finish credit', () => {
  const budget = new AuthoringBudget('experiment', { maxEstimatedTokens: 150 }, undefined, settlement);
  const id = budget.reserve(admission()); budget.finish(id, { promptTokens: 150, completionTokens: 50 }, 'succeeded');
  expect(budget.snapshot().admissionTokens).toBe(200);
  budget.finish(id, { promptTokens: 0, completionTokens: 0 }, 'succeeded'); budget.finish(999, { promptTokens: 0, completionTokens: 0 }, 'succeeded');
  expect(budget.snapshot()).toMatchObject({ admissionTokens: 200, settledSends: 1, reportedInputTokens: 150, reportedOutputTokens: 50 });
  expect(() => budget.reserve(admission())).toThrow('authoring-budget-exhausted:total');
});

it('nested scopes settle a physical observed send once each while retaining independent input/output/send caps', async () => {
  sendMessage.mockResolvedValue(response);
  const run = new AuthoringBudget('run', { maxSends: 1, maxEstimatedTokens: 150 }, undefined, settlement);
  const slot = new AuthoringBudget('slot', { maxSends: 2, maxInputTokens: 40, maxOutputTokens: 100 }, undefined, settlement);
  await withAuthoringBudget(run, () => withAuthoringBudget(slot, () => withAuthoringBudget(slot, async () => {
    await completeJson('one', { maxTokens: 100 });
    await expect(completeJson('two', { maxTokens: 100 })).rejects.toThrow('authoring-budget-exhausted:sends');
  })));
  expect(run.snapshot()).toMatchObject({ observedSends: 1, admissionTokens: 13, settledSends: 1 });
  expect(slot.snapshot()).toMatchObject({ observedSends: 1, admissionTokens: 13, settledSends: 1 });
  expect(sendMessage).toHaveBeenCalledTimes(1);
  const caps = new AuthoringBudget('caps', { maxInputTokens: 40, maxOutputTokens: 100 }, undefined, settlement);
  expect(() => caps.reserve(admission('long prompt'))).toThrow('authoring-budget-exhausted:input');
  expect(() => caps.reserve(admission('one', 101))).toThrow('authoring-budget-exhausted:output');
});

it('settles malformed JSON provider successes independently and continues charging the bounded correction send', async () => {
  sendMessage.mockResolvedValueOnce({ ...response, content: 'not JSON' }).mockResolvedValueOnce(response);
  const budget = new AuthoringBudget('repair', { maxSends: 2, maxEstimatedTokens: 320 }, undefined, settlement);
  await expect(withAuthoringBudget(budget, () => completeJson('one', { maxTokens: 100 }))).resolves.toEqual({ ok: true });
  expect(budget.snapshot()).toMatchObject({ observedSends: 2, admissionTokens: 26, settledSends: 2, usageCompleteness: 'complete' });
  expect(sendMessage).toHaveBeenCalledTimes(2);
});
