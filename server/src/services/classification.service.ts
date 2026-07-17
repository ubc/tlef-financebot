import type { ObjectId, WithId } from 'mongodb';
import { completeJson } from '../components/genai/llm';
import { materialsCol, themesCol, losCol } from '../components/mongodb/collections';
import { env } from '../config/env';
import type { LearningObjective, Material, Theme } from '../types/domain';

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
//    whole Theme -> LO outline. Pure read: it NEVER writes the DB. Acceptance
//    is the instructor calling the existing addTheme/addLo endpoints (Task 2)
//    with the names returned here. Slip candidate #3.
// -----------------------------------------------------------------------------

// Below this the model is telling us it isn't sure; per the brief a low-
// confidence classification stores nothing and the material shows as
// "Unclassified" client-side.
const CONFIDENCE_THRESHOLD = 0.5;

// How much of each material's text the prompts use. The excerpt is persisted on
// the Material at ingest time (materials.service.ts) — see the deviation note
// there — so neither function re-parses files or re-fetches URL materials.
const MAX_HIERARCHY_MATERIALS = 40;

interface ClassificationResult {
  themeName: string;
  loName?: string;
  confidence: number;
}

interface HierarchyResult {
  themes?: Array<{ name?: unknown; los?: unknown }>;
}

/** Case-insensitive, whitespace-insensitive name match — the LLM echoes the
 * names we gave it, but casing/trailing spaces drift, and an unresolved name
 * must fall through to "store nothing" rather than a wrong id. */
function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * IN-S06 auto-classification. Reads the material's persisted excerpt and the
 * course's live Theme/LO names, asks the LLM for a single best-fit Theme (+
 * optional LO) with a confidence, and stores a `classificationSuggestion` only
 * when the model is confident AND the suggested names resolve to real ids.
 * Stores nothing (and makes no LLM call) when the material has no excerpt or the
 * course has no themes yet.
 */
export async function classifyMaterial(materialId: ObjectId): Promise<void> {
  const material = await materialsCol().findOne({ _id: materialId });
  if (!material?.excerpt) return; // nothing ingested to classify

  const courseId = material.courseId;
  const [themes, los] = await Promise.all([
    themesCol().find({ courseId, archivedAt: { $exists: false } }).toArray(),
    losCol().find({ courseId, archivedAt: { $exists: false } }).toArray(),
  ]);
  if (themes.length === 0) return; // no hierarchy to classify into yet

  const result = await completeJson<ClassificationResult>(buildClassificationPrompt(material, themes, los), {
    model: env.llmDefaultModel,
    temperature: 0,
  });

  if (typeof result.confidence !== 'number' || result.confidence < CONFIDENCE_THRESHOLD) return;

  const theme = themes.find((t) => normalizeName(t.name) === normalizeName(result.themeName ?? ''));
  if (!theme) return; // the model named a theme that doesn't exist — discard

  // An LO only counts if it names a real LO UNDER the matched theme.
  const lo = result.loName
    ? los.find((l) => l.themeId.equals(theme._id) && normalizeName(l.name) === normalizeName(result.loName!))
    : undefined;

  const suggestion: Material['classificationSuggestion'] = {
    themeId: theme._id,
    ...(lo ? { loId: lo._id } : {}),
    confidence: result.confidence,
  };
  await materialsCol().updateOne({ _id: materialId }, { $set: { classificationSuggestion: suggestion } });
}

/**
 * IN-S06 AI-suggested hierarchy. From the course's ready materials' excerpts,
 * ask the LLM to propose a Theme -> LO outline. Pure read — never writes the DB;
 * the instructor applies it via the existing addTheme/addLo endpoints. Returns
 * an empty hierarchy (no LLM call) when the course has no ready materials.
 */
export async function suggestHierarchy(courseId: ObjectId): Promise<SuggestedHierarchy> {
  const materials = await materialsCol()
    .find({ courseId, status: 'ready' })
    .toArray();
  const excerpts = materials
    .map((m) => m.excerpt?.trim())
    .filter((e): e is string => Boolean(e))
    .slice(0, MAX_HIERARCHY_MATERIALS);
  if (excerpts.length === 0) return { themes: [] };

  const existing = await themesCol().find({ courseId, archivedAt: { $exists: false } }).toArray();
  const raw = await completeJson<HierarchyResult>(buildHierarchyPrompt(excerpts, existing), {
    model: env.llmDefaultModel,
    temperature: 0,
  });

  // Shape the (untrusted) LLM JSON into the return type: keep only entries with
  // a non-blank theme name, and only string LO names within each.
  const themes = (Array.isArray(raw.themes) ? raw.themes : [])
    .filter((t): t is { name: string; los?: unknown } => typeof t?.name === 'string' && t.name.trim() !== '')
    .map((t) => ({
      name: t.name.trim(),
      los: (Array.isArray(t.los) ? t.los : [])
        .filter((l): l is string => typeof l === 'string' && l.trim() !== '')
        .map((l) => l.trim()),
    }));
  return { themes };
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

  const clearSuggestion = { $unset: { classificationSuggestion: '' } } as const;

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
    .join('\n');

  return [
    'You are helping an instructor organise course materials into an existing',
    'Theme / Learning Objective (LO) hierarchy. Classify the material below into',
    'exactly ONE existing Theme, and optionally ONE existing LO under that Theme.',
    'Use ONLY names that appear in the hierarchy — do not invent new ones.',
    '',
    'Respond with ONLY a JSON object of this shape:',
    '{ "themeName": string, "loName": string | null, "confidence": number }',
    'confidence is 0..1 — your certainty the material belongs to that Theme.',
    'If nothing fits well, still pick the closest Theme but give a low confidence.',
    '',
    'Existing hierarchy:',
    hierarchy,
    '',
    `Material title: ${material.name}`,
    'Material excerpt:',
    material.excerpt ?? '',
  ].join('\n');
}

function buildHierarchyPrompt(excerpts: string[], existing: WithId<Theme>[]): string {
  const existingLine =
    existing.length > 0
      ? `The course already has these Themes (avoid duplicating them): ${existing.map((t) => t.name).join(', ')}.`
      : 'The course has no Themes yet.';
  const corpus = excerpts.map((e, i) => `--- Material ${i + 1} ---\n${e}`).join('\n\n');

  return [
    'You are helping an instructor draft a course outline from their uploaded',
    'materials. Propose a hierarchy of Themes, each with a short list of Learning',
    'Objectives (LOs), covering the material below.',
    existingLine,
    '',
    'Respond with ONLY a JSON object of this shape:',
    '{ "themes": [ { "name": string, "los": string[] } ] }',
    'Keep names concise (a few words). Prefer 3-8 Themes with 2-5 LOs each.',
    '',
    'Materials:',
    corpus,
  ].join('\n');
}
