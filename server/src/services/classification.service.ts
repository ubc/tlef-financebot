import { ObjectId, type WithId } from 'mongodb';
import { completeJson } from '../components/genai/llm';
import { materialsCol, themesCol, losCol } from '../components/mongodb/collections';
import { env } from '../config/env';
import type { LearningObjective, Material, MaterialKind, Theme } from '../types/domain';
import { upsertCourseOutline } from './courses.service';

// -----------------------------------------------------------------------------
// Classification service (IN-S06): LLM-assisted material auto-classification and
// AI-suggested course hierarchy. Both features are ADVISORY — they only ever
// produce *suggestions* an instructor accepts or rejects; nothing here mutates
// the published Theme/LO hierarchy or a material's assignments on its own.
//
//  - classifyMaterial(materialId): after a material ingests, ask the LLM which
//    existing Theme (and optionally LO) it belongs to, and — only when the
//    model is confident (>= CONFIDENCE_THRESHOLD) and the names resolve to real
//    ids — stash a `classificationSuggestion` on the material. The instructor
//    then accepts/rejects it via resolveClassification(). Called from the tail
//    of the `material.ingest` job (materials.service.ts), best-effort: a
//    failure here must never flip a successfully-ingested material to `failed`.
//
//  - suggestHierarchy(courseId): from the ingested materials' text, propose a
//    whole Theme -> LO outline plus the ready materials relevant to each LO.
//    Pure read: it NEVER writes the DB.
//
//  - applySuggestedHierarchy(courseId, input): creates the instructor-reviewed
//    subset and atomically merges each suggested material link into the new
//    LO's assignments from the application's point of view. Existing material
//    assignments are preserved.
// -----------------------------------------------------------------------------

export const AUTO_APPLY_CONFIDENCE = 0.85;
export const REVIEW_CONFIDENCE = 0.65;

// How much of each material's text the prompts use. The excerpt is persisted on
// the Material at ingest time (materials.service.ts) — see the deviation note
// there — so neither function re-parses files or re-fetches URL materials.
const MAX_HIERARCHY_MATERIALS = 40;

interface ClassificationResult {
  themeName?: string;
  loName?: string;
  confidence?: number;
  materialKind?: MaterialKind;
  materialKindConfidence?: number;
  matches?: Array<{ themeName?: unknown; loName?: unknown; confidence?: unknown; rationale?: unknown }>;
  concepts?: Array<{
    name?: unknown;
    description?: unknown;
    confidence?: unknown;
    evidence?: unknown;
    relationships?: unknown;
  }>;
}

interface HierarchyResult {
  themes?: Array<{ name?: unknown; los?: unknown }>;
}

interface HierarchyResultLo {
  name?: unknown;
  materialNumbers?: unknown;
}

/** Case-insensitive, whitespace-insensitive name match — the LLM echoes the
 * names we gave it, but casing/trailing spaces drift, and an unresolved name
 * must fall through to "store nothing" rather than a wrong id. */
function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * IN-S06 auto-classification. Reads the material's persisted excerpt and the
 * course's live Theme/LO names, asks the LLM for kind, concepts, and zero or
 * more mappings. High-confidence mappings apply automatically; medium ones
 * become review items. Extraction still runs before a hierarchy exists.
 */
export async function classifyMaterial(materialId: ObjectId): Promise<void> {
  const material = await materialsCol().findOne({ _id: materialId, deletedAt: { $exists: false } });
  if (!material?.excerpt) return; // nothing ingested to classify

  const courseId = material.courseId;
  const [themes, los] = await Promise.all([
    themesCol().find({ courseId, archivedAt: { $exists: false } }).toArray(),
    losCol().find({ courseId, archivedAt: { $exists: false } }).toArray(),
  ]);
  const result = await completeJson<ClassificationResult>(buildClassificationPrompt(material, themes, los), {
    model: env.llmDefaultModel,
    temperature: 0,
  });

  const rawMatches = Array.isArray(result.matches)
    ? result.matches
    : result.themeName
      ? [{ themeName: result.themeName, loName: result.loName, confidence: result.confidence }]
      : [];
  const resolved: NonNullable<Material['classificationSuggestions']> = [];
  for (const match of rawMatches.slice(0, 8)) {
    if (typeof match.themeName !== 'string' || typeof match.confidence !== 'number') continue;
    if (match.confidence < REVIEW_CONFIDENCE || match.confidence > 1) continue;
    const theme = themes.find((candidate) => normalizeName(candidate.name) === normalizeName(match.themeName as string));
    if (!theme) continue;
    const lo =
      typeof match.loName === 'string'
        ? los.find(
            (candidate) =>
              candidate.themeId.equals(theme._id) &&
              normalizeName(candidate.name) === normalizeName(match.loName as string),
          )
        : undefined;
    const duplicate = resolved.some(
      (candidate) =>
        candidate.themeId.equals(theme._id) &&
        Boolean(candidate.loId) === Boolean(lo?._id) &&
        (!candidate.loId || !lo?._id || candidate.loId.equals(lo._id)),
    );
    if (duplicate) continue;
    resolved.push({
      themeId: theme._id,
      ...(lo ? { loId: lo._id } : {}),
      confidence: match.confidence,
      ...(typeof match.rationale === 'string' ? { rationale: match.rationale.slice(0, 500) } : {}),
    });
  }
  resolved.sort((a, b) => b.confidence - a.confidence);
  const autoApplied = resolved.filter((match) => match.confidence >= AUTO_APPLY_CONFIDENCE);
  const needsReview = resolved.filter((match) => match.confidence < AUTO_APPLY_CONFIDENCE);
  const assignments = [...(material.assignments ?? [])];
  for (const match of autoApplied) {
    const exists = assignments.some(
      (assignment) =>
        assignment.themeId.equals(match.themeId) &&
        Boolean(assignment.loId) === Boolean(match.loId) &&
        (!assignment.loId || !match.loId || assignment.loId.equals(match.loId)),
    );
    if (!exists) assignments.push({ themeId: match.themeId, ...(match.loId ? { loId: match.loId } : {}) });
  }

  const kinds: MaterialKind[] = ['lecture', 'reading', 'assignment', 'assessment', 'solution', 'reference', 'other'];
  const aiKind = kinds.includes(result.materialKind as MaterialKind) ? (result.materialKind as MaterialKind) : undefined;
  const kindConfidence =
    typeof result.materialKindConfidence === 'number' && result.materialKindConfidence >= 0 && result.materialKindConfidence <= 1
      ? result.materialKindConfidence
      : 0;
  const concepts: NonNullable<Material['knowledgeConcepts']> = [];
  for (const raw of Array.isArray(result.concepts) ? result.concepts.slice(0, 24) : []) {
    if (typeof raw.name !== 'string' || raw.name.trim() === '') continue;
    const relationships = Array.isArray(raw.relationships)
      ? raw.relationships
          .filter(
            (relationship): relationship is { targetName: string; type: string } =>
              typeof relationship === 'object' &&
              relationship !== null &&
              typeof (relationship as { targetName?: unknown }).targetName === 'string' &&
              typeof (relationship as { type?: unknown }).type === 'string',
          )
          .slice(0, 12)
          .map((relationship) => ({ targetName: relationship.targetName.slice(0, 120), type: relationship.type.slice(0, 60) }))
      : undefined;
    concepts.push({
      name: raw.name.trim().slice(0, 120),
      ...(typeof raw.description === 'string' ? { description: raw.description.slice(0, 600) } : {}),
      confidence:
        typeof raw.confidence === 'number' ? Math.max(0, Math.min(1, raw.confidence)) : 0.5,
      ...(typeof raw.evidence === 'string' ? { evidence: raw.evidence.slice(0, 600) } : {}),
      ...(relationships?.length ? { relationships } : {}),
    });
  }

  const highestConfidence = resolved[0]?.confidence ?? 0;
  const set: Partial<Material> = {
    assignments,
    classificationSuggestions: needsReview,
    automation: {
      kind: {
        value: aiKind && kindConfidence >= REVIEW_CONFIDENCE ? aiKind : (material.kind ?? 'other'),
        confidence: aiKind ? kindConfidence : 0,
        source: aiKind && kindConfidence >= REVIEW_CONFIDENCE ? 'ai' : 'filename',
      },
      assignment: {
        status: autoApplied.length > 0 ? 'auto-applied' : needsReview.length > 0 ? 'needs-review' : 'unmatched',
        confidence: highestConfidence,
        updatedAt: new Date(),
      },
    },
    knowledgeConcepts: concepts,
  };
  if (aiKind && kindConfidence >= REVIEW_CONFIDENCE) set.kind = aiKind;
  if (needsReview[0]) set.classificationSuggestion = needsReview[0];
  await materialsCol().updateOne(
    { _id: materialId, deletedAt: { $exists: false } },
    needsReview[0] ? { $set: set } : { $set: set, $unset: { classificationSuggestion: '' } },
  );
}

/**
 * IN-S06 AI-suggested hierarchy. From the course's ready materials' excerpts,
 * ask the LLM to propose a Theme -> LO outline. Pure read — never writes the DB;
 * the instructor applies it via the existing addTheme/addLo endpoints. Returns
 * an empty hierarchy (no LLM call) when the course has no ready materials.
 */
export async function suggestHierarchy(courseId: ObjectId): Promise<SuggestedHierarchy> {
  const materials = await materialsCol()
    .find({ courseId, status: 'ready', deletedAt: { $exists: false } })
    .toArray();
  const sourceMaterials = materials
    .filter((material) => Boolean(material.excerpt?.trim()))
    .slice(0, MAX_HIERARCHY_MATERIALS);
  if (sourceMaterials.length === 0) return { themes: [], assignments: [] };

  const existing = await themesCol().find({ courseId, archivedAt: { $exists: false } }).toArray();
  const raw = await completeJson<HierarchyResult>(buildHierarchyPrompt(sourceMaterials, existing), {
    model: env.llmDefaultModel,
    temperature: 0,
  });

  // Shape the untrusted LLM JSON into the public contract. Material numbers
  // are one-based positions from the prompt; translate them to real ids here
  // so the client can never invent a link from model output.
  const themes: SuggestedHierarchy['themes'] = [];
  const assignments: SuggestedHierarchy['assignments'] = [];
  for (const rawTheme of Array.isArray(raw.themes) ? raw.themes : []) {
    if (typeof rawTheme?.name !== 'string' || rawTheme.name.trim() === '') continue;
    const themeIndex = themes.length;
    const los: string[] = [];
    for (const rawLo of Array.isArray(rawTheme.los) ? rawTheme.los : []) {
      // Accept the old string-only shape as a safe no-assignment fallback if a
      // provider ignores the new response instructions.
      const lo: HierarchyResultLo =
        typeof rawLo === 'string' ? { name: rawLo, materialNumbers: [] } : (rawLo as HierarchyResultLo);
      if (typeof lo?.name !== 'string' || lo.name.trim() === '') continue;
      const loIndex = los.length;
      los.push(lo.name.trim());
      const materialIds = [
        ...new Set(
          (Array.isArray(lo.materialNumbers) ? lo.materialNumbers : [])
            .filter((number): number is number => Number.isInteger(number))
            .map((number) => sourceMaterials[number - 1]?._id.toHexString())
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      if (materialIds.length > 0) assignments.push({ themeIndex, loIndex, materialIds });
    }
    themes.push({ name: rawTheme.name.trim(), los });
  }
  return { themes, assignments };
}

export interface ApplySuggestedHierarchyInput {
  themes: Array<{
    name: string;
    los: Array<{ name: string; materialIds: string[] }>;
  }>;
}

export interface ApplySuggestedHierarchyResult {
  themesCreated: number;
  losCreated: number;
  materialsAssigned: number;
  assignmentsCreated: number;
}

/**
 * Applies an instructor-reviewed AI hierarchy and its source mappings. All
 * referenced materials are validated before the first hierarchy write so a
 * stale or cross-course material id cannot leave a partially-created outline.
 */
export async function applySuggestedHierarchy(
  courseId: ObjectId,
  input: ApplySuggestedHierarchyInput,
): Promise<ApplySuggestedHierarchyResult> {
  const normalized = input.themes.map((theme) => ({
    name: theme.name.trim(),
    los: theme.los.map((lo) => ({
      name: lo.name.trim(),
      materialIds: [...new Set(lo.materialIds)],
    })),
  }));
  if (
    normalized.length === 0 ||
    normalized.some((theme) => theme.name === '' || theme.los.some((lo) => lo.name === ''))
  ) {
    throw new Error('suggested-hierarchy-invalid');
  }

  const materialIdStrings = [
    ...new Set(normalized.flatMap((theme) => theme.los.flatMap((lo) => lo.materialIds))),
  ];
  if (materialIdStrings.some((id) => !ObjectId.isValid(id))) {
    throw new Error('suggested-hierarchy-material-not-found');
  }
  const materialIds = materialIdStrings.map((id) => new ObjectId(id));
  const materials =
    materialIds.length === 0
      ? []
      : await materialsCol()
          .find({ _id: { $in: materialIds }, courseId, status: 'ready', deletedAt: { $exists: false } })
          .toArray();
  if (materials.length !== materialIds.length) {
    throw new Error('suggested-hierarchy-material-not-found');
  }

  const outline = await upsertCourseOutline(courseId, {
    themes: normalized.map((theme) => ({
      name: theme.name,
      los: theme.los.map((lo) => lo.name),
    })),
  });
  const assignmentsByMaterial = new Map<string, Array<{ themeId: ObjectId; loId: ObjectId }>>();
  for (const [themeIndex, theme] of normalized.entries()) {
    const upsertedTheme = outline.themes[themeIndex];
    if (!upsertedTheme) throw new Error('suggested-hierarchy-invalid');
    for (const [loIndex, lo] of theme.los.entries()) {
      const upsertedLo = upsertedTheme.los[loIndex];
      if (!upsertedLo) throw new Error('suggested-hierarchy-invalid');
      for (const materialId of lo.materialIds) {
        const bucket = assignmentsByMaterial.get(materialId) ?? [];
        bucket.push({ themeId: upsertedTheme._id, loId: upsertedLo._id });
        assignmentsByMaterial.set(materialId, bucket);
      }
    }
  }

  let assignmentsCreated = 0;
  for (const material of materials) {
    const additions = assignmentsByMaterial.get(material._id.toHexString()) ?? [];
    const existing = material.assignments ?? [];
    const novel = additions.filter(
      (addition) =>
        !existing.some(
          (assignment) =>
            assignment.themeId.equals(addition.themeId) &&
            assignment.loId?.equals(addition.loId) === true,
        ),
    );
    if (novel.length === 0) continue;
    assignmentsCreated += novel.length;
    await materialsCol().updateOne(
      { _id: material._id, courseId },
      {
        $addToSet: { assignments: { $each: novel } },
        $unset: { classificationSuggestion: '' },
      },
    );
  }

  return {
    themesCreated: outline.themesCreated,
    losCreated: outline.losCreated,
    materialsAssigned: assignmentsByMaterial.size,
    assignmentsCreated,
  };
}

/**
 * Accept or reject a material's pending classification suggestion (IN-S06,
 * contract `POST /api/materials/:id/classification`). Accept merges the
 * suggested `{ themeId, loId? }` into the material's assignments (dedup) and
 * clears the suggestion; reject just clears the suggestion, leaving assignments
 * untouched. Throws `material-not-found` / `no-classification-suggestion`.
 */
export async function resolveClassification(
  materialId: ObjectId,
  action: 'accept' | 'reject',
): Promise<WithId<Material>> {
  const material = await materialsCol().findOne({ _id: materialId });
  if (!material) throw new Error('material-not-found');

  const clearSuggestion = { $unset: { classificationSuggestion: '', classificationSuggestions: '' } } as const;

  if (action === 'reject') {
    const updated = await materialsCol().findOneAndUpdate(
      { _id: materialId },
      clearSuggestion,
      { returnDocument: 'after' },
    );
    if (!updated) throw new Error('material-not-found');
    return updated;
  }

  const suggestion = material.classificationSuggestion;
  if (!suggestion) throw new Error('no-classification-suggestion');

  // Merge the suggestion into assignments without duplicating an identical one
  // (same themeId, same loId-or-absent). The many-to-many IN-S05 assignments
  // are objects, so $addToSet can't dedup them structurally here — do it in
  // code against the doc we already loaded.
  const assignments = material.assignments ?? [];
  const already = assignments.some(
    (a) =>
      a.themeId.equals(suggestion.themeId) &&
      Boolean(a.loId) === Boolean(suggestion.loId) &&
      (!a.loId || !suggestion.loId || a.loId.equals(suggestion.loId)),
  );
  const nextAssignments = already
    ? assignments
    : [...assignments, { themeId: suggestion.themeId, ...(suggestion.loId ? { loId: suggestion.loId } : {}) }];

  const updated = await materialsCol().findOneAndUpdate(
    { _id: materialId },
    { $set: { assignments: nextAssignments }, ...clearSuggestion },
    { returnDocument: 'after' },
  );
  if (!updated) throw new Error('material-not-found');
  return updated;
}

/** The shape suggestHierarchy returns and the endpoint serializes. */
export interface SuggestedHierarchy {
  themes: Array<{ name: string; los: string[] }>;
  assignments: Array<{
    themeIndex: number;
    loIndex: number;
    materialIds: string[];
  }>;
}

// --- Prompts (inline, one-shot few-shot, temperature 0) ----------------------

function buildClassificationPrompt(
  material: WithId<Material>,
  themes: WithId<Theme>[],
  los: WithId<LearningObjective>[],
): string {
  const losByTheme = new Map<string, string[]>();
  for (const lo of los) {
    const key = lo.themeId.toHexString();
    const bucket = losByTheme.get(key);
    if (bucket) bucket.push(lo.name);
    else losByTheme.set(key, [lo.name]);
  }
  const hierarchy = themes
    .map((t) => {
      const themeLos = losByTheme.get(t._id.toHexString()) ?? [];
      const loLines = themeLos.length > 0 ? themeLos.map((n) => `    - ${n}`).join('\n') : '    (no LOs yet)';
      return `- Theme: ${t.name}\n${loLines}`;
    })
    .join('\n') || '(No Topics or LOs exist yet. Return no hierarchy matches.)';

  return [
    'You are helping an instructor organise course materials into an existing',
    'Theme / Learning Objective (LO) hierarchy. Infer the material kind, extract',
    'important concepts with short source evidence, and find every strong match',
    'to the existing hierarchy. A material may match multiple LOs. Use ONLY',
    'hierarchy names shown below; never invent a match.',
    '',
    'Respond with ONLY a JSON object of this shape:',
    '{ "materialKind": "lecture"|"reading"|"assignment"|"assessment"|"solution"|"reference"|"other",',
    '  "materialKindConfidence": number,',
    '  "matches": [{ "themeName": string, "loName": string|null, "confidence": number, "rationale": string }],',
    '  "concepts": [{ "name": string, "description": string, "confidence": number, "evidence": string,',
    '                  "relationships": [{ "targetName": string, "type": string }] }] }',
    'All confidence values are 0..1. Return an empty matches array when nothing fits.',
    '',
    'Existing hierarchy:',
    hierarchy,
    '',
    `Material title: ${material.name}`,
    'Material excerpt:',
    material.excerpt ?? '',
  ].join('\n');
}

function buildHierarchyPrompt(materials: Array<WithId<Material>>, existing: WithId<Theme>[]): string {
  const existingLine =
    existing.length > 0
      ? `The course already has these Themes (avoid duplicating them): ${existing.map((t) => t.name).join(', ')}.`
      : 'The course has no Themes yet.';
  const corpus = materials
    .map((material, index) => `--- Material ${index + 1}: ${material.name} ---\n${material.excerpt?.trim() ?? ''}`)
    .join('\n\n');

  return [
    'You are helping an instructor draft a course outline from their uploaded',
    'materials. Propose a hierarchy of Themes, each with a short list of Learning',
    'Objectives (LOs), covering the material below. For every LO, identify every',
    'source material that substantively supports it. A material may support',
    'multiple LOs, and an LO may use multiple materials.',
    existingLine,
    '',
    'Respond with ONLY a JSON object of this shape:',
    '{ "themes": [ { "name": string, "los": [',
    '  { "name": string, "materialNumbers": number[] }',
    '] } ] }',
    'materialNumbers are the one-based Material numbers shown below. Use only',
    'numbers that appear below; do not invent sources.',
    'Keep names concise (a few words). Prefer 3-8 Themes with 2-5 LOs each.',
    '',
    'Materials:',
    corpus,
  ].join('\n');
}
