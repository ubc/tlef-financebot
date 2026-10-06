import { createHash } from 'node:crypto';
import { z } from 'zod';

const id = z.string().min(1).max(160);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const text = z.string().max(40000);
export const PolicySchema = z.enum(['baseline', 'grounded-memory-v1']);
export const IssueSchema = z.enum(['present', 'absent', 'uncertain']);
export const issueDimensions = ['sourceScope', 'notation', 'duplication', 'difficulty', 'answerQuality'] as const;
export type IssueDimension = typeof issueDimensions[number];

export const QuestionSchema = z.object({
  type: z.enum(['mcq', 'true-false']), stem: text,
  options: z.array(z.object({ key: z.string().max(80), text,
    role: z.enum(['correct', 'common-misconception', 'partially-correct', 'clearly-wrong']), explanation: text }).strict()).max(8),
  numericKind: z.enum(['numeric', 'conceptual']).optional(),
  paramSlots: z.array(z.object({ name: id, description: text.optional(), min: z.number().finite().optional(), max: z.number().finite().optional(), step: z.number().finite().optional(), values: z.array(z.number().finite()).max(200).optional() }).strict()).max(32).optional(),
  derivedValues: z.array(z.object({ name: id, formula: text, errorModel: text.optional() }).strict()).max(32).optional(),
}).strict();
export type EvaluationQuestion = z.infer<typeof QuestionSchema>;

export const ContextSchema = z.object({
  objective: z.string().min(1).max(4000),
  request: z.object({ type: z.enum(['mcq', 'true-false']), difficulty: z.enum(['easy', 'medium', 'hard', 'mixed']), count: z.number().int().min(1).max(100), instruction: text }).strict(),
  sources: z.array(z.object({ id, role: z.enum(['primary', 'secondary', 'prerequisite']), text }).strict()).max(200),
  bank: z.array(z.object({ id, content: QuestionSchema }).strict()).max(200),
  coverage: z.object({ sourcesComplete: z.boolean(), bankComplete: z.boolean(), notes: z.array(z.string().max(2000)).max(30) }).strict(),
}).strict().superRefine((value, ctx) => {
  for (const field of ['sources', 'bank'] as const) if (new Set(value[field].map(row => row.id)).size !== value[field].length) ctx.addIssue({ code: 'custom', path: [field], message: 'Context identifiers must be unique.' });
});
export type EvaluationContext = z.infer<typeof ContextSchema>;
export const CaseSchema = z.object({ caseId: id, repetitions: z.number().int().min(1).max(100), context: ContextSchema }).strict();

export const UsageSchema = z.object({
  status: z.enum(['complete', 'partial', 'pending', 'unavailable']),
  inputTokens: count.nullable(), outputTokens: count.nullable(), totalTokens: count.nullable(),
  observedCalls: count, unknownCalls: count, pendingCalls: count, coverageGaps: count,
  untracked: z.boolean(),
}).strict().superRefine((usage, ctx) => {
  if (usage.status === 'complete' && (usage.inputTokens === null || usage.outputTokens === null || usage.totalTokens === null || usage.unknownCalls || usage.pendingCalls || usage.coverageGaps || usage.untracked)) ctx.addIssue({ code: 'custom', message: 'Complete usage requires known totals and no recorded coverage gaps.' });
});

export const CandidateSchema = z.object({ content: QuestionSchema, contentHash: hash, truncated: z.boolean() }).strict().superRefine((candidate, ctx) => {
  if (candidate.contentHash !== hashValue(candidate.content)) ctx.addIssue({ code: 'custom', path: ['contentHash'], message: 'Candidate hash does not match the supplied content.' });
});
const verdict = z.enum(['pass', 'fail', 'uncertain']).nullable();
export const SlotSchema = z.object({
  item: z.number().int().min(0).max(99), outcome: z.enum(['saved', 'withheld', 'failed', 'missing']),
  candidate: CandidateSchema.nullable(),
  automatic: z.object({ sourceScope: verdict, notation: verdict, duplication: verdict, gate: z.enum(['eligible', 'withheld']).nullable() }).strict(),
  numerical: z.enum(['verified', 'failed', 'not-applicable', 'unknown']),
  limitations: z.array(z.string().max(2000)).max(30),
}).strict();
export const RunSchema = z.object({
  runId: id, caseId: id, repetition: z.number().int().min(1).max(100), policy: PolicySchema,
  contextHash: hash.nullable(),
  comparison: z.object({ contextTiming: z.enum(['before-generation', 'retrospective', 'unrecorded', 'synthetic']), isolated: z.boolean().nullable(), controlsHash: hash.nullable() }).strict(),
  requestedSlots: z.number().int().min(1).max(100),
  slots: z.array(SlotSchema).min(1).max(100),
  usage: UsageSchema,
  elapsedMs: z.number().finite().nonnegative().nullable(),
  limitations: z.array(z.string().max(2000)).max(30),
}).strict().superRefine((run, ctx) => {
  if (run.slots.length !== run.requestedSlots || new Set(run.slots.map(slot => slot.item)).size !== run.requestedSlots || run.slots.some(slot => slot.item >= run.requestedSlots)) ctx.addIssue({ code: 'custom', path: ['slots'], message: 'Every requested slot must occur exactly once, including failures and missing outputs.' });
});

export const DatasetSchema = z.object({
  schemaVersion: z.literal('financebot-quality-evaluation-v1'), experimentId: id,
  origin: z.enum(['synthetic', 'recorded']), rubricVersion: z.literal('financebot-teacher-v1'),
  cases: z.array(CaseSchema).min(1).max(100), runs: z.array(RunSchema).min(1).max(200),
  limitations: z.array(z.string().max(2000)).max(30),
}).strict().superRefine((dataset, ctx) => {
  const unique = (values: string[], name: string) => { if (new Set(values).size !== values.length) ctx.addIssue({ code: 'custom', path: [name], message: `${name} must be unique.` }); };
  unique(dataset.cases.map(row => row.caseId), 'cases'); unique(dataset.runs.map(row => row.runId), 'runs');
  unique(dataset.runs.map(row => JSON.stringify([row.caseId, row.repetition, row.policy])), 'arm repetitions');
  for (const run of dataset.runs) {
    const fixture = dataset.cases.find(row => row.caseId === run.caseId);
    if (!fixture || fixture.context.request.count !== run.requestedSlots || run.repetition > fixture.repetitions) ctx.addIssue({ code: 'custom', path: ['runs'], message: 'Run must match an existing case, planned repetition, and requested-slot denominator.' });
    if (dataset.origin === 'recorded' && run.comparison.contextTiming === 'synthetic') ctx.addIssue({ code: 'custom', path: ['runs'], message: 'Recorded data cannot claim synthetic comparison provenance.' });
  }
});
export type EvaluationDataset = z.infer<typeof DatasetSchema>;
export type EvaluationRun = z.infer<typeof RunSchema>;
export type EvaluationSlot = z.infer<typeof SlotSchema>;

export const LabelSchema = z.object({
  reviewId: id, reviewHash: hash,
  sourceScope: IssueSchema.nullable(), notation: IssueSchema.nullable(), duplication: IssueSchema.nullable(), difficulty: IssueSchema.nullable(), answerQuality: IssueSchema.nullable(),
  disposition: z.enum(['accepted', 'edited', 'discarded', 'intentional-variant', 'unresolved', 'source-shortfall']).nullable(),
  reviewMinutes: z.number().finite().nonnegative().max(1440).nullable(),
  evidenceRefs: z.array(id).max(30), notes: z.string().max(4000),
}).strict();
export const ReviewFileSchema = z.object({ schemaVersion: z.literal('financebot-quality-reviews-v1'), reviewSetId: id, rubricVersion: z.literal('financebot-teacher-v1'), reviewerId: z.string().trim().min(1, 'Reviewer identifier cannot be blank.').max(160), labels: z.array(LabelSchema).max(10000) }).strict().superRefine((file, ctx) => {
  if (new Set(file.labels.map(label => label.reviewId)).size !== file.labels.length) ctx.addIssue({ code: 'custom', path: ['labels'], message: 'Duplicate reviews require explicit adjudication; they cannot overwrite each other.' });
});
export type TeacherLabel = z.infer<typeof LabelSchema>;
export type ReviewFile = z.infer<typeof ReviewFileSchema>;

export interface ReviewCard {
  reviewId: string; reviewHash: string; context: EvaluationContext;
  earlierCandidates: Array<{ id: string; content: EvaluationQuestion }>;
  candidate: EvaluationQuestion | null; reviewable: boolean; limitations: string[];
}
export interface BlindReviewBundle {
  schemaVersion: 'financebot-blind-review-v1'; reviewSetId: string; rubricVersion: 'financebot-teacher-v1';
  origin: 'synthetic' | 'recorded'; cards: ReviewCard[];
}
export const ReviewKeySchema = z.object({
  schemaVersion: z.literal('financebot-review-key-v1'), reviewSetId: id, datasetHash: hash,
  entries: z.array(z.object({ reviewId: id, reviewHash: hash, runId: id, item: z.number().int().min(0).max(99) }).strict()).min(1).max(10000),
}).strict();
export type ReviewKey = z.infer<typeof ReviewKeySchema>;

/** Object-key order does not change identity; array order remains meaningful. */
export function hashValue(value: unknown): string {
  const canonical = (input: unknown): unknown => Array.isArray(input) ? input.map(canonical)
    : input && typeof input === 'object' ? Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => [key, canonical(value)])) : input;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
