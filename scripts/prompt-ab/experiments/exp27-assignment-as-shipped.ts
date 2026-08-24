/**
 * Experiment 27 — the shipped assignment mechanism (c2e7e78), probed on two
 * families: replication on EV/EBITDA, and the fit-stress case the mechanism's
 * escape hatch exists for.
 *
 * Exp 26 established assignment wins with a harness-side appendix; this runs
 * the REAL path — HARDNESS_MOVE_MENU texts through GENERATOR_PROMPT's
 * assignedMove param, the pipeline's own insertion point — and adds the cell
 * exp 26 did not have: a conceptual-shaped LO (FX macro drivers) where most
 * calculation moves are a bad fit. Sequential rotation from index 0 stands in
 * for the pipeline's random-start rotation, so all seven menu moves get drawn
 * at n=7. The `ev-widened` fixture is the production 6+2 grounding shape;
 * `fx` is plain (a conceptual LO's own material).
 *
 * Pre-registered:
 *   - EV cell replicates exp 26's assigned arm (distinct faithful builds, no
 *     difficulty complaints, proofs hold).
 *   - FX cell: bad-fit assignments take the ESCAPE HATCH — conceptual hard
 *     with the misfit declared — rather than forcing broken numerics.
 *     A question that forces an unfaithful calculation to satisfy a misfit
 *     assignment counts against the mechanism; an honest declared fallback
 *     counts for it.
 *
 * AB_N overrides n (default 7 = one full menu rotation per cell).
 */
import { HARDNESS_MOVE_MENU } from '../../../server/src/services/generation.service';
import { loadFixtures, runExperiment } from '../harness';

loadFixtures(); // fail fast if fixtures are missing before spending any calls

const rotate = (i: number) => HARDNESS_MOVE_MENU[(i - 1) % HARDNESS_MOVE_MENU.length]!.text;

runExperiment({
  name: 'exp27-assignment-as-shipped',
  hypothesis:
    'Pre-registered: through the real assignedMove path, the EV cell replicates '
    + 'exp 26 (distinct faithful builds, no difficulty complaints); on the '
    + 'conceptual-shaped FX cell, bad-fit assignments take the declared escape '
    + 'hatch instead of forcing broken numerics.',
  arms: [{ label: 'assigned', assignedMoveFor: rotate }],
  cells: [{ fixture: 'ev-widened', difficulty: 'hard' }, { fixture: 'fx', difficulty: 'hard' }],
  n: Number(process.env.AB_N ?? 7),
  mode: 'single-shot',
}).then(
  () => process.exit(0),
  (err) => { console.error(err); process.exit(1); },
);
