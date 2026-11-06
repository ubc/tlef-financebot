import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { VISUAL_LIMITS } from './signals';

export interface ChildLimits { timeoutMs: number; outputBytes: number }
/** No shell, bounded runtime and both output streams; Node heap is separately
 * capped by the caller. A killed worker never supplies partial trusted JSON. */
export function runBoundedChild(binary: string, args: string[], limits: ChildLimits = {
  timeoutMs: VISUAL_LIMITS.workerTimeoutMs, outputBytes: VISUAL_LIMITS.workerOutputBytes,
}): Promise<{ stdout: string; stderr: string }> {
  assert(Number.isSafeInteger(limits.timeoutMs) && limits.timeoutMs > 0 && limits.timeoutMs <= VISUAL_LIMITS.workerTimeoutMs, 'visual-worker-timeout-cap');
  assert(Number.isSafeInteger(limits.outputBytes) && limits.outputBytes > 0 && limits.outputBytes <= VISUAL_LIMITS.workerOutputBytes, 'visual-worker-output-cap');
  return new Promise((resolve, reject) => {
    execFile(binary, args, { timeout: limits.timeoutMs, maxBuffer: limits.outputBytes, encoding: 'utf8', killSignal: 'SIGKILL', windowsHide: true },
      (error, stdout, stderr) => {
        if (error) reject(new Error(`visual-worker-failed:${error.code ?? 'unknown'}:${error.killed ? 'killed' : 'exited'}:${stderr.slice(-1000)}`));
        else resolve({ stdout, stderr });
      });
  });
}

export async function mapBounded<T, U>(values: T[], concurrency: number, operation: (value: T, index: number) => Promise<U>): Promise<U[]> {
  assert(Number.isSafeInteger(concurrency) && concurrency > 0 && concurrency <= VISUAL_LIMITS.concurrency, 'visual-concurrency-cap');
  const output: U[] = new Array(values.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) { const index = cursor++; output[index] = await operation(values[index], index); }
  }));
  return output;
}
