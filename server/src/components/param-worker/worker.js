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
    //
    // Fix round 5: everything from here down — reading `result.vars`,
    // validating each value is a finite number, and turning the validated
    // data into the thing that ultimately crosses back to host code — used
    // to happen in `worker.js`'s HOST scope, immediately after
    // `runInContext()` returned. That reopened the exact bug class fix
    // round 4 closed, just on the RETURN path instead of the CALL-IN path:
    // `result.vars` and `Object.entries(vars)` are direct host-scope
    // property reads on a vm-realm object. If `generate()` returns an
    // object whose `vars` (or a property/getter on it) is an accessor or a
    // Proxy trap, that getter/trap body runs as VM-REALM CODE — but with a
    // HOST stack frame (the frame doing `result.vars`) live on the call
    // stack at the moment it runs. Exactly like Escape B, that getter can
    // install `Error.prepareStackTrace`, walk `.stack`, and get a real
    // `CallSite` for the host frame, whose `.getThis()`/`.getFunction()`
    // hands back the actual host object — full RCE again, just triggered by
    // a property READ instead of a CALL.
    //
    // The fix is the same structural move as round 4, applied to the other
    // direction: do the validation and serialization *inside* the vm
    // script, so any getter/Proxy trap on a malicious `vars` fires while
    // only vm-realm frames are on the stack, and have the script's last
    // expression be a plain **string** (`JSON.stringify(...)`). A string is
    // a primitive, not an object — there is no property to read on it that
    // could trigger sandboxed code, so the crossing back to host scope is
    // no longer a property read on a vm-realm object at all.
    //
    // The freshly-copied-object step (iterating `Object.keys(rawVars)` and
    // copying each value into a brand-new `Object.create(null)` object
    // BEFORE stringifying) matters too: `JSON.stringify` run directly on a
    // malicious object can itself trigger a `toJSON`/getter/Proxy trap
    // during its own internal enumeration. Stringifying a fresh, known-
    // plain object instead means `JSON.stringify` only ever walks data this
    // script itself just built.
    // The whole validation/serialization step is wrapped in its own async
    // IIFE, still spliced into the SAME combined script (still vm-realm
    // code, still inside the one `runInContext` call): `generate(...)` may
    // itself be async or return a Promise (see the pre-existing
    // "async generate()" test), so its result must be `await`-ed BEFORE
    // validating — and that `await` must happen from a vm-realm stack
    // frame, not a host one, for the same reason the call to `generate`
    // itself must. `runInContext` then returns this IIFE's own Promise
    // (still a vm-realm object at that instant); by the time host code
    // `await`s it below, it has already settled to a plain string, because
    // every step that touches `__result`/`__rawVars` ran to completion
    // inside the vm. Awaiting an already-vm-settled Promise from host scope
    // is the same value-read (not a call) that fix round 4 already
    // established as safe.
    const combinedSource = [
      MULBERRY32_SOURCE,
      scriptSource,
      "if (typeof generate !== 'function') { throw new Error('script must define generate()'); }",
      `
      (async () => {
        var __result = await generate(mulberry32(${seedLiteral}));
        var __rawVars = __result && typeof __result === 'object' && __result.vars ? __result.vars : null;
        if (!__rawVars) throw new Error('generate() must return { vars: { ... } }');
        var __vars = Object.create(null);
        var __keys = Object.keys(__rawVars);
        for (var __i = 0; __i < __keys.length; __i++) {
          var __k = __keys[__i];
          var __v = __rawVars[__k];
          if (typeof __v !== 'number' || !Number.isFinite(__v)) {
            throw new Error('vars.' + __k + ' is not a finite number');
          }
          __vars[__k] = __v;
        }
        return JSON.stringify(__vars);
      })();
      `,
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
    // `result` here is whatever the combined script's async IIFE resolves
    // to. Fix round 5: that is now ALWAYS a plain string primitive (the
    // JSON-serialized, validated `vars`), never a vm-realm object — the
    // IIFE above did the `result.vars` read, the per-value numeric
    // validation, and the `JSON.stringify` entirely inside the vm, with
    // only vm-realm frames on the stack. Host code below therefore never
    // reads a property off a vm-realm object; it only ever touches a
    // primitive string (via `JSON.parse`) and the plain data that parses
    // out of it. This closes the read-back mirror of Escape B: there is no
    // longer any host-scope property read (`result.vars`,
    // `Object.entries(vars)`, ...) that a malicious getter/Proxy trap on
    // the sandboxed return value could hijack, because no such property
    // read happens in host scope anymore.
    const result = await compiled.runInContext(context, { timeout: timeoutMs });
    if (typeof result !== 'string') {
      // Should be unreachable — the vm script's own IIFE always resolves to
      // a JSON string or throws. Treated as the same class of failure as a
      // malformed script, not distinguished further.
      throw new Error('generate() must return { vars: { ... } }');
    }
    let vars;
    try {
      vars = JSON.parse(result);
    } catch (err) {
      throw new Error('generate() must return { vars: { ... } }', { cause: err });
    }
    if (!vars || typeof vars !== 'object') throw new Error('generate() must return { vars: { ... } }');
    parentPort.postMessage({ ok: true, vars });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: String(err && err.message ? err.message : err) });
  }
})();
