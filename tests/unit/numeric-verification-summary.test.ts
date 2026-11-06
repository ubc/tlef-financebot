import { numericVerificationSummary } from '../../client/src/numeric-verification-summary';

const proof = {
  evaluatorVersion: 1,
  inputDisplayVersion: 1,
  sampleSeeds: Array.from({ length: 100 }, (_, index) => 1_000_003 + index),
  verifiedAt: '2026-10-17T12:00:00.000Z',
};
const coverage = {
  version: 'finite-slot-grid-v1', mode: 'exhaustive', totalCombinations: 27,
  checkedCombinations: 27, maxCombinations: 256,
};

test('shows every grid entry combination and the recorded sample count for a valid new proof', () => {
  expect(numericVerificationSummary({ ...proof, parameterCoverage: coverage }))
    .toBe('Verified all 27 parameter-entry combinations plus 100 recorded sample draws. Approval is still required.');
});

test('a singleton grid and singleton historical sample use singular units', () => {
  expect(numericVerificationSummary({ ...proof, sampleSeeds: [1],
    parameterCoverage: { ...coverage, totalCombinations: 1, checkedCombinations: 1 } }))
    .toContain('all 1 parameter-entry combination plus 1 recorded sample draw.');
});

test('the maximum complete grid remains eligible for the exhaustive wording', () => {
  expect(numericVerificationSummary({ ...proof,
    parameterCoverage: { ...coverage, totalCombinations: 256, checkedCombinations: 256 } }))
    .toContain('all 256 parameter-entry combinations');
});

test('historical absence never implies a complete grid or an invented 100 samples', () => {
  expect(numericVerificationSummary({ ...proof, sampleSeeds: Array.from({ length: 25 }, (_, index) => index) }))
    .toBe('Verified across 25 recorded sample draws. Full-grid coverage was not recorded. Approval is still required.');
});

test.each([
  ['combination-limit', 257, 'exceeds the 256-combination limit'],
  ['unrepresentable-domain', null, 'could not be safely enumerated'],
  ['ambiguous-parameter-names', null, 'prevent complete grid verification'],
])('shows the bounded sampled fallback %s without claiming complete coverage', (reason, totalCombinations, text) => {
  const summary = numericVerificationSummary({ ...proof,
    parameterCoverage: { ...coverage, mode: 'sampled', checkedCombinations: 0, reason, totalCombinations } });
  expect(summary).toContain('Verified across 100 recorded sample draws.');
  expect(summary).toContain(text);
  expect(summary).not.toContain('Verified all');
});

test.each([
  null,
  [],
  'exhaustive',
  { ...coverage, version: 'future-version' },
  { ...coverage, mode: 'complete' },
  { ...coverage, totalCombinations: null },
  { ...coverage, totalCombinations: '27' },
  { ...coverage, totalCombinations: 0, checkedCombinations: 0 },
  { ...coverage, totalCombinations: -1, checkedCombinations: -1 },
  { ...coverage, totalCombinations: 27.5, checkedCombinations: 27.5 },
  { ...coverage, totalCombinations: Infinity, checkedCombinations: Infinity },
  { ...coverage, totalCombinations: NaN, checkedCombinations: NaN },
  { ...coverage, totalCombinations: Number.MAX_SAFE_INTEGER + 1, checkedCombinations: Number.MAX_SAFE_INTEGER + 1 },
  { ...coverage, checkedCombinations: 26 },
  { ...coverage, totalCombinations: 257, checkedCombinations: 257 },
  { ...coverage, maxCombinations: 128 },
  { ...coverage, maxCombinations: '256' },
  { ...coverage, reason: 'combination-limit' },
])('untrusted coverage metadata %j never earns exhaustive wording', parameterCoverage => {
  const summary = numericVerificationSummary({ ...proof, parameterCoverage });
  expect(summary).toContain('Verified across 100 recorded sample draws.');
  expect(summary).toContain('Full-grid coverage is unavailable.');
  expect(summary).not.toContain('Verified all');
});

test.each([
  undefined, null, [], {},
  { ...proof, evaluatorVersion: 0 },
  { ...proof, evaluatorVersion: '1' },
  { ...proof, sampleSeeds: [] },
  { ...proof, sampleSeeds: Array<number>(100) },
  { ...proof, sampleSeeds: [NaN] },
  { ...proof, sampleSeeds: ['1'] },
  { ...proof, sampleSeeds: [1.5] },
  { ...proof, verifiedAt: 'unknown' },
])('missing/malformed base proof %j never shows a success message', value => {
  expect(numericVerificationSummary(value)).toBeNull();
});
