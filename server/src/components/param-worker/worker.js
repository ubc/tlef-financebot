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
    // Fix round 6: the error/throw path is the mirror of round 5's success
    // path, and had the exact same bug class. When the vm script threw — a
    // `generate()` that `throw`s, a malformed return, a syntax-free runtime
    // error, anything — `runInContext()` propagated the thrown VALUE (which
    // the instructor script fully controls: `throw { get message() {...} }`)
    // back into host `worker.js` scope as a real exception. The host `catch`
    // then did `String(err && err.message ? err.message : err)` — a
    // HOST-scope property read (`err.message`) of a vm-realm object, plus a
    // `String(err)` that invokes its `toString`/`Symbol.toPrimitive`. If
    // `.message` (or `toString`) is a getter, that getter body ran as
    // vm-realm code with a HOST stack frame (the catch block) live on the
    // stack — structurally identical to Escape B and the round-5 result-read
    // bug, just on the throw path. It was live-verified as full RCE (real
    // `process.pid`, `child_process.execSync('whoami')`, `process.env`
    // exfiltration), returned disguised as the thrown object's `.message`.
    //
    // The fix is the same structural move rounds 4 and 5 made for the
    // call-in and result-read directions, applied to the throw direction:
    // NOTHING that a malicious script can influence is ever thrown across the
    // native `runInContext` boundary. The whole thing — the instructor
    // script's own evaluation, the `generate(...)` call, result validation,
    // serialization, AND error-to-string conversion — runs inside one async
    // IIFE wrapped in a single try/catch. The IIFE ALWAYS resolves to a
    // plain string: a discriminated JSON envelope, `{ok:true,vars}` on
    // success or `{ok:false,error}` on failure. The error message is
    // stringified INSIDE the vm (where any `.message`/`toString` getter fires
    // with only vm-realm frames on the stack — the same reason round 5's
    // `__rawVars[__k]` reads are safe), so the only thing crossing back to
    // host code is, once again, a primitive string that host code
    // `JSON.parse`s. Host code never reads a property off a vm-realm object
    // on the throw path any more than it does on the success path.
    //
    // The instructor script is spliced INSIDE the try (not at top level
    // before the IIFE as in rounds 4/5) precisely so that a top-level throw
    // during the script's own evaluation is caught here too, not propagated
    // to host scope. `function generate` still hoists and is callable from
    // the following lines.
    const combinedSource = [
      MULBERRY32_SOURCE,
      `
      (async () => {
        // Fix round 7: capture private references to every intrinsic the
        // harness's OWN code below depends on for its own control-flow and
        // serialization, BEFORE the instructor script (spliced in just below
        // this line) gets any chance to run. The instructor script executes
        // in this SAME vm realm as the harness's post-generate() code — a
        // realm whose global \`JSON\`, \`Object\`, \`Number\`, \`String\` etc the
        // harness itself also reads by their bare global names. A malicious
        // script can simply reassign \`JSON.stringify = function(){ throw
        // {get message(){...leak...}} }\` at its own top level, before
        // \`generate()\` is even called. If the harness later calls the BARE
        // \`JSON.stringify\` name for its own success/error envelope, it
        // invokes the SCRIPT's tampered version instead of the real one —
        // which can throw a value whose \`.message\` getter leaks the host
        // once that throw escapes far enough (see the outer runInContext
        // catch below for why that matters even so). Capturing these
        // references into local variables HERE — before scriptSource has
        // executed a single statement — means the harness's own code always
        // uses the ORIGINAL, real intrinsics, no matter what the instructor
        // script does to the realm's globals afterward.
        var __origStringify = JSON.stringify;
        var __origObjectKeys = Object.keys;
        var __origObjectCreate = Object.create;
        var __origIsFinite = Number.isFinite;
        var __origString = String;
        try {
      `,
      scriptSource,
      `
          if (typeof generate !== 'function') { throw new Error('script must define generate()'); }
          var __result = await generate(mulberry32(${seedLiteral}));
          var __rawVars = __result && typeof __result === 'object' && __result.vars ? __result.vars : null;
          if (!__rawVars) throw new Error('generate() must return { vars: { ... } }');
          var __vars = __origObjectCreate(null);
          var __keys = __origObjectKeys(__rawVars);
          for (var __i = 0; __i < __keys.length; __i++) {
            var __k = __keys[__i];
            var __v = __rawVars[__k];
            if (typeof __v !== 'number' || !__origIsFinite(__v)) {
              throw new Error('vars.' + __k + ' is not a finite number');
            }
            __vars[__k] = __v;
          }
          return __origStringify({ ok: true, vars: __vars });
        } catch (__e) {
          // Stringify the (possibly malicious) thrown value entirely inside
          // the vm, so any getter/toString trap on it runs with only
          // vm-realm frames live — never a host frame. Only the resulting
          // plain string leaves the vm. Uses the captured __origString, not
          // the bare (possibly-tampered) global.
          var __msg;
          try {
            __msg = (__e && typeof __e === 'object' && typeof __e.message === 'string')
              ? __e.message
              : __origString(__e);
          } catch (__inner) {
            __msg = 'generate() script error';
          }
          if (typeof __msg !== 'string') __msg = 'generate() script error';
          return __origStringify({ ok: false, error: __msg });
        }
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
    let result;
    try {
      result = await compiled.runInContext(context, { timeout: timeoutMs });
    } catch {
      // Fix round 7 (primary/structural fix): this catch exists only as a
      // backstop for the case where something got past the vm IIFE's own
      // internal try/catch above — by design that should never happen once
      // the in-vm envelope logic (and the captured-intrinsics defense above)
      // is solid, but "should never happen" is exactly the assumption round
      // 6's bug violated. If it IS ever reached, the caught value is a value
      // that crossed the native runInContext boundary as a real
      // rejection/throw, and an instructor script that corrupted realm
      // intrinsics (e.g. reassigning JSON.stringify so the vm IIFE's OWN
      // envelope-building call throws a `{get message(){...}}` trap, which
      // then escapes because that second throw isn't caught by anything
      // further) fully controls its shape and its properties. Reading ANY
      // property off it here — `.message`, `.toString()`, template-literal
      // coercion, `String(err)`, anything — would run vm-realm getter/trap
      // code with THIS host catch frame live on the stack, which is exactly
      // how round 6's fix was defeated (see AGENTS.md "Fix round 7"). So
      // this catch deliberately does not even bind the caught value to a
      // name — there is no way to inspect it if there is no reference to
      // it. It always reports one fixed, hardcoded, generic string,
      // regardless of what the script managed to make this rejection
      // contain.
      parentPort.postMessage({
        ok: false,
        error: 'param-worker: script execution failed unexpectedly',
      });
      return;
    }
    if (typeof result !== 'string') {
      // Should be unreachable — the vm script's own IIFE always resolves to
      // a JSON string (a `{ok:...}` envelope) or, in the pathological case
      // of a splice-breakout, could reject; either way host code never reads
      // a property off a vm-realm object here.
      throw new Error('generate() must return { vars: { ... } }');
    }
    // `envelope` is the product of `JSON.parse` on a primitive string — a
    // brand-new HOST-realm plain object. Reading `.ok`/`.vars`/`.error` off
    // it is a host-scope read of a host object, not of a vm-realm object, so
    // no vm-realm getter/trap can fire on a host frame here (fix round 6).
    let envelope;
    try {
      envelope = JSON.parse(result);
    } catch (err) {
      throw new Error('generate() must return { vars: { ... } }', { cause: err });
    }
    if (!envelope || typeof envelope !== 'object') {
      throw new Error('generate() must return { vars: { ... } }');
    }
    if (envelope.ok === true) {
      const vars = envelope.vars;
      if (!vars || typeof vars !== 'object') {
        throw new Error('generate() must return { vars: { ... } }');
      }
      parentPort.postMessage({ ok: true, vars });
    } else {
      const error = typeof envelope.error === 'string' ? envelope.error : 'generate() script error';
      parentPort.postMessage({ ok: false, error });
    }
  } catch (err) {
    // Reached only for HOST-realm failures: a compile-time SyntaxError from
    // `new vm.Script(...)`, a `JSON.parse` failure, or one of the host-side
    // `throw new Error(...)` checks above. All of these are host-created
    // Error objects with plain-string `.message` (no attacker-controlled
    // getter), so reading `.message` here is safe — unlike a value thrown
    // by the sandboxed script, which can no longer reach this catch because
    // the vm IIFE converts it to a string envelope internally (fix round 6).
    parentPort.postMessage({ ok: false, error: String(err && err.message ? err.message : err) });
  }
})();
