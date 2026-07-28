/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
// Sandbox worker: evaluates an instructor generate() script inside a genuinely
// separate vm.createContext() realm, with a seeded PRNG. Resource limits are
// enforced by the parent via worker_threads resourceLimits + terminate-on-
// timeout. Plain JS on purpose — see AGENTS.md.
const { parentPort, workerData } = require('worker_threads');
const vm = require('vm');

// `parentPort`/`workerData` are referenced only here, in worker.js's own
// top-level (host) scope. They are never passed into the vm sandbox, so the
// evaluated script can never reach them, even indirectly.

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The whole body runs inside an async IIFE so that a `generate()` which
// returns a Promise (e.g. one whose body evaluates a rejected `import(...)`
// — vm's dynamic-import rejection is asynchronous, not a synchronous throw,
// even when the script never explicitly awaits it) is properly awaited
// instead of being left as an unhandled rejection inside the worker thread.
(async () => {
  try {
    const { script: scriptSource, seed, timeoutMs } = workerData;

    // Create a genuinely separate realm. `vm.createContext()` gives the
    // sandbox object its OWN, freshly-created ECMAScript intrinsics — its own
    // `Object`, `Array`, `Function`, `Math`, `JSON`, `Date`, `RegExp`,
    // `Promise`, etc. — distinct from the worker thread's own globals. None of
    // Node's platform additions (`process`, `require`, `fetch`, `Buffer`,
    // `setTimeout`, `module`, `exports`, `__dirname`, `__filename`,
    // `globalThis` pointing at the real global, ...) are copied in. This is
    // the structural fix (see AGENTS.md): because the sandbox's `Function` is
    // the *context's own* Function, not the host's, any constructor-chain
    // trick a script tries — `[].constructor.constructor("return
    // process")()`, `({}).constructor.constructor(...)`, `Function(...)`,
    // indirect `eval`, or any other route to "the global Function/eval" — can
    // only ever reach the sandbox's own harmless intrinsics. There is no
    // identifier list to maintain and no way to forget one, because nothing
    // dangerous was ever reachable from inside the realm to begin with.
    const sandbox = Object.create(null);
    const context = vm.createContext(sandbox);

    let compiled;
    try {
      compiled = new vm.Script(scriptSource, { filename: 'generate.js' });
    } catch (err) {
      throw new Error(`generate() script has a syntax error: ${err && err.message ? err.message : err}`, { cause: err });
    }

    // vm's own `timeout` guards this synchronous run — e.g. a top-level
    // infinite loop that runs *while the script text itself is being
    // evaluated* (before `generate` is even defined) is killed here, cleanly,
    // without needing to wait for the outer worker-level timeout. It does NOT
    // cover a later call to the `generate` function retrieved below — that
    // call happens outside this vm.Script.runInContext invocation entirely, so
    // a `generate(random) { while(true){} }` body can still hang forever from
    // vm's point of view. The outer `index.ts` timeout / `worker.terminate()`
    // is the real backstop for that case: `worker.terminate()` is called from
    // the parent thread and forcibly kills this worker's isolate regardless of
    // what this thread is synchronously stuck doing, so it works even though
    // vm's inner timeout can't see it.
    compiled.runInContext(context, { timeout: timeoutMs });

    // Top-level `function generate(random) {...}` declarations executed via
    // `vm.Script.runInContext` attach as properties of the context object,
    // exactly as they would attach to `globalThis` in a real environment —
    // verified experimentally, not assumed. `context` and `sandbox` refer to
    // the same (contextified) object, so either reference works; `context` is
    // used below for clarity that we're deliberately pulling this out of the
    // sandboxed realm.
    const generate = context.generate;
    if (typeof generate !== 'function') throw new Error('script must define generate()');

    // This call happens in worker.js's own host scope, but `generate`'s BODY
    // still executes against the vm context's own globals, because that's the
    // realm it was defined in — this is the whole point of the fix, and it's
    // exactly what closes the constructor-chain escape: even though the call
    // site here is host code, `[].constructor` inside the function body still
    // resolves to the context's own Array.prototype/Function, not the host's.
    // `await` here also ensures a `generate()` that returns a rejected
    // Promise (e.g. from a `vm`-caught dynamic `import()`) surfaces as a
    // clean rejection instead of an unhandled-rejection in this thread.
    const result = await generate(mulberry32(seed));
    const vars = result && typeof result === 'object' && result.vars ? result.vars : null;
    if (!vars) throw new Error('generate() must return { vars: { ... } }');
    for (const [k, v] of Object.entries(vars)) {
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`vars.${k} is not a finite number`);
    }
    parentPort.postMessage({ ok: true, vars });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: String(err && err.message ? err.message : err) });
  }
})();
