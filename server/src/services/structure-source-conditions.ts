import { createHash } from 'node:crypto';
import type { SourceExtractionSection } from '../types/source-evidence';
import type { StructureConditionContext, StructureConditionOriginal, StructureEvidence } from '../types/structure';
import { estimateAuthoringTokens } from '../components/genai/llm/authoring-budget';
import { resolveSourcePassagePolicy, splitSourcePassages, type SourcePassagePolicy } from './source-passages';

export const SOURCE_CONDITION_CONTEXT_PROTOCOL = 'source-condition-context-v1' as const;
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
interface Section { id: string; localId?: string; materialId: string; chunkIndex: number; text: string }
export interface StructureConditionContextInput {
  sourceFingerprint: string;
  passagePolicy?: SourcePassagePolicy;
  sections: Section[];
  materials: Array<{ materialId: string; sourceTextHash: string; parserVersion: string; chunkerVersion: string }>;
  extractions: Array<{ sectionId: string; row: SourceExtractionSection }>;
  evidence: StructureEvidence[];
}
const pointKey = (point: StructureEvidence): string => hash([point.materialId, point.chunkIndex, point.sourcePassageId,
  point.objective, point.quote, point.supportingPassages ?? []]);
const trusted = new WeakSet<StructureConditionContext>();
function freeze(context: StructureConditionContext): StructureConditionContext {
  for (const original of context.originals) Object.freeze(original);
  for (const condition of context.conditions) {
    Object.freeze(condition.originalIds); Object.freeze(condition.evidenceIds); Object.freeze(condition.evidenceKeys); Object.freeze(condition);
  }
  Object.freeze(context.originals); Object.freeze(context.conditions); Object.freeze(context); trusted.add(context); return context;
}

/** Mechanical joins retain extracted conditions as advisory source-local context.
 * Matching passage identity does not prove that a condition applies to every
 * capability in that passage, and never credits pedagogical coverage. */
export function buildStructureConditionContext(input: StructureConditionContextInput): StructureConditionContext {
  const passagePolicy = resolveSourcePassagePolicy(input.passagePolicy);
  if (new Set(input.sections.map(section => section.id)).size !== input.sections.length ||
      new Set(input.materials.map(material => material.materialId)).size !== input.materials.length ||
      new Set(input.evidence.map(point => point.id)).size !== input.evidence.length ||
      new Set(input.extractions.map(row => row.sectionId)).size !== input.extractions.length) throw new Error('structure-condition-identity');
  if (input.extractions.length !== input.sections.length || input.sections.some(section => !input.extractions.some(row => row.sectionId === section.id))) throw new Error('structure-condition-extraction-incomplete');
  const originals = new Map<string, StructureConditionOriginal>();
  const conditions = new Map<string, StructureConditionContext['conditions'][number]>();
  for (const extraction of input.extractions) {
    const section = input.sections.find(row => row.id === extraction.sectionId);
    if (!section || (section.localId ?? section.id) !== extraction.row.sectionId) throw new Error('structure-condition-section-changed');
    const material = input.materials.find(row => row.materialId === section.materialId);
    if (!material) throw new Error('structure-condition-material-changed');
    const sectionId = section.localId ?? section.id;
    const passages = splitSourcePassages({ ...section, id: sectionId }, passagePolicy);
    const verifyReference = (reference: { passageId: string; quote: string }) => {
      if (!passages.some(passage => passage.id === reference.passageId && passage.text === reference.quote)) throw new Error('structure-condition-original-changed');
    };
    const own = input.evidence.filter(point => point.materialId === section.materialId && point.chunkIndex === section.chunkIndex &&
      point.sourcePassageId?.replace(/\.P\d+$/, '') === sectionId);
    for (const point of own) for (const reference of [{ passageId: point.sourcePassageId!, quote: point.quote }, ...(point.supportingPassages ?? [])]) verifyReference(reference);
    for (const knowledge of extraction.row.knowledge ?? []) {
      if (knowledge.kind !== 'condition') continue;
      const references = [{ passageId: knowledge.passageId, quote: knowledge.quote }, ...(knowledge.supportingPassages ?? [])];
      if (!knowledge.name.trim() || new Set(references.map(reference => reference.passageId)).size !== references.length) throw new Error('structure-condition-identity');
      const originalIds = references.map(reference => {
        verifyReference(reference);
        const original = { materialId: section.materialId, sourceTextHash: material.sourceTextHash, parserVersion: material.parserVersion,
          chunkerVersion: material.chunkerVersion, chunkIndex: section.chunkIndex, sectionId, ...reference };
        const id = `P${hash([SOURCE_CONDITION_CONTEXT_PROTOCOL, passagePolicy, original])}`;
        if (!originals.has(id)) originals.set(id, { id, ...original }); return id;
      });
      const passageIds = new Set(references.map(reference => reference.passageId));
      const linked = own.filter(point => [point.sourcePassageId, ...(point.supportingPassages ?? []).map(reference => reference.passageId)].some(id => id && passageIds.has(id)));
      const id = `K${hash([SOURCE_CONDITION_CONTEXT_PROTOCOL, knowledge.name, originalIds])}`;
      conditions.set(id, { id, name: knowledge.name, originalIds, evidenceIds: linked.map(point => point.id), evidenceKeys: linked.map(pointKey) });
    }
  }
  const rows = [...conditions.values()];
  const body = { version: SOURCE_CONDITION_CONTEXT_PROTOCOL, sourceFingerprint: input.sourceFingerprint, passagePolicy,
    originals: [...originals.values()], conditions: rows, linkedConditions: rows.filter(row => row.evidenceIds.length).length,
    orphanConditions: rows.filter(row => !row.evidenceIds.length).length };
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > 2_000_000) throw new Error('structure-condition-context-too-large');
  return freeze({ ...body, hash: hash(body) });
}

/** Validate restored sidecars against exact current originals and extraction
 * rows. A hash alone cannot establish source or passage-policy currentness. */
export function validateStructureConditionContext(context: StructureConditionContext, input: StructureConditionContextInput): void {
  if (JSON.stringify(buildStructureConditionContext(input)) !== JSON.stringify(context)) throw new Error('structure-condition-context-changed');
}

function assertContext(context: StructureConditionContext): void {
  if (trusted.has(context)) return;
  const { hash: expected, ...body } = context;
  if (context.version !== SOURCE_CONDITION_CONTEXT_PROTOCOL || hash(body) !== expected) throw new Error('structure-condition-context-changed');
  freeze(context);
}

/** Short prompt aliases resolve through the frozen, hashed server-side sidecar.
 * Do not repeat full source quotes: pack ledgers already carry their originals,
 * and independent grounding still reads the exact complete original sections. */
export function structureConditionPromptContext(context: StructureConditionContext, points: StructureEvidence[], includeOrphans = false): {
  version: typeof SOURCE_CONDITION_CONTEXT_PROTOCOL;
  contextHash: string;
  conditions: Array<{ id: string; name: string; evidenceIds: string[]; originalIds: string[] }>;
  unlinkedConditions: Array<{ id: string; name: string; originalIds: string[] }>;
} {
  assertContext(context);
  const keys = new Map<string, string[]>();
  for (const point of points) { const key = pointKey(point); keys.set(key, [...keys.get(key) ?? [], point.id]); }
  const selected = context.conditions.flatMap(condition => {
    const evidenceIds = [...new Set(condition.evidenceKeys.flatMap(key => keys.get(key) ?? []))];
    return evidenceIds.length || (includeOrphans && !condition.evidenceIds.length) ? [{ condition, evidenceIds }] : [];
  });
  const originalIds = new Set(selected.flatMap(row => row.condition.originalIds));
  const aliases = new Map(context.originals.filter(original => originalIds.has(original.id)).map((original, index) => [original.id, `CP${index + 1}`]));
  const rows = selected.map(({ condition, evidenceIds }, index) => ({ id: `K${index + 1}`, name: condition.name, evidenceIds,
    originalIds: condition.originalIds.map(id => aliases.get(id)!) }));
  // A foreign or newly added chapter must not invalidate an unchanged pack.
  // The scoped digest binds stable identities, while aliases stay local.
  const contextHash = hash({ version: context.version, selected: selected.map(({ condition, evidenceIds }) => ({
    id: condition.id, evidenceIds, originalIds: condition.originalIds })) });
  return { version: context.version, contextHash, conditions: rows.filter(row => row.evidenceIds.length),
    unlinkedConditions: rows.filter(row => !row.evidenceIds.length).map(({ evidenceIds: _evidenceIds, ...row }) => row) };
}

export const SOURCE_CONDITION_CONTEXT_INSTRUCTIONS = 'Synthesis protocol: source-condition-context-v1. Extracted condition context is advisory data tied to immutable original references in the server receipt. Preserve applicable conditions when grouping or wording the linked capabilities; inspect exact originals in source review. A shared passage does not establish applicability. K/CP context aliases are not learning-point IDs: never cite them as evidenceIds, invent extra objectives from them, credit coverage for them, or infer an answer key from an unanswered activity. Unlinked conditions remain explicit source-context gaps, not automatic new LOs.';

/** All-or-nothing input admission. No condition is dropped to fit a prompt. */
export function assertStructureConditionPromptBudget(prompt: string, maxInputTokens: number): void {
  if (estimateAuthoringTokens(prompt) > maxInputTokens) throw new Error('structure-condition-context-too-large');
}
