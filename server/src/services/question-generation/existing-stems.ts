import type { ObjectId } from 'mongodb';
import { questionsCol, questionVersionsCol } from '../../components/mongodb/collections';
import type { PublicationState } from '../../types/domain';

/** Questions that still count: everything a teaching team can see except archive. */
export const ACTIVE_QUESTION_STATES: readonly PublicationState[] = Object.freeze(['draft', 'pending-review', 'reviewed', 'approved', 'paused']);
export const MAX_EXISTING_STEMS = 30;

/** Same-LO stems for the generator's distinctness context. Context is an aid:
 * a read failure yields no context rather than failing the generation. */
export async function loadExistingLoStems(input: { courseId: ObjectId; loIds: ObjectId[]; excludeQuestionId?: ObjectId }): Promise<string[]> {
  try {
    const heads = await questionsCol()
      .find({
        courseId: input.courseId,
        loIds: { $in: input.loIds },
        state: { $in: [...ACTIVE_QUESTION_STATES] },
        ...(input.excludeQuestionId ? { _id: { $ne: input.excludeQuestionId } } : {}),
      }, { projection: { currentVersionId: 1 } })
      .sort({ updatedAt: -1 })
      .limit(MAX_EXISTING_STEMS)
      .toArray();
    if (heads.length === 0) return [];
    const versions = await questionVersionsCol()
      .find({ _id: { $in: heads.map(h => h.currentVersionId) } }, { projection: { stem: 1 } })
      .toArray();
    const stemById = new Map(versions.map(v => [v._id.toHexString(), v.stem]));
    return heads.map(h => stemById.get(h.currentVersionId.toHexString())).filter((s): s is string => typeof s === 'string');
  } catch {
    return [];
  }
}
