import { ObjectId } from 'mongodb';
import { questionsCol, questionVersionsCol } from '../components/mongodb/collections';
import type { QuestionVersion } from '../types/domain';
import type { PaperQuestion } from '../types/exam-builder';
import { isServable } from './numeric-gate.service';
import { drawCollisionFreeParams, stableSeedsForId, substituteParams } from './params.service';

export function examError(message: string, status = 409): never { throw Object.assign(new Error(message), { status }); }

/** Freeze one checked draw so preview, publication and grading use identical text. */
export async function freezeExamQuestion(version: Pick<QuestionVersion, 'stem' | 'options' | 'type' | 'difficulty' | 'generateScript' | 'paramSlots' | 'derivedValues' | 'numericKind' | 'verification'>, identity: string): Promise<Pick<PaperQuestion, 'stem' | 'options' | 'type' | 'difficulty' | 'seed' | 'paramValues' | 'validated'>> {
  if (!isServable(version)) examError('Question requires valid numerical verification before it can be used in an exam.');
  const { seed, paramValues } = await drawCollisionFreeParams(version, stableSeedsForId(identity));
  const render = (text: string) => paramValues ? substituteParams(text, paramValues) : text;
  const stem = render(version.stem);
  const options = version.options.map(option => ({ ...option, text: render(option.text), explanation: render(option.explanation ?? '') }));
  if (options.length !== (version.type === 'mcq' ? 4 : 2) || options.filter(o => o.role === 'correct').length !== 1
    || new Set(options.map(o => o.key)).size !== options.length || new Set(options.map(o => o.text.trim())).size !== options.length
    || [stem, ...options.flatMap(o => [o.text, o.explanation ?? ''])].some(text => /\{\{[^}]+\}\}/.test(text))) examError('The rendered question has invalid or unresolved options.');
  return { stem, options, type: version.type, difficulty: version.difficulty, seed, ...(paramValues ? { paramValues } : {}), validated: true };
}

/** A reusable variant boundary: no exam or bank writes, always explicit versions. */
export class QuestionVariantService {
  async source(courseId: ObjectId, questionId: string, versionId: string) {
    const question = await questionsCol().findOne({ _id: new ObjectId(questionId), courseId });
    const version = await questionVersionsCol().findOne({ _id: new ObjectId(versionId), questionId: new ObjectId(questionId) });
    if (!question || !version) examError('Question version not found in this course.', 404);
    if (question.state === 'archived' || question.state === 'paused') examError('Archived or paused questions cannot be used.');
    return { question, version };
  }
  async parameters(courseId: ObjectId, questionId: string, versionId: string, identity: string): Promise<PaperQuestion> {
    const { question, version } = await this.source(courseId, questionId, versionId);
    if (!version.paramSlots?.length || version.generateScript) examError('This question does not have a supported parameter definition.');
    const frozen = await freezeExamQuestion(version, identity);
    const original = await freezeExamQuestion(version, questionId);
    if (frozen.stem === original.stem && JSON.stringify(frozen.options) === JSON.stringify(original.options)) examError('This parameter draw did not produce a distinct variant. Try another draw.');
    return { ...frozen, id: identity, source: 'variant', questionId, versionId, familyId: (question.templateFamilyId ?? question._id).toHexString(), loIds: question.loIds.map(id => id.toHexString()), points: 1, minutes: 3, practiceExposure: true };
  }
}
