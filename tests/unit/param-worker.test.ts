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
});
