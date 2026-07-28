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

- **Honest residual risk — this is still not a hardened, zero-trust
  boundary.** Node's own `vm` module documentation is explicit: *"the vm
  module is not a security mechanism. Do not use it to run untrusted code."*
  There have been historical vm-escape / cross-realm techniques in various
  JS-engine embeddings (e.g. via `Error.prepareStackTrace` callbacks that
  execute with access to the invoking realm, or cross-realm `Promise`/
  `WeakRef`/finalizer callback tricks) that this review has not specifically
  re-tested against this codebase's Node/V8 version. This component should
  be understood as a **substantial, industry-standard improvement** — a
  separate V8 context (this doc), combined with `worker_threads` isolation
  (a separate OS thread and V8 isolate, so even a full engine-level realm
  escape still can't touch the main thread's memory directly), a memory cap
  (`resourceLimits.maxOldGenerationSizeMb`), and a hard timeout (both vm's
  own and the outer worker-level backstop) — appropriate **defense-in-depth
  for instructor-trusted-but-possibly-buggy-or-compromised content**. It is
  explicitly **not** a hardened boundary suitable for arbitrary
  hostile/internet-sourced code; do not repurpose this component to run
  untrusted student- or public-submitted code without a real isolation
  boundary (separate process/container with OS-level sandboxing, not just
  `vm` + `worker_threads`).
- **What's structurally unreachable now, via ANY route (not just named
  identifiers):** `process`, `require`, `fetch`, the filesystem, the
  network, `Buffer`, and every other Node platform global — because none of
  them were ever injected into the vm context's global object, and the
  context's own intrinsics (`Function`, `eval`, `Array`, `Object`, ...) were
  never derived from a realm that had them either. This includes the
  constructor-chain route (`[].constructor.constructor(...)`,
  `({}).constructor.constructor(...)`, and any other built-in's constructor
  chain), direct and indirect `eval`, and `new Function(...)` inside the
  script — all of these still execute, but only ever construct/evaluate
  code within the same process-less, require-less realm.
- **Known, accepted, low-severity residual risk:** timing side-channels
  (a script can call `Date.now()` repeatedly to try to infer host timing
  characteristics — of limited practical value against
  instructor-trusted content) and the general "vm is not a hardened
  boundary" caveat above (undiscovered V8-level cross-realm bugs). Also
  residual: `vm`'s own `timeout` option only guards the synchronous
  `runInContext` call that evaluates the script's top-level code and defines
  `generate` — it does **not** guard a later call to `generate(random)`
  itself if that function's *body* loops forever (that call happens outside
  `runInContext`). The outer `index.ts` timeout / `worker.terminate()` is
  the real backstop for that case, verified to still work: `worker.terminate()`
  is called from the parent thread and forcibly kills the worker's isolate
  regardless of what the worker thread is synchronously stuck doing.
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
  a shadowed `undefined`). Crucially, this also closes every
  constructor-chain route (`[].constructor.constructor("return
  process")()`, `({}).constructor.constructor(...)`, `Function(...)`,
  direct/indirect `eval`) because the realm's own `Function`/`eval` were
  never derived from anything that had `process` either — there is no
  identifier to shadow because there is nothing to reach, by name or by
  property access.
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
rounds, and the constructor-chain escape (`[].constructor.constructor(...)`,
`({}).constructor.constructor(...)`, and a full escalation to
`process.getBuiltinModule('fs')`) that motivated the `vm.createContext()`
rewrite in fix round 3.
