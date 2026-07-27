// Parameterized-question execution sandbox (PRD §2, Phase 2 Task 4). Runs an
// instructor-authored generate() script in a real worker_threads worker so a
// runaway or buggy script (infinite loop, network/fs/process access) cannot
// hang or compromise the server process. See AGENTS.md for the threat model.
import { Worker } from 'worker_threads';
import path from 'path';
import { env } from '../../config/env';

// worker.js is deliberately plain JS living at a fixed path relative to the
// repo root (not compiled TS), so this same path resolves correctly whether
// the server runs via `tsx` in dev or a compiled `dist` build in prod.
const WORKER_PATH = path.resolve(process.cwd(), 'server/src/components/param-worker/worker.js');

type WorkerMessage = { ok: true; vars: Record<string, number> } | { ok: false; error: string };

/**
 * Runs `script`'s generate(random) in a sandboxed worker thread with a
 * seeded PRNG (deterministic per seed) and resolves its `vars`. Rejects with
 * Error('param-timeout') if the script does not finish within
 * env.paramWorkerTimeoutMs, or with the script's own error otherwise.
 */
export function executeGenerate(script: string, seed: number): Promise<Record<string, number>> {
  return new Promise((resolve, reject) => {
    // Dynamic import() is a syntax construct, not an identifier, so it can't
    // be shadowed like require/process/fetch/Function are inside the worker.
    // A static text scan is a pragmatic, documented limitation (defense-in-
    // depth against accidental/casual misuse, not a zero-trust boundary —
    // see AGENTS.md) that rejects the obvious case before we even spawn a
    // worker thread.
    if (script.includes('import(')) {
      reject(new Error('generate() script must not use import()'));
      return;
    }

    const worker = new Worker(WORKER_PATH, {
      workerData: { script, seed },
      resourceLimits: { maxOldGenerationSizeMb: env.paramWorkerMemoryMb },
    });

    let settled = false;

    // Every exit path (resolve, reject, timeout) runs through here exactly
    // once, so the timer and worker/listeners never outlive this call.
    const settle = async (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.removeAllListeners();
      await worker.terminate().catch(() => {});
      fn();
    };

    const timer = setTimeout(() => {
      void settle(() => reject(new Error('param-timeout')));
    }, env.paramWorkerTimeoutMs);

    worker.once('message', (msg: WorkerMessage) => {
      void settle(() => {
        if (msg.ok) resolve(msg.vars);
        else reject(new Error(msg.error));
      });
    });

    worker.once('error', (err: Error) => {
      void settle(() => reject(err));
    });
  });
}
