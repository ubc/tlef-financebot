/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
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
  // Shadow every escape hatch the script could reach lexically. `Function`
  // itself must be shadowed too — otherwise a script can do
  // `Function('return process')()` to build a brand-new Function whose body
  // runs in the worker's real global scope, bypassing every other shadow.
  // `eval` must be shadowed too — a *direct* `eval("process")` call resolves
  // to this shadowed local, but per the ECMAScript spec any *indirect* call
  // (e.g. `const g = eval; g("process")` or `(0, eval)("process")`) always
  // executes in the global scope regardless of strict mode and cannot be
  // intercepted any other way — shadowing the `eval` identifier itself is
  // the only way to stop a script from ever obtaining the real, global eval
  // (see AGENTS.md threat model).
  // Note on structure: `eval` (like `arguments`) can never be a parameter
  // name of a function whose own body is strict — that's a hard
  // ECMAScript syntax restriction, not a stylistic choice — so the
  // `"use strict"` directive can't sit at the top of *this* outer
  // function's body the way it did before `eval` was added to the
  // parameter list. Instead the outer function (sloppy, but does nothing
  // except hold the shadowed parameters) immediately returns an inner
  // IIFE that opts into `"use strict"` and contains the actual script.
  // The inner IIFE has its own `arguments` object, so it never exposes
  // the outer function's — and referencing (not binding) `eval` from
  // strict code is perfectly legal, so the script's lookup of `eval`
  // still resolves to the outer shadowed parameter.
  const evaluator = new Function(
    'require', 'process', 'fetch', 'globalThis', 'module', 'exports', '__dirname', '__filename', 'Function', 'eval',
    `return (function () {
      "use strict";
      ${script}
      if (typeof generate !== 'function') throw new Error('script must define generate()');
      return generate;
    })();`,
  );
  const generate = evaluator(undefined, undefined, undefined, {}, undefined, undefined, undefined, undefined, undefined, undefined);
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
