/**
 * Experiment 27c — the reviewer now SEES the assignment. Does it stay fair to
 * declared misfit-fallbacks?
 *
 * Hardening from exp 27b's review: criterion 9 verified the DECLARED move, so
 * a silent substitution (declared honestly) would have passed. The reviewer
 * now receives the platform's assignment with explicit fallback protection.
 * The risk this probe measures is the reviewer turning compliance-cop: the FX
 * cell legitimately produces declared fallbacks, and rejecting them for
 * non-compliance would break the escape hatch.
 *
 * Same FX cell and rotation as 27b — the only change is the reviewer's
 * assignment visibility. Pre-registered: declared misfit-fallbacks still
 * PASS (compliance-rejections = 0); results otherwise comparable to 27b
 * (5/0/2 with one residual displacement and one unrelated defect).
 */
import { HARDNESS_MOVE_MENU } from '../../../server/src/services/generation.service';
import { loadFixtures, runExperiment } from '../harness';

loadFixtures();
const rotate = (i: number) => HARDNESS_MOVE_MENU[(i - 1) % HARDNESS_MOVE_MENU.length]!.text;

runExperiment({
  name: 'exp27c-reviewer-sees-assignment',
  hypothesis:
    'Pre-registered: with the assignment visible to the reviewer (fallback '
    + 'protection worded in), declared misfit-fallbacks still pass — zero '
    + 'compliance-rejections — and outcomes stay comparable to 27b.',
  arms: [{ label: 'reviewer-sees-assignment', assignedMoveFor: rotate }],
  cells: [{ fixture: 'fx', difficulty: 'hard' }],
  n: Number(process.env.AB_N ?? 7),
  mode: 'single-shot',
}).then(
  () => process.exit(0),
  (err) => { console.error(err); process.exit(1); },
);
