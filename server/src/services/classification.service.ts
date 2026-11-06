import { authoringCollection, authoringCommitAvailable, currentAuthoringSession, withCourseAuthoringWrite } from './authoring-commit.service';
import { assertStructureConsolidationAdoptable, assertStructureCapabilityAdoptable, assertStructureRepairAdoptable, generateStructure, loadStructureCorpus } from './structure-generation.service';
import { assertEditRevision, editConflict, editRevisionFilter } from './edit-revision';
import { ObjectId, type WithId } from 'mongodb';
import { completeJson } from '../components/genai/llm';
import { materialsCol, themesCol, losCol, contentRunsCol } from '../components/mongodb/collections';
import type { LearningObjective, Material, MaterialKind, Theme } from '../types/domain';
import { utilityStepConfig } from './admin.service';
import { upsertCourseOutline } from './courses.service';
import { createStructureGenerationRun, updateContentRun, failContentRun } from './content-runs.service';
import { withModelUsage } from './model-usage.service';
import type { StructureGenerationRun } from '../types/domain';

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
//    Public calls retain a durable generation run/source receipt for guarded
//    Apply. Internal calls without an actor retain the read-only projection.
//
//  - applySuggestedHierarchy(courseId, input): creates the instructor-reviewed
//    subset and atomically merges each suggested material link into the new
//    LO's assignments from the application's point of view. Existing material
//    assignments are preserved.
// -----------------------------------------------------------------------------

export const AUTO_APPLY_CONFIDENCE = 0.85;
export const REVIEW_CONFIDENCE = 0.65;

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
  const material = await authoringCollection(materialsCol()).findOne({ _id: materialId, deletedAt: { $exists: false } });
  if (!material?.excerpt) return; // nothing ingested to classify

  const courseId = material.courseId;
  const [themes, los] = await Promise.all([
    authoringCollection(themesCol()).find({ courseId, archivedAt: { $exists: false } }).toArray(),
    authoringCollection(losCol()).find({ courseId, archivedAt: { $exists: false } }).toArray(),
  ]);
  const result = await completeJson<ClassificationResult>(buildClassificationPrompt(material, themes, los), {
    // temperature 0 is what this step has always used; an admin who sets one on
    // the utility step is overriding it deliberately, so the spread comes last.
    temperature: 0,
    ...(await utilityStepConfig(courseId)),
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
  await withCourseAuthoringWrite(courseId, () => authoringCollection(materialsCol()).updateOne(
    // AI work may take minutes. Do not overwrite a correction made while it ran.
    { _id: materialId, deletedAt: { $exists: false }, ...editRevisionFilter(material.revision ?? 0) },
    needsReview[0] ? { $set: set, $inc: { revision: 1 } } : { $set: set, $unset: { classificationSuggestion: '' }, $inc: { revision: 1 } },
  ));
}

/** Public legacy suggestions also retain a durable source receipt for Apply.
 * Internal read-only consumers may still request the historical projection. */
export async function suggestHierarchy(courseId: ObjectId, requestedBy?: string): Promise<SuggestedHierarchy> {
  let run: WithId<StructureGenerationRun> | undefined;
  try {
    if (requestedBy) {
      const corpus = await loadStructureCorpus(courseId);
      try { run = await createStructureGenerationRun({ courseId, requestedBy, options: { materialIds: corpus.materials.map(material => material.materialId), synthesisProtocol: 'source-condition-context-v1', pageTextObservationProtocol: 'native-page-text-observations-v1' } }); }
      catch (error) { if ((error as { code?: number }).code === 11000) throw structureApplyError('structure-generation-in-progress'); throw error; }
      await updateContentRun(run._id, { status: 'running', message: 'Preparing source analysis' });
    }
    const result = run ? await withModelUsage({ runId: run._id.toHexString(), courseId: courseId.toHexString(), actor: { puid: requestedBy! }, stage: 'structure-analysis' },
      () => generateStructure(courseId, run!.input, run!._id)) : await generateStructure(courseId, {});
    if (run) await updateContentRun(run._id, { status: 'completed', structureResult: result, message: 'Draft ready for review' });
    return {
      ...(run ? { runId: run._id.toHexString() } : {}),
      themes: result.themes.map(t => ({ name: t.name, los: t.los.map(lo => lo.name) })),
      assignments: result.themes.flatMap((t, themeIndex) => t.los.map((lo, loIndex) => ({ themeIndex, loIndex, materialIds: lo.materialIds }))),
    };
  } catch (error) {
    if (run && !(error instanceof Error && error.message === 'content-run-conflict')) {
      await failContentRun(run._id, { code: 'structure-generation-failed', message: 'The outline could not be completed. Generate a new draft.', atStage: 'analyzing', retryable: true });
    }
    if (error instanceof Error && error.message === 'structure-no-materials') return { themes: [], assignments: [] };
    throw error;
  }
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
  consistency?: 'transactional' | 'best-effort';
  warning?: string;
  /** A teacher label edit is intentional authoring, not a new model review. */
  capabilityReview?: { protocol: 'outline-capability-distinctness-v1'; reviewedObjectives: number; withheldObjectives: number;
    wording: 'reviewed' | 'instructor-edited'; teacherEditedNames: number };
  consolidationReview?: { protocol: 'durable-outline-consolidation-v1'; parentRunId: string; retiredIds: string[]; reviewedObjectives: number;
    wording: 'reviewed' | 'instructor-edited'; teacherEditedNames: number };
  repairReview?: { runId: string; parentRunId: string;
    mode: 'wording-only-outline-repair-v1' | 'coverage-wording-outline-repair-v1';
    wording: 'reviewed' | 'instructor-edited'; teacherEditedNames: number };
}

export interface ApplyGeneratedHierarchyInput {
  runId: string;
  themes: Array<{ name: string; los: Array<{ name: string; materialIds: string[]; sourceThemeIndex: number; sourceLoIndex: number }> }>;
}

function structureApplyError(message: string, status = 409): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

/** Public AI adoption always resolves its source scope from a completed run.
 * Text edits are instructor-authored; source links cannot be replaced or omitted. */
export async function applyGeneratedHierarchy(courseId: ObjectId, input: ApplyGeneratedHierarchyInput): Promise<ApplySuggestedHierarchyResult> {
  if (!ObjectId.isValid(input.runId)) throw structureApplyError('structure-apply-run-required', 400);
  // An existing session must also belong to this course before the first read.
  if (authoringCommitAvailable() || currentAuthoringSession()) {
    return withCourseAuthoringWrite(courseId, () => applyGeneratedHierarchyInScope(courseId, input));
  }
  return applyGeneratedHierarchyInScope(courseId, input);
}

async function applyGeneratedHierarchyInScope(courseId: ObjectId, input: ApplyGeneratedHierarchyInput): Promise<ApplySuggestedHierarchyResult> {
  const transactional = Boolean(currentAuthoringSession());
  const run = await authoringCollection(contentRunsCol()).findOne({ _id: new ObjectId(input.runId), courseId, kind: 'structure-generation', status: 'completed' });
  if (!run || run.kind !== 'structure-generation' || !run.structureResult?.coverage.sourceFingerprint) throw structureApplyError('structure-apply-run-unavailable');
  // Repair branches have stronger authority than ordinary historical drafts.
  // Re-enter a required course transaction rather than best-effort adoption.
  const hasRepair = Object.hasOwn(run, 'structureRepair');
  const hasCapability = Object.hasOwn(run.input, 'capabilityDistinctnessProtocol');
  const hasConsolidation = Object.hasOwn(run, 'structureConsolidation');
  if ((hasRepair || hasCapability || hasConsolidation) && !currentAuthoringSession()) {
    return withCourseAuthoringWrite(courseId, () => applyGeneratedHierarchyInScope(courseId, input), { required: true });
  }
  const consolidation = hasConsolidation ? await assertStructureConsolidationAdoptable(courseId, run) : undefined;
  if (hasConsolidation && !consolidation) throw structureApplyError('structure-apply-consolidation-authority-missing');
  const capability = hasCapability && !hasConsolidation ? await assertStructureCapabilityAdoptable(courseId, run) : undefined;
  if (hasCapability && !hasConsolidation && !capability) throw structureApplyError('structure-apply-capability-authority-missing');
  const repair = hasRepair ? await assertStructureRepairAdoptable(courseId, run) : undefined;
  if (hasRepair && !repair) throw structureApplyError('structure-apply-repair-authority-missing');
  const selected = new Set<string>();
  let teacherEditedNames = 0;
  const expectedIds = new Set(run.structureResult.coverage.sourceSelection.included.map(source => source.materialId));
  const identities = (ids: string[]) => JSON.stringify([...new Set(ids)].sort());
  for (const theme of input.themes) {
    let editedTopic = false;
    for (const lo of theme.los) {
      const source = Number.isSafeInteger(lo.sourceThemeIndex) && Number.isSafeInteger(lo.sourceLoIndex) && lo.sourceThemeIndex >= 0 && lo.sourceLoIndex >= 0
        ? run.structureResult.themes[lo.sourceThemeIndex]?.los[lo.sourceLoIndex] : undefined;
      const key = `${lo.sourceThemeIndex}:${lo.sourceLoIndex}`;
      if (!source || selected.has(key) || !source.materialIds.length || source.materialIds.some(id => !expectedIds.has(id)) ||
        identities(lo.materialIds) !== identities(source.materialIds)) throw structureApplyError('structure-apply-source-scope-changed');
      selected.add(key);
      if (repair || capability || consolidation) {
        if (lo.name.trim() !== source.name.trim()) teacherEditedNames += 1;
        if (theme.name.trim() !== run.structureResult.themes[lo.sourceThemeIndex]!.name.trim()) editedTopic = true;
      }
    }
    if (editedTopic) teacherEditedNames += 1;
  }
  if (consolidation && selected.size !== run.structureResult.themes.reduce((sum, theme) => sum + theme.los.length, 0)) throw structureApplyError('structure-apply-consolidation-full-projection-required');
  if (!selected.size) throw structureApplyError('suggested-hierarchy-invalid', 400);
  // Replica-set reads share the short course-fenced transaction. Standalone
  // checks both sides of revision-guarded writes and reports its weaker guarantee.
  const currentCorpus = () => loadStructureCorpus(courseId, run.input.materialIds, run.input.sourceBatchId, run.input.sourceReplacements);
  let corpus: Awaited<ReturnType<typeof loadStructureCorpus>>;
  try { corpus = await currentCorpus(); }
  catch { throw structureApplyError('structure-apply-source-changed'); }
  if (corpus.fingerprint !== run.structureResult.coverage.sourceFingerprint) throw structureApplyError('structure-apply-source-changed');
  let writesStarted = false;
  try {
    const result = await applySuggestedHierarchy(courseId, input, {
      expectedRevisions: new Map(corpus.sourceSelection.included.map(source => [source.materialId, source.revision ?? 0])),
      beforeHierarchyWrite: () => { writesStarted = true; },
    });
    if ((await currentCorpus()).fingerprint !== corpus.fingerprint) throw structureApplyError('structure-apply-source-changed');
    return { ...result, consistency: transactional ? 'transactional' : 'best-effort',
      ...(!transactional ? { warning: 'Sources were checked before and after applying. This database does not support atomic source adoption; concurrent source changes cannot be ruled out.' } : {}),
      ...(capability ? { capabilityReview: { ...capability, wording: teacherEditedNames ? 'instructor-edited' as const : 'reviewed' as const, teacherEditedNames },
        ...(teacherEditedNames ? { warning: 'Your edited labels were applied as instructor-authored wording. Capability comparisons cover the stored proposal, not these subsequent text edits.' } : {}) } : {}),
      ...(consolidation ? { consolidationReview: { protocol: consolidation.protocol, parentRunId: consolidation.parentRunId, retiredIds: consolidation.retiredIds, reviewedObjectives: consolidation.reviewedObjectives, wording: teacherEditedNames ? 'instructor-edited' as const : 'reviewed' as const, teacherEditedNames },
        ...(teacherEditedNames ? { warning: 'Your edited labels are instructor-authored. The full consolidation review covers the stored wording, not subsequent teacher edits.' } : {}) } : {}),
      ...(repair ? { repairReview: { runId: run._id.toHexString(), ...repair,
        wording: teacherEditedNames ? 'instructor-edited' as const : 'reviewed' as const, teacherEditedNames },
        ...(teacherEditedNames ? { warning: 'Your edited labels were applied as instructor-authored wording. The independent repair review covers the stored proposal, not these subsequent text edits.' } : {}) } : {}),
    };
  } catch (error) {
    // Standalone cannot roll back shared hierarchy rows safely. Never return a
    // ready/success receipt after a detected race or an uncertain partial write.
    if (!transactional && writesStarted) throw structureApplyError('structure-apply-conflict-after-write');
    throw error;
  }
}

interface HierarchySourceGuard {
  expectedRevisions: Map<string, number>;
  beforeHierarchyWrite: () => void;
}

/**
 * Internal/manual hierarchy application. Public AI callers must use
 * applyGeneratedHierarchy so omitting its run proof cannot choose this path. All
 * referenced materials are validated before the first hierarchy write so a
 * stale or cross-course material id cannot leave a partially-created outline.
 */
export async function applySuggestedHierarchy(
  courseId: ObjectId,
  input: ApplySuggestedHierarchyInput,
  sourceGuard?: HierarchySourceGuard,
): Promise<ApplySuggestedHierarchyResult> {
  if (authoringCommitAvailable() && !currentAuthoringSession()) return withCourseAuthoringWrite(courseId, () => applySuggestedHierarchy(courseId, input, sourceGuard));
  const normalized = input.themes.map((theme) => ({
    name: theme.name.trim(),
    los: theme.los.map((lo) => ({
      name: lo.name.trim(),
      materialIds: [...new Set(lo.materialIds)],
    })),
  }));
  if (
    normalized.length === 0 ||
    normalized.some((theme) => theme.name === '' || !theme.los.length || theme.los.some((lo) => lo.name === '') ||
      new Set(theme.los.map(lo => lo.name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-CA'))).size !== theme.los.length)
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
      : await authoringCollection(materialsCol())
          .find({ _id: { $in: materialIds }, courseId, status: 'ready', deletedAt: { $exists: false } })
          .toArray();
  if (materials.length !== materialIds.length) {
    throw new Error('suggested-hierarchy-material-not-found');
  }
  if (sourceGuard && materials.some(material => sourceGuard.expectedRevisions.get(material._id.toHexString()) !== (material.revision ?? 0))) {
    throw structureApplyError('structure-apply-source-changed');
  }

  sourceGuard?.beforeHierarchyWrite();
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
    const expectedRevision = material.revision ?? 0;
    const written = await authoringCollection(materialsCol()).updateOne(
      { _id: material._id, courseId, ...(sourceGuard ? { status: 'ready', deletedAt: { $exists: false }, ...editRevisionFilter(expectedRevision) } : {}) },
      {
        $addToSet: { assignments: { $each: novel } },
        $inc: { revision: 1 },
        $unset: { classificationSuggestion: '' },
      },
    );
    if (sourceGuard) {
      if (written.matchedCount !== 1) throw structureApplyError('structure-apply-source-changed');
    }
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
  expectedRevision?: number,
): Promise<WithId<Material>> {
  const material = await authoringCollection(materialsCol()).findOne({ _id: materialId });
  if (!material) throw new Error('material-not-found');
  if (authoringCommitAvailable() && !currentAuthoringSession()) return withCourseAuthoringWrite(material.courseId, () => resolveClassification(materialId, action, expectedRevision));
  assertEditRevision('Material', material, expectedRevision);

  const clearSuggestion = { $unset: { classificationSuggestion: '', classificationSuggestions: '' }, $inc: { revision: 1 } } as const;

  if (action === 'reject') {
    const updated = await authoringCollection(materialsCol()).findOneAndUpdate(
      { _id: materialId, deletedAt: { $exists: false }, ...editRevisionFilter(expectedRevision ?? material.revision ?? 0) },
      clearSuggestion,
      { returnDocument: 'after' },
    );
    if (!updated) throw editConflict('Material');
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

  const updated = await authoringCollection(materialsCol()).findOneAndUpdate(
    { _id: materialId, deletedAt: { $exists: false }, ...editRevisionFilter(expectedRevision ?? material.revision ?? 0) },
    { $set: { assignments: nextAssignments }, ...clearSuggestion },
    { returnDocument: 'after' },
  );
  if (!updated) throw editConflict('Material');
  return updated;
}

/** The shape suggestHierarchy returns and the endpoint serializes. */
export interface SuggestedHierarchy {
  runId?: string;
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
