import type { ObjectId } from 'mongodb';
import { embedOne } from '../../components/genai/embeddings';
import { search } from '../../components/qdrant';
import { losCol, materialsCol, themesCol } from '../../components/mongodb/collections';
import { assertSourceSelectionReady } from '../source-readiness.service';
import type { RetrievedChunk } from './candidate';

/** Chunks retrieved per question to ground the generator. */
export const RETRIEVE_TOP_K = 6;

/** The hard-target grounding (R7): the LO keeps its FULL budget and earlier
 * objectives' material comes on top — 8 chunks total. Probe evidence
 * (experiment 22): the widened pool is the difference between 0/4 and 3/4
 * honest numeric-hard attempts on the LO family whose own material tops out
 * at medium. Originally 4+2 to hold the prompt size flat; raised to 6+2 on
 * 2026-08-21 because the ~500 extra tokens are three orders of magnitude
 * below anything Luna's context or pricing cares about, and losing two
 * primary chunks was the split's only real cost. Experiments 22-23 ran at
 * 4+2 — note the condition change before comparing against them. */
export const HARD_PRIMARY_TOP_K = 6;
export const HARD_SUPPORTING_TOP_K = 2;

/** Multi-LO generation: how many further objectives one question may be
 * asked to integrate. Two keeps the question answerable — three concepts
 * chained in one stem reads as a case study, not a practice item — and keeps
 * the prompt within the same budget as a widened hard target (6 primary
 * chunks plus SECONDARY_TOP_K per secondary objective). */
export const MAX_SECONDARY_LOS = 2;
/** Chunks retrieved per secondary objective, filtered to that objective's own
 * ready assigned materials so each one is genuinely represented. */
export const SECONDARY_TOP_K = 2;

export interface RetrievedGrounding {
  chunks: RetrievedChunk[];
  allowedMaterialIds: string[];
}

/** Ready materials assigned directly to the LO, plus Theme-wide materials
 * whose assignment has no narrower loId. Other course materials are forbidden
 * grounding even when their vector score is higher. */
export async function groundingMaterialIds(
  courseId: ObjectId,
  lo: { _id: ObjectId; themeId: ObjectId },
  prompt?: string,
  strict = false,
): Promise<string[]> {
  const materials = await materialsCol()
    .find({ courseId, ...(strict ? {} : { status: 'ready' }), deletedAt: { $exists: false } })
    .toArray();
  const assigned = materials.filter((material) =>
    material.assignments.some(
      (assignment) =>
        assignment.loId?.equals(lo._id) === true ||
        (assignment.loId === undefined && assignment.themeId.equals(lo.themeId)),
    ),
  );
  const mentions = extractMaterialMentions(prompt);
  if (mentions.length === 0) {
    const ids = assigned.map((material) => material._id.toHexString());
    if (strict && ids.length) await assertSourceSelectionReady(courseId, { materialIds: ids });
    return ids;
  }

  const selected: string[] = [];
  for (const mention of mentions) {
    const matches = assigned.filter(
      (material) => normalizeMaterialName(material.name) === normalizeMaterialName(mention),
    );
    if (matches.length === 0) throw new Error('generation-material-mention-not-found');
    if (matches.length > 1) throw new Error('generation-material-mention-ambiguous');
    const id = matches[0]._id.toHexString();
    if (!selected.includes(id)) selected.push(id);
  }
  if (strict) await assertSourceSelectionReady(courseId, { materialIds: selected });
  return selected;
}

/**
 * Materials assigned to EARLIER learning objectives — same theme with a lower
 * LO order, or any LO/theme-wide assignment in a lower-ordered theme (R7).
 *
 * Backward only, by course order: the instructor's HIGH questions chain into
 * concepts already taught (12 of the bank's 23 HIGH items sit in the
 * cumulative Class 9-10 quiz), never forward into material students have not
 * seen. Materials already in the primary pool are excluded — a material
 * assigned to both this LO and an earlier one is primary, not support.
 */
export async function supportingMaterialIds(
  courseId: ObjectId,
  lo: { _id: ObjectId; themeId: ObjectId; order: number },
  primaryMaterialIds: string[],
): Promise<string[]> {
  const [themes, los, materials] = await Promise.all([
    themesCol().find({ courseId, archivedAt: { $exists: false } }).toArray(),
    losCol().find({ courseId, archivedAt: { $exists: false } }).toArray(),
    materialsCol().find({ courseId, status: 'ready', deletedAt: { $exists: false } }).toArray(),
  ]);
  const currentTheme = themes.find((theme) => theme._id.equals(lo.themeId));
  if (!currentTheme) return [];

  const earlierThemeIds = themes
    .filter((theme) => theme.order < currentTheme.order)
    .map((theme) => theme._id);
  const isEarlierTheme = (themeId: ObjectId) => earlierThemeIds.some((id) => id.equals(themeId));
  const earlierLoIds = los
    .filter((candidate) =>
      isEarlierTheme(candidate.themeId) ||
      (candidate.themeId.equals(lo.themeId) && candidate.order < lo.order))
    .map((candidate) => candidate._id);

  const primary = new Set(primaryMaterialIds);
  return materials
    .filter((material) =>
      !primary.has(material._id.toHexString()) &&
      material.assignments.some(
        (assignment) =>
          (assignment.loId !== undefined && earlierLoIds.some((id) => id.equals(assignment.loId as ObjectId))) ||
          (assignment.loId === undefined && isEarlierTheme(assignment.themeId)),
      ))
    .map((material) => material._id.toHexString());
}

export interface SecondaryLo {
  lo: { _id: ObjectId; themeId: ObjectId; name: string; order: number };
  /** Ready materials assigned to this objective (plain assignment — the
   * prompt's @mentions constrain only the primary pool). */
  materialIds: string[];
}

/**
 * Multi-LO generation: validate the instructor's secondary objectives and
 * resolve each one's grounding pool. Every failure here is a request error an
 * instructor can act on: an unknown or foreign LO, the primary repeated, more
 * than MAX_SECONDARY_LOS, or an objective with no ready assigned material
 * (there would be nothing to integrate it FROM). Order is preserved — the
 * prompt lists the objectives as the instructor chose them.
 */
export async function resolveSecondaryLos(
  courseId: ObjectId,
  primary: { _id: ObjectId },
  secondaryLoIds: ObjectId[] | undefined,
  strict = false,
): Promise<SecondaryLo[]> {
  if (!secondaryLoIds || secondaryLoIds.length === 0) return [];
  if (secondaryLoIds.length > MAX_SECONDARY_LOS) throw new Error('generation-secondary-lo-limit');
  const seen = new Set<string>([primary._id.toHexString()]);
  for (const id of secondaryLoIds) {
    const key = id.toHexString();
    if (seen.has(key)) throw new Error('generation-secondary-lo-duplicate');
    seen.add(key);
  }
  const found = await losCol().find({ _id: { $in: secondaryLoIds } }).toArray();
  const resolved: SecondaryLo[] = [];
  for (const id of secondaryLoIds) {
    const lo = found.find((candidate) => candidate._id.equals(id));
    if (!lo) throw new Error('lo-not-found');
    if (!lo.courseId.equals(courseId)) throw new Error('lo-not-in-course');
    const materialIds = await groundingMaterialIds(courseId, lo, undefined, strict);
    if (materialIds.length === 0) throw new Error('generation-secondary-lo-no-materials');
    resolved.push({ lo, materialIds });
  }
  return resolved;
}

/** The LOs a generated question is tagged to: the primary first, then every
 * secondary objective in the instructor's order (IN-Q13 many-to-many). */
export function taggedLoIds(loId: ObjectId, secondary: SecondaryLo[]): ObjectId[] {
  return [loId, ...secondary.map((entry) => entry.lo._id)];
}

/** The themes of every tagged LO, de-duplicated — two objectives in one
 * theme tag the theme once. */
export function taggedThemeIds(lo: { themeId: ObjectId }, secondary: SecondaryLo[]): ObjectId[] {
  const themes: ObjectId[] = [lo.themeId];
  for (const entry of secondary) {
    if (!themes.some((id) => id.equals(entry.lo.themeId))) themes.push(entry.lo.themeId);
  }
  return themes;
}

export function normalizeMaterialName(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-CA');
}

/** Supports @lecture-3.pdf and quoted names such as @"Lecture 3.pdf". */
export function extractMaterialMentions(prompt?: string): string[] {
  if (!prompt) return [];
  const mentions: string[] = [];
  const pattern = /@"([^"\r\n]+)"|@([^\s@"']+)/g;
  for (const match of prompt.matchAll(pattern)) {
    const name = (match[1] ?? match[2] ?? '').replace(/[),;:!?\]}]+$/u, '');
    if (name && !mentions.includes(name)) mentions.push(name);
  }
  return mentions;
}

/** Retrieve strictly assigned grounding chunks. Missing assignments, a Qdrant
 * failure, or zero usable hits is a visible service failure: never fall back to
 * generating from the LO name or general model knowledge.
 *
 * `widen` (R7, hard targets only): split the budget HARD_PRIMARY_TOP_K /
 * HARD_SUPPORTING_TOP_K between the LO's own materials and earlier
 * objectives' materials, so a hardness move has a second concept to chain.
 * The widen decision belongs to the CALLER, because `pinnedMaterialIds` here
 * does not mean "instructor pinned" — the tracked pipeline routes its
 * resolved ids through it on every run. Callers must not widen over an
 * actual instructor pin (a pin means exactly these). Widening quietly
 * reverts to the plain retrieval when the course has no earlier-objective
 * material (the first LO) or the supporting search yields nothing. A supporting-search failure likewise degrades to
 * primary-only rather than failing generation: support is an enrichment, and
 * the strictness contract above covers the PRIMARY grounding.
 */
export async function retrieveChunks(
  collection: string,
  courseId: ObjectId,
  lo: { _id: ObjectId; themeId: ObjectId; name: string; order: number },
  prompt?: string,
  pinnedMaterialIds?: string[],
  widen?: boolean,
  /** Multi-LO generation: instructor-chosen secondary objectives. When any
   * are given they ARE the supporting pool — SECONDARY_TOP_K chunks each,
   * filtered to that objective's own materials and queried by its own name —
   * and R7's automatic earlier-objective sweep is skipped: the instructor has
   * said which concept to chain. Unlike the automatic sweep this is a
   * contract, so an objective that retrieves nothing fails the run the same
   * way an ungrounded primary does. */
  secondary: SecondaryLo[] = [],
): Promise<RetrievedGrounding> {
  const allowedMaterialIds = pinnedMaterialIds ?? (await groundingMaterialIds(courseId, lo, prompt));
  if (allowedMaterialIds.length === 0) throw new Error('generation-no-assigned-materials');

  const supportingIds = widen && secondary.length === 0
    ? await supportingMaterialIds(courseId, lo, allowedMaterialIds)
    : [];
  const primaryTopK = supportingIds.length > 0 ? HARD_PRIMARY_TOP_K : RETRIEVE_TOP_K;

  const query = prompt ? `${lo.name}\n${prompt}` : lo.name;
  const vector = await embedOne(query);
  let hits;
  try {
    hits = await search(collection, vector, primaryTopK, {
      must: [{ key: 'materialId', match: { any: allowedMaterialIds } }],
    });
  } catch (err) {
    console.warn(
      `[generation] assigned-material retrieval failed for ${collection}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    throw new Error('generation-retrieval-failed', { cause: err });
  }
  const toChunk = (hit: (typeof hits)[number]) => ({
    materialId: typeof hit.payload?.materialId === 'string' ? hit.payload.materialId : undefined,
    ...(typeof hit.payload?.chunkIndex === 'number' && Number.isSafeInteger(hit.payload.chunkIndex) && hit.payload.chunkIndex >= 0 ? { chunkIndex: hit.payload.chunkIndex } : {}),
    text: typeof hit.payload?.chunk === 'string' ? hit.payload.chunk : '',
  });
  const allowed = new Set(allowedMaterialIds);
  const chunks: RetrievedChunk[] = hits
    .map(toChunk)
    // Defense in depth: Qdrant should enforce the filter, but never trust a
    // malformed/stale hit enough to write a forbidden sourceRef.
    .filter((chunk) => chunk.materialId !== undefined && allowed.has(chunk.materialId) && chunk.text.length > 0);
  if (chunks.length === 0) throw new Error('generation-no-grounding');

  for (const entry of secondary) {
    const secondaryVector = await embedOne(prompt ? `${entry.lo.name}\n${prompt}` : entry.lo.name);
    let secondaryHits;
    try {
      secondaryHits = await search(collection, secondaryVector, SECONDARY_TOP_K, {
        must: [{ key: 'materialId', match: { any: entry.materialIds } }],
      });
    } catch (err) {
      console.warn(
        `[generation] secondary-objective retrieval failed for ${collection}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      throw new Error('generation-retrieval-failed', { cause: err });
    }
    const secondaryAllowed = new Set(entry.materialIds);
    const secondaryChunks = secondaryHits
      .map(toChunk)
      .filter((chunk) =>
        chunk.materialId !== undefined && secondaryAllowed.has(chunk.materialId) && chunk.text.length > 0
        // A material assigned to both objectives can surface the same chunk
        // twice; the primary copy already grounds it.
        && !chunks.some((existing) => existing.text === chunk.text))
      .map((chunk) => ({ ...chunk, supporting: true, supportingLoName: entry.lo.name }));
    if (secondaryChunks.length === 0) throw new Error('generation-secondary-lo-no-grounding');
    chunks.push(...secondaryChunks);
  }

  if (supportingIds.length > 0) {
    try {
      const supportingHits = await search(collection, vector, HARD_SUPPORTING_TOP_K, {
        must: [{ key: 'materialId', match: { any: supportingIds } }],
      });
      const supportingAllowed = new Set(supportingIds);
      chunks.push(
        ...supportingHits
          .map(toChunk)
          .filter((chunk) =>
            chunk.materialId !== undefined && supportingAllowed.has(chunk.materialId) && chunk.text.length > 0)
          .map((chunk) => ({ ...chunk, supporting: true })),
      );
    } catch (err) {
      console.warn(
        `[generation] supporting-material retrieval failed for ${collection}, ` +
          `continuing with primary grounding only: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return { chunks, allowedMaterialIds };
}
