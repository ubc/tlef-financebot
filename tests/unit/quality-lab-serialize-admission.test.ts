import type { CompleteJsonOptions } from '../../server/src/components/genai/llm';
import type { JsonCompletion } from '../../scripts/quality-lab/protocol';
import { serializeAdmission } from '../../scripts/quality-lab/serialize-admission';

it('serializes concurrent ledger hooks while leaving provider work concurrent, including correction sends', async () => {
  let hookActive = 0; let maxHookActive = 0; let providerActive = 0; let maxProviderActive = 0;
  const execution: string[] = [];
  let releaseProvider: () => void = () => undefined;
  const providerGate = new Promise<void>(resolve => { releaseProvider = resolve; });
  const complete: JsonCompletion = async <T>(prompt: string, options: CompleteJsonOptions = {}) => {
    await options.beforeRequest?.(); providerActive++; maxProviderActive = Math.max(maxProviderActive, providerActive);
    execution.push(prompt); if (providerActive === 2) releaseProvider(); await providerGate;
    providerActive--; await options.beforeRequest?.(); return {} as T;
  };
  const serialized = serializeAdmission(complete);
  const hook = async () => { hookActive++; maxHookActive = Math.max(maxHookActive, hookActive); await Promise.resolve(); hookActive--; };
  await Promise.all([serialized('left', { beforeRequest: hook }), serialized('right', { beforeRequest: hook })]);
  expect(maxHookActive).toBe(1); expect(maxProviderActive).toBe(2); expect(execution).toEqual(['left', 'right']);
});

it('releases the local queue after an admission failure without swallowing the failure', async () => {
  const complete: JsonCompletion = async <T>(_prompt: string, options: CompleteJsonOptions = {}) => { await options.beforeRequest?.(); return {} as T; };
  const serialized = serializeAdmission(complete);
  await expect(serialized('failed', { beforeRequest: async () => { throw new Error('denied'); } })).rejects.toThrow('denied');
  await expect(serialized('next', { beforeRequest: async () => undefined })).resolves.toEqual({});
});
