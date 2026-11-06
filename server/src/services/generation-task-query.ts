import type { GenerationMemoryContent } from './generation-memory.service';
import type { GenerationMemorySnapshot } from './generation-memory.service';
import type { GenerationTaskRetrievalDiagnostic } from '../types/generation-quality';

/** A bounded retrieval locator, never the full comparison or source proof.
 * The quality prompt still receives the complete validated candidate. */
export function generationTaskQuery(candidate: GenerationMemoryContent): string {
  return `${candidate.stem} ${candidate.options.filter(option => option.role === 'correct')
    .map(option => `${option.text} ${option.explanation}`).join(' ')}`.slice(0, 8000);
}

export function generationTaskRetrievalDiagnostic(memory: GenerationMemorySnapshot): GenerationTaskRetrievalDiagnostic | undefined {
  const receipt = memory.taskRetrieval;
  if (!receipt) return undefined;
  const { protocol, rankerVersion, queryHash, bindingsDigest, status, incompleteReason,
    headsScanned, versionsChecked, missingVersions, invalidVersions, invalidHeads,
    missingDescriptors, ignoredProfiles, unscannedHeadsLowerBound, nominatedIds, retainedIds, requiredComparisonIds } = receipt;
  return { protocol, rankerVersion, queryHash, bindingsDigest, status, ...(incompleteReason ? { incompleteReason } : {}),
    headsScanned, versionsChecked, missingVersions, invalidVersions, invalidHeads, missingDescriptors,
    ignoredProfiles, unscannedHeadsLowerBound, nominatedIds: [...nominatedIds], retainedIds: [...retainedIds], requiredComparisonIds: [...requiredComparisonIds] };
}
