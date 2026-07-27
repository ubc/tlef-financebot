// Sandbox worker: evaluates an instructor generate() script with a scrubbed
// scope and a seeded PRNG. Resource limits are enforced by the parent via
// worker_threads resourceLimits + terminate-on-timeout. Plain JS on purpose —
// see AGENTS.md.
const { parentPort, workerData } = require('worker_threads');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

try {
  const { script, seed } = workerData;
  // Shadow every escape hatch the script could reach lexically.
  const evaluator = new Function(
    'require', 'process', 'fetch', 'globalThis', 'module', 'exports', '__dirname', '__filename',
    `"use strict"; ${script}; if (typeof generate !== 'function') throw new Error('script must define generate()'); return generate;`,
  );
  const generate = evaluator(undefined, undefined, undefined, {}, undefined, undefined, undefined, undefined);
  const result = generate(mulberry32(seed));
  const vars = result && typeof result === 'object' && result.vars ? result.vars : null;
  if (!vars) throw new Error('generate() must return { vars: { ... } }');
  for (const [k, v] of Object.entries(vars)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`vars.${k} is not a finite number`);
  }
  parentPort.postMessage({ ok: true, vars });
} catch (err) {
  parentPort.postMessage({ ok: false, error: String(err && err.message ? err.message : err) });
}
