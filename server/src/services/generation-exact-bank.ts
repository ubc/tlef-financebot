import type { ClientSession, ObjectId } from 'mongodb';
import type { AuthoringRequirements, GenerationQualityAssessment } from '../types/generation-quality';
import { contentFingerprint, lookupGenerationExactBank, type GenerationMemoryContent } from './generation-memory.service';

/** Recheck inside the caller's course transaction. A receipt made before a
 * model call cannot authorize a write after another current Bank head changes. */
export async function assertGenerationExactBankCurrent(input: {
  courseId: ObjectId;
  candidate: GenerationMemoryContent;
  requirements: AuthoringRequirements;
  assessment: GenerationQualityAssessment;
  session?: ClientSession;
}): Promise<void> {
  const protocol = input.requirements.exactBankProtocol;
  if (protocol === undefined) return;
  if (protocol !== 'course-exact-bank-v1') throw new Error('generation-exact-bank-policy-invalid');
  // Intentional edits and numerical/context variants keep their existing rules.
  if (input.requirements.intent !== 'create-independent-task') return;
  const recorded = input.assessment.exactBank;
  if (input.assessment.status !== 'eligible' || input.assessment.policy !== 'grounded-memory-v2' ||
      !recorded || recorded.protocol !== protocol || recorded.courseId !== input.courseId.toHexString() ||
      recorded.excludedQuestionId !== undefined || recorded.candidateHash !== contentFingerprint(input.candidate).exact ||
      recorded.status !== 'complete' || recorded.exactMatchCount !== 0 || recorded.matches.length !== 0 ||
      recorded.missingVersions !== 0 || recorded.invalidVersions !== 0 || recorded.invalidHeads !== 0 ||
      recorded.unscannedHeadsLowerBound !== 0 || !Number.isSafeInteger(recorded.headsScanned) || recorded.headsScanned < 0 ||
      recorded.versionsChecked !== recorded.headsScanned || !/^[a-f0-9]{64}$/.test(recorded.bindingsDigest)) {
    throw new Error('generation-exact-bank-receipt-invalid');
  }
  const fresh = await lookupGenerationExactBank({ protocol, courseId: input.courseId, candidate: input.candidate,
    ...(input.session ? { session: input.session } : {}) });
  if (!fresh || fresh.status !== 'complete') throw new Error('authoring-exact-bank-incomplete');
  if (fresh.exactMatchCount > 0) throw new Error('authoring-exact-bank-duplicate');
  if (fresh.candidateHash !== recorded.candidateHash || fresh.bindingsDigest !== recorded.bindingsDigest ||
      fresh.headsScanned !== recorded.headsScanned || fresh.versionsChecked !== recorded.versionsChecked) {
    throw new Error('authoring-memory-changed');
  }
}
