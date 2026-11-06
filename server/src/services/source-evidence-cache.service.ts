import { createHash } from 'node:crypto';
import type { ObjectId } from 'mongodb';
import { coursesCol, sourceEvidenceExtractionsCol } from '../components/mongodb/collections';
import type { SourceEvidenceExtraction, SourceExtractionSection } from '../types/source-evidence';
import { authoringCollection, withCourseAuthoringWrite } from './authoring-commit.service';
import { resolveSourcePassagePolicy, type SourcePassagePolicy } from './source-passages';

export const SOURCE_EXTRACTION_PROMPT_VERSION = 'source-local-ledger-v3';
export const SOURCE_EXTRACTION_SCHEMA_VERSION = 'source-knowledge-v2-passage-accounting';
export function sourceEvidenceHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export interface SourceExtractionIdentity {
  passagePolicy?: SourcePassagePolicy;
  courseId: ObjectId;
  materialId: ObjectId;
  sourceTextHash: string;
  parserVersion: string;
  chunkerVersion: string;
  sourceTitle: string;
  guidance: string;
  promptText: string;
  modelConfiguration: Record<string, unknown>;
  sections: Array<{ id: string; chunkIndex: number; text: string }>;
}
export function sourceExtractionIdentity(input: SourceExtractionIdentity): Omit<SourceEvidenceExtraction, 'sections' | 'completedAt'> {
  resolveSourcePassagePolicy(input.passagePolicy);
  const modelConfigurationHash = sourceEvidenceHash(input.modelConfiguration);
  const guidanceHash = sourceEvidenceHash(input.guidance.trim());
  const promptTextHash = sourceEvidenceHash(input.promptText);
  const identity = { sourceTextHash: input.sourceTextHash, parserVersion: input.parserVersion, chunkerVersion: input.chunkerVersion,
    promptVersion: SOURCE_EXTRACTION_PROMPT_VERSION, promptTextHash, schemaVersion: SOURCE_EXTRACTION_SCHEMA_VERSION, modelConfigurationHash,
    sourceTitle: input.sourceTitle, guidanceHash, sectionIds: input.sections.map(s => s.id) };
  // Identical rendered alias/text payloads can reuse a validated old entry.
  // A changed cut changes promptTextHash; no blanket schema invalidation is needed.
  return { ...identity, ...(input.passagePolicy === undefined ? {} : { passagePolicy: input.passagePolicy }), courseId: input.courseId, materialId: input.materialId,
    cacheKey: sourceEvidenceHash({ courseId: input.courseId.toHexString(), ...identity,
      sections: input.sections.map(s => ({ id: s.id, chunkIndex: s.chunkIndex, text: s.text })) }) };
}

/** Content is never trusted because it came from a cache. The caller resolves
 * every passage against current originals and verifies source eligibility. */
export async function readSourceExtraction(identity: ReturnType<typeof sourceExtractionIdentity>,
  validate: (sections: unknown) => SourceExtractionSection[]): Promise<SourceExtractionSection[] | null> {
  try { resolveSourcePassagePolicy(identity.passagePolicy); } catch { return null; }
  const record = await sourceEvidenceExtractionsCol().findOne({ courseId: identity.courseId, cacheKey: identity.cacheKey });
  try { resolveSourcePassagePolicy(record?.passagePolicy); } catch { return null; }
  if (!record || record.sourceTextHash !== identity.sourceTextHash || record.schemaVersion !== identity.schemaVersion ||
      record.promptVersion !== identity.promptVersion || record.promptTextHash !== identity.promptTextHash || sourceEvidenceHash(record.sectionIds) !== sourceEvidenceHash(identity.sectionIds)) return null;
  try { return validate(record.sections); } catch { return null; }
}

export async function readSourceExtractionChild(parent: ReturnType<typeof sourceExtractionIdentity>, sectionId: string,
  validate: (sections: unknown) => SourceExtractionSection[]): Promise<SourceExtractionSection[] | null> {
  try { resolveSourcePassagePolicy(parent.passagePolicy); } catch { return null; }
  const record = await sourceEvidenceExtractionsCol().findOne({ courseId: parent.courseId, cacheKey: sourceEvidenceHash([parent.cacheKey, sectionId]) });
  try { resolveSourcePassagePolicy(record?.passagePolicy); } catch { return null; }
  if (!record || record.parentCacheKey !== parent.cacheKey || record.parentPromptTextHash !== parent.promptTextHash ||
      record.sourceTextHash !== parent.sourceTextHash || record.modelConfigurationHash !== parent.modelConfigurationHash ||
      record.schemaVersion !== parent.schemaVersion || record.promptVersion !== parent.promptVersion ||
      sourceEvidenceHash(record.sectionIds) !== sourceEvidenceHash([sectionId])) return null;
  try { return validate(record.sections); } catch { return null; }
}

export async function storeSourceExtractionChild(parent: ReturnType<typeof sourceExtractionIdentity>, row: SourceExtractionSection,
  actualPrompt: string, assertEligible?: () => Promise<void>): Promise<void> {
  resolveSourcePassagePolicy(parent.passagePolicy);
  const child = { ...parent, cacheKey: sourceEvidenceHash([parent.cacheKey, row.sectionId]), parentCacheKey: parent.cacheKey,
    parentPromptTextHash: parent.promptTextHash, promptTextHash: sourceEvidenceHash(actualPrompt), sectionIds: [row.sectionId] };
  await storeSourceExtraction(child, [row], assertEligible);
}

export async function storeSourceExtraction(identity: ReturnType<typeof sourceExtractionIdentity>, sections: SourceExtractionSection[],
  assertEligible?: () => Promise<void>): Promise<void> {
  resolveSourcePassagePolicy(identity.passagePolicy);
  // Completed validated units alone are reusable. Partial/failed units stay
  // explicit in run diagnostics, never as successful cache entries.
  await withCourseAuthoringWrite(identity.courseId, async session => {
    const courseEligible = async () => {
      if (!await authoringCollection(coursesCol()).findOne({ _id: identity.courseId, authoringDeletionStartedAt: { $exists: false } }, { projection: { _id: 1 } })) throw new Error('course-not-found');
    };
    await courseEligible();
    await assertEligible?.();
    const collection = authoringCollection(sourceEvidenceExtractionsCol());
    try {
      await collection.updateOne({ courseId: identity.courseId, cacheKey: identity.cacheKey },
        { $set: { ...identity, sections, completedAt: new Date() } }, { upsert: true });
    } catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
    if (!session) {
      // Standalone deployments cannot promise an atomic course fence. A lost
      // source/deletion race is cleaned rather than recreating an eligible hit.
      try { await courseEligible(); await assertEligible?.(); }
      catch (error) { await collection.deleteOne({ courseId: identity.courseId, cacheKey: identity.cacheKey }); throw error; }
    }
  });
}
