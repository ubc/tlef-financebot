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
  The scrubbed scope (`require`, `process`, `fetch`, `globalThis`, `module`,
  `exports`, `__dirname`, `__filename`, `Function`, and `eval` all shadowed
  to `undefined`/`{}` inside `new Function(...)`) means even a deliberately
  malicious script can't read files, make outbound requests, touch the
  process, mint a fresh `Function` bound to the real global scope, or reach
  the real `eval` — directly or indirectly — but this is one layer, not a
  complete isolation guarantee (it does not stop e.g. CPU/timing side
  channels or Node/V8 engine bugs). Do not repurpose this component to run
  untrusted student- or public-submitted code without a real isolation
  boundary (separate process/container, not just `worker_threads`).
- **Residual limitation — the `import()` static scan is a text match, not a
  parser.** `executeGenerate` rejects any script whose source contains the
  literal substring `import(` before it ever spawns a worker. This catches
  the straightforward case, but a determined obfuscator could still build an
  equivalent call at runtime through some other string-concatenation or
  reflection trick the scan doesn't recognize as text (note: routing it
  through direct or indirect `eval` no longer works as a bypass, since
  `eval` itself is shadowed inside the worker — see below). Per the threat
  model above, this is defense-in-depth against accidental or casual misuse
  by an instructor-trusted script, not a guarantee against a deliberately
  adversarial one. More generally, shadowing known-dangerous identifiers
  (`Function`, `eval`, `require`, `process`, `fetch`, `globalThis`, ...) is a
  pragmatic, enumerable defense against real, known techniques for reaching
  the global scope from inside `new Function(...)` — it is not, and cannot
  be, an exhaustive list of every possible way a fully adversarial,
  obfuscated script might reach outside the sandbox at the JS-engine level.

## Public API (`index.ts`)

| Export | Purpose |
| --- | --- |
| `executeGenerate(script: string, seed: number): Promise<Record<string, number>>` | Runs `script`'s `generate(random)` in a fresh worker with a seeded PRNG (mulberry32) as `random`, and resolves the returned `vars`. Same `seed` → identical `vars`, always. |

Guarantees `executeGenerate` provides:

- **Hard timeout** — `env.paramWorkerTimeoutMs` (default 2000ms). On expiry
  the worker is terminated and the promise rejects with `Error('param-timeout')`.
- **Memory cap** — `resourceLimits: { maxOldGenerationSizeMb: env.paramWorkerMemoryMb }`
  (default 64MB) on the worker's old-generation heap.
- **No network / fs / process** — the worker evaluates the script via
  `new Function(...)` with `require`, `process`, `fetch`, `globalThis`,
  `module`, `exports`, `__dirname`, `__filename`, `Function`, and `eval` all
  passed as parameters bound to `undefined` (or `{}` for `globalThis`),
  shadowing any same-named binding the script's top-level code could
  otherwise reach. A script that calls `require('fs')`, `process.exit()`, or
  `fetch(...)` throws a `TypeError` (calling `undefined`), which is caught
  and surfaced as a rejection, not a crash. `Function` is shadowed too —
  without it, a script could do `Function('return process')()` to mint a
  fresh `Function` whose body runs in the worker's real global scope,
  bypassing every other shadow (since none of the parameter names are
  referenced inside that new function body). `eval` is shadowed too, and for
  a subtler reason: a *direct* `eval("process")` call would already resolve
  to the shadowed local (direct eval uses the calling scope's bindings), but
  per the ECMAScript spec any *indirect* call — `const g = eval; g("process")`,
  `(0, eval)("process")`, etc. — always executes in the real global scope
  regardless of strict mode, and no amount of lexical shadowing of anything
  else stops that. The only fix is to shadow the `eval` identifier itself,
  same as `Function`, so a script can never obtain a reference to the real
  global `eval` in the first place. One structural wrinkle: `eval` (like
  `arguments`) can never be a parameter name of a function whose own body is
  strict — that's an ECMAScript syntax restriction — so `worker.js` can't
  put `"use strict"` at the top of the outer `new Function(...)` body the
  way it could when only `Function` needed shadowing. Instead the outer
  (sloppy) function immediately returns an inner IIFE that opts into
  `"use strict"` and contains the actual script; referencing (not binding)
  `eval` from strict code is legal, so the script's lookup of `eval` still
  resolves to the outer shadowed parameter, and the inner IIFE gets its own
  `arguments` object rather than exposing the outer function's.
- **No dynamic `import()`** — `executeGenerate` rejects (before spawning a
  worker) any script whose source text contains the literal substring
  `import(`, since dynamic import is a language construct that can reach the
  real `node:fs` / `node:http` / etc. modules and can't be shadowed via
  `new Function(...)` parameters the way identifiers can. See the threat
  model above for this check's residual limitation.
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
surface easy to audit — it does one thing (evaluate a script with a scrubbed
scope) and has no imports beyond the `worker_threads` builtin.

## Testing

`tests/unit/param-worker.test.ts` is the "abuse suite" — a Phase 2 exit
criterion. It spawns **real worker threads, no mocks**, because the sandbox
*is* the security boundary under test: mocking it would test nothing. It
covers determinism-per-seed, timeout-kills-infinite-loop, and
network/fs/process blocking, plus the "no `generate()`" rejection path.
