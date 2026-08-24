/**
 * Experiment 26 — move-first generation: does choosing the move BEFORE
 * generation break the hidden-parameter monoculture and produce genuinely
 * hard questions?
 *
 * Experiment 25's finding: given free choice, the generator declared "hidden
 * parameter" on 4/4 numeric questions, twice trivially. Three escalations of
 * description (menu, connector, declaration) moved detection, never
 * generation. This probes the two candidate mechanisms for moving generation
 * — a probe only, nothing ships:
 *
 *   one-pass — shipped behavior: the generator picks its own move. Same-run
 *              control (third run of this condition; wobble is documented).
 *   two-pass — a planning call first (effort low): pick the best-fitting
 *              move for this LO+material, name the concept chained from the
 *              supporting chunks, sketch the scenario. The generator gets it
 *              as an assignment.
 *   assigned — no planner: the harness rotates a curated move list
 *              deterministically. If this matches two-pass, production gets
 *              simpler and diversity is guaranteed by construction.
 *
 * Pre-registered: both treatment arms produce >= 3 distinct declared moves
 * (vs exp 25's 1) with no regression in proofs or complaint rate; the
 * questions implementing assigned/planned moves are richer (helper steps,
 * chain-taking) than the hidden-parameter template. A planned move the
 * generator SUBSTITUTES away counts against the mechanism.
 *
 * AB_N overrides n (default 6 per arm).
 */
import { completeJson } from '../../../server/src/components/genai/llm';
import { loadFixtures, runExperiment, type FixtureChunk } from '../harness';

const fixtures = loadFixtures();
const widened: FixtureChunk[] = [
  ...fixtures.ev.chunks,
  { text: fixtures.capm.chunks[1].text, supporting: true },
  { text: fixtures.capm.chunks[4].text, supporting: true },
];

/** The R2 menu's move names, curated to the ones plausibly implementable on
 * this LO family, rotation order chosen so early draws hit the moves the
 * model never picks on its own (exp 25: 4/4 chose hidden parameter). */
const CURATED_MOVES = [
  'two-approach comparison: value the company BOTH by the peer multiple AND by a DCF (use the CAPM material to derive the discount rate), and ask about reconciling the two',
  'deferred/off-cycle timing: the operating cash flows start later than year 1 or arrive mid-cycle, so their standard formula value lands at the wrong date and must be discounted again',
  'benefit minus cost: the computed firm or enterprise value is one LEG of a decision (an offer, a purchase); the answer is the difference between the two legs',
  'regime change: growth or margins switch partway through the forecast, chaining two valuation stages across the boundary',
  'hidden parameter: a genuinely needed input is NOT stated and must be reconstructed from other given terms first — it must not be a value the stem effectively hands over',
  'reinvestment chain: interim cash flows are reinvested at a different rate before the valuation date, so their future value must be built before the main valuation',
];

function assignmentAppendix(move: string): string {
  return [
    'YOUR HARDNESS MOVE HAS BEEN CHOSEN for this question. Implement EXACTLY this move:',
    `  ${move}`,
    'Do not substitute a different move. Declare this move (as implemented) in the',
    '"hardnessMove" field. If the move genuinely cannot be implemented for this',
    'learning objective from the material provided, implement the closest faithful',
    'variant and say so in the declaration.',
  ].join('\n');
}

const MOVE_MENU_FOR_PLANNER = CURATED_MOVES.map((m, idx) => `  ${idx + 1}. ${m}`).join('\n');

runExperiment({
  name: 'exp26-move-first-two-pass',
  hypothesis:
    'Pre-registered: assigning the hardness move before generation (by planner '
    + 'or rotation) yields >= 3 distinct moves per treatment arm vs the '
    + 'monoculture, without regressing proofs or complaint rate; substituted-away '
    + 'assignments count against the mechanism.',
  arms: [
    { label: 'one-pass', chunks: widened },
    {
      label: 'two-pass',
      chunks: widened,
      prePass: async ({ lo, chunks, model, track }) => {
        const material = chunks.map((c, idx) => `[${idx + 1}]${c.supporting ? ' (earlier objective)' : ''} ${c.text.slice(0, 300)}`).join('\n');
        const plan = await completeJson<{ move: string; chains: string; sketch: string }>(
          [
            `You are planning ONE hard finance practice question for the learning objective "${lo}".`,
            'A hard question is a medium question plus ONE deliberate complication. Choose the',
            'single move from this menu that BEST FITS this objective and this material — judge',
            'fit, do not default to the familiar:',
            MOVE_MENU_FOR_PLANNER,
            '',
            'Course material (truncated previews; supporting entries are from earlier objectives',
            'and exist to be chained):',
            material,
            '',
            'Respond with ONLY this JSON shape:',
            '{ "move": string,     // the chosen move, named as in the menu',
            '  "chains": string,   // which concept from which material entry it chains, and how',
            '  "sketch": string }  // one-sentence scenario sketch implementing the move',
          ].join('\n'),
          { model, reasoningEffort: 'low', onUsage: track },
        );
        return {
          appendix: assignmentAppendix(`${plan.move}\n  Chains: ${plan.chains}\n  Scenario: ${plan.sketch}`),
          planned: plan,
        };
      },
    },
    {
      label: 'assigned',
      chunks: widened,
      prePass: async ({ i }) => {
        const move = CURATED_MOVES[(i - 1) % CURATED_MOVES.length];
        return { appendix: assignmentAppendix(move), planned: { move } };
      },
    },
  ],
  cells: [{ fixture: 'ev', difficulty: 'hard' }],
  n: Number(process.env.AB_N ?? 6),
  mode: 'single-shot',
}).then(
  () => process.exit(0),
  (err) => { console.error(err); process.exit(1); },
);
