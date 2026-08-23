/**
 * The regression panel: a fixed cross-section of the course, run the same
 * way every time so "how is generation doing?" has a number instead of an
 * anecdote. Chosen to cover the families the experiments found behave
 * differently — calculation-supported, conceptual, decision-shaped,
 * prerequisite-heavy — across every difficulty and both types.
 *
 * No instructor preset on the main grid: the panel measures the pipeline's
 * own routing, not a preset choice. `count` per cell is small on purpose —
 * breadth beats depth for regression, and the verdict wobble (~30% on
 * borderline cases, exp 31) means soft metrics need the whole panel to mean
 * anything, not one cell.
 */
export interface PanelCell {
  lo: string;
  type: 'mcq' | 'true-false';
  difficulty: 'easy' | 'medium' | 'hard';
  count: number;
  /** What the LO is for, so roll-ups by family are possible. */
  family: 'calculation' | 'conceptual' | 'decision' | 'prerequisite-heavy';
}

const MCQ_LOS: Array<{ lo: string; family: PanelCell['family'] }> = [
  { lo: 'Plan saving, investing, protection', family: 'calculation' },
  { lo: 'Evaluate car affordability', family: 'decision' },
  { lo: 'Explain market efficiency', family: 'conceptual' },
  { lo: 'Estimate expected returns with CAPM', family: 'calculation' },
  { lo: 'Apply NPV and IRR', family: 'calculation' },
  { lo: 'Compare projects with PP and PI', family: 'decision' },
  { lo: 'Calculate unlevered free cash flow', family: 'prerequisite-heavy' },
  { lo: 'Analyze macro drivers of exchange rates', family: 'conceptual' },
];

const TRUE_FALSE_LOS: Array<{ lo: string; family: PanelCell['family'] }> = [
  { lo: 'Evaluate car affordability', family: 'decision' },
  { lo: 'Explain market efficiency', family: 'conceptual' },
  { lo: 'Estimate expected returns with CAPM', family: 'calculation' },
  { lo: 'Distinguish firm vs enterprise value', family: 'conceptual' },
];

export const PANEL: PanelCell[] = [
  ...MCQ_LOS.flatMap(({ lo, family }) =>
    (['easy', 'medium', 'hard'] as const).map((difficulty) => ({ lo, family, difficulty, type: 'mcq' as const, count: 2 }))),
  ...TRUE_FALSE_LOS.flatMap(({ lo, family }) =>
    (['medium', 'hard'] as const).map((difficulty) => ({ lo, family, difficulty, type: 'true-false' as const, count: 2 }))),
];

/** The dev course every experiment has run against. */
export const PANEL_COURSE_ID = '6a7e36845981785988043588';
export const PANEL_REQUESTED_BY = '12345678';
