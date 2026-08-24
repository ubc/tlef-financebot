/**
 * Experiment 25 — does the declared hardnessMove field fix difficulty
 * inflation where the menu + connector did not?
 *
 * Experiments 22-24: the moves menu, labeled prerequisite material and the
 * connector line produced 1 taken chain in 16 draws, and 2/8 questions in
 * exp 24 still drew difficulty complaints. The field converts the
 * instruction into a commitment (the self-assessment mechanism), and gives
 * the reviewer a concrete claim to verify (criterion 9) instead of the
 * boundary call that wobbled between exps 22 and 24.
 *
 * Arms:
 *   A "no-field"  — the built prompt with HARDNESS_MOVE_DECLARATION stripped
 *                   (exp 24's condition; also a same-run replication of it),
 *                   criterion 9 inert because no question carries the field.
 *   B "declared"  — as shipped.
 *
 * Same cell and grounding as exp 24: EV/EBITDA × hard, 6 EV + 2 CAPM
 * supporting chunks. Single-shot (exp 24 measured retries never firing).
 *
 * Metrics: difficulty complaints (primary), declaration compliance in B,
 * whether declared moves are actually implemented (read the questions),
 * routing and proofs as guards against regression.
 *
 * AB_N overrides n (default 8).
 */
import { HARDNESS_MOVE_DECLARATION } from '../../../server/src/services/generation.service';
import { loadFixtures, runExperiment, type FixtureChunk } from '../harness';

const fixtures = loadFixtures();
const widened: FixtureChunk[] = [
  ...fixtures.ev.chunks,
  { text: fixtures.capm.chunks[1].text, supporting: true },
  { text: fixtures.capm.chunks[4].text, supporting: true },
];

runExperiment({
  name: 'exp25-hardness-move-field',
  hypothesis:
    'Pre-registered: arm B (declared hardnessMove, reviewer criterion 9) '
    + 'produces fewer difficulty complaints than arm A (no field), because the '
    + 'model must choose a move before writing and the reviewer verifies a '
    + 'concrete claim instead of making a boundary call. Compliance in B is '
    + 'expected near-total; a declared-but-unimplemented move surfacing as a '
    + 'criterion-9 flag counts as the mechanism WORKING, not failing.',
  arms: [
    {
      label: 'no-field',
      chunks: widened,
      transformPrompt: (prompt) => prompt.replace(`${HARDNESS_MOVE_DECLARATION}\n`, ''),
    },
    { label: 'declared', chunks: widened },
  ],
  cells: [{ fixture: 'ev', difficulty: 'hard' }],
  n: Number(process.env.AB_N ?? 8),
  mode: 'single-shot',
}).then(
  () => process.exit(0),
  (err) => { console.error(err); process.exit(1); },
);
