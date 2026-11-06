import { isDeepStrictEqual } from 'node:util';
import type { AuthoringRequirements, GenerationQualityAssessment } from '../types/generation-quality';
import { assertTaskRetrievalReady, selectGenerationMemory, type GenerationMemoryContent, type GenerationMemorySnapshot } from './generation-memory.service';
import { snapshotQualityCandidate } from './generation-quality.service';
import { generationTaskQuery } from './generation-task-query';
import { TASK_RETRIEVAL_PROTOCOL } from './generation-task-retrieval';
import { requiredTaskComparisonIssues } from './generation-task-comparisons';

/** Replays assessment bindings only. The caller separately replays the stored
 * current Bank/query inside its course fence. No model, embedding or DB work
 * occurs here; actualCandidate must be the content being saved/adopted. */
export function assertGenerationTaskRetrievalAssessment(input: {
  candidate: GenerationMemoryContent;
  memory: GenerationMemorySnapshot;
  requirements: AuthoringRequirements;
  assessment: GenerationQualityAssessment;
}): void {
  const protocol = input.requirements.taskRetrievalProtocol;
  if (protocol === undefined) return;
  const invalid = () => { throw new Error('generation-task-retrieval-assessment-invalid'); };
  if (protocol !== TASK_RETRIEVAL_PROTOCOL) return invalid();
  try {
    assertTaskRetrievalReady(input.memory, protocol);
    const snapshot = snapshotQualityCandidate(input.candidate);
    const assessment = input.assessment;
    if (snapshot.truncated || !assessment.candidate || assessment.candidate.truncated
      || !isDeepStrictEqual(snapshot, assessment.candidate) || assessment.status !== 'eligible'
      || assessment.policy !== 'grounded-memory-v2' || assessment.intent !== input.requirements.intent
      || assessment.memoryDigest !== input.memory.snapshotDigest
      || input.memory.taskRetrieval!.query !== generationTaskQuery(input.candidate)) return invalid();
    const selection = selectGenerationMemory(input.memory, { query: generationTaskQuery(input.candidate) });
    const compared = assessment.comparedEntryIds;
    const actual = selection.entries.map(entry => entry.id);
    if (!Array.isArray(compared) || compared.length !== actual.length || new Set(compared).size !== compared.length
      || compared.some(id => !actual.includes(id))
      || !isDeepStrictEqual(selection.requiredComparisonIds, input.memory.taskRetrieval!.requiredComparisonIds)) return invalid();
    if (input.requirements.intent === 'create-independent-task'
      && (assessment.novelty !== 'independent' || requiredTaskComparisonIssues(assessment, selection, input.requirements).length)) return invalid();
  } catch {
    return invalid();
  }
}
