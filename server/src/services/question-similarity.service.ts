import type { ObjectId } from 'mongodb';
import { questionsCol, questionVersionsCol, questionEmbeddingsCol } from '../components/mongodb/collections';
import { embedOne } from '../components/genai/embeddings';
import { env } from '../config/env';
import type { QuestionSimilarity, SimilarityLink } from '../types/domain';
import { ACTIVE_QUESTION_STATES } from './question-generation/existing-stems';

export interface PoolEntry { questionId: ObjectId; loIds: ObjectId[]; themeIds: ObjectId[]; vector: number[]; similarity?: QuestionSimilarity }

export function cosine(a: number[], b: number[]): number {
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

export function similarityText(version: { stem: string; options: Array<{ text: string; role?: string }> }): string {
  const correct = version.options.find(o => o.role === 'correct')?.text ?? '';
  return `${version.stem}\n${correct}`;
}

const round = (score: number) => Math.round(score * 100) / 100;
const shares = (a: ObjectId[], b: ObjectId[]) => a.some(x => b.some(y => x.equals(y)));

export function nearest(target: Omit<PoolEntry, 'similarity'>, pool: PoolEntry[]): { lo: SimilarityLink | null; topic: SimilarityLink | null } {
  let lo: SimilarityLink | null = null; let topic: SimilarityLink | null = null;
  for (const entry of pool) {
    if (entry.questionId.equals(target.questionId)) continue;
    const score = round(cosine(target.vector, entry.vector));
    if (shares(target.loIds, entry.loIds) && (!lo || score > lo.score)) lo = { questionId: entry.questionId, score };
    if (shares(target.themeIds, entry.themeIds) && (!topic || score > topic.score)) topic = { questionId: entry.questionId, score };
  }
  return { lo, topic };
}

/** Embed (or reuse) the question's current version. */
async function ensureEmbedding(question: { _id: ObjectId; courseId: ObjectId; currentVersionId: ObjectId }): Promise<number[]> {
  const stored = await questionEmbeddingsCol().findOne({ _id: question._id });
  if (stored && stored.versionId.equals(question.currentVersionId) && stored.model === env.embeddingsModel) return stored.vector;
  const version = await questionVersionsCol().findOne({ _id: question.currentVersionId });
  if (!version) throw new Error('version-not-found');
  const vector = await embedOne(similarityText(version));
  await questionEmbeddingsCol().updateOne({ _id: question._id }, { $set: {
    courseId: question.courseId, versionId: question.currentVersionId, vector, model: env.embeddingsModel, createdAt: new Date(),
  } }, { upsert: true });
  return vector;
}

async function loadPool(courseId: ObjectId): Promise<PoolEntry[]> {
  const heads = await questionsCol().find({ courseId, state: { $in: [...ACTIVE_QUESTION_STATES] } },
    { projection: { loIds: 1, themeIds: 1, similarity: 1 } }).toArray();
  const vectors = await questionEmbeddingsCol().find({ _id: { $in: heads.map(h => h._id) }, model: env.embeddingsModel }).toArray();
  const byId = new Map(vectors.map(v => [v._id.toHexString(), v.vector]));
  return heads.flatMap(h => {
    const vector = byId.get(h._id.toHexString());
    return vector ? [{ questionId: h._id, loIds: h.loIds, themeIds: h.themeIds, vector, ...(h.similarity ? { similarity: h.similarity } : {}) }] : [];
  });
}

/** Recompute one question's nearest neighbours and raise any neighbour whose
 * stored nearest is now less similar than this question. Informational only:
 * every failure is swallowed so a save never depends on it. */
export async function refreshQuestionSimilarity(questionId: ObjectId): Promise<void> {
  try {
    const question = await questionsCol().findOne({ _id: questionId });
    if (!question || !ACTIVE_QUESTION_STATES.includes(question.state)) return;
    const vector = await ensureEmbedding(question);
    const pool = await loadPool(question.courseId);
    const target = { questionId, loIds: question.loIds, themeIds: question.themeIds, vector };
    const now = new Date();
    const own = nearest(target, pool);
    await questionsCol().updateOne({ _id: questionId }, { $set: { similarity: { ...own, model: env.embeddingsModel, computedAt: now } } });
    for (const entry of pool) {
      if (entry.questionId.equals(questionId)) continue;
      const score = round(cosine(vector, entry.vector));
      const current = entry.similarity?.model === env.embeddingsModel ? entry.similarity : undefined;
      const lo = shares(entry.loIds, question.loIds) && (!current?.lo || score > current.lo.score) ? { questionId, score } : current?.lo ?? null;
      const topic = shares(entry.themeIds, question.themeIds) && (!current?.topic || score > current.topic.score) ? { questionId, score } : current?.topic ?? null;
      if (lo !== (current?.lo ?? null) || topic !== (current?.topic ?? null)) {
        await questionsCol().updateOne({ _id: entry.questionId }, { $set: { similarity: { lo, topic, model: env.embeddingsModel, computedAt: now } } });
      }
    }
  } catch (error) {
    console.warn(`[similarity] refresh skipped for ${questionId.toHexString()}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Embed every active question in the course and recompute all nearest links. */
export async function rebuildCourseSimilarity(courseId: ObjectId): Promise<{ questions: number }> {
  const heads = await questionsCol().find({ courseId, state: { $in: [...ACTIVE_QUESTION_STATES] } }).toArray();
  for (const head of heads) {
    try { await ensureEmbedding(head); } catch { /* a question without an embedding simply has no similarity */ }
  }
  const pool = await loadPool(courseId);
  const now = new Date();
  for (const entry of pool) {
    const result = nearest(entry, pool);
    await questionsCol().updateOne({ _id: entry.questionId }, { $set: { similarity: { ...result, model: env.embeddingsModel, computedAt: now } } });
  }
  return { questions: pool.length };
}
