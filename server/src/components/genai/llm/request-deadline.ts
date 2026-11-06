export const DEFAULT_LLM_REQUEST_TIMEOUT_MS = 180_000;

export class ModelCallTimeoutError extends Error {
  readonly code = 'model-call-timeout';

  constructor(readonly timeoutMs: number) {
    super(`Model request exceeded its ${timeoutMs} ms deadline.`);
    this.name = 'ModelCallTimeoutError';
  }
}

/** One deadline for headers, SDK retries, and every streamed chunk. */
export function createRequestDeadline(timeoutMs: number) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    throw new Error('LLM_REQUEST_TIMEOUT_MS must be a positive timer-safe integer.');
  }
  const controller = new AbortController();
  const error = new ModelCallTimeoutError(timeoutMs);
  const expiresAt = Date.now() + timeoutMs;
  let expired = false;
  const expire = () => { expired = true; controller.abort(error); };
  const timer = setTimeout(expire, timeoutMs);
  const check = () => {
    if (!expired && Date.now() >= expiresAt) expire();
    if (expired) throw error;
  };
  return {
    signal: controller.signal,
    check,
    // Also settles clients/iterators that fail to honor AbortSignal. Late
    // resolution or rejection is consumed, without resuming the caller.
    wait<T>(operation: () => PromiseLike<T>): Promise<T> {
      check();
      return new Promise<T>((resolve, reject) => {
        const abort = () => reject(error);
        controller.signal.addEventListener('abort', abort, { once: true });
        const cleanup = () => controller.signal.removeEventListener('abort', abort);
        const rejectFailure = (failure: unknown) => {
          cleanup();
          try { check(); reject(failure); } catch (deadline) { reject(deadline); }
        };
        try {
          Promise.resolve(operation()).then(value => {
            cleanup();
            try { check(); resolve(value); } catch (failure) { reject(failure); }
          }, rejectFailure);
        } catch (failure) { rejectFailure(failure); }
      });
    },
    dispose(abortRequest = false) {
      clearTimeout(timer);
      if (abortRequest) controller.abort();
    },
  };
}
