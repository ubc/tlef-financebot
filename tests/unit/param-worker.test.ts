import { executeGenerate } from '../../server/src/components/param-worker';

jest.setTimeout(15000);

const GOOD = `function generate(random) {
  const r = Math.round(random() * 100) / 100;
  return { vars: { rate: r, principal: 1000 + Math.floor(random() * 9000) } };
}`;

describe('param worker sandbox (abuse suite — phase exit criterion)', () => {
  it('runs a well-behaved script and is deterministic per seed', async () => {
    const a = await executeGenerate(GOOD, 42);
    const b = await executeGenerate(GOOD, 42);
    const c = await executeGenerate(GOOD, 43);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(typeof a.rate).toBe('number');
  });

  it('kills an infinite loop at the timeout', async () => {
    await expect(executeGenerate('function generate(){ while(true){} }', 1)).rejects.toThrow('param-timeout');
  });

  it('blocks network access', async () => {
    await expect(
      executeGenerate('function generate(){ return fetch("http://example.com").then(()=>({vars:{}})) }', 1),
    ).rejects.toThrow();
  });

  it('blocks filesystem access', async () => {
    await expect(
      executeGenerate('function generate(){ require("fs").writeFileSync("/tmp/pwn",""); return {vars:{}}; }', 1),
    ).rejects.toThrow();
  });

  it('blocks process access', async () => {
    await expect(executeGenerate('function generate(){ process.exit(1); }', 1)).rejects.toThrow();
  });

  it('rejects a script with no generate()', async () => {
    await expect(executeGenerate('const x = 1;', 1)).rejects.toThrow(/generate/);
  });

  it('blocks the Function-constructor escape to the real process', async () => {
    await expect(
      executeGenerate(
        'function generate(){ const p = Function("return process")(); return { vars: { leak: p.pid } }; }',
        1,
      ),
    ).rejects.toThrow();
  });

  it('blocks the Function-constructor escape to the real fetch', async () => {
    await expect(
      executeGenerate('function generate(){ const f = Function("return fetch")(); return { vars: {} }; }', 1),
    ).rejects.toThrow();
  });

  it('blocks the indirect-eval escape to the real process', async () => {
    await expect(
      executeGenerate(
        'function generate(){ const g = eval; const p = g("process"); return { vars: { leak: p.pid } }; }',
        1,
      ),
    ).rejects.toThrow();
  });

  it('blocks dynamic import() with a clear error', async () => {
    await expect(
      executeGenerate(
        'function generate(){ return import("node:fs").then(fs => ({ vars: {} })); }',
        1,
      ),
    ).rejects.toThrow(/dynamic import/i);
  });

  it('blocks the [].constructor.constructor("return process") escape', async () => {
    await expect(
      executeGenerate(
        'function generate(){ const p = [].constructor.constructor("return process")(); return { vars: { leak: p.pid } }; }',
        1,
      ),
    ).rejects.toThrow();
  });

  it('blocks the ({}).constructor.constructor("return process") escape', async () => {
    await expect(
      executeGenerate(
        'function generate(){ const p = ({}).constructor.constructor("return process")(); return { vars: { leak: p.pid } }; }',
        1,
      ),
    ).rejects.toThrow();
  });

  it('blocks the full constructor-chain escalation to reading the filesystem', async () => {
    await expect(
      executeGenerate(
        `function generate(){
          const p = [].constructor.constructor("return process")();
          const fs = p.getBuiltinModule('fs');
          const contents = fs.readFileSync('/etc/hosts', 'utf8');
          return { vars: { leakLength: contents.length } };
        }`,
        1,
      ),
    ).rejects.toThrow();
  });

  // Fix round 4 regressions: the host-boundary escapes found after round 3's
  // vm.createContext() rewrite. Both stemmed from calling generate() FROM
  // HOST SCOPE with a HOST-realm `random` argument, not from any realm-
  // isolation gap in vm.createContext() itself. See AGENTS.md "Fix round 4".

  it('blocks the host-argument constructor-chain escape via random.constructor (Escape A)', async () => {
    await expect(
      executeGenerate(
        `function generate(random){
          const p = random.constructor("return process")();
          return { vars: { leak: p.pid } };
        }`,
        1,
      ),
    ).rejects.toThrow();
  });

  it('blocks the host-argument constructor-chain escape via random.constructor.constructor (Escape A variant)', async () => {
    await expect(
      executeGenerate(
        `function generate(random){
          const p = random.constructor.constructor("return process")();
          return { vars: { leak: p.pid } };
        }`,
        1,
      ),
    ).rejects.toThrow();
  });

  it('blocks the Error.prepareStackTrace cross-realm CallSite leak (Escape B)', async () => {
    await expect(
      executeGenerate(
        `function generate(){
          Error.prepareStackTrace = (e, frames) => frames;
          let leak = null;
          for (const f of new Error().stack) {
            try {
              const th = f.getThis();
              if (th && th.constructor && th.constructor.constructor) {
                const p = th.constructor.constructor("return process")();
                if (p && p.pid) leak = p.pid;
              }
            } catch (e) {}
            try {
              const fn = f.getFunction();
              if (fn && fn.constructor && fn.constructor.constructor) {
                const p = fn.constructor.constructor("return process")();
                if (p && p.pid) leak = p.pid;
              }
            } catch (e) {}
          }
          if (leak) return { vars: { leak } };
          return { vars: {} };
        }`,
        1,
      ),
    ).resolves.toEqual({});
  });

  it('blocks the Error.prepareStackTrace cross-realm CallSite leak even for an async generate() (Escape B, post-await)', async () => {
    await expect(
      executeGenerate(
        `async function generate(){
          await Promise.resolve();
          Error.prepareStackTrace = (e, frames) => frames;
          let leak = null;
          for (const f of new Error().stack) {
            try {
              const th = f.getThis();
              if (th && th.constructor && th.constructor.constructor) {
                const p = th.constructor.constructor("return process")();
                if (p && p.pid) leak = p.pid;
              }
            } catch (e) {}
          }
          if (leak) return { vars: { leak } };
          return { vars: {} };
        }`,
        1,
      ),
    ).resolves.toEqual({});
  });

  // Fix round 5 regressions: the result-READ mirror of Escape B. Round 4
  // closed the call-IN path (host code calling generate() directly); this
  // is the call-OUT path — host code reading `result.vars` off the
  // vm-realm return value after runInContext() resolves. A getter or Proxy
  // trap on that return value runs as vm-realm code, but (before this fix)
  // with a HOST stack frame live at the moment it ran, letting it walk
  // Error.prepareStackTrace/CallSite back to the real process. See
  // AGENTS.md "Fix round 5" and task-4-report.md.

  it('blocks the Error.prepareStackTrace cross-realm CallSite leak via a getter on the returned vars (Escape B, result-read variant)', async () => {
    await expect(
      executeGenerate(
        `function generate(){
          return {
            vars: {
              get leak() {
                Error.prepareStackTrace = (e, frames) => frames;
                let leak = 0;
                for (const f of new Error().stack) {
                  try {
                    const th = f.getThis();
                    if (th && th.constructor && th.constructor.constructor) {
                      const p = th.constructor.constructor("return process")();
                      if (p && p.pid) leak = p.pid;
                    }
                  } catch (e) {}
                  try {
                    const fn = f.getFunction();
                    if (fn && fn.constructor && fn.constructor.constructor) {
                      const p = fn.constructor.constructor("return process")();
                      if (p && p.pid) leak = p.pid;
                    }
                  } catch (e) {}
                }
                return leak;
              }
            }
          };
        }`,
        1,
      ),
    ).resolves.toEqual({ leak: 0 });
  });

  it('blocks the Error.prepareStackTrace cross-realm CallSite leak via a Proxy-wrapped result (Escape B, Proxy variant)', async () => {
    await expect(
      executeGenerate(
        `function generate(){
          let trapped = false;
          const varsTarget = { rate: 1 };
          const varsProxy = new Proxy(varsTarget, {
            get(target, prop, receiver) {
              if (!trapped) {
                trapped = true;
                Error.prepareStackTrace = (e, frames) => frames;
                for (const f of new Error().stack) {
                  try {
                    const th = f.getThis();
                    if (th && th.constructor && th.constructor.constructor) {
                      th.constructor.constructor("return process")();
                    }
                  } catch (e) {}
                }
              }
              return Reflect.get(target, prop, receiver);
            }
          });
          const resultProxy = new Proxy({}, {
            get(target, prop, receiver) {
              if (prop === 'vars') return varsProxy;
              return Reflect.get(target, prop, receiver);
            }
          });
          return resultProxy;
        }`,
        1,
      ),
    ).resolves.toEqual({ rate: 1 });
  });

  // Fix round 6 regressions: the THROW-path mirror of Escape B. Rounds 4 and
  // 5 closed the call-in and success-result-read paths, but a value THROWN
  // by the script (which the script fully controls: `throw { get message()
  // {...} }`) still propagated across the native runInContext boundary into
  // the host catch, which read `err.message` / `String(err)` on it — a
  // host-scope read of a vm-realm object, running the getter/toString trap
  // with a HOST frame live. Live-verified as full RCE before the fix. Fixed
  // by wrapping the whole script (evaluation + generate() + validation +
  // error-to-string) in one in-vm try/catch that always resolves to a
  // discriminated JSON string envelope; the error message is stringified
  // inside the vm, so nothing script-controlled is thrown to host scope.
  // See AGENTS.md "Fix round 6".

  it('blocks the Error.prepareStackTrace cross-realm CallSite leak via a getter on a THROWN message (Escape B, throw-path variant)', async () => {
    const walk = `
      Error.prepareStackTrace = (e, frames) => frames;
      for (const f of new Error().stack) {
        try {
          const th = f.getThis();
          if (th && th.constructor && th.constructor.constructor) {
            const p = th.constructor.constructor("return process")();
            if (p && p.pid) return 'LEAK pid=' + p.pid;
          }
        } catch (e) {}
        try {
          const fn = f.getFunction();
          if (fn && fn.constructor && fn.constructor.constructor) {
            const p = fn.constructor.constructor("return process")();
            if (p && p.pid) return 'LEAK pid=' + p.pid;
          }
        } catch (e) {}
      }
      return 'no-leak';
    `;
    // The reported error must be the harmless in-vm 'no-leak' string, never a
    // real host pid — proving the getter ran with only vm-realm frames live.
    await expect(
      executeGenerate(`function generate(){ throw { get message(){ ${walk} } }; }`, 1),
    ).rejects.toThrow('no-leak');
  });

  it('blocks the throw-path CallSite leak via a toString trap on a thrown object', async () => {
    const walk = `
      Error.prepareStackTrace = (e, frames) => frames;
      for (const f of new Error().stack) {
        try {
          const th = f.getThis();
          if (th && th.constructor && th.constructor.constructor) {
            const p = th.constructor.constructor("return process")();
            if (p && p.pid) return 'LEAK pid=' + p.pid;
          }
        } catch (e) {}
      }
      return 'no-leak';
    `;
    await expect(
      executeGenerate(`function generate(){ throw { toString(){ ${walk} } }; }`, 1),
    ).rejects.toThrow('no-leak');
  });

  it('still surfaces a benign thrown Error message', async () => {
    await expect(
      executeGenerate('function generate(){ throw new Error("boom custom"); }', 1),
    ).rejects.toThrow('boom custom');
  });

  // Fix round 7: round 6's in-vm try/catch runs in the SAME vm realm as the
  // instructor script, so a script can reassign `JSON.stringify` (a global
  // intrinsic of that realm) BEFORE `generate()` is even called. The
  // harness's own success-path envelope call then invokes the tampered
  // version, which throws a `{get message(){...leak...}}` trap; that throw
  // is caught by the harness's in-vm catch, but the catch's OWN
  // `JSON.stringify({ok:false,...})` call also invokes the still-tampered
  // version, throwing again — and this second throw is not caught by
  // anything further, so it escapes the vm IIFE as a real rejection that
  // crosses the native runInContext boundary into host code. Fixed by (a)
  // capturing the real `JSON.stringify` before the instructor script runs,
  // so the harness's own envelope-building always uses the untampered
  // intrinsic, and (b) the host's outer catch around `runInContext` never
  // reading a property off whatever it catches, so even an escape past (a)
  // can never reach the host's real `process`. See AGENTS.md "Fix round 7".
  it('blocks the JSON.stringify-reassignment escape via the harness\'s own envelope serialization (Escape C)', async () => {
    const walk = `
      Error.prepareStackTrace = (e, frames) => frames;
      for (const f of new Error().stack) {
        try {
          const th = f.getThis();
          if (th && th.constructor && th.constructor.constructor) {
            const p = th.constructor.constructor("return process")();
            if (p && p.pid) return 'LEAK pid=' + p.pid;
          }
        } catch (e) {}
        try {
          const fn = f.getFunction();
          if (fn && fn.constructor && fn.constructor.constructor) {
            const p = fn.constructor.constructor("return process")();
            if (p && p.pid) return 'LEAK pid=' + p.pid;
          }
        } catch (e) {}
      }
      return 'no-leak';
    `;
    const script = `
      JSON.stringify = function () {
        throw { get message() { ${walk} } };
      };
      function generate() { return { vars: { rate: 1 } }; }
    `;
    // Because the harness now captures the real JSON.stringify (and
    // Object.keys/Object.create/Number.isFinite/String) into local variables
    // BEFORE this script's `JSON.stringify = ...` line ever runs, the
    // harness's own success-path envelope call never invokes the tampered
    // version at all — the reassignment is completely inert as far as the
    // harness's own serialization is concerned. So the previously-fatal
    // script now just... works normally: `generate()` runs, returns valid
    // vars, and the harness serializes them with the captured original
    // JSON.stringify. This is the strongest possible outcome for Escape C —
    // not merely "fails safely with a generic message" but "the tampering
    // has zero effect on the harness," proving the getter/CallSite trap
    // never gets a chance to fire with a host frame live, because the
    // tampered global is never consulted at all. (The `walk` payload above
    // is dead code from the script's own perspective in this scenario — it
    // only runs if something ever DOES call the tampered JSON.stringify,
    // which no longer happens.)
    const vars = await executeGenerate(script, 1);
    expect(vars).toEqual({ rate: 1 });
  });

  // Part 1 of the round-7 fix (the host's outer catch around runInContext
  // never reading a property off whatever it catches) is a structural
  // backstop for cases where something gets past the vm's own in-vm
  // try/catch and captured-intrinsics defense above — which, by design and
  // as confirmed by the resolved (not rejected) outcome of the Escape-C test
  // above, should not happen for any currently-known tampering trick. It is
  // intentionally not independently exercised by a sandboxed-script-level
  // test here (no known script currently reaches it); see AGENTS.md
  // "Fix round 7" and worker.js's own comment on that catch block for the
  // full reasoning on why it's still required as defense in depth.
});
