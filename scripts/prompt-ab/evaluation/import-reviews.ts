import { DatasetSchema, ReviewFileSchema, ReviewKeySchema, issueDimensions, hashValue } from './schema';
import type { EvaluationDataset, ReviewKey, ReviewFile, TeacherLabel } from './schema';
import { buildReviewCard } from './review';

export interface LinkedReview { runId: string; item: number; label: TeacherLabel }

/** One adjudicated file is intentional: conflicting raters must never silently
 * overwrite one another. Blank entries may be omitted for partial review. */
export function importTeacherReviews(datasetInput: EvaluationDataset, keyInput: ReviewKey, reviewsInput: ReviewFile): LinkedReview[] {
  const dataset = DatasetSchema.parse(datasetInput);
  const key = ReviewKeySchema.parse(keyInput);
  const reviews = ReviewFileSchema.parse(reviewsInput);
  if (key.datasetHash !== hashValue(dataset)) throw new Error('Review key belongs to a different or edited dataset.');
  if (reviews.reviewSetId !== key.reviewSetId || reviews.rubricVersion !== dataset.rubricVersion) throw new Error('Review set or rubric does not match the private key.');
  const expectedSlots = dataset.runs.reduce((sum, run) => sum + run.requestedSlots, 0);
  const ids = new Set(key.entries.map(entry => entry.reviewId));
  const slots = new Set(key.entries.map(entry => JSON.stringify([entry.runId, entry.item])));
  if (key.entries.length !== expectedSlots || ids.size !== expectedSlots || slots.size !== expectedSlots) throw new Error('Private key must cover every recorded requested slot exactly once.');
  const cards = new Map<string, ReturnType<typeof buildReviewCard>>();
  for (const entry of key.entries) {
    const run = dataset.runs.find(run => run.runId === entry.runId);
    const slot = run?.slots.find(slot => slot.item === entry.item);
    if (!run || !slot) throw new Error('Private key refers to an unknown run or slot.');
    const card = buildReviewCard(dataset, run, slot);
    if (card.reviewHash !== entry.reviewHash) throw new Error('Private key contains stale candidate or context evidence.');
    cards.set(entry.reviewId, card);
  }
  return reviews.labels.map(label => {
    const entry = key.entries.find(entry => entry.reviewId === label.reviewId);
    const card = cards.get(label.reviewId);
    if (!entry || !card || entry.reviewHash !== label.reviewHash) throw new Error('Unknown review ID or stale review content hash.');
    const hasDecision = issueDimensions.some(field => label[field] !== null) || label.disposition !== null || label.reviewMinutes !== null || label.notes.length > 0 || label.evidenceRefs.length > 0;
    if (hasDecision && reviews.reviewerId.trim() === 'unassigned') throw new Error('Assign an anonymized reviewer identifier before importing completed reviews.');
    if (!card.reviewable && (issueDimensions.some(field => label[field] !== null) || label.disposition !== null && !['unresolved', 'source-shortfall'].includes(label.disposition))) throw new Error('Missing, truncated, or mismatched candidate evidence permits triage notes/time only.');
    const references = new Set([...card.context.sources, ...card.context.bank, ...card.earlierCandidates].map(row => row.id));
    if (label.evidenceRefs.some(reference => !references.has(reference))) throw new Error('Teacher evidence reference does not exist in the blinded review context.');
    return { runId: entry.runId, item: entry.item, label };
  });
}
