import { BUILTIN_REFERENCE } from '../../components/formula';
import { STEP_TEMPERATURE_DEFAULTS } from '../step-models';
import type { Difficulty, QuestionKind, QuestionOption, QuestionType } from '../../types/domain';
import type { RetrievedChunk } from './candidate';
import { renderChunks } from './candidate';
import type { AssessmentAngle } from './slots';

export interface RegenerateContext {
  original: { stem: string; options: QuestionOption[] };
  agentDecision?: { decision: string; reasoning: string; roleAssessment?: string; suggestions?: string[] };
  instruction: string;
}

const MAX_RENDERED_STEM = 300;
const clip = (stem: string) => {
  const flat = stem.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_RENDERED_STEM ? `${flat.slice(0, MAX_RENDERED_STEM)}…` : flat;
};

export function renderDistinctnessContext(existingStems: string[], batchStems: string[]): string {
  if (existingStems.length === 0 && batchStems.length === 0) return '';
  return [
    'DISTINCTNESS. The questions below already exist for this learning objective. Do NOT test the same',
    'inference or solution path as any of them. Changing numbers or names does not make a new question.',
    ...(existingStems.length ? ['Existing questions:', ...existingStems.map(stem => `- ${clip(stem)}`)] : []),
    ...(batchStems.length ? ['Written earlier in this batch:', ...batchStems.map(stem => `- ${clip(stem)}`)] : []),
  ].join('\n');
}

function renderRegenerateContext(context: RegenerateContext): string {
  const decision = context.agentDecision;
  return [
    'REWRITE TASK. Produce an improved replacement for the question below. Fix every finding listed.',
    `Original question: ${JSON.stringify(context.original)}`,
    ...(decision ? [
      `Automatic check verdict: ${decision.decision}. ${decision.reasoning}`,
      ...(decision.roleAssessment ? [`Option-role findings: ${decision.roleAssessment}`] : []),
      ...(decision.suggestions?.length ? ['Suggested fixes:', ...decision.suggestions.map(s => `- ${s}`)] : []),
    ] : []),
    `Instructor request: ${context.instruction}`,
  ].join('\n');
}


/** The generator runs warm so a batch (count > 1) yields DISTINCT questions —
 * completeJson defaults to temperature 0, which would make every question in
 * the batch identical. The validator and reviewer stay deterministic (the
 * completeJson default).
 *
 * Lives in `step-models` so the admin console can show it as the generator's
 * effective default instead of pre-filling a `0` that would override it. */
export const GENERATOR_TEMPERATURE = STEP_TEMPERATURE_DEFAULTS.generator;

/** Multi-LO generation: the integration rule shared by the generator and, in
 * its judging form, the validator and reviewer. Listed objectives are a
 * CONTRACT — each must be a step the answer genuinely needs, never a name
 * dropped into the stem. */
export function integrationRule(secondaryLoNames: string[] | undefined, difficulty?: Difficulty): string {
  if (!secondaryLoNames || secondaryLoNames.length === 0) return '';
  return [
    `THIS QUESTION MUST INTEGRATE ${secondaryLoNames.length === 1 ? 'A SECOND LEARNING OBJECTIVE' : 'TWO FURTHER LEARNING OBJECTIVES'}:`,
    ...secondaryLoNames.map((name) => `  - "${name}"`),
    'Answering correctly must genuinely require the primary objective AND each objective',
    'listed above — a step from each, chained into one scenario — never a question about',
    'the primary objective that merely mentions the others. The material for each listed',
    'objective is labeled below by objective; draw on it. The question will be tagged to',
    'every one of these objectives, so a student practicing any of them may be served it.',
    difficulty === 'hard'
      ? 'At target hard, the concept your declared hardness move chains should come from one of'
        + ' the listed objectives rather than from any other material.'
      : '',
  ].filter((line) => line.length > 0).join('\n');
}

/**
 * One rubric, two audiences. The generator sees its TARGET's line; the reviewer
 * sees all three, because it judges whether the label matches. Until 2026-08-17
 * the reviewer had only "a one-step substitution should not pass as medium or
 * hard" — it was grading against definitions it had never been shown.
 *
 * The definitions are the course instructor's own, condensed from the
 * operational rubric in FinanceBot_Difficulty_Ratings.docx (2026-08-21) — the
 * one they applied to all 108 released practice questions. It splits
 * calculation from conceptual demand because the boundaries genuinely differ:
 * a calculation gets harder by chaining concepts, a conceptual question by
 * tightening distractors. See docs/difficulty-ratings-analysis.md.
 */
export const DIFFICULTY_RUBRIC: Record<Difficulty, string> = {
  easy:
    'Easy (calculation): one formula, one concept; no rate or unit conversion beyond '
    + 'a single step — or the conversion IS the entire question (e.g. r = APR/m). '
    + 'Easy (conceptual): direct recall of a definition or fact, with plausible but '
    + 'clearly distinguishable distractors.',
  medium:
    'Medium (calculation): one genuine rate conversion (e.g. APR to effective rate '
    + 'where compounding frequency differs from cash-flow frequency) PLUS one formula '
    + 'application; or one standard formula (bond pricing, Gordon growth) applied to '
    + 'a scenario whose several inputs the student must organize; or rearranging one '
    + 'formula to solve for an unknown (payment, rate, growth rate); a direct formula '
    + 'substitution is too easy. '
    + 'Medium (conceptual): applying a concept to a new scenario, with distractors '
    + 'that require real understanding rather than recall.',
  hard:
    'Hard (calculation): chains MORE THAN TWO distinct concepts or formula types '
    + '(e.g. rate conversion + annuity PV + value-equals-benefit-minus-cost), or '
    + 'requires backward or strategic solving where the approach itself is not given '
    + '(e.g. re-deriving a hidden parameter such as a remaining term or an original '
    + 'payment before the asked-for quantity can be computed). '
    + 'Hard (conceptual): the student must hold two related-but-easily-confused rules '
    + 'in mind at once (annuity vs. annuity due, cum- vs. ex-dividend, coupon rate '
    + 'vs. interest-rate risk), against distractors each built from a single wrong '
    + 'step. Hardness is connections across concepts, never arithmetic size, and the '
    + 'question must remain solvable from the supplied material.',
};

/**
 * How a HARD question is manufactured, not just what one is. The rubric above
 * defines the standard; this is the construction menu behind it — in the
 * instructor's released bank, nearly every HIGH calculation question is a MID
 * question plus exactly ONE of these complications (docs/
 * difficulty-ratings-analysis.md §2). Included in GENERATOR_PROMPT only when
 * the target is `hard`, so easy/medium calls pay nothing for it — the
 * experiment-2 lesson that global prompt additions are not free.
 *
 * A single pre-joined string, exported by name, so an A/B harness can remove
 * the block from a built prompt by exact match.
 */
/**
 * The compact replacement for the moves CATALOG when the move is ASSIGNED
 * (which, since assignMovesForBatch, is every production hard call). The
 * seven-entry menu existed to help the model choose; the server chooses now,
 * and showing seven alternatives next to a decree is noise at best. What
 * survives is what the catalog block smuggled in besides the list: the
 * bank's framing principle, and the conceptual pattern the assignment's
 * escape hatch refers to — without this, the fallback would reference a
 * pattern the prompt no longer defines. ~120 tokens against the menu's ~450.
 */
export const HARDNESS_FRAMING: string = [
  'WHAT MAKES A QUESTION HARD. In this course\'s own released question bank, a hard',
  'question is a medium question plus ONE deliberate complication that hides the',
  'approach. Do NOT enlarge the arithmetic — hardness is connections across',
  'concepts, and what the stem withholds, never bigger numbers.',
  'For a CONCEPTUAL hard question the pattern is: the correct answer requires',
  'holding two related-but-easily-confused rules in mind at once, and every',
  'distractor is built from a SINGLE wrong step a student takes when the rules',
  'blur.',
].join('\n');

export const HARDNESS_MOVES: string = [
  'HOW TO MAKE IT HARD. In this course\'s own released question bank, a hard question',
  'is a medium question plus ONE deliberate complication that hides the approach.',
  'Pick the ONE move that best fits this learning objective and apply it. Do NOT',
  'enlarge the arithmetic — hardness is connections across concepts, and what the',
  'stem withholds, never bigger numbers:',
  '  1. Off-cycle timing: the event happens mid-stream, so a count or remaining term',
  '     must be re-derived rather than read off the stem (value a loan just after',
  '     payment 14 of 36; sell the asset one year after purchase).',
  '  2. Hidden parameter: a needed input (an original payment, a remaining maturity,',
  '     an implied rate) is not given and must be reconstructed from other stated',
  '     terms before the asked-for quantity can even be set up.',
  '  3. Value = benefit minus cost: the computed value is one LEG of a trade; the',
  '     answer is the difference, and identifying the two legs is the real work.',
  '  4. Regime change: a growth rate or rate environment switches partway (fast',
  '     growth for some years, then a steady state), chaining two formulas across',
  '     the boundary and discounting the far side back through the near side.',
  '  5. Deferred start: the stream begins some periods from now, so its standard',
  '     formula value lands at the wrong date and must be discounted again.',
  '  6. Reinvestment chain: interim cash flows are reinvested at a DIFFERENT rate;',
  '     the answer needs their future value plus the terminal piece, then a return.',
  '  7. Two-approach comparison: the same quantity valued two ways (a multiple vs. a',
  '     discounted value), with the question living in the reconciliation.',
  '  8. Payments due today rather than at period-end — combined with another move,',
  '     never alone.',
  'For a CONCEPTUAL hard question, sharpen instead of complicating: the correct',
  'answer must require holding two related-but-easily-confused rules in mind at',
  'once, and every distractor must be built from a SINGLE wrong step a student',
  'takes when the rules blur.',
].join('\n');

/**
 * The declared-move requirement, active only at target `hard`. A single
 * pre-joined string exported by name (like HARDNESS_MOVES) so the A/B harness
 * can strip it from a built prompt by exact match.
 *
 * Why a required FIELD and not more instruction: experiments 22-24 measured
 * the menu + labeled material + connector line producing 1 taken chain in 16
 * draws — description does not compel. The pipeline's own precedent is the
 * difficulty self-assessment: restating the rules fixed nothing (12/12
 * mislabelled), requiring the model to RETURN a judgment fixed labels. A
 * field the model must fill forces the move to be chosen before the stem is
 * written; the reviewer then verifies a concrete claim instead of making a
 * boundary call (the wobble measured in experiments 14 and 24).
 */
export const HARDNESS_MOVE_DECLARATION: string = [
  'DECLARE YOUR MOVE. Include ONE additional field in your JSON:',
  '  "hardnessMove": one sentence naming WHICH hardness move you applied and HOW the',
  'question implements it — specifically what the stem withholds or chains, e.g.',
  '  "off-cycle timing: the loan is valued just after payment 14 of 36, so the',
  '   remaining 22-payment term is never stated and must be derived".',
  'For a conceptual question, name instead the two easily-confused rules the',
  'correct answer requires holding at once. This declaration is CHECKED against',
  'the question: a declared move the question does not implement is flagged, and',
  'a hard question with no declaration at all is rejected before review.',
].join('\n');

/**
 * The assignable hardness moves (experiment 26): at target `hard` the SERVER
 * picks the construction device, because given free choice the generator
 * monocultures — 4/4 "hidden parameter" in experiment 25, and a planner call
 * re-imported the same bias in 26 — while a deterministic rotation produced
 * six distinct faithful builds in six draws, zero substitutions, zero
 * difficulty complaints. Ids are the API surface (GenerationInput.hardnessMove
 * lets an instructor pick one explicitly); texts are the generator-facing
 * instructions. Annuity-due is deliberately absent: the bank never uses it
 * standalone, only stacked on another move.
 */
export const HARDNESS_MOVE_MENU: ReadonlyArray<{ id: string; text: string }> = [
  {
    id: 'two-approach-comparison',
    text: 'two-approach comparison: value the same quantity two different ways (e.g. a '
      + 'multiple vs. a discounted value) and set the question in reconciling or '
      + 'comparing the two results',
  },
  {
    id: 'off-cycle-timing',
    text: 'off-cycle timing: place the decisive event mid-stream, so a count or '
      + 'remaining term must be re-derived rather than read off the stem',
  },
  {
    id: 'benefit-minus-cost',
    text: 'value = benefit minus cost: make the computed value one LEG of a trade or '
      + 'decision, so the answer is the difference between two legs and identifying '
      + 'the legs is part of the work',
  },
  {
    id: 'regime-change',
    text: 'regime change: switch a growth rate or rate environment partway through, '
      + 'chaining two formula stages across the boundary and discounting the far '
      + 'side back through the near side',
  },
  {
    id: 'deferred-start',
    text: 'deferred start: begin the cash-flow stream some periods in the future, so '
      + 'its standard formula value lands at the wrong date and must be discounted '
      + 'again',
  },
  {
    id: 'reinvestment-chain',
    text: 'reinvestment chain: reinvest interim cash flows at a DIFFERENT rate, so '
      + 'the answer needs their future value plus the terminal piece',
  },
  {
    id: 'hidden-parameter',
    text: 'hidden parameter: withhold one genuinely needed input (an original payment, '
      + 'a remaining maturity, an implied rate) so it must be reconstructed from other '
      + 'stated terms first — it must not be a value the stem effectively hands over',
  },
];

/**
 * The generator-facing assignment. The escape hatch is deliberate: assignment
 * steers routing numeric (measured in experiment 26), and on a
 * conceptual-shaped LO a forced calculation move would be a bad fit — the
 * fallback keeps the conceptual hard pattern reachable, with the mismatch
 * recorded in the declaration where criterion 9 and the instructor can see it.
 */
export function HARDNESS_MOVE_ASSIGNMENT(move: string): string {
  return [
    'YOUR HARDNESS MOVE HAS BEEN ASSIGNED for this question. Implement EXACTLY this move:',
    `  ${move}`,
    'Do not substitute a different move. Declare this move, as implemented, in the',
    '"hardnessMove" field.',
    // The subordination clause. Measured 2026-08-21 (experiment 27, FX cell):
    // the escape hatch fired correctly when a move was UNIMPLEMENTABLE, but
    // three technically-implementable moves produced sound arithmetic that
    // displaced the objective — the LO's content became a stem assertion and
    // every question was rejected on criterion 2 ("the student never analyzes
    // how macro drivers influence the rate"). Implementability is not fit.
    'The move is a MEANS of testing the learning objective, never the point of the',
    'question. If implementing it would reduce the objective to a background',
    'assertion — the stem merely ASSERTS the objective\'s content while the student',
    'only exercises the move\'s arithmetic — that is a MISFIT even though the move is',
    'technically implementable. On a misfit of any kind, including when the right',
    'question for this objective is CONCEPTUAL, fall back to the hard pattern the',
    'objective itself supports (for a conceptual objective: two easily-confused',
    'rules, single-wrong-step distractors) and say in the declaration that the',
    'assigned move did not fit and why.',
    // Measured 2026-08-22 on "Compare projects with PP and PI": the natural
    // answer is WHICH project wins, and the generator encoded two rankings
    // into one number (PP_A + PI_B/1000) to satisfy the option contract —
    // collision, wrong key, wrong payback model, all in one question.
    'If implementing the move yields a RANKING or a DECISION ("which project",',
    '"which criterion wins") rather than one quantity, do not encode it as a number.',
    'Either ask for ONE financially meaningful quantity the decision turns on — the',
    'NPV of choosing A over B, the PI of one project, the value given up by picking',
    'the wrong one — or make the question conceptual. Never pack two results into',
    'one displayed value, and never subtract one METRIC from a different metric',
    // Measured 2026-08-22, the live retry: "PP difference minus PI difference"
    // — an arithmetic combination of two unrelated metrics, rejected as a
    // different objective. "Value difference" needed saying in finance terms.
    '("payback difference minus PI difference" is arithmetic, not finance).',
  ].join('\n');
}

export function GENERATOR_PROMPT(params: {
  type: QuestionType;
  loName: string;
  difficulty?: Difficulty;
  prompt?: string;
  chunks: RetrievedChunk[];
  /** The server-assigned (or instructor-chosen) hardness move. Only rendered
   * at target hard; see HARDNESS_MOVE_MENU. */
  assignedMove?: string;
  /** The kind contract from a batch-planner cell. */
  kind?: QuestionKind;
  /** Multi-LO generation: further objectives the question must integrate. */
  secondaryLoNames?: string[];
  angle?: AssessmentAngle;
  focusChunk?: number;
  existingStems?: string[];
  batchStems?: string[];
  regenerate?: RegenerateContext;
}): string {
  const optionCount = params.type === 'mcq' ? 4 : 2;
  const difficultyGuidance = params.difficulty ? DIFFICULTY_RUBRIC[params.difficulty] : '';
  return [
    `You are an expert finance instructor writing ONE ${params.type === 'mcq' ? 'multiple-choice' : 'true/false'} practice question`,
    `for the learning objective: "${params.loName}". The question must assess the learning objective "${params.loName}":`,
    'a question a student could answer without that objective is wrong, however well written.',
    integrationRule(params.secondaryLoNames, params.difficulty),
    params.difficulty ? `Target difficulty: ${params.difficulty}.` : '',
    difficultyGuidance,
    // Measured 2026-08-16: TWELVE OF TWELVE generated questions came back
    // labelled `medium` while the reviewer judged every one of them a one-step
    // substitution. The rule above already said that is too easy — the model was
    // not breaking it so much as echoing the target back as a label. So the fix
    // is not restating the standard, it is asking for a self-assessment.
    'The "difficulty" you RETURN must describe the question you actually wrote, not the',
    'target you were given. Grade your own question honestly: if the stem supplies the',
    'formula and the student performs one substitution, that is "easy" however large the',
    'arithmetic looks. If your question comes out easier than the target, prefer to make',
    'it genuinely harder — require choosing between two approaches, or a step the stem',
    'does not hand over — and only if you cannot, return the honest lower label. A',
    'mislabelled question is worse than an easy one: it is served to students as',
    'evidence of a mastery they have not shown.',
    // With an assignment the seven-entry catalog is dead weight (the server
    // chose) and an invitation to blend; the compact framing keeps the two
    // things the catalog block also carried — the hardness principle and the
    // conceptual pattern the assignment's escape hatch references.
    params.difficulty === 'hard'
      ? (params.assignedMove ? HARDNESS_FRAMING : HARDNESS_MOVES)
      : '',
    params.difficulty === 'hard' ? HARDNESS_MOVE_DECLARATION : '',
    params.difficulty === 'hard' && params.assignedMove
      ? HARDNESS_MOVE_ASSIGNMENT(params.assignedMove)
      : '',
    // The connector (R7): experiment 22 measured the widened pool licensing
    // numeric ambition while the offered chain went untaken 3/3 — the model
    // fell back to its single-concept template on 2 of 3. The material and the
    // menu have to be tied together explicitly.
    params.difficulty === 'hard' && params.chunks.some((chunk) => chunk.supporting && !chunk.supportingLoName)
      ? 'Some chunks below are marked as supporting material from EARLIER learning\n'
        + 'objectives. They are provided precisely so a hardness move can CHAIN one of\n'
        + 'their concepts into this question. A hard question that ignores them and stays\n'
        + 'inside the current objective\'s single concept is probably not hard. The\n'
        + 'question must still primarily TEST the current learning objective — the\n'
        + 'chained concept is a step on the way, never the thing being tested.'
      : '',
    // The kind contract (batch planner, 2026-08-23): a planner cell that says
    // "calculation" is a guarantee, checked deterministically (kindContractMet)
    // — the first dimension of a question to get a contract rather than a
    // preset's suggestion.
    params.kind === 'calculation'
      ? 'THIS QUESTION MUST BE A CALCULATION: set "numericKind": "numeric", with paramSlots '
        + 'and derivedValues as specified below. A question of the other kind is recorded as a defect.'
      : params.kind === 'conceptual'
        ? 'THIS QUESTION MUST BE CONCEPTUAL: set "numericKind": "conceptual", with no '
          + 'paramSlots and no derivedValues — the student reasons about ideas, not '
          + 'arithmetic. A question of the other kind is recorded as a defect.'
        : '',
    params.prompt ? `Additional instruction from the instructor: ${params.prompt}` : '',
    '',
    'Ground the question ONLY in the course material below. Do not introduce facts not supported by it.',
    'Course material:',
    renderChunks(params.chunks),
    '',
    `Produce EXACTLY ${optionCount} options. EXACTLY ONE option has role "correct".`,
    'Every option has a per-option explanation. Assign each non-correct option one role from:',
    '  - "common-misconception": a plausible error a student commonly makes',
    '  - "partially-correct": right idea, incomplete or misapplied',
    '  - "clearly-wrong": obviously incorrect to a prepared student',
    params.type === 'mcq'
      ? 'AT LEAST ONE option MUST be "common-misconception". The practice loop offers '
        + 'its retry only when a student picks one, so a question without it silently '
        + 'loses that behaviour. A question without one is recorded as a defect.'
      : '',
    '',
    'DISTRACTORS ARE WRONG METHODS, NOT WRONG ARITHMETIC. A distractor must be the',
    'number a student actually reaches by reasoning incorrectly — discounting the',
    'wrong number of periods, compounding forward instead of back, dropping a term,',
    'using the wrong rate. Do NOT take the correct formula and mutate an operator:',
    '  good:  PAYMENT*(1+r)^n        compounded forward instead of discounting',
    '  good:  PAYMENT/(1+r)^1        discounted one period regardless of the term',
    '  bad:   SALES*(MULTIPLE^2)     squaring a multiple is not a mistake anyone makes',
    '  bad:   SALES+MULTIPLE         swapping x for + is arithmetic noise',
    '  bad:   (MULTIPLE+1)*SALES     an arbitrary tweak, not a misconception',
    'If you cannot name the student who would make the mistake, it is not a',
    'distractor — find a real one from the course material.',
    '',
    'FORMATTING. The stem, every option, and every explanation are rendered as',
    'markdown with KaTeX math. Write formulas as LaTeX, not as flat ASCII:',
    '  - inline math between single dollars: $PV = \\frac{C}{(1+r)^n}$',
    '  - display math between double dollars for a full worked line:',
    '      $$PV = \\sum_{t=1}^{n} \\frac{C_t}{(1+r)^t}$$',
    'Two rules the renderer imposes, and both fail SILENTLY when broken — the',
    'math renders as literal source text rather than erroring:',
    '  1. Never use \\( \\) or \\[ \\]. The markdown pass runs first and strips',
    '     their backslashes, so KaTeX never sees a delimiter.',
    '  2. A math span must never contain a dollar followed by digits and then a',
    '     space: that reads as a currency amount, not as math. In practice, start',
    '     math with a symbol or a command — never a digit — and keep currency',
    '     symbols OUTSIDE the math:',
    '       good:  A payment of $500 grows to $P \\times 1.05$.',
    '       good:  $\\text{FV} = 500 \\times 1.05$',
    '       bad:   $500 \\times 1.05$      (opens with a digit)',
    '       bad:   $\\$500 \\times 1.05$   (escaped amount, then a space)',
    '     The same applies right after $$: write $$\\text{PV} = \\sum ...$$, never',
    '     $$500 \\times ...$$',
    '  3. Never write a slot or derived-value NAME inside \\text{}. Those names',
    '     contain underscores, and escaping an underscore inside math is where',
    '     stray characters creep in and break the whole span. Use a short symbol',
    '     and let the placeholder carry the number:',
    '       good:  $r = \\frac{R}{100}$ where the rate is {{RATE_PCT}}%',
    '       bad:   $r = \\frac{\\text{RATE_PCT}}{100}$',
    '  4. A placeholder is always exactly {{NAME}}, and its braces are NOT a LaTeX',
    '     group. Wherever LaTeX needs a group around a placeholder or around an',
    '     expression containing one, add that group separately, with spaces:',
    '       good:  $(1+r)^{ {{PERIODS}} }$     $(1+r)^{ {{COMPOUNDS}} / 4 }$',
    '       bad:   $(1+r)^{{PERIODS}}$         $(1+r)^{{COMPOUNDS}/4}$',
    '  5. Write every multiplication explicitly with \\times. A placeholder written',
    '     straight after a fraction, a digit or another placeholder runs into it once',
    '     the numbers are filled in:',
    '       good:  $P\\left(1+\\frac{ {{RATE_PCT}} }{100} \\times {{YEARS}}\\right)$',
    '       bad:   $P\\left(1+\\frac{ {{RATE_PCT}} }{100}{{YEARS}}\\right)$   (shows 4/100 then a stray 2)',
    '  6. DISPLAY A RATE AS A PERCENTAGE, never as a decimal. A rate a student reads',
    '     — a periodic rate, an IRR, a return — is a derivedValue named _PCT whose',
    '     formula is in percent, shown with a percent sign (\\% inside math):',
    '       good:  { "name": "MONTHLY_RATE_PCT", "formula": "APR_PCT/12" }',
    '              ... a monthly rate of {{MONTHLY_RATE_PCT}}%   or   $r_m = {{MONTHLY_RATE_PCT}}\\%$',
    '       bad:   { "name": "MONTHLY_RATE", "formula": "APR_PCT/100/12" } shown as $r_m = {{MONTHLY_RATE}}$',
    '     A decimal rate reads as 0.00487 — harder to check than 0.405%. Keep decimal',
    '     rates for formulas that only other formulas use.',
    'Prose stays prose; only the formulas are LaTeX.',
    'Show the working in the EXPLANATION — that is what that field is for, so a',
    'display line there beats describing the arithmetic in words. Do NOT put the',
    'working in an option: an option states an ANSWER, never the formula that',
    'produces it. See THE OPTION CONTRACT below.',
    '',
    'NUMERICAL QUESTIONS — MANDATORY.',
    'If answering requires ANY computation, set "numericKind": "numeric".',
    'NEVER write a computed number anywhere — not in the stem, an option, or an explanation.',
    'State the inputs as variable slots and every displayed value as a formula; a',
    'deterministic evaluator computes them at serve time, and each student sees different',
    'numbers.',
    // Found 2026-08-22 by the solvability gate: three persisted questions had
    // stems written as ALGEBRA — "the loan principal is $P$, the APR is $A$%"
    // — symbolic names in math, no placeholders, so the student saw letters
    // and no numbers. Unanswerable, and nothing had caught it.
    'The STEM must show every input the answer needs as its {{NAME}} placeholder —',
    '"a principal of ${{PRINCIPAL}} at {{APR_PCT}}% APR" — never as a bare symbol',
    'like $P$ or $A$. A symbolic stem displays no numbers; the question is rejected.',
    '  - "paramSlots": the inputs, e.g.',
    '      [ { "name": "PAYMENT", "min": 100, "max": 900, "step": 100 },',
    '        { "name": "RATE_PCT", "min": 4, "max": 12, "step": 2 } ]',
    '  - "derivedValues": the correct answer AND every distractor, e.g.',
    '      [ { "name": "PV", "formula": "PAYMENT/(1+RATE_PCT/100)^2" },',
    '        { "name": "PV_COMPOUNDED", "formula": "PAYMENT*(1+RATE_PCT/100)^2",',
    '          "errorModel": "compounded forward instead of discounting back" } ]',
    '    These formulas are EVALUATOR syntax and are NEVER LaTeX: they are parsed',
    '    and computed, not displayed. Keep writing PAYMENT/(1+RATE_PCT/100)^2 —',
    '    a \\frac{}{} here fails to parse and the question is rejected. LaTeX',
    '    belongs only in the stem, option and explanation TEXT.',
    '  - BUILD THE ANSWER IN STEPS. "derivedValues" are evaluated IN ORDER, and a',
    '    later formula may use any earlier one BY NAME. Prefer several short named',
    '    steps to one long expression:',
    // Example corrected 2026-08-17. The previous version modelled DEBT_VALUE as
    // PV(y, 16, COUPON) + PV(y, 16, FACE) — under the evaluator's single-sum PV
    // that discounts ONE coupon and drops the other fifteen. This prompt was
    // teaching wrong bond valuation as its own worked "good" example, and three
    // live questions were rejected reproducing it.
    '      good:',
    '        COUPON_PMT   = FACE_DEBT*COUPON_PCT/100',
    '        DEBT_VALUE   = COUPON_PMT*(1-(1+YTM_PCT/100)^-16)/(YTM_PCT/100) + PV(YTM_PCT/100, 16, FACE_DEBT)',
    '        EQUITY_VALUE = SHARES*PRICE',
    '        V            = DEBT_VALUE + EQUITY_VALUE',
    '        COST_EQUITY  = RF_PCT/100 + BETA*MRP_PCT/100',
    // Displayed in PERCENT, deliberately (2026-08-22): a live hard batch
    // reproduced this example with a fraction-valued WACC, and its
    // remaining-term distractor (14 vs 15 years) moved the rate by ~0.0004 —
    // invisible at the two-decimal display, so "0.12" collided with "0.12"
    // on both attempts and all three questions died unservable. The same
    // values in percent, 12.04 vs 12.00, are distinct.
    '        WACC_PCT     = 100*((EQUITY_VALUE/V)*COST_EQUITY + (DEBT_VALUE/V)*(YTM_PCT/100))',
    '      bad:  all of that inlined as one 400-character expression with the',
    '            debt-value sub-expression repeated six times.',
    '    A step that no option displays is perfectly allowed and is exempt from',
    '    the option contract below — name it and reuse it.',
    '    This is not a style preference. Long nested expressions are exactly where',
    '    real generations drop a parenthesis; the parser then reports "trailing',
    '    input after formula" and the question is rejected outright. If a formula',
    '    runs past roughly 100 characters, or nests more than three deep, SPLIT IT.',
    '    If you cannot express a quantity inline, give it its OWN step. Never fill',
    '    the gap with a stand-in: (PV(1,1,1) - PV(1,1,1)) and a hardcoded 2.2e6',
    '    were both produced in real runs — the first is identically zero, so it',
    '    divided the answer by zero on every draw.',
    '    Every distractor MUST carry an "errorModel" naming the specific mistake it',
    '    represents, and its formula must genuinely implement that mistake.',
    '    Name the MISTAKE, never the role. "common-misconception" is a role, not an',
    '    errorModel — a real generation returned exactly that on every distractor',
    '    and the question was flagged as defective. Write "compounded forward instead of',
    '    discounting back" or "used the coupon rate in place of the yield".',
    '    The CORRECT value MUST NOT carry an "errorModel" — it represents no mistake.',
    '    Omit the field entirely rather than describing the right answer in it.',
    '  - THE OPTION CONTRACT — read this twice. It is checked FIRST, before any',
    '    formula is evaluated, so breaking it rejects the question before the',
    '    collision check below is even reached. Three consecutive live',
    '    generations died here.',
    '    An option text IS a value. Not a sentence containing a value — the whole',
    '    option is the quantity, plus at most a currency symbol, unit or percent',
    '    sign, and it carries EXACTLY ONE {{NAME}} from "derivedValues":',
    '      good:  "${{PV}}"',
    '      good:  "{{IRR_PCT}}%"',
    '      bad:   "${{PAYMENT}}"                  an INPUT slot is not an answer',
    '      bad:   "-{{CF0}} + {{CF1}}/(1+r)"      the formula, not the answer',
    '      bad:   "Accept the project"            no computed value at all',
    '      bad:   "Accept the project. {{NPV}}"   a sentence with a value stapled',
    '             on. This is the worst of the four: it passes the automatic',
    '             check and reaches a student as a decision followed by an',
    '             unrelated number. If you find yourself appending a value to a',
    '             sentence to satisfy this rule, the question is CONCEPTUAL —',
    '             go and set "numericKind": "conceptual" instead.',
    '    Input-slot placeholders may also appear in an option, but they do not',
    '    count toward this rule and can never stand in for the derived value.',
    '    Two options must never name the same derived value.',
    '    The STEM may use slot placeholders freely — this rule is about options.',
    '',
    'Formula syntax: + - * / ^ ( ), variable names, and these functions only:',
    // The semantics block replaced a bare signature list on 2026-08-17, after a
    // live batch modelled bond value as PV(y, n, COUPON) + PV(y, n, FACE) —
    // Excel's reading of PV, which drops all but one coupon here. A name is not
    // a definition; the model fills undocumented signatures from its training.
    BUILTIN_REFERENCE,
    '  SUM(index, from, to, body) for series such as duration or amortization.',
    'These functions are shorthand, not a limit: any closed-form finance formula can be',
    'written with arithmetic alone (CAPM is RF + BETA*MRP; Gordon growth is D1/(R-G)).',
    'Transcribe the formula the course material itself uses.',
    '',
    'That list is the WHOLE grammar. There are no comparisons (> < >= <= == !=),',
    'no conditionals, no ternary ?:, no booleans, and no if(). A formula like',
    '"max(1, min(2, (PI_X>0?1:0) + (PI_Y>0?1:0)))" does not parse and the question',
    'is rejected. If you are reaching for a comparison, you are encoding a DECISION',
    'as a number — that question is "conceptual", not "numeric".',
    '',
    'Two rules the automatic verifier enforces — a question breaking either is rejected:',
    '  1. Ranges must never let a formula break. A rate a formula divides by must not',
    '     include 0, and no range may drive a value beyond about 1e12.',
    '  2. Option values must differ for EVERY combination of values in range.',
    '',
    'THE PAIRWISE COLLISION CHECK — do this before you answer, it is the single most',
    'common reason a question is rejected. Take every PAIR of option formulas, set them',
    'equal, and solve. If any solution falls inside the declared ranges, the two options',
    'show the same number on that draw and the question is unanswerable. Examples of',
    'pairs that look fine and are not:',
    '  - "A" and "B" (two bare slot values) are equal wherever their ranges OVERLAP.',
    '  - "A - B" and "B" are equal when A = 2*B.',
    '  - "A - B" and "B - A" are equal when A = B (both 0).',
    '  - "A * (1+r)^n" and "A" are equal when n can draw 0.',
    // The identity-element family. Added 2026-08-16 after it caused FIVE OF SIX
    // verification failures in one measured batch, every time via BETA=1.0 — the
    // list above covers overlapping slots, doubling and a zero exponent, and the
    // model checked those faithfully while missing this one entirely.
    '  - A MULTIPLIER that can draw exactly 1. "RF + BETA*(M - RF)" and the "ignored',
    '    beta" distractor "RF + (M - RF)" are the same expression when BETA = 1, so a',
    '    beta range of 0.5..2.0 step 0.5 is unservable — 1.0 is one of its draws.',
    '  - An ADDEND or a rate that can draw exactly 0, which makes a "forgot this term"',
    '    distractor identical to the correct answer on that draw.',
    'This family is the one that gets missed: the two formulas look different because',
    'one has a factor the other lacks, and they are still identical at the draw where',
    'that factor is the identity. Whenever a distractor differs from the correct answer',
    'by REMOVING a multiplier, check whether that multiplier can draw 1; by removing an',
    'added term, whether it can draw 0. If it can, EXCLUDE that value from the range or',
    'change the mistake. Check the exclusion by listing the draws, because min/max alone',
    'hides it: BETA 1.1..2.0 step 0.3 gives 1.1, 1.4, 1.7, 2.0 and never draws 1.0, but',
    'BETA 0.6..2.0 step 0.4 gives 0.6, 1.0, ... and still does.',
    '',
    'THE FIX, and prefer this one: give the slots DISJOINT, WELL-SEPARATED ranges. If A',
    'is always far larger than B, then A never equals B, A-B never equals B, and A+B',
    'never equals either. For a firm with cash in and cash out, use something like',
    'CASH_IN 3000..5000 and CASH_OUT 200..1000 rather than two ranges that both span',
    '200..5000. Separated ranges are also more realistic than overlapping ones.',
    'If separation is impossible, change the mistake instead: use a wrong rate, a',
    'dropped term, or a wrong operand rather than a formula that can coincide.',
    '',
    'Two collision traps seen in real generations, both from distractors that are',
    'RATIOS or PERCENTAGES rather than amounts — the sizes cancel, so widening the',
    'ranges does not separate them:',
    '  - a distractor that differs only by a factor which some draw makes 1;',
    '  - two "wrong rate" distractors whose rates coincide where their ranges meet.',
    'For a ratio-valued answer, separate it by the STRUCTURE of the mistake (a',
    'dropped term, a wrong denominator), not by the input ranges.',
    'And DISPLAY every rate or ratio in PERCENT: multiply by 100, name it *_PCT, show',
    'it as "{{NAME_PCT}}%". Options render at two decimals, so a fraction-valued rate',
    'hides any difference under 0.005 — a distractor that shifts a WACC by 0.0004',
    '(one year of remaining term) collides with the correct 0.12 while 12.04% and',
    '12.00% are distinct. Timing and hidden-term moves produce exactly such small',
    'shifts on rate-valued answers; percent display is what keeps them servable.',
    // Added 2026-08-22 after the live re-run: with percent display in place,
    // the batch STILL collided six times on first attempts — "used the
    // original term instead of the remaining term" distractors came out
    // identical to the correct answer at the cent (872117.12 = 872117.12),
    // i.e. an identity at the draw, not a rounding miss. A term-shift move
    // makes the obvious distractor an input-range difference, which is the
    // collision family the rule above already forbids — it needed naming for
    // this move specifically. Option B rescued all three, at ~3x the cost.
    'When your hardness move SHIFTS a term or count (remaining maturity, payments',
    'already made, a deferred start), do NOT build a distractor from the unshifted',
    'value — "used the original term", "forgot the elapsed years". That distractor',
    'differs from the correct answer only by the shift, which is a tiny rate change',
    'or exactly zero when the shift draws 0, and it collides. Make the elapsed or',
    'deferred quantity a slot that never draws 0, and build every distractor from a',
    'STRUCTURALLY different mistake (book weights, coupon rate for yield, a dropped',
    'leg) — never from the term alone.',
    '',
    'If answering requires NO computation, set "numericKind": "conceptual" and omit',
    'paramSlots and derivedValues entirely.',
    // 2026-09-14: a conceptual question came back with "a down payment in
    // {{YEARS_SHORT}} years" — no slots, so the student read the braces.
    'A conceptual question therefore has NO {{placeholders}} anywhere. Any number it',
    'mentions is a fixed fact written out plainly: "a down payment in 5 years", never',
    '"a down payment in {{YEARS}} years".',
    '',
    'ALSO conceptual, even though arithmetic is involved: a question whose OPTIONS',
    'are decisions or statements rather than values — "Accept the project" /',
    '"Reject the project", "The NPV rule and the IRR rule agree", and so on. Those',
    'options cannot satisfy the option contract, because there is no single',
    'computed value for them to display. Pick one shape and commit to it:',
    '  - want the decision tested? -> "conceptual", no slots, no derivedValues;',
    '  - want the arithmetic tested? -> "numeric", and every option is a VALUE.',
    'Do not try to have both in one question.',
    '',
    'Respond with ONLY this JSON shape:',
    '{ "stem": string, "difficulty": "easy"|"medium"|"hard", "sourceChunkIndexes": [number],',
    '  "numericKind": "numeric"|"conceptual",',
    '  "paramSlots": [ { "name": string, "min": number, "max": number, "step": number } ],',
    '  "derivedValues": [ { "name": string, "formula": string, "errorModel": string } ],',
    '  "options": [ { "key": string, "text": string, "role": string, "explanation": string } ] }',
    '"sourceChunkIndexes" lists the [n] labels of the course-material passages the question relies on.',
    params.type === 'mcq'
      ? 'Use option keys "A","B","C","D".'
      // Measured 2026-08-22: three true/false questions at target hard came
      // back as TWO-OPTION NUMERIC questions — options "${{S}}" / "${{S_WRONG}}"
      // under keys T/F — because nothing above said a true/false question is
      // a claim, and the numeric machinery plus an assigned calculation move
      // pulled it numeric. All three were rejected. This is a contract, and
      // trueFalseShapeValid enforces it deterministically.
      : [
        'Use option keys "T","F". A TRUE/FALSE QUESTION IS A CLAIM, NOT A CALCULATION:',
        'the stem asserts one statement, the options are EXACTLY the texts "True" and',
        '"False", and "numericKind" is ALWAYS "conceptual" with no paramSlots and no',
        'derivedValues — numbers in the stem, if any, are fixed and the student',
        'reasons about the claim. A hard true/false question is the conceptual hard',
        'pattern: the claim is true or false only when two easily-confused rules are',
        'held together. Never put a computed value in an option.',
      ].join('\n'),
    '',
    params.angle ? `ASSESSMENT ANGLE for this question: ${params.angle.text}` : '',
    params.focusChunk !== undefined ? `Lean primarily on material [${params.focusChunk + 1}].` : '',
    renderDistinctnessContext(params.existingStems ?? [], params.batchStems ?? []),
    params.regenerate ? renderRegenerateContext(params.regenerate) : '',
  ]
    .filter(Boolean)
    .join('\n');
}
