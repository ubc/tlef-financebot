function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function recordedSeeds(value: unknown): value is number[] {
  if (!Array.isArray(value) || value.length < 1) return false;
  // Iteration visits sparse entries too; Array.every would skip a missing seed.
  for (const seed of value) {
    if (typeof seed !== 'number' || !Number.isSafeInteger(seed)) return false;
  }
  return true;
}

/** Describe recorded checks, not source truth, approval or current serving
 * eligibility. Runtime validation prevents malformed wire metadata from
 * turning a sampled historical proof into an exhaustive-grid claim. */
export function numericVerificationSummary(verification: unknown): string | null {
  const proof = record(verification);
  if (!proof || !nonNegativeInteger(proof.evaluatorVersion) || proof.evaluatorVersion < 1
    || !recordedSeeds(proof.sampleSeeds)
    || typeof proof.verifiedAt !== 'string' || !Number.isFinite(Date.parse(proof.verifiedAt))) return null;

  const samples = `${proof.sampleSeeds.length} recorded sample draw${proof.sampleSeeds.length === 1 ? '' : 's'}`;
  const coverage = record(proof.parameterCoverage);
  const knownCoverage = coverage?.version === 'finite-slot-grid-v1'
    && coverage.maxCombinations === 256
    && nonNegativeInteger(coverage.checkedCombinations) && coverage.checkedCombinations <= 256
    && (coverage.totalCombinations === null || nonNegativeInteger(coverage.totalCombinations));
  if (knownCoverage && coverage.mode === 'exhaustive'
    && typeof coverage.totalCombinations === 'number' && coverage.totalCombinations >= 1
    && coverage.totalCombinations === coverage.checkedCombinations
    && coverage.reason === undefined) {
    return `Verified all ${coverage.totalCombinations} parameter-entry combination${coverage.totalCombinations === 1 ? '' : 's'} plus ${samples}. Approval is still required.`;
  }

  let grid = proof.parameterCoverage === undefined
    ? 'Full-grid coverage was not recorded.' : 'Full-grid coverage is unavailable.';
  if (knownCoverage && coverage.mode === 'sampled') {
    if (coverage.reason === 'combination-limit') grid = 'Full-grid verification exceeds the 256-combination limit.';
    else if (coverage.reason === 'unrepresentable-domain') grid = 'The parameter domains could not be safely enumerated.';
    else if (coverage.reason === 'ambiguous-parameter-names') grid = 'Parameter names prevent complete grid verification.';
  }
  return `Verified across ${samples}. ${grid} Approval is still required.`;
}
