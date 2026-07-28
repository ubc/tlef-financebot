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

// The mulberry32 PRNG's *source text*, not a host-scope function. It gets
// spliced into `combinedSource` below and compiled/constructed entirely
// inside the vm context — see "Fix round 4" in AGENTS.md for why this
// matters: a host-realm PRNG closure passed as `generate`'s argument was
// itself an escape route (its `.constructor` chain led back to the host's
// real `Function`/`process`), so the PRNG must never exist in host scope at
// all, not even briefly.
const MULBERRY32_SOURCE = `
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
`;

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
    // only ever reach the sandbox's own harmless intrinsics.
    const sandbox = Object.create(null);
    const context = vm.createContext(sandbox);

    // `seed` is caller-controlled (not the instructor's script), and it's
    // about to be spliced into a string that gets compiled as *code* below.
    // Coerce and validate it to a definitely-safe numeric literal BEFORE
    // interpolating: `JSON.stringify` of a finite number always produces a
    // bare numeric-literal token (e.g. "42", "-3.5"), which cannot contain
    // any script-injection surface, unlike splicing in a raw string.
    const safeSeed = Number(seed);
    if (!Number.isFinite(safeSeed)) {
      throw new Error('seed must be a finite number');
    }
    const seedLiteral = JSON.stringify(safeSeed);

    // Fix round 4: the PRNG's *construction*, the instructor script, AND the
    // call to `generate(...)` are all concatenated into ONE script and
    // compiled/run together via a single `vm.Script.runInContext()` call.
    // This is a deliberate change from fix round 3, which compiled only the
    // instructor script inside the vm context but then pulled the resulting
    // `generate` function OUT into host scope and called it FROM HOST CODE,
    // passing a host-realm `mulberry32` closure as its argument. That was
    // itself a bug, independent of realm isolation, with two live-verified
    // escapes:
    //   (a) `random.constructor(...)` reached the HOST's `Function`, because
    //       `random` (the PRNG closure) was created in worker.js's own host
    //       scope, not inside the vm context.
    //   (b) Calling `generate(...)` FROM A HOST STACK FRAME put host JS
    //       frames on the live call stack at the moment `generate`'s body
    //       ran. Installing `Error.prepareStackTrace` and walking
    //       `new Error().stack` handed the sandboxed script raw `CallSite`
    //       objects for those host frames; `.getThis()`/`.getFunction()` on
    //       a frame that is a DIRECT JS-to-JS call across the realm boundary
    //       returns the real host object, whose constructor chain reaches
    //       the host `Function` → real `process`. (This works even when
    //       `generate()` never touches its `random` argument at all.)
    //
    // Both routes share one root cause: a direct JS call crossing the realm
    // boundary, either as an argument or as the call itself. Experimentally
    // confirmed (throwaway script, see task-4-report.md "Fix round 4"): V8's
    // `CallSite.getThis()`/`getFunction()` DO leak the real host object when
    // host code calls a vm-realm function directly — but return `undefined`
    // for any frame on the far side of the *native* `vm.Script.runInContext`
    // boundary. So as long as `generate(...)` is invoked by code that is
    // ITSELF running inside the compiled vm script (never by host code
    // holding a reference to it, and never with a host-realm object passed
    // as an argument), no direct JS-to-JS call ever crosses the boundary —
    // every crossing goes through the native `runInContext` trampoline,
    // which CallSite cannot see through. This closes both escapes
    // structurally, not by patching either one individually.
    const combinedSource = [
      MULBERRY32_SOURCE,
      scriptSource,
      "if (typeof generate !== 'function') { throw new Error('script must define generate()'); }",
      `generate(mulberry32(${seedLiteral}));`,
    ].join('\n');

    let compiled;
    try {
      compiled = new vm.Script(combinedSource, { filename: 'generate.js' });
    } catch (err) {
      throw new Error(`generate() script has a syntax error: ${err && err.message ? err.message : err}`, { cause: err });
    }

    // vm's own `timeout` now guards the ENTIRE combined script, including the
    // synchronous portion of the `generate(...)` call itself (an improvement
    // over fix round 3, where vm's inner timeout covered only the top-level
    // script evaluation and NOT the later, separately-invoked call to
    // `generate`). It still cannot cover work that only happens after
    // `runInContext` has returned (e.g. a `generate()` that returns a Promise
    // whose `.then` continuation loops forever) — the outer `index.ts`
    // timeout / `worker.terminate()` remains the real backstop for that case:
    // `worker.terminate()` is called from the parent thread and forcibly
    // kills this worker's isolate regardless of what this thread is
    // synchronously or asynchronously stuck doing.
    //
    // The value returned here is the result of `generate(...)`, since it's
    // the last statement of the combined script and `vm.Script.runInContext`
    // returns the value of the last evaluated expression. If `generate(...)`
    // returns a Promise (e.g. from a `vm`-caught dynamic `import()` or any
    // other async work), `result` here is that Promise, still owned by the
    // vm context's own realm; `await`-ing it below reads its settled value
    // as plain data (or propagates its rejection) without ever calling back
    // into vm-context code from a new host call site — this is a value read,
    // not a call, so it does not reopen the CallSite/argument routes above.
    const result = await compiled.runInContext(context, { timeout: timeoutMs });
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
