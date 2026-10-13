import { ObjectId } from 'mongodb';
import { questionsCol, questionVersionsCol } from '../components/mongodb/collections';
import type { QuestionVersion } from '../types/domain';
import type { PaperQuestion } from '../types/exam-builder';
import { isServable, unresolvablePlaceholders } from './numeric-gate.service';
import { optionValueNamesForVerification, placeholderSyntaxFailure, verifyQuestionNumerics } from './numeric-verification.service';
import { drawCollisionFreeParams, stableSeedsForId, substituteParams } from './params.service';

export function examError(message: string, status = 409): never { throw Object.assign(new Error(message), { status }); }
type ExamQuestionVersion = Pick<QuestionVersion, 'stem' | 'options' | 'type' | 'difficulty' | 'generateScript' | 'paramSlots' | 'derivedValues' | 'numericKind' | 'verification'>;

/** Recheck old formula proofs locally, without rewriting an approved bank version. */
export function prepareExamVersion<T extends ExamQuestionVersion>(version: T): T {
  if (unresolvablePlaceholders(version).length) examError('Unresolved question placeholders. Edit this question in Question Bank before using it.');
  if (isServable(version)) return version;
  if (!version.generateScript && version.derivedValues?.length) {
    const syntax = placeholderSyntaxFailure(version, [...(version.paramSlots ?? []), ...version.derivedValues].map(v => v.name));
    if (syntax) examError(`Numerical check failed: ${syntax}`);
    const names = optionValueNamesForVerification(version.options.map(o => o.text), version.derivedValues.map(v => v.name));
    if (!names.ok) examError(`Numerical check failed: ${names.error}. Edit this question in Question Bank.`);
    const checked = verifyQuestionNumerics({ slots: version.paramSlots ?? [], derivedValues: version.derivedValues, optionValueNames: names.names, optionCurrency: names.currency });
    if (!checked.ok) examError(`Numerical check failed: ${checked.error}. Edit this question in Question Bank.`);
    return { ...version, verification: checked.verification };
  }
  examError('Approved content still needs a current numerical proof. Edit and verify its calculation in Question Bank; approving it again alone will not fix it.');
}

/** Freeze one checked draw so preview, publication and grading use identical text. */
export async function freezeExamQuestion(version: ExamQuestionVersion, identity: string): Promise<Pick<PaperQuestion, 'stem' | 'options' | 'type' | 'difficulty' | 'seed' | 'paramValues' | 'validated'>> {
  const checked = prepareExamVersion(version);
  let draw: Awaited<ReturnType<typeof drawCollisionFreeParams>>;
  try { draw = await drawCollisionFreeParams(checked, stableSeedsForId(identity)); }
  catch (error) { examError(`Numerical draw failed: ${error instanceof Error ? error.message : 'Unable to resolve values'}. Edit this question in Question Bank.`); }
  const { seed, paramValues } = draw;
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
    const original = await freezeExamQuestion(version, questionId);
    for (let attempt = 0; attempt < 8; attempt++) {
      const frozen = await freezeExamQuestion(version, attempt ? `${identity}:${attempt}` : identity);
      if (frozen.stem === original.stem && JSON.stringify(frozen.options) === JSON.stringify(original.options)) continue;
      return { ...frozen, id: identity, source: 'variant', questionId, versionId, familyId: (question.templateFamilyId ?? question._id).toHexString(), loIds: question.loIds.map(id => id.toHexString()), points: 1, minutes: 3, practiceExposure: true };
    }
    examError('The parameter range did not produce different numbers. Use the original question or expand its range in Question Bank.');
  }
}
