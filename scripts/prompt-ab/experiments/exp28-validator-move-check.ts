/**
 * Experiment 28 — two changes probed together, because they ship together:
 *
 *   1. The move claim-check moved to the VALIDATOR (declared-vs-implemented,
 *      declared-vs-assigned -> moveAssessment); the reviewer weighs the
 *      finding under criterion 9's policy and never sees the raw assignment
 *      (exp 27c: assignment visibility anchored its verdict upward).
 *   2. The generator's seven-entry moves catalog is replaced by compact
 *      framing when a move is assigned (~330 tokens saved; the conceptual
 *      pattern the escape hatch references survives in the framing).
 *
 * Cells mirror exp 27: EV-widened (friendly family — watch faithfulness and
 * substitutions with the catalog gone) and FX (hostile family — watch
 * fallback protection through the validator handoff, and whether
 * displacement verdicts RE-HARDEN now that the reviewer no longer holds the
 * assignment).
 *
 * Pre-registered:
 *   - EV: distinct faithful builds hold (no catalog needed to implement an
 *     assigned move), zero substitutions, no difficulty complaints.
 *   - FX: declared fallbacks still pass; displacement faults return to
 *     REJECT (the exp 27b blind-reviewer behaviour) rather than flag.
 *   - Validator moveAssessments are factual (implemented/matching/why), not
 *     verdicts.
 *
 * AB_N overrides n (default 7 = one full rotation per cell).
 */
import { HARDNESS_MOVE_MENU } from '../../../server/src/services/generation.service';
import { loadFixtures, runExperiment } from '../harness';

loadFixtures();
const rotate = (i: number) => HARDNESS_MOVE_MENU[(i - 1) % HARDNESS_MOVE_MENU.length]!.text;

runExperiment({
  name: 'exp28-validator-move-check',
  hypothesis:
    'Pre-registered: with the move check in the validator and the catalog '
    + 'compacted, EV keeps distinct faithful builds with zero substitutions; '
    + 'FX keeps fallback protection AND displacement verdicts re-harden to '
    + 'reject now that the reviewer no longer holds the assignment.',
  arms: [{ label: 'validator-move-check', assignedMoveFor: rotate }],
  cells: [{ fixture: 'ev-widened', difficulty: 'hard' }, { fixture: 'fx', difficulty: 'hard' }],
  n: Number(process.env.AB_N ?? 7),
  mode: 'single-shot',
}).then(
  () => process.exit(0),
  (err) => { console.error(err); process.exit(1); },
);
