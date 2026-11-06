import vm from 'node:vm';
import { safeRealmError } from '../../scripts/quality-lab/audit-extraction-pair';

it('retains an exact structural failure message from the trusted VM without exposing credential-shaped text', () => {
  const foreign = vm.runInNewContext('new Error("Missing objective references: P4. Incorrect API key provided: sk-synthetic-only")') as unknown;
  expect(foreign instanceof Error).toBe(false);
  const normalized = safeRealmError(foreign);
  expect(normalized.message).toContain('Missing objective references: P4.');
  expect(normalized.message).not.toContain('sk-synthetic-only');
  expect(normalized.message).toContain('redacted');
});
