# AGENTS.md — components/param-worker

Runs an instructor-authored PrairieLearn-style `generate(random)` script (PRD
§2, Phase 2 Task 4) in a real `worker_threads` worker, with a hard timeout, a
memory cap, and no network / filesystem / process access.

## Threat model

Scripts come from **instructor-trusted content** — an instructor with
course-authoring access, not an arbitrary untrusted internet user. This is
**not** a zero-trust sandbox for hostile input. Its job is:

- **Defend against accidents.** An instructor's script with an infinite loop,
  a runaway allocation, or a typo that throws should not hang or crash the
  server process, and should fail cleanly for that one question.
- **Defense-in-depth against a compromised/malicious instructor account.**
  Course-authoring access is a real privilege boundary (SAML-authenticated,
  role-gated), but it's still a lower trust tier than server-operator code.

### Why this is `vm.createContext()`, not identifier shadowing (fix round 3)

Two earlier rounds of this component evaluated the script via `new
Function(...)`, passing `require`, `process`, `fetch`, `globalThis`,
`module`, `exports`, `Function`, and `eval` as parameter names bound to
`undefined`, hoping to shadow every dangerous identifier the script's
top-level code could reference. **A third review round live-verified this
was fully broken as a security boundary**, independent of which identifiers
got shadowed: `new Function(...)` runs the compiled function in the *same JS
realm* as the worker thread. Any built-in value reachable from the
script — `[]`, `{}`, a string literal, `Math`, anything — has a
`.constructor` (its constructor function) whose own `.constructor` is that
realm's real, unshadowed `Function` constructor, reachable purely through
*property access*, which no identifier shadow can intercept:

```js
[].constructor.constructor("return process")()
```

This is not a variant of the `Function`/`eval` escapes those rounds already
fixed — it never references the identifiers `Function` or `eval` at all, so
shadowing them (correctly, exhaustively) does nothing. It was live-verified
as full RCE: arbitrary file read/write via
`process.getBuiltinModule('fs')`, command execution via
`child_process.execSync`, and environment-variable exfiltration. Identifier
shadowing cannot structurally close this bug class, because the escape
route is a value, not a name — no matter how many dangerous identifiers get
enumerated and shadowed, the *same-realm* `Function` constructor stays
reachable through any object's prototype chain.

**The fix is `vm.createContext()`**, which runs the script in a genuinely
separate V8 context — its own realm, with its own freshly-created
`Object`/`Array`/`Function`/`Math`/`JSON`/`Date`/`RegExp`/`Promise`/etc.,
distinct from the worker thread's. None of Node's platform additions
(`process`, `require`, `fetch`, `Buffer`, `setTimeout`, `module`, `exports`,
`__dirname`, `__filename`, or a `globalThis` pointing at the real global)
are copied into the sandbox object passed to `vm.createContext()`. This
closes the bug class **structurally**, not by enumeration: `[].constructor`
inside the vm context is the *context's own* `Array.prototype.constructor`,
so `.constructor.constructor` resolves to the context's own `Function` —
which has never seen `process`, `require`, or anything else Node-specific,
because those were never in this realm to begin with. There is no
identifier list to get right, forget an entry from, or have a future
reviewer find a fourth bypass of, because nothing dangerous is reachable
from inside the realm in the first place — not by name, and not by
property access.

Concretely, inside the vm context, `[].constructor.constructor("return
process")()` still runs (it's a self-contained expression, not blocked
syntactically) — but the `Function` it constructs and the code it evaluates
are of the vm context's own realm, so `process` inside that returned
function is simply not defined (`ReferenceError: process is not defined`),
same as any other undeclared free variable would be in a fresh, empty
global scope. This was re-verified live (see "Fix round 3" in
`.superpowers/sdd/task-4-report.md`).

### Why `generate()` is called entirely INSIDE the vm context, never from host code (fix round 4)

Round 3's `vm.createContext()` rewrite closed every *lexical* escape route —
but a **fourth review round live-verified two more independent, full-RCE
escapes**, both caused by a bug in *how the script's `generate` function was
invoked*, not by any gap in realm isolation itself. The round-3
implementation compiled the script inside the vm context, then pulled the
resulting `generate` function reference OUT into `worker.js`'s own host
scope and called it FROM THERE, passing a host-realm `mulberry32` PRNG
closure as its argument:

```js
// The round-3 pattern — looks safe, was not:
const generate = context.generate;          // pulled into host scope
const result = await generate(mulberry32(seed)); // called FROM host scope,
                                                   // with a HOST object as
                                                   // the argument
```

This reopened two escapes:

- **Escape A — host argument's constructor chain.** `mulberry32(seed)` ran
  in `worker.js`'s own host scope, so the `random` function passed into
  `generate` was itself a host-realm object. `random.constructor` (or
  `random.constructor.constructor(...)`) resolved to the HOST's real
  `Function`, not the vm context's — live-verified full RCE (env
  exfiltration, arbitrary file read/write via
  `process.getBuiltinModule('fs')`, shell exec via
  `child_process.execSync`).
- **Escape B — `Error.prepareStackTrace` cross-realm `CallSite` leak.**
  Because `generate(...)` was CALLED from a host stack frame, the live call
  stack at the moment `generate`'s body ran contained a host JS frame (the
  one that called it). Installing `Error.prepareStackTrace = (e, frames) =>
  frames` and reading `.stack` handed the sandboxed script raw `CallSite`
  objects for that frame; V8's `CallSite.getThis()` / `getFunction()`
  return the *real* host object for a frame reached by a **direct JS-to-JS
  call across the realm boundary** — walking its constructor chain reached
  the host `Function` → real `process`. This worked even for a `generate()`
  that never touched its `random` argument at all, so fixing Escape A alone
  would not have closed it.

Both escapes share one root cause: a **direct JS call crossing the realm
boundary**, either as a call argument (A) or as the call itself (B).
Live-verified experimentally (throwaway script against `vm.createContext`/
`vm.Script`, see "Fix round 4" in `.superpowers/sdd/task-4-report.md`): V8's
`CallSite.getThis()`/`getFunction()` genuinely do leak the real host object
when host code calls a vm-realm function directly — but return `undefined`
for any frame on the far side of the *native* `vm.Script.runInContext`
boundary. In other words, the boundary that blocks cross-realm `CallSite`
introspection is the native embedder call itself, not "realm-ness" in the
abstract.

**The fix**: the PRNG's construction, the instructor's script, and the call
to `generate(...)` are now all concatenated into ONE script string and
compiled/executed together via a single `vm.Script.runInContext()` call
(`worker.js`). Concretely:

```js
const combinedSource = [
  MULBERRY32_SOURCE,     // PRNG source text, spliced in — never a host-scope closure
  scriptSource,           // the instructor's script, verbatim
  "if (typeof generate !== 'function') { throw new Error('script must define generate()'); }",
  `generate(mulberry32(${seedLiteral}));`, // seedLiteral: a validated, JSON.stringify'd finite number
].join('\n');

const result = await compiled.runInContext(context, { timeout: timeoutMs });
```

`generate` is never extracted into host scope, `mulberry32` is never
constructed in host scope, and no host-realm object is ever passed as an
argument to sandboxed code. Every crossing of the realm boundary — from the
moment `runInContext` is called to the moment it returns a plain result
value — goes through the native `vm.Script.runInContext` trampoline, which
`CallSite` cannot see through. This closes both Escape A (no host object is
ever reachable as an argument) and Escape B (no direct JS-to-JS call ever
crosses the boundary, so no host frame is ever visible on the stack while
sandboxed code runs) structurally, not by patching either one individually.
Re-verified live, including an async-`generate()`-that-awaits-before-
walking-the-stack variant of Escape B (see task-4-report.md) — still
blocked, because the boundary-crossing property holds regardless of when
the sandboxed code runs relative to an `await`.

**Caveat, corrected by fix round 5 below:** round 4 closed the *call-in*
direction — host code never calls sandboxed code, and no host object is
ever passed in as an argument. It did **not** close the mirror-image
*call-out* direction — host code reading properties off the vm-realm
*return* value after `runInContext()` resolved. That remained a live,
direct host→vm property read until round 5 (next section). Do not read
"no direct JS-to-JS call ever crosses the realm boundary in either
direction" as true as of round 4 alone; it only became true once round 5's
fix landed too.

The seed value itself (caller-controlled, not instructor-script-controlled)
is coerced with `Number(seed)`, validated with `Number.isFinite`, and only
then spliced into the script text via `JSON.stringify(safeSeed)` — which
always produces a bare numeric-literal token — specifically to avoid
opening a *new* script-injection hole via string interpolation while fixing
the other two.

A secondary benefit: vm's own `timeout` now covers the ENTIRE combined
script, including the synchronous portion of the `generate(...)` call
itself — round 3's design left a documented gap where vm's inner timeout
guarded only the top-level script evaluation, not the later, separately-
invoked call to `generate`. (The outer `index.ts` timeout /
`worker.terminate()` remains the real backstop for anything that only hangs
after `runInContext` has returned, e.g. inside a `.then` continuation.)

### Why the result is validated, serialized, and read back as a string, never as a vm-realm object (fix round 5)

Round 4 closed the *call-in* direction of the boundary — host code never
calls sandboxed code, and no host-realm object is ever passed into it as an
argument. **A fifth review round live-verified that the mirror-image
*call-out* direction — host code reading the RESULT `generate()` returns —
had the exact same bug class, just running in the opposite direction.**

The round-4 implementation, immediately after `runInContext()` resolved,
read the result from HOST scope:

```js
// The round-4 pattern — looks safe, was not:
const result = await compiled.runInContext(context, { timeout: timeoutMs });
const vars = result && typeof result === 'object' && result.vars ? result.vars : null; // host-scope property read
for (const [k, v] of Object.entries(vars)) { ... }                                      // host-scope property reads
```

`result.vars` and `Object.entries(vars)` are direct HOST-scope property
reads on a vm-realm object. If a malicious `generate()` returns an object
whose `vars` (or a property on it) is implemented as an **accessor
(getter)** or via a **`Proxy` trap**, reading that property runs the
getter/trap body as vm-realm *code* — but at the moment it runs, the live
call stack has a HOST stack frame on it (the frame doing `result.vars`).
This is structurally identical to Escape B (round 4), just triggered by a
*property read* instead of a *call*: the getter/trap installs
`Error.prepareStackTrace = (e, frames) => frames`, walks `new
Error().stack`, and gets a real `CallSite` for that host frame; V8's
`CallSite.getThis()`/`getFunction()` return the actual host object for a
frame reached via a **direct crossing of the realm boundary**, and walking
its constructor chain reaches the host `Function` → real `process`. **This
was live-verified as full RCE**: a getter that installs
`Error.prepareStackTrace`, walks `.stack`, and reaches a host `CallSite`'s
`getThis()`/`getFunction()` → host `Function` → real `process` → arbitrary
file read, `child_process.execSync`, `process.env` exfiltration — all
returned disguised as an ordinary parameter value. A `Proxy`-wrapped result
object (trapping `get` on either the outer result or the `vars` object)
achieves the same thing.

**The fix**: move the result extraction, the per-value numeric validation,
and the serialization *inside* the vm script itself — as the tail end of
the SAME combined script from fix round 4, still executed inside the one
`runInContext()` call — and have the script's last expression resolve to a
plain **string**, not an object:

```js
(async () => {
  var __result = await generate(mulberry32(seedLiteral));
  var __rawVars = __result && typeof __result === 'object' && __result.vars ? __result.vars : null;
  if (!__rawVars) throw new Error('generate() must return { vars: { ... } }');
  var __vars = Object.create(null);
  var __keys = Object.keys(__rawVars);           // read keys, not the object itself
  for (var __i = 0; __i < __keys.length; __i++) {
    var __k = __keys[__i];
    var __v = __rawVars[__k];                     // any getter fires HERE, vm-realm frames only
    if (typeof __v !== 'number' || !Number.isFinite(__v)) {
      throw new Error('vars.' + __k + ' is not a finite number');
    }
    __vars[__k] = __v;                            // copy into a FRESH, known-plain object
  }
  return JSON.stringify(__vars);                  // stringify the fresh object, not the original
})();
```

`worker.js`'s host code then does `const result = await
compiled.runInContext(...)`, checks `typeof result === 'string'`, and
`JSON.parse`s it. Two details matter, both live-verified in the fix:

- **Every property read on the (possibly malicious) `vars`/result object
  happens while only vm-realm frames are on the stack.** The `await
  generate(...)` call, the `__rawVars[__k]` reads, and everything else run
  entirely inside the vm script — there is no point during any of it where
  a host stack frame is live. Any `Error.prepareStackTrace` walk performed
  by a getter/trap during this phase only ever sees vm-realm `CallSite`s,
  the same way `CallSite.getThis()`/`getFunction()` already returned
  `undefined` for frames on the far side of the native `runInContext`
  boundary in fix round 4.
- **The fresh-object copy happens BEFORE `JSON.stringify`, not instead of
  it.** `JSON.stringify` run directly on a malicious object can itself
  trigger a `toJSON` method, a getter, or a Proxy trap during its own
  internal property enumeration — stringifying the *original*, possibly-
  malicious object would not have been safe even though it happens inside
  the vm, because the trigger point would still be attacker-controlled.
  Copying every value into a brand-new `Object.create(null)` object first
  (via `Object.keys` + indexed reads, each individually validated as
  `typeof v === 'number' && Number.isFinite(v)`) means `JSON.stringify`
  only ever walks known-plain data this script itself just built —  nothing
  left in the value that could carry a trap through serialization.

Once `runInContext()` returns, host code touches only a primitive string
(`JSON.parse` and its output) — never a property of a vm-realm object — so
no getter or Proxy trap has anywhere to run on a host stack frame. This
closes the call-out mirror of Escape B the same way fix round 4 closed the
call-in original: not by trying to detect or block the trick, but by
removing the direct host↔vm property/call boundary crossing it depends on.
Re-verified live against both a getter-on-`vars` variant and a
`Proxy`-wrapped-result variant (see "Fix round 5" in
`task-4-report.md`) — both resolve harmlessly, with no `process`/pid ever
observed.

- **Honest residual risk — this is still not a hardened, zero-trust
  boundary.** Node's own `vm` module documentation is explicit: *"the vm
  module is not a security mechanism. Do not use it to run untrusted code."*
  There have been historical vm-escape / cross-realm techniques in various
  JS-engine embeddings, and this task's own review history is itself proof
  of the pattern: **five review rounds each found a live, working RCE that
  the previous round's fix did not anticipate** — most recently round 5,
  which found the exact same bug class as round 4 (a direct host↔vm
  boundary crossing enabling a cross-realm `CallSite` leak) simply running
  in the opposite direction (reading the result, not calling into the
  sandbox). **There is no reason to believe round 5 is the last one
  either** — the honest claim is "no known direct-call route remains
  crossing the realm boundary in either direction, as of this fix," not
  that the boundary is now provably complete. This component should be
  understood as a **substantial, industry-standard improvement** — a
  separate V8 context (this doc), never calling from host code into
  sandboxed code or passing host objects into it (fix round 4), never
  reading a property off a vm-realm object from host code either (fix
  round 5 — the result crosses back only as a validated, pre-serialized
  string), combined with `worker_threads` isolation (a separate OS thread
  and V8 isolate, so even a full
  engine-level realm escape still can't touch the main thread's memory
  directly), a memory cap (`resourceLimits.maxOldGenerationSizeMb`), and a
  hard timeout (both vm's own and the outer worker-level backstop) —
  appropriate **defense-in-depth for instructor-trusted-but-possibly-buggy-
  or-compromised content**. It is explicitly **not** a hardened boundary
  suitable for arbitrary hostile/internet-sourced code; do not repurpose
  this component to run untrusted student- or public-submitted code without
  a real isolation boundary (separate process/container with OS-level
  sandboxing, not just `vm` + `worker_threads`). **The real security
  boundary this component relies on is the trust tier of the content, not
  the technical hardening** — "this is instructor-trusted content, not
  hostile/internet-sourced input" (see "Threat model" above). Everything in
  this section is defense-in-depth on top of that trust boundary, not a
  substitute for it.
- **Five escape classes closed across five review rounds** (kept here, not
  just in gitignored scratch reports, so a future reviewer sees the full
  history and pattern before assuming round 5 is exhaustive):
  1. **Identifier reference** (rounds 1–2) — `new Function(...)` with
     dangerous identifiers (`require`, `process`, `fetch`, `eval`, ...)
     shadowed as parameter names bound to `undefined`. Broken by referencing
     the same identifiers a different way the shadow didn't cover.
  2. **Constructor-chain via lexical intrinsics** (round 3) — same-realm
     `new Function(...)` meant any built-in value's
     `.constructor.constructor` reached the real, unshadowed `Function`
     (`[].constructor.constructor("return process")()`), a *property*
     route no identifier shadow can intercept. Fixed by `vm.createContext()`
     — a genuinely separate realm whose own intrinsics were never derived
     from anything with `process`.
  3. **Host-argument constructor chain** (round 4, Escape A) — `generate`
     was pulled out of the vm context and called from host scope with a
     host-realm `mulberry32` closure as its argument; `random.constructor`
     reached the HOST's real `Function`. Fixed by constructing the PRNG
     inside the vm context too, never in host scope.
  4. **Cross-realm `CallSite` via `Error.prepareStackTrace`, call-in
     direction** (round 4, Escape B) — calling `generate(...)` FROM host
     code put a host JS frame on the stack at the moment `generate`'s body
     ran; `CallSite.getThis()`/`getFunction()` on that frame returned the
     real host object. Fixed by never letting host code directly call
     sandboxed code — every crossing now goes through the native
     `vm.Script.runInContext` boundary, which `CallSite` cannot see
     through.
  5. **Cross-realm `CallSite` via `Error.prepareStackTrace`, call-out /
     result-read direction** (round 5) — the same bug class as #4, running
     the other way: host code reading `result.vars` / `Object.entries(vars)`
     off the vm-realm return value after `runInContext()` resolved was a
     direct host-scope property read. A getter or `Proxy` trap on that
     return value ran as vm-realm code with a HOST frame live on the stack,
     letting it walk `Error.prepareStackTrace`/`CallSite` back to the real
     host object the same way Escape B did. Fixed by moving the result
     read, per-value numeric validation, and serialization *inside* the vm
     script (same combined script as fix round 4), so it resolves to a
     plain `JSON.stringify`-ed **string** — host code then only ever
     touches a primitive via `JSON.parse`, never a property of a vm-realm
     object.
- **What's structurally unreachable now, via ANY route (not just named
  identifiers), AS OF fix round 5:** `process`, `require`, `fetch`, the
  filesystem, the network, `Buffer`, and every other Node platform global —
  because none of them were ever injected into the vm context's global
  object, the context's own intrinsics (`Function`, `eval`, `Array`,
  `Object`, ...) were never derived from a realm that had them either, and
  (as of round 4) no host-realm object — not even the PRNG — is ever passed
  into sandboxed code as an argument, and (as of round 5) no host code ever
  reads a property off a vm-realm object either — the only thing that
  crosses back is a validated, pre-serialized string. Together this means
  no direct JS-to-JS call OR property read ever crosses the realm boundary
  in either direction (closing the `CallSite`/`Error.prepareStackTrace`
  route in both the call-in and call-out directions, alongside the argument
  route). This includes the constructor-chain route
  (`[].constructor.constructor(...)`, `({}).constructor.constructor(...)`,
  and any other built-in's constructor chain, including one reached via a
  function argument), direct and indirect `eval`, `new Function(...)`
  inside the script, and cross-realm `CallSite` introspection — all of
  these still execute, but only ever construct/evaluate code or observe
  frames within the same process-less, require-less realm. This is stated
  as what five rounds of live-verified adversarial review have found and
  closed — **no known direct-call route remains crossing the boundary in
  either direction, as of this fix** — **not** as a claim that no sixth
  route exists; see the residual risk bullet above.
- **Known, accepted, low-severity residual risk:** timing side-channels
  (a script can call `Date.now()` repeatedly to try to infer host timing
  characteristics — of limited practical value against
  instructor-trusted content) and the general "vm is not a hardened
  boundary" caveat above (undiscovered V8-level cross-realm bugs, or a sixth
  bug class this review didn't think to test for). Also residual: `vm`'s own
  `timeout` option guards the entire combined script (PRNG construction +
  instructor script + the `generate(...)` call + the round-5 result
  validation/serialization, all inside one `runInContext` call) but only
  the *synchronous* portion of it — it does **not** guard work that only
  happens after `runInContext` has returned, e.g. a `generate()` that
  returns a Promise whose `.then` continuation loops forever. The outer
  `index.ts` timeout / `worker.terminate()` is the real backstop for that
  case, verified to still work: `worker.terminate()` is called from the
  parent thread and forcibly kills the worker's isolate regardless of what
  the worker thread is synchronously or asynchronously stuck doing.
- **Dynamic `import()` is handled natively, not via text-scanning.** Node's
  `vm.Script.runInContext` requires an explicit `importModuleDynamically`
  callback to support dynamic `import()`; this component deliberately does
  not provide one. Verified live: calling `import(...)` inside a
  vm-evaluated script throws cleanly (`TypeError: A dynamic import callback
  was not specified.`), caught the same way any other script error is,
  surfaced as a normal rejection. This replaces the previous approach's
  fragile `script.includes('import(')` substring scan in `index.ts` (a
  documented stopgap for the old same-realm `new Function(...)` approach,
  which had no other way to block dynamic import), which has been removed
  entirely — vm's native behavior is both stricter (not foolable by string
  concatenation, since it's not a text match) and requires no maintenance.

## Public API (`index.ts`)

| Export | Purpose |
| --- | --- |
| `executeGenerate(script: string, seed: number): Promise<Record<string, number>>` | Runs `script`'s `generate(random)` in a fresh worker with a seeded PRNG (mulberry32) as `random`, and resolves the returned `vars`. Same `seed` → identical `vars`, always. |

Guarantees `executeGenerate` provides:

- **Hard timeout** — `env.paramWorkerTimeoutMs` (default 2000ms). On expiry
  the worker is terminated and the promise rejects with `Error('param-timeout')`.
- **Memory cap** — `resourceLimits: { maxOldGenerationSizeMb: env.paramWorkerMemoryMb }`
  (default 64MB) on the worker's old-generation heap.
- **No network / fs / process, structurally** — the worker evaluates the
  script inside a separate V8 realm via `vm.createContext()` +
  `vm.Script.runInContext()` (see "Why this is `vm.createContext()`" above).
  The sandbox object passed to `vm.createContext()` never has `process`,
  `require`, `fetch`, `Buffer`, `module`, `exports`, `__dirname`,
  `__filename`, or `setTimeout` copied into it, so those identifiers are
  simply undeclared free variables inside the script (`ReferenceError`, not
  a shadowed `undefined`). This also closes every constructor-chain route
  (`[].constructor.constructor("return process")()`,
  `({}).constructor.constructor(...)`, `Function(...)`, direct/indirect
  `eval`) because the realm's own `Function`/`eval` were never derived from
  anything that had `process` either.
- **No host-boundary crossing, structurally (fix rounds 4 and 5)** — the
  PRNG's construction, the instructor script, the call to `generate(...)`,
  AND (as of round 5) the result validation and serialization all execute
  together inside a single `vm.Script.runInContext()` call (see "Why
  `generate()` is called entirely INSIDE the vm context" and "Why the
  result is validated, serialized, and read back as a string" above).
  `generate` is never extracted into host scope and called from there, no
  host-realm object (not even the PRNG) is ever passed into sandboxed code
  as an argument, and host code never reads a property off the vm-realm
  result — `runInContext()` returns only a plain, pre-validated JSON
  string, which host code `JSON.parse`s. This closes the host-argument
  constructor-chain route and the `Error.prepareStackTrace`/cross-realm-
  `CallSite` route in BOTH directions — no direct JS-to-JS call and no
  direct property read ever crosses the realm boundary either way, so no
  host-realm object is ever reachable from sandboxed code (as an argument
  or via the call stack), and no vm-realm object's getter/Proxy trap is
  ever reachable from host code (via a property read on the result).
- **No dynamic `import()`, natively** — `vm.Script.runInContext` is called
  without an `importModuleDynamically` callback, so any `import(...)` inside
  the script throws `TypeError: A dynamic import callback was not
  specified.`, caught the same way any other script error is. No text-scan
  in `index.ts` is needed or present.
- **Every exit path cleans up** — resolve, reject, or timeout all funnel
  through one `settle()` that clears the timeout timer, removes the
  worker's listeners, and terminates the worker, so a call never leaks a
  live worker thread or a pending timer.
- **Validated output** — the worker itself rejects a `generate()` that
  doesn't exist (`typeof generate !== 'function'`), doesn't return
  `{ vars: {...} }`, or returns any `vars` value that isn't a finite
  `number` — no strings/objects/NaN/Infinity leak out as "parameter values".

## Why `worker.js` is plain JS, not compiled TypeScript

`worker.js` is checked in verbatim as CommonJS JavaScript and loaded via
`new Worker(WORKER_PATH)`, where `WORKER_PATH` is resolved with
`path.resolve(process.cwd(), 'server/src/components/param-worker/worker.js')`
— a fixed path relative to the repo root, not the TS build output. That one
path resolves correctly whether the server is running via `tsx` in dev (no
`dist` exists yet) or as a compiled `dist` build in prod (compiling `worker.js`
through the TS pipeline would require it to end up in `dist` at a predictable
path, which is exactly the "build gymnastics" this setup avoids). Keeping the
worker file plain, small, and dependency-free also keeps the sandboxed
surface easy to audit — it does one thing (evaluate a script in an isolated
`vm` context) and has no imports beyond the `worker_threads` and `vm`
builtins.

## Testing

`tests/unit/param-worker.test.ts` is the "abuse suite" — a Phase 2 exit
criterion. It spawns **real worker threads, no mocks**, because the sandbox
*is* the security boundary under test: mocking it would test nothing. It
covers determinism-per-seed, timeout-kills-infinite-loop, and
network/fs/process blocking, the "no `generate()`" rejection path, the
`Function`-constructor and indirect-`eval` regressions from earlier review
rounds, the constructor-chain escape (`[].constructor.constructor(...)`,
`({}).constructor.constructor(...)`, and a full escalation to
`process.getBuiltinModule('fs')`) that motivated the `vm.createContext()`
rewrite in fix round 3, and — from fix round 4 — the host-argument
constructor-chain escape (`random.constructor(...)` /
`random.constructor.constructor(...)`, Escape A) and the
`Error.prepareStackTrace` cross-realm `CallSite` leak (Escape B), including
an async-`generate()` variant of Escape B that walks the stack after an
`await` to confirm the fix holds regardless of timing relative to a
microtask boundary — and, from fix round 5, the call-out mirror of Escape
B: a `generate()` that returns `{ vars: { get leak() { ... } } }` (a getter
that installs `Error.prepareStackTrace` and walks the stack when the
`vars` object is read back) and a `generate()` that returns a
`Proxy`-wrapped result (trapping `get` on the outer result object and on
the `vars` object) attempting the same stack-walk during host-side result
reading. Both resolve harmlessly with no `process`/pid ever observed,
confirming the result-read boundary crossing no longer exposes a host
stack frame to sandboxed getter/trap code.
