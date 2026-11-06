import { ObjectId } from 'mongodb';
import { questionVersionsCol } from '../components/mongodb/collections';
import type { PaperQuestion } from '../types/exam-builder';
import { numericInputDisplayFailure } from './numeric-input-display.service';
import { substituteParams } from './parameter-display';

/** Admission for a NEW sitting only. Existing sittings keep their frozen grading.
 * Use pinned definitions and values; never redraw a paper or silently repair it. */
export async function frozenNumericalPaperProblem(items: PaperQuestion[]): Promise<string | undefined> {
  for (let index = 0; index < items.length; index++) {
    const item = items[index]!;
    if (!item.paramValues) continue;
    let definition = item.numericDefinition;
    if (!definition) {
      const version = item.versionId && ObjectId.isValid(item.versionId)
        ? await questionVersionsCol().findOne({ _id: new ObjectId(item.versionId),
          ...(item.questionId && ObjectId.isValid(item.questionId) ? { questionId: new ObjectId(item.questionId) } : {}) }) : null;
      // Opaque legacy scripts retain their existing sandbox policy.
      if (version?.generateScript) continue;
      if (version && !version.derivedValues?.length) continue;
      if (version?.derivedValues?.length) definition = {
        stem: version.stem, options: version.options.map(option => ({ key: option.key, text: option.text })),
        paramSlots: version.paramSlots ?? [], derivedValues: version.derivedValues,
      };
    }
    const recreate = `Question ${index + 1} needs a numerical display check. Ask the Instructor to recreate this paper from the checked Question Bank before starting a new attempt.`;
    if (!definition) return recreate;
    if (!definition.derivedValues.length) continue;
    // Parent IDs of old generated context variants are not evidence for the
    // variant's formula. Refuse when the pinned template does not reproduce it.
    if (substituteParams(definition.stem, item.paramValues) !== item.stem
      || definition.options.length !== item.options.length
      || definition.options.some(option => substituteParams(option.text, item.paramValues!) !== item.options.find(frozen => frozen.key === option.key)?.text)) return recreate;
    const failure = numericInputDisplayFailure({ stem: definition.stem, slots: definition.paramSlots,
      derivedValues: definition.derivedValues, optionTexts: definition.options.map(option => option.text), values: item.paramValues });
    if (failure) return `Question ${index + 1} cannot start: its displayed inputs do not reproduce its frozen answers. Ask the Instructor to correct the parameter values and recreate this paper.`;
  }
  return undefined;
}
