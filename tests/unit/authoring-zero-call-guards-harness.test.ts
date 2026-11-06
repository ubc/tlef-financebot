import { assertZeroCallTarget, claimZeroCallDatabase, deniedBoundary, parseZeroCallArguments, zeroCallSocketAllowed } from '../../scripts/verify-authoring-zero-call-guards';
import type { ZeroCallOwnershipCollection, ZeroCallOwnershipRecord } from '../../scripts/verify-authoring-zero-call-guards';

const database = 'financebot_quality_smoke_retest_zero_call_guards_unit_20261017';
describe('zero-call authoring harness admission (pure; no runtime, socket or database starts)', () => {
  it('defaults to a file-only plan and accepts only explicit --live once', () => {
    expect(parseZeroCallArguments(['--database', database, '--output', '/tmp/zero-call-unit-plan'])).toMatchObject({ database, live: false });
    expect(parseZeroCallArguments(['--database', database, '--output', '/tmp/zero-call-unit-plan', '--live', 'once'])).toMatchObject({ database, live: true });
  });
  it.each([
    ['--database', database], ['--database', database, '--output', '/tmp/a', '--live', 'true'],
    ['--database', database, '--output', '/tmp/a', '--database', database],
    ['--database', database, '--output', '/tmp/a', '--provider', 'openai'],
    ['--database', 'financebot', '--output', '/tmp/a'],
  ])('rejects incomplete, duplicate or provider-capable arguments: %j', (...argv) => {
    expect(() => parseZeroCallArguments(argv)).toThrow();
  });
  it('accepts only the declared owned loopback MongoDB on port 27029', () => {
    expect(() => assertZeroCallTarget('mongodb://127.0.0.1:27029/?directConnection=true', database, database)).not.toThrow();
    expect(() => assertZeroCallTarget('mongodb://[::1]:27029/', database, database)).not.toThrow();
  });
  it.each([
    ['mongodb://example.invalid:27029/', database], ['mongodb+srv://example.invalid/', database],
    ['mongodb://user:password@127.0.0.1:27029/', database], ['mongodb://127.0.0.1:27017/', database],
    ['mongodb://127.0.0.1:27029/', 'financebot'],
  ])('refuses unsafe or mismatched database targets: %s', (uri, configured) => {
    expect(() => assertZeroCallTarget(uri, configured, database)).toThrow();
  });
  it('never allows provider/vector/default-app sockets merely because a port is loopback', () => {
    expect(zeroCallSocketAllowed('127.0.0.1', 27029)).toBe(true);
    expect(zeroCallSocketAllowed('127.0.0.1', 49123, 49123)).toBe(true);
    for (const port of [6333, 6118, 443, 80, 27017]) expect(zeroCallSocketAllowed('127.0.0.1', port, 49123)).toBe(false);
    expect(zeroCallSocketAllowed('example.invalid', 27029, 49123)).toBe(false);
    expect(zeroCallSocketAllowed('example.invalid', 49123, 49123)).toBe(false);
  });
  it('counts and throws on each forbidden boundary instead of returning a fake completion', () => {
    const attempts: Array<{ boundary: string; at: string }> = [];
    const deny = deniedBoundary(attempts, 'llm.completeJson');
    expect(() => deny('Synthetic input')).toThrow('zero-call-boundary-forbidden:llm.completeJson');
    expect(() => deny()).toThrow('zero-call-boundary-forbidden:llm.completeJson');
    expect(attempts).toHaveLength(2);
    expect(attempts.every(attempt => attempt.boundary === 'llm.completeJson' && Number.isFinite(Date.parse(attempt.at)))).toBe(true);
  });
  it('admits only one concurrent owner after both processes could have observed an empty database', async () => {
    const records = new Map<string, ZeroCallOwnershipRecord>();
    const duplicate = Object.assign(new Error('duplicate ownership _id'), { code: 11000 });
    let attempts = 0;
    // This fake models one atomic unique-key insert, not a read-then-write claim.
    const collection: ZeroCallOwnershipCollection = { async insertOne(record) {
      attempts += 1;
      await Promise.resolve();
      if (records.has(record._id)) throw duplicate;
      records.set(record._id, record);
    } };
    const ownership = { database, createdAt: new Date('2026-10-17T00:00:00Z'), scope: 'Synthetic concurrent ownership test.' };
    const outcomes = await Promise.allSettled([
      claimZeroCallDatabase(collection, { ...ownership, actor: 'first-process' }),
      claimZeroCallDatabase(collection, { ...ownership, actor: 'second-process' }),
    ]);
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === 'rejected')).toEqual([{ status: 'rejected', reason: duplicate }]);
    expect(attempts).toBe(2);
    expect([...records.values()]).toEqual([{ ...ownership, actor: 'first-process', _id: 'exclusive-zero-call-database-owner', noCleanup: true }]);
    await expect(claimZeroCallDatabase(collection, { ...ownership, actor: 'later-process' })).rejects.toBe(duplicate);
    expect(records.size).toBe(1);
    expect(records.get('exclusive-zero-call-database-owner')?.actor).toBe('first-process');
  });
});
