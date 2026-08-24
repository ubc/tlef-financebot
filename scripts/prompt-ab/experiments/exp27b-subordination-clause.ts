/**
 * Experiment 27b — the subordination clause, re-probing exp 27's failing cell.
 *
 * Exp 27's FX cell: 3/7 rejects, all criterion 2, all the same mechanism —
 * technically-implementable moves whose arithmetic displaced the objective
 * (macro drivers became stem assertions). The assignment block now
 * subordinates the move to the LO: implementability is not fit; a move that
 * reduces the objective to a background assertion is a misfit and takes the
 * declared fallback.
 *
 * Same FX cell, same rotation, n=7. Pre-registered: rejects drop (more draws
 * take the declared fallback or keep the LO's reasoning in the question);
 * an increase in honest conceptual fallbacks is success, not evasion.
 */
import { HARDNESS_MOVE_MENU } from '../../../server/src/services/generation.service';
import { loadFixtures, runExperiment } from '../harness';

loadFixtures();
const rotate = (i: number) => HARDNESS_MOVE_MENU[(i - 1) % HARDNESS_MOVE_MENU.length]!.text;

runExperiment({
  name: 'exp27b-subordination-clause',
  hypothesis:
    'Pre-registered: with the subordination clause, the FX cell\'s criterion-2 '
    + 'rejects drop below 3/7 — misfit assignments take the declared fallback '
    + 'or keep the objective\'s own reasoning in the question.',
  arms: [{ label: 'assigned-subordinated', assignedMoveFor: rotate }],
  cells: [{ fixture: 'fx', difficulty: 'hard' }],
  n: Number(process.env.AB_N ?? 7),
  mode: 'single-shot',
}).then(
  () => process.exit(0),
  (err) => { console.error(err); process.exit(1); },
);
