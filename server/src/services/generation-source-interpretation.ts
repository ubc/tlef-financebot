/** Shared v2 instructions, not a deterministic semantic verdict or a new gate.
 * Keep historical baseline/v1 prompts outside this prospective prompt cohort. */
export const V2_SOURCE_INTERPRETATION_RULES = [
  'SOURCE INTERPRETATION: reduce/mitigate != eliminate/diversify away; can/may != must/always/only. Judge the actual claim.',
  'Preserve table actor/category ownership; lists are not exclusive unless the source says only/not. Exact-cell lookup must be stated. Ambiguous layout/exclusivity stays uncertain.',
  'Grade literal True/False against the whole proposition. Correct feedback explaining a wrong choice is not another correct choice. Do not waive ambiguous stems/wrong keys. Fully correct MCQ alternatives are not partly correct.',
  'Compare current/proposed roles before alleging a mislabel; identical roles are not a relabeling defect.',
  'Wrong arithmetic need not be taught if the taught formula refutes it; extra concepts still need source. Inspect all relevant spans. Cite corrections/exclusions; honor explicit restrictions, never invent support or force acceptance.',
].join('\n');
