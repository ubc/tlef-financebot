import { continuationError, installContinuationDiagnostics } from '../../scripts/quality-lab/public-acceptance-continuation-observation';
import { installPublicObservation, type PublicNativeCapture } from '../../scripts/quality-lab/public-acceptance-observation';
import type { LLMModule } from 'ubc-genai-toolkit-llm';

jest.mock('../../server/src/config/env', () => { throw new Error('Offline continuation diagnostics must not import runtime config.'); });
jest.mock('../../server/src/components/mongodb', () => { throw new Error('Offline continuation diagnostics must not import Mongo.'); });
jest.mock('../../server/src/components/genai/llm', () => { throw new Error('Offline continuation diagnostics must not import providers.'); });

describe('operation-labelled local-fetch continuation evidence without automatic retries', () => {
  let original: typeof globalThis.fetch; let diagnostics: ReturnType<typeof installContinuationDiagnostics> | undefined;
  beforeEach(() => { original = globalThis.fetch; });
  afterEach(() => { diagnostics?.restore(); diagnostics = undefined; globalThis.fetch = original; });
  it('retains the exact local endpoint, case, method and nested socket cause; then refuses another socket', async () => {
    const socket = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED', errno: -61, syscall: 'connect', address: '127.0.0.1', port: 6333 });
    const error = new TypeError('fetch failed', { cause: new AggregateError([socket], 'All local addresses failed') });
    const fetch = jest.fn().mockRejectedValue(error); globalThis.fetch = fetch as typeof globalThis.fetch; const save = jest.fn().mockResolvedValue(undefined);
    diagnostics = installContinuationDiagnostics({ caseId: () => 'regeneration-create-independent-task', save });
    await expect(diagnostics.operation('clone:chapter-4:qdrant.upsertPoints', () => globalThis.fetch('http://127.0.0.1:6333/collections/owned/points?wait=true', { method: 'PUT' }))).rejects.toBe(error);
    expect(fetch).toHaveBeenCalledTimes(1); expect(diagnostics.fetches[0]).toMatchObject({ operation: 'clone:chapter-4:qdrant.upsertPoints', caseId: 'regeneration-create-independent-task',
      method: 'PUT', endpoint: 'http://127.0.0.1:6333/collections/owned/points', error: { name: 'TypeError', message: 'fetch failed', cause: { name: 'AggregateError', errors: [{ code: 'ECONNREFUSED', syscall: 'connect', port: 6333 }] } } });
    expect(diagnostics.operations[0]).toMatchObject({ status: 'failed', error: { cause: { errors: [{ errno: '-61' }] } } });
    expect(save.mock.calls.length).toBeGreaterThan(2); expect(() => diagnostics!.assertHealthy()).toThrow('local-evidence-failed');
    await expect(globalThis.fetch('http://127.0.0.1:6333/collections')).rejects.toThrow('local-evidence-failed'); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('forwards local fetch arguments and provider calls unchanged while capturing local status without bodies or query secrets', async () => {
    const response = { status: 200 } as Response; const fetch = jest.fn().mockResolvedValue(response); globalThis.fetch = fetch as typeof globalThis.fetch;
    diagnostics = installContinuationDiagnostics({ caseId: () => 'owned', save: async () => undefined });
    const options = { method: 'POST', body: '{"original":true}', headers: { Authorization: 'Bearer secret' } };
    expect(await diagnostics.operation('local-read', () => globalThis.fetch('http://localhost:6333/collections?api_key=secret', options))).toBe(response);
    expect(fetch.mock.calls[0]).toEqual(['http://localhost:6333/collections?api_key=secret', options]);
    expect(diagnostics.fetches[0]).toMatchObject({ operation: 'local-read', status: 200, endpoint: 'http://localhost:6333/collections' });
    const providerInput = new URL('https://provider.invalid/v1/chat/completions'); expect(await globalThis.fetch(providerInput, options)).toBe(response);
    expect(fetch.mock.calls[1]).toEqual([providerInput, options]); expect(diagnostics.fetches).toHaveLength(1);
    expect(JSON.stringify(diagnostics.fetches)).not.toContain('secret'); expect(diagnostics.operations[0].status).toBe('returned');
    diagnostics.restore(); expect(globalThis.fetch).toBe(fetch);
  });
  it('does not start a socket or work after evidence persistence fails', async () => {
    const fetch = jest.fn(); globalThis.fetch = fetch as typeof globalThis.fetch;
    diagnostics = installContinuationDiagnostics({ caseId: () => 'owned', save: async () => { throw new Error('disk-full'); } });
    await expect(globalThis.fetch('http://127.0.0.1:6333/collections')).rejects.toThrow('disk-full'); expect(fetch).not.toHaveBeenCalled();
    const work = jest.fn(); await expect(diagnostics.operation('never-started', work)).rejects.toThrow('local-evidence-failed'); expect(work).not.toHaveBeenCalled();
  });
  it('keeps labels independent across concurrent local operations', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({ status: 200 }) as typeof globalThis.fetch;
    diagnostics = installContinuationDiagnostics({ caseId: () => 'owned', save: async () => undefined });
    await Promise.all(['chapter-3', 'chapter-4'].map(label => diagnostics!.operation(label, async () => { await Promise.resolve(); return globalThis.fetch(`http://localhost:6333/${label}`); })));
    expect(diagnostics.fetches.map(row => row.operation).sort()).toEqual(['chapter-3', 'chapter-4']);
  });
  it('records an operation-level non-fetch failure once and forwards its original error', async () => {
    const error = Object.assign(new Error('local fixture assertion'), { code: 'FIXTURE-FAILED' });
    diagnostics = installContinuationDiagnostics({ caseId: () => 'owned', save: async () => undefined });
    const work = jest.fn().mockRejectedValue(error); await expect(diagnostics.operation('clone:material-insert', work)).rejects.toBe(error);
    expect(work).toHaveBeenCalledTimes(1); expect(diagnostics.operations[0]).toMatchObject({ operation: 'clone:material-insert', status: 'failed', error: { code: 'FIXTURE-FAILED' } });
  });
});

describe('nested error evidence and refusal before the paid facade', () => {
  it('redacts keys, tokens and userinfo while retaining error type and bounded nested causes', () => {
    const error = new Error('api_key=private sk-verysecret https://user:password@example.invalid/v1 Bearer hidden');
    Object.assign(error, { cause: error }); const record = continuationError(error);
    expect(record.name).toBe('Error'); expect(record.cause?.message).toBe('[depth/cycle boundary]');
    expect(record.message).not.toMatch(/private|verysecret|password|hidden/); expect(record.message).toContain('[redacted]');
  });
  it('refuses a stale authority before reservation/provider entry and keeps the failed capture explicit', async () => {
    const provider = jest.fn().mockResolvedValue({ text: 'must never be returned' }); const facade = { llm: { sendConversation: provider } as unknown as LLMModule };
    const reserve = jest.fn(); const captures: PublicNativeCapture[] = [];
    const observer = installPublicObservation(facade, { configuration: { provider: 'openai', defaultModel: 'test' }, caseId: () => 'regeneration-create-independent-task',
      assertCurrent: async () => { throw new Error('prefix-drift'); }, reserve, save: async row => { captures.push(row); } });
    try {
      await expect(facade.llm.sendConversation([{ role: 'user', content: 'original' }], { model: 'test', max_completion_tokens: 8000 })).rejects.toThrow('prefix-drift');
      expect(reserve).not.toHaveBeenCalled(); expect(provider).not.toHaveBeenCalled();
      expect(captures.at(-1)).toMatchObject({ state: 'phase-refused', reservationId: null, nativeEnteredAt: null });
    } finally { observer.restore(); }
  });
});
