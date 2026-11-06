import type {
  Difficulty,
  OptionRole,
  QuestionKind,
  QuestionOption,
  QuestionType,
  ParamSlot,
  DerivedValue,
  NumericVerification,
} from '../../types/domain';
import type { PedagogicalTaskDescriptor } from '../../types/authoring-task';
import {
  optionValueNamesForVerification,
  verifyQuestionNumerics,
  undisplayedInputs,
  optionFormatsConsistent,
  placeholderSyntaxFailure,
} from '../numeric-verification.service';
import { HARDNESS_MOVE_MENU } from './generator-prompt';

export const OPTION_ROLES: ReadonlySet<OptionRole> = new Set<OptionRole>([
  'correct',
  'common-misconception',
  'partially-correct',
  'clearly-wrong',
]);
export const DIFFICULTIES: ReadonlySet<Difficulty> = new Set<Difficulty>(['easy', 'medium', 'hard']);
export const DECISIONS = new Set(['pass', 'flag', 'reject']);

export interface RetrievedChunk {
  materialId?: string;
  chunkIndex?: number;
  text: string;
  /** From an EARLIER learning objective's materials, retrieved only for hard
   * targets so a hardness move has a second concept to chain (R7). Rendered
   * with an explicit label so the model — and the reviewer judging grounding —
   * can tell support apart from the LO's own material. */
  supporting?: boolean;
  /** Set when the supporting chunk came from an instructor-chosen SECONDARY
   * objective rather than R7's automatic earlier-objective pool, so the
   * label can name the objective the question must integrate. */
  supportingLoName?: string;
}

export interface GeneratorOutput {
  stem: string;
  options: QuestionOption[];
  difficulty?: string;
  taskDescriptor?: PedagogicalTaskDescriptor;
  /** Required at target `hard` (enforced in generateValidQuestion): one
   * sentence naming which hardness move the question applies and how. The
   * reviewer verifies the claim against the question — structure over
   * exhortation, the same mechanism as the difficulty self-assessment.
   * Measured need: experiments 22-24, where the moves menu plus labeled
   * material produced 1 taken chain in 16 draws — description alone does
   * not compel. */
  hardnessMove?: string;
  // Parameterization (design spec 2026-08-05). A numerical question states no
  // numbers: it declares its inputs as `paramSlots` and every displayed value
  // — the correct answer and each distractor — as a `derivedValues` formula.
  numericKind?: 'numeric' | 'conceptual';
  paramSlots?: ParamSlot[];
  derivedValues?: DerivedValue[];
}

/** One move per question in a hard batch (experiment 26): rotation from a
 * random start guarantees distinct constructions within a batch, which also
 * attacks the batch-diversity problem open since experiment 1. An explicit
 * instructor choice applies to every question in the batch — they picked it
 * deliberately. Non-hard targets get no assignment at all. */
/** The assignment for a hard TRUE/FALSE question: the menu's moves are
 * calculation devices, and assigning one to a claim is what produced
 * two-option numerics (2026-08-22). The conceptual pattern is the only hard
 * construction a claim supports, so it is assigned directly. */
export const TRUE_FALSE_HARD_MOVE =
  'conceptual two-rule claim: the statement is true or false only when two '
  + 'related-but-easily-confused rules are held together (annuity vs. annuity due, '
  + 'cum- vs. ex-dividend, coupon rate vs. interest-rate risk); the single wrong '
  + 'option must be what a student concludes when the rules blur';

export function assignMovesForBatch(
  difficulty: Difficulty | undefined,
  hardnessMove: string | undefined,
  count: number,
  type: QuestionType = 'mcq',
): (string | undefined)[] {
  if (difficulty !== 'hard') return Array.from({ length: count }, () => undefined);
  if (type === 'true-false') return Array.from({ length: count }, () => TRUE_FALSE_HARD_MOVE);
  if (hardnessMove) {
    const chosen = HARDNESS_MOVE_MENU.find((move) => move.id === hardnessMove);
    if (!chosen) throw new Error('generation-unknown-hardness-move');
    return Array.from({ length: count }, () => chosen.text);
  }
  const start = Math.floor(Math.random() * HARDNESS_MOVE_MENU.length);
  return Array.from(
    { length: count },
    (_, i) => HARDNESS_MOVE_MENU[(start + i) % HARDNESS_MOVE_MENU.length]!.text,
  );
}


/**
 * Strips C0/C7 control characters from generated display text.
 *
 * The generator intermittently emits a stray control character mid-word —
 * `\text{DISC<U+0002>PCT}` in a stem on 2026-08-13, then a U+001D inside an
 * explanation on the next run. They survive `JSON.parse` (the model emits them
 * as `\uXXXX` escapes), are invisible in logs and in the DB shell, and kill the
 * KaTeX span they land in. Prompt guidance did NOT stop it recurring, so this
 * is deterministic rather than advisory, and sits at the one place every
 * generator output passes through.
 *
 * Tab and newline are deliberately kept: explanations legitimately use them.
 */
export function stripControlChars(text: string): string {
  // A code-point filter rather than a regex: a character class covering C0
  // would have to contain literal control characters, which are invisible in
  // the source and do not survive most editors intact.
  return [...String(text)]
    .filter((ch) => {
      const cp = ch.codePointAt(0) ?? 0;
      const isC0 = cp < 0x20 && cp !== 0x09 && cp !== 0x0a;
      return !isC0 && cp !== 0x7f;
    })
    .join('');
}

/** Applied only after optionShapeValid, which guarantees the string fields. */
export function sanitizeGenerated(candidate: GeneratorOutput): GeneratorOutput {
  return {
    stem: stripControlChars(candidate.stem),
    options: candidate.options.map((option) => ({
      key: option.key,
      role: option.role,
      text: stripControlChars(option.text),
      explanation: stripControlChars(option.explanation),
    })),
    // Model output cannot supply trusted verification, source provenance or
    // approval fields. Those are computed and bound by the server afterward.
    ...(candidate.difficulty !== undefined ? { difficulty: candidate.difficulty } : {}),
    ...(candidate.numericKind !== undefined ? { numericKind: candidate.numericKind } : {}),
    ...(candidate.paramSlots !== undefined ? { paramSlots: candidate.paramSlots } : {}),
    ...(candidate.derivedValues !== undefined ? { derivedValues: candidate.derivedValues } : {}),
    ...(candidate.taskDescriptor !== undefined ? { taskDescriptor: candidate.taskDescriptor } : {}),
    ...(typeof candidate.hardnessMove === 'string'
      ? { hardnessMove: stripControlChars(candidate.hardnessMove) }
      : {}),
  };
}

/** A true/false candidate is a CLAIM: its options are the texts "True" and
 * "False" and it carries no numeric machinery. Deterministic because the
 * prompt alone did not hold (2026-08-22: 3/3 true/false questions at hard
 * came back as two-option numerics) and because the reviewer, judging them as
 * malformed MCQs, was spending Option-B retries on a fault this check can
 * refuse before any review call. MCQ candidates pass through untouched. */
export function trueFalseShapeValid(type: QuestionType, candidate: GeneratorOutput): boolean {
  if (type !== 'true-false') return true;
  if (candidate.numericKind === 'numeric') return false;
  if ((candidate.paramSlots?.length ?? 0) > 0 || (candidate.derivedValues?.length ?? 0) > 0) return false;
  const texts = candidate.options.map((option) => String(option.text).trim().toLowerCase());
  return texts.includes('true') && texts.includes('false');
}

/** The kind contract (batch planner, 2026-08-23). Until now the kind of a
 * question was the one dimension with no contract: the generator chose
 * numericKind freely and a preset could only ask. A planner cell that says
 * "1 calculation" has to be a guarantee, so a candidate of the other kind is
 * refused like a shape failure and regenerated. No contract → free choice,
 * as before. */
export function kindContractMet(kind: QuestionKind | undefined, candidate: GeneratorOutput): boolean {
  if (kind === undefined) return true;
  return kind === 'calculation' ? candidate.numericKind === 'numeric' : candidate.numericKind !== 'numeric';
}

/** A hard candidate must DECLARE its hardness move (prompt: the
 * HARDNESS_MOVE_DECLARATION block). Deliberately narrow, like
 * errorModelsNameMistakes: only absence/emptiness is rejected here — whether
 * the declared move is actually IMPLEMENTED is the reviewer's criterion 9,
 * which is a judgment this deterministic gate cannot make. Non-hard targets
 * are exempt: the prompt never asks them for the field. */
export function hardnessMoveDeclared(
  difficulty: Difficulty | undefined,
  candidate: GeneratorOutput,
): boolean {
  if (difficulty !== 'hard') return true;
  return typeof candidate.hardnessMove === 'string' && candidate.hardnessMove.trim().length > 0;
}

/** Structural pre-check before spending validator/reviewer calls. createQuestion
 * remains the authoritative invariant guard (defense in depth). */
export function optionShapeValid(type: QuestionType, options: unknown): boolean {
  const expected = type === 'mcq' ? 4 : 2;
  if (!Array.isArray(options) || options.length !== expected) return false;
  const correct = options.filter((o) => o && (o as QuestionOption).role === 'correct');
  if (correct.length !== 1) return false;
  // An MCQ must carry at least one common-misconception. This is not a style
  // rule: decideStrategy (attempts.service.ts) applies Strategy A ONLY when the
  // student picks a common-misconception, so an MCQ without one silently opts
  // out of the retry gate and is Strategy B in every case. A real generation on
  // 2026-08-14 produced correct/clearly-wrong/clearly-wrong/partially-correct
  // and nothing noticed. True/False needs no check — assertOptionInvariants
  // coerces its single wrong option to common-misconception by design.
  if (type === 'mcq') {
    const misconceptions = options.filter(
      (o) => o && (o as QuestionOption).role === 'common-misconception',
    );
    if (misconceptions.length === 0) return false;
  }
  return options.every((o) => {
    const opt = o as QuestionOption;
    return (
      o &&
      typeof opt.key === 'string' &&
      typeof opt.text === 'string' &&
      typeof opt.explanation === 'string' &&
      OPTION_ROLES.has(opt.role)
    );
  });
}

/**
 * An `errorModel` must name the MISTAKE, not restate the option's role. A real
 * generation returned `errorModel: "common-misconception"` on every distractor,
 * which is the field's whole value thrown away — the reviewer and the
 * instructor both read it to judge whether a distractor is honest.
 *
 * Deliberately narrow: only an errorModel that is NOTHING BUT a role name is
 * rejected. `"common-misconception: inverting the multiple"` is noisy but does
 * name the mistake, so it passes. Checked here rather than in
 * verifyGeneratedNumerics because a failure there denies the proof and the
 * question can never serve — disproportionate for a metadata wording problem.
 * A retry is the proportionate response.
 */
export function errorModelsNameMistakes(candidate: GeneratorOutput): boolean {
  return (candidate.derivedValues ?? []).every((derived) => {
    const model = String(derived.errorModel ?? '').trim().toLowerCase();
    if (model === '') return true; // absent is the CORRECT value's contract
    return !OPTION_ROLES.has(model as QuestionOption['role']);
  });
}

export function normalizeDifficulty(value: unknown): Difficulty {
  return typeof value === 'string' && DIFFICULTIES.has(value as Difficulty) ? (value as Difficulty) : 'medium';
}

export function normalizeDecision(value: unknown): 'pass' | 'flag' | 'reject' {
  // Default to 'flag' when the reviewer returns something unexpected: surface it
  // for a human rather than silently 'pass'.
  return typeof value === 'string' && DECISIONS.has(value) ? (value as 'pass' | 'flag' | 'reject') : 'flag';
}

// --- Prompts (exported so Phase 4 content QA can tune them independently) -----

export function renderChunks(chunks: RetrievedChunk[]): string {
  return chunks
    .map((chunk, i) =>
      chunk.supportingLoName
        ? `[${i + 1}] [Material for the learning objective "${chunk.supportingLoName}", which this `
          + `question must ALSO genuinely require — see the integration rule above.]\n${chunk.text}`
        : chunk.supporting
          ? `[${i + 1}] [Supporting material from an EARLIER learning objective, already taught `
            + `to these students. You may chain its concepts into the question, but the question `
            + `must still primarily test the current learning objective.]\n${chunk.text}`
          : `[${i + 1}] ${chunk.text}`)
    .join('\n\n');
}

/**
 * Verifies a generated numerical question's formulas before the version is
 * written, so an unverifiable one lands in review already carrying its reason
 * instead of looking approvable.
 *
 * Returns the parameterization fields to spread into `createQuestion`, plus an
 * optional `failure` note to append to the reviewer's reasoning. A conceptual
 * question has nothing to verify numerically, but it is still checked for
 * placeholders: it has no slots, so any `{{NAME}}` in it reaches the student
 * verbatim (2026-09-14, "a down payment in {{YEARS_SHORT}} years").
 *
 * `optionValueNames` is derived from which derived values the options actually
 * display: a helper value used only as an intermediate step in another formula
 * is legitimately allowed to collide with an option's value, and demanding
 * distinctness from it would reject sound questions.
 */
export function verifyGeneratedNumerics(generated: GeneratorOutput): {
  fields: {
    numericKind?: 'numeric' | 'conceptual';
    paramSlots?: ParamSlot[];
    derivedValues?: DerivedValue[];
    verification?: NumericVerification;
  };
  failure?: string;
} {
  if (generated.numericKind !== 'numeric') {
    const fields = generated.numericKind ? { numericKind: generated.numericKind } : {};
    const texts = [generated.stem, ...generated.options.flatMap((option) => [option.text, option.explanation ?? ''])];
    const slot = texts.map((text) => /\{\{\s*([A-Za-z_]\w*)\s*\}\}?/.exec(text)?.[1]).find(Boolean);
    if (slot) {
      return {
        fields,
        failure: `this question is conceptual, so it has no paramSlots and {{${slot}}} can never be replaced by a `
          + `number — the student would read "{{${slot}}}" as written. Write the value itself as a plain fixed `
          + 'number (for example "a down payment in 5 years"), or make the question numeric and declare '
          + `${slot} as a paramSlot`,
      };
    }
    const failure = placeholderSyntaxFailure(generated, []);
    return failure ? { fields, failure } : { fields };
  }

  const paramSlots = generated.paramSlots ?? [];
  const derivedValues = generated.derivedValues ?? [];
  const base = { numericKind: 'numeric' as const, paramSlots, derivedValues };

  if (derivedValues.length === 0) {
    return {
      fields: base,
      failure: 'declared numeric but supplied no derivedValues, so no value could be computed',
    };
  }

  const placeholders = placeholderSyntaxFailure(generated, [...paramSlots, ...derivedValues].map((entry) => entry.name));
  if (placeholders) return { fields: base, failure: placeholders };

  const optionValues = optionValueNamesForVerification(
    generated.options.map((option) => option.text),
    derivedValues.map((derived) => derived.name),
  );
  if (!optionValues.ok) {
    return { fields: base, failure: optionValues.error };
  }

  const formats = optionFormatsConsistent(generated.options.map((option) => option.text));
  if (!formats.ok) {
    return {
      fields: base,
      failure: `options must all display the same quantity in the same format, but they use `
        + `${formats.templates.map((t) => `"${t}"`).join(' and ')} — a differently formatted option `
        + 'gives the answer away and compares unlike quantities; make every option the same '
        + 'unit and template',
    };
  }

  const result = verifyQuestionNumerics({
    stem: generated.stem,
    slots: paramSlots,
    derivedValues,
    optionValueNames: optionValues.names,
    optionCurrency: optionValues.currency,
  });
  if (!result.ok) {
    return {
      fields: base,
      failure: `${result.error}${result.failingSeed !== undefined ? ` (seed ${result.failingSeed})` : ''}`,
    };
  }

  // The solvability gate (2026-08-22, third sighting in a week: exps 27b, 28
  // and a live batch): a slot the CORRECT answer depends on that the stem
  // never displays. Every value computes, distinctness proves, and the student
  // cannot solve the question because an input was never shown. Distractor-
  // only slots are exempt — error models need no solvability. Checked AFTER
  // distinctness so a colliding question reports the collision, whose retry
  // feedback is the more specific of the two.
  const correctOption = generated.options.find((option) => option.role === 'correct');
  const correctName = correctOption?.text.match(/\{\{(\w+)\}\}/)?.[1];
  if (correctName) {
    const missing = undisplayedInputs({
      slots: paramSlots, derivedValues, rootName: correctName, stem: generated.stem,
    });
    if (missing.length > 0) {
      return {
        fields: base,
        failure: `the correct answer depends on ${missing.map((name) => `{{${name}}}`).join(', ')} but the stem `
          + 'never displays it, so the student has no way to compute the answer — show every input the '
          + 'correct value needs in the stem',
      };
    }
  }
  return { fields: { ...base, verification: result.verification } };
}

/** The reviewer's earned label, persisted only when it is a real difficulty —
 * the model may emit anything, and a bad value must not reach the editor. */
export function suggestedDifficultyField(value: unknown): { suggestedDifficulty?: Difficulty } {
  return typeof value === 'string' && DIFFICULTIES.has(value as Difficulty)
    ? { suggestedDifficulty: value as Difficulty }
    : {};
}

/** Appends a verification failure to the reviewer's reasoning so the instructor
 * sees WHY the question will not serve, right where they read the review. */
export function withVerificationNote(reasoning: string, failure?: string): string {
  return failure ? `${reasoning}\n\nNumeric verification FAILED: ${failure}` : reasoning;
}
