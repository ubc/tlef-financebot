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
});
