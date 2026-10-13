import { randomInt } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { losCol, themesCol, questionsCol, questionVersionsCol } from '../components/mongodb/collections';
import type { Difficulty, QuestionType } from '../types/domain';
import { assertEditable, getBuilderExam, requireExamCourse } from './exam-builder.service';
import { examError, freezeExamQuestion } from './question-variant.service';

export interface ExamSampleRequest {
  mode: 'total' | 'per-topic';
  topics: Array<{ topicId: string; count: number }>;
  count: number;
  type?: QuestionType;
  difficulty?: Difficulty;
}

/** An instructor catalog checks the same draw used by manual add and publication. */
export async function examBankCatalog(courseId: ObjectId) {
  await requireExamCourse(courseId);
  const [questions, los, topics] = await Promise.all([
    questionsCol().find({ courseId, state: 'approved' }).sort({ _id: 1 }).toArray(),
    losCol().find({ courseId, archivedAt: { $exists: false } }).toArray(),
    themesCol().find({ courseId, archivedAt: { $exists: false } }).toArray(),
  ]);
  const activeTopics = new Set(topics.map(t => t._id.toHexString()));
  const activeLos = new Map(los.filter(lo => activeTopics.has(lo.themeId.toHexString())).map(lo => [lo._id.toHexString(), lo.themeId.toHexString()]));
  const versions = await questionVersionsCol().find({ _id: { $in: questions.map(q => q.currentVersionId) } }).toArray();
  const byId = new Map(versions.map(v => [v._id.toHexString(), v]));
  const rows = [];
  // Sequential draws bound sandbox worker concurrency for imported script questions.
  for (const q of questions) {
    const version = byId.get(q.currentVersionId.toHexString());
    if (!version || !version.questionId.equals(q._id)) continue;
    const loIds = q.loIds.map(id => id.toHexString());
    const themeIds = [...new Set(loIds.map(id => activeLos.get(id)).filter((id): id is string => Boolean(id)))];
    let contentReady = false, blockedReason: string | undefined;
    let sample: { seed: number; parameterized: boolean; stem: string; options: Array<{ key: string; text: string; explanation: string }> } | undefined;
    try {
      if (!loIds.length || loIds.some(id => !activeLos.has(id))) examError('This question references a removed learning objective. Update its objectives in Question Bank.');
      const frozen = await freezeExamQuestion(version, q._id.toHexString());
      sample = { seed: frozen.seed!, parameterized: Boolean(frozen.paramValues), stem: frozen.stem, options: frozen.options.map(({ key, text, explanation }) => ({ key, text, explanation: explanation ?? '' })) };
      contentReady = true;
    } catch (error) {
      // Expected admission failures become visible rows; infrastructure failures propagate.
      if (!(error instanceof Error) || !('status' in error)) throw error;
      blockedReason = error.message;
    }
    rows.push({ id: q._id.toHexString(), state: q.state, labels: q.labels, loIds, themeIds, current: version, contentReady, blockedReason, sample });
  }
  return { total: rows.length, questions: rows };
}

function shuffled<T>(values: T[]): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) { const j = randomInt(i + 1); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}

/** Bipartite matching fills quotas without counting a multi-topic question twice. */
export function pickTopicSample(pools: Array<{ topicId: string; count: number; ids: string[] }>): Array<{ questionId: string; topicId: string }> {
  const slots = pools.flatMap(pool => Array.from({ length: pool.count }, () => ({ topicId: pool.topicId, ids: shuffled(pool.ids) })));
  const owner = new Map<string, number>();
  function assign(slot: number, visited: Set<string>): boolean {
    for (const id of slots[slot].ids) {
      if (visited.has(id)) continue;
      visited.add(id);
      const previous = owner.get(id);
      if (previous === undefined || assign(previous, visited)) { owner.set(id, slot); return true; }
    }
    return false;
  }
  for (let i = 0; i < slots.length; i++) {
    if (!assign(i, new Set())) examError('Not enough distinct eligible questions for this topic mix. Reduce the counts or choose more topics.', 400);
  }
  return [...owner].sort((a, b) => a[1] - b[1]).map(([questionId, slot]) => ({ questionId, topicId: slots[slot].topicId }));
}

/** Preview only. The existing version-pinned bank-items endpoint commits the choice. */
export async function sampleExamBank(courseId: ObjectId, examId: ObjectId, revision: number, input: ExamSampleRequest) {
  const exam = await getBuilderExam(courseId, examId); assertEditable(exam, revision);
  const ids = input.topics.map(t => t.topicId);
  if (!ids.length || new Set(ids).size !== ids.length) examError('Select distinct course topics.', 400);
  const topics = await themesCol().find({ courseId, _id: { $in: ids.map(id => new ObjectId(id)) }, archivedAt: { $exists: false } }).toArray();
  if (topics.length !== ids.length) examError('A topic is unavailable or belongs to another course.', 400);
  const count = input.mode === 'total' ? input.count : input.topics.reduce((sum, t) => sum + t.count, 0);
  if (!Number.isInteger(count) || count < 1 || count + exam.items.length > 100) examError('Choose a mix that fits within the 100-question paper limit.', 400);
  const catalog = await examBankCatalog(courseId);
  const excluded = new Set(exam.items.map(i => i.questionId).filter(Boolean));
  const eligible = catalog.questions.filter(q => q.contentReady && !excluded.has(q.id)
    && (!input.type || q.current.type === input.type) && (!input.difficulty || q.current.difficulty === input.difficulty));
  const choices = input.mode === 'total'
    ? pickTopicSample([{ topicId: '', count, ids: eligible.filter(q => q.themeIds.some(id => ids.includes(id))).map(q => q.id) }])
    : pickTopicSample(input.topics.map(t => ({ ...t, ids: eligible.filter(q => q.themeIds.includes(t.topicId)).map(q => q.id) })));
  return { revision, questions: choices.map(choice => {
    const q = eligible.find(q => q.id === choice.questionId)!;
    return { questionId: q.id, versionId: q.current._id.toHexString(), topicId: choice.topicId || q.themeIds.find(id => ids.includes(id))!,
      stem: q.sample!.stem, type: q.current.type, difficulty: q.current.difficulty,
      supportsNumbers: Boolean(q.current.paramSlots?.length && !q.current.generateScript) };
  }) };
}
