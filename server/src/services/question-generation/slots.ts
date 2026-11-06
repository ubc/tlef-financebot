import type { QuestionKind, QuestionType } from '../../types/domain';

/** One way of assessing a learning objective. Each slot in a run gets a
 * different angle so questions in one plan cell are distinct by construction. */
export interface AssessmentAngle { id: string; text: string }

export const CONCEPTUAL_ANGLES: readonly AssessmentAngle[] = Object.freeze([
  { id: 'definition-discrimination', text: 'Make the student tell this concept apart from a closely related one the course also teaches.' },
  { id: 'scenario-application', text: 'Describe a short realistic scenario and ask which principle applies or what follows from it.' },
  { id: 'cause-effect', text: 'Ask what happens to one quantity or outcome when another changes, and why.' },
  { id: 'misconception-diagnosis', text: 'Present a student\'s reasoning that contains a common error and ask what is wrong with it.' },
  { id: 'compare-ideas', text: 'Ask the student to compare two related ideas, methods or outcomes from the material.' },
  { id: 'evaluate-claim', text: 'State a claim about the concept and ask the student to judge whether and why it holds.' },
]);

export const CALCULATION_ANGLES: readonly AssessmentAngle[] = Object.freeze([
  { id: 'direct-computation', text: 'Give the inputs and ask for the computed result.' },
  { id: 'reverse-solve', text: 'Give the result and all but one input, and ask for the missing input.' },
  { id: 'interpret-result', text: 'Have the student compute a value and choose what it implies (a decision or interpretation).' },
  { id: 'compare-scenarios', text: 'Give two scenarios and ask which yields the higher or lower value, requiring both to be computed.' },
  { id: 'identify-method', text: 'Ask which formula, step or setup correctly solves the described problem.' },
]);

export function angleMenu(kind: QuestionKind | undefined, type: QuestionType): readonly AssessmentAngle[] {
  if (type === 'true-false' || kind === 'conceptual') return CONCEPTUAL_ANGLES;
  if (kind === 'calculation') return CALCULATION_ANGLES;
  const mixed: AssessmentAngle[] = [];
  const length = Math.max(CONCEPTUAL_ANGLES.length, CALCULATION_ANGLES.length);
  for (let i = 0; i < length; i += 1) {
    if (CONCEPTUAL_ANGLES[i]) mixed.push(CONCEPTUAL_ANGLES[i]);
    if (CALCULATION_ANGLES[i]) mixed.push(CALCULATION_ANGLES[i]);
  }
  return mixed;
}

export interface SlotAssignment {
  item: number;
  angle: AssessmentAngle;
  /** Index into the retrieved chunks this slot should lean on; all chunks are still supplied. */
  focusChunk: number | undefined;
  hardnessMove: string | undefined;
}

/** Stable non-negative hash so the same run always gets the same rotation. */
function seedOffset(seed: string, modulo: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return modulo === 0 ? 0 : hash % modulo;
}

export function allocateSlots(input: {
  count: number;
  kind?: QuestionKind;
  type: QuestionType;
  chunkCount: number;
  seed: string;
  hardnessMoves: (string | undefined)[];
}): SlotAssignment[] {
  const menu = angleMenu(input.kind, input.type);
  const start = seedOffset(input.seed, menu.length);
  return Array.from({ length: input.count }, (_, item) => ({
    item,
    angle: menu[(start + item) % menu.length],
    focusChunk: input.chunkCount > 0 ? item % input.chunkCount : undefined,
    hardnessMove: input.hardnessMoves[item],
  }));
}
