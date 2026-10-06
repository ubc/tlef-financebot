import { aggregateHarnessUsage, createHarnessUsageTracker, summarizeHarnessUsage } from '../../scripts/prompt-ab/usage-summary';
import { observeModelCall, withModelCallContext, type ModelCallEvent } from '../../server/src/components/genai/llm/model-call';
import { normalizeProviderUsage } from '../../server/src/components/genai/llm/provider-usage';

const mockCompleteJson = jest.fn();
const mockProvider = jest.fn();
const mockWrites: string[] = [];
jest.mock('node:fs', () => ({
  readFileSync: () => JSON.stringify({ finance: { lo: 'Synthetic source-bounded finance objective', chunks: [{ text: 'Synthetic fixture evidence.' }] } }),
  mkdirSync: jest.fn(),
  writeFileSync: (_path: string, body: string) => { mockWrites.push(body); },
  appendFileSync: (_path: string, body: string) => { mockWrites.push(body); },
}));
// Mock the full component entry point; no .env, toolkit, SDK, or provider is loaded.
jest.mock('../../server/src/components/genai/llm', () => ({ completeJson: (...args: unknown[]) => mockCompleteJson(...args) }));
jest.mock('../../server/src/services/generation.service', () => ({
  GENERATOR_PROMPT: () => 'Synthetic generator prompt', VALIDATOR_PROMPT: () => 'Synthetic validator prompt',
  REVIEWER_PROMPT: () => 'Synthetic reviewer prompt', REVIEWER_REJECT_FEEDBACK: () => 'Synthetic rejection feedback',
  verifyGeneratedNumerics: () => ({ failure: null }),
}));
import { runExperiment, type Experiment } from '../../scripts/prompt-ab/harness';

const config = { provider: 'openai' as const, defaultModel: 'synthetic-model' };
const fixtureUsage = { promptTokens: 10, completionTokens: 2, totalTokens: 12 };
const finished = (callId: string, tokens = 12): Extract<ModelCallEvent, { type: 'finished' }> => ({
  type: 'finished', callId, provider: 'openai', requestedModel: 'synthetic-model', actualModel: 'synthetic-model', responseId: `response-${callId}`,
  startedAt: '2026-10-03T00:00:00.000Z', finishedAt: '2026-10-03T00:00:01.000Z', durationMs: 1000,
  requestOptions: {}, usageContext: {}, retryVisibility: 'unknown', outcome: 'succeeded',
  usage: normalizeProviderUsage('openai', { prompt_tokens: tokens - 2, completion_tokens: 2, total_tokens: tokens }, 'openai-chat'),
});
const started = (callId: string): ModelCallEvent => ({ ...finished(callId), type: 'started' });
const generated = { difficulty: 'hard', numericKind: 'conceptual', stem: 'Synthetic question', options: [] };
const reply = (content: unknown, usage: typeof fixtureUsage | undefined = fixtureUsage) => ({ content: JSON.stringify(content), model: 'synthetic-model', ...(usage ? { usage } : {}) });
const spec = (arms = [{ label: 'baseline' }]): Experiment => ({ name: 'synthetic-accounting-test', hypothesis: 'Local fixture only', arms,
  cells: [{ fixture: 'finance', difficulty: 'hard' }], n: 1, mode: 'single-shot', defaults: { model: 'synthetic-model' } });
let logs: jest.SpyInstance;

beforeEach(() => {
  mockWrites.length = 0; mockProvider.mockReset(); mockCompleteJson.mockReset();
  logs = jest.spyOn(console, 'log').mockImplementation(() => {});
  mockCompleteJson.mockImplementation(async (prompt, options = {}) => withModelCallContext(options.usageContext || {}, options.onAttempt, async () => {
    const response = await observeModelCall(config, options, () => mockProvider(prompt, options));
    options.onUsage?.(response.usage);
    return JSON.parse(response.content);
  }));
});
afterEach(() => logs.mockRestore());

describe('truthful prompt experiment usage', () => {
  it('deduplicates repeated terminal delivery and preserves known counters', () => {
    const paid = finished('call-1');
    const empty = { ...paid, usage: normalizeProviderUsage('openai', null) };
    expect(summarizeHarnessUsage([started('call-1'), paid, paid, empty], { coverageComplete: true }))
      .toMatchObject({ calls: 1, reportedCalls: 1, totalTokens: 12, inputTokens: 10, outputTokens: 2, status: 'complete', retryLimitedCalls: 1 });
  });
  it('retains failed consumption and distinguishes missing usage from zero', () => {
    const failed = { ...finished('failed'), outcome: 'failed' as const };
    const unknown = { ...finished('unknown'), usage: normalizeProviderUsage('openai', null) };
    expect(summarizeHarnessUsage([failed, unknown], { coverageComplete: true }))
      .toMatchObject({ totalTokens: 12, calls: 2, unknownCalls: 1, failedCalls: 1, status: 'partial' });
    expect(summarizeHarnessUsage([{ ...finished('zero', 2), usage: normalizeProviderUsage('openai', { prompt_tokens: 0, completion_tokens: 0 }, 'openai-chat') }], { coverageComplete: true }))
      .toMatchObject({ inputTokens: 0, outputTokens: 0, totalTokens: 0, status: 'complete' });
  });
  it('keeps partially known fields and marks an abandoned started call unknown', () => {
    const partial = { ...finished('partial'), usage: normalizeProviderUsage('openai', { prompt_tokens: 5 }, 'openai-chat') };
    expect(summarizeHarnessUsage([partial, started('pending')], { coverageComplete: true }))
      .toMatchObject({ inputTokens: 5, outputTokens: null, totalTokens: null, reportedCalls: 1, callsWithKnownTotal: 0, unknownCalls: 2, status: 'partial' });
    expect(summarizeHarnessUsage([started('pending')], { coverageComplete: true, active: true }))
      .toMatchObject({ pendingCalls: 1, unknownCalls: 0, status: 'pending' });
  });
  it('does not manufacture free historical runs from an empty ledger', () => {
    expect(summarizeHarnessUsage([])).toMatchObject({ totalTokens: null, status: 'unavailable', untrackedRecords: 1 });
    expect(summarizeHarnessUsage([], { coverageComplete: true })).toMatchObject({ totalTokens: 0, status: 'complete', calls: 0 });
  });
  it('includes error rows in aggregation and makes missing records explicit', () => {
    const good = createHarnessUsageTracker(); good.observe(finished('good'));
    const failed = createHarnessUsageTracker(); failed.observe({ ...finished('failed'), outcome: 'failed' });
    const summary = aggregateHarnessUsage([{ usage: good.summarize(), modelCalls: good.snapshot() },
      { error: 'Synthetic failed candidate', usage: failed.summarize(), modelCalls: failed.snapshot() }]);
    expect(summary).toMatchObject({ totalTokens: 24, calls: 2, failedCalls: 1, status: 'complete' });
    expect(aggregateHarnessUsage([{ error: 'Untracked old result' }])).toMatchObject({ totalTokens: null, status: 'unavailable', untrackedRecords: 1 });
  });
  it('accounts for a rejected candidate and its replacement without merging calls', async () => {
    mockProvider.mockResolvedValueOnce(reply(generated)).mockResolvedValueOnce(reply({ roleAssessment: 'Synthetic role check' }))
      .mockResolvedValueOnce(reply({ decision: 'reject', reasoning: 'Synthetic rejection' }))
      .mockResolvedValueOnce(reply({ ...generated, stem: 'Synthetic replacement' }))
      .mockResolvedValueOnce(reply({ roleAssessment: 'Synthetic role check' }))
      .mockResolvedValueOnce(reply({ decision: 'pass', reasoning: 'Synthetic review' }));
    await runExperiment({ ...spec(), mode: 'retry-on-reject' });
    const record = JSON.parse(mockWrites[1]);
    expect(record).toMatchObject({ retryFired: true, decision: 'reject', retry: { decision: 'pass' }, usage: { totalTokens: 72, calls: 6 } });
    expect(record.modelCalls.filter((event: ModelCallEvent) => event.type === 'started').map((event: ModelCallEvent) => event.usageContext.candidateAttempt))
      .toEqual([0, 0, 0, 1, 1, 1]);
  });
  it('counts no-usage provider failure in the arm tally and saves its result record', async () => {
    mockProvider.mockResolvedValueOnce(reply(generated)).mockResolvedValueOnce(reply({ roleAssessment: 'Synthetic' }))
      .mockResolvedValueOnce(reply({ decision: 'pass', reasoning: 'Synthetic' })).mockRejectedValueOnce(new Error('Synthetic unavailable provider'));
    await runExperiment({ ...spec([{ label: 'same-arm' }]), n: 2 });
    const errorRecord = JSON.parse(mockWrites[2]);
    expect(errorRecord).toMatchObject({ error: expect.stringContaining('Synthetic unavailable provider'), usage: { calls: 1, totalTokens: null, unknownCalls: 1 } });
    expect(logs.mock.calls.some(([value]) => typeof value === 'string' && value.includes('36') && value.includes('partial; 3/4; 1'))).toBe(true);
  });
  it('automatically accounts for compatible legacy prepasses without double counting onUsage', async () => {
    mockProvider.mockResolvedValueOnce(reply({ plan: 'Synthetic' })).mockResolvedValueOnce(reply(generated))
      .mockResolvedValueOnce(reply({ roleAssessment: 'Synthetic' })).mockResolvedValueOnce(reply({ decision: 'pass', reasoning: 'Synthetic' }));
    const experiment = spec();
    experiment.arms[0].prePass = async ({ track }) => {
      await mockCompleteJson('Synthetic planning', { onUsage: track }); return { appendix: 'Synthetic plan' };
    };
    await runExperiment(experiment);
    const record = JSON.parse(mockWrites[1]);
    expect(record.usage).toMatchObject({ calls: 4, totalTokens: 48 });
    expect(record.modelCalls[0].usageContext).toMatchObject({ stage: 'prepass', item: 1 });
  });
});
