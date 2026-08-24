/**
 * Experiment 24 — does Option B's retry convert difficulty rejects?
 *
 * Experiment 23 produced the first difficulty REJECT with a rubric-specific
 * critique ("does not involve more than two distinct concepts or formula
 * types…"). Production would quote that critique back and regenerate once;
 * the single-shot probes never exercised it. This is the measurement the
 * exp-23 record asked for BEFORE escalating to a hardnessMove output field
 * or two-pass generation.
 *
 * Conditions: the shipped stack (R1 rubric + R2 moves + R7 labeling) on the
 * reject-prone family — EV/EBITDA at target hard with the production 6+2
 * widened grounding (6 EV chunks + 2 CAPM chunks flagged supporting).
 * Single arm; the comparison is within-record: reject -> retry outcome.
 *
 * AB_N overrides n (default 8): AB_N=1 for a plumbing smoke run.
 */
import { loadFixtures, runExperiment, type FixtureChunk } from '../harness';

const fixtures = loadFixtures();
const widened: FixtureChunk[] = [
  ...fixtures.ev.chunks,
  { text: fixtures.capm.chunks[1].text, supporting: true },
  { text: fixtures.capm.chunks[4].text, supporting: true },
];

runExperiment({
  name: 'exp24-option-b-retry',
  hypothesis:
    'Pre-registered: when the reviewer rejects for inflated difficulty with a '
    + 'rubric-specific critique, the Option-B retry produces a replacement that '
    + 'is genuinely harder (pass/flag with no difficulty complaint) in at least '
    + 'half the rejects, rather than a cosmetic relabel to medium or a resubmission '
    + 'of the same single-concept template.',
  arms: [{ label: 'shipped-6+2', chunks: widened }],
  cells: [{ fixture: 'ev', difficulty: 'hard' }],
  n: Number(process.env.AB_N ?? 8),
  mode: 'retry-on-reject',
}).then(
  () => process.exit(0),
  (err) => { console.error(err); process.exit(1); },
);
