import type { CompleteJsonOptions } from '../../server/src/components/genai/llm';
import type { JsonCompletion } from './protocol';

/** Serialize only the local before-dispatch evidence/ledger critical section.
 * Provider requests retain production parallelism. Other processes still fail
 * closed on the shared ledger lock rather than silently competing. */
export function serializeAdmission(complete: JsonCompletion): JsonCompletion {
  let pending = Promise.resolve();
  return <T>(prompt: string, options: CompleteJsonOptions = {}): Promise<T> => complete<T>(prompt, { ...options,
    beforeRequest: admission => {
      const previous = pending;
      let release: () => void = () => undefined;
      pending = new Promise<void>(resolve => { release = resolve; });
      return previous.then(() => options.beforeRequest?.(admission)).finally(release);
    },
  });
}
