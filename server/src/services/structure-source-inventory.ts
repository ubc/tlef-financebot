import type { SourceExtractionSection } from '../types/source-evidence';
import type { StructureEvidence, StructureResult, StructureSourceInventory } from '../types/structure';

export interface StructureSourceSection {
  id: string; localId?: string; materialId: string; materialName: string; chunkIndex: number; text: string;
}
export interface NumberedSourcePassage { id: string; text: string }

/** A zero-objective section can contain an unreadable visual, supporting
 * context or administration. Report recorded passage labels without inventing
 * a section-level non-instructional verdict. */
export function structureNoObjectiveWarning(rows: SourceExtractionSection[]): string | undefined {
  const empty = rows.filter(row => row.objectives.length === 0);
  if (!empty.length) return undefined;
  const dispositions = empty.flatMap(row => row.passageDispositions ?? []);
  const counts = (['visual-review', 'context', 'non-instructional'] as const).flatMap(disposition => {
    const count = dispositions.filter(row => row.disposition === disposition).length;
    return count ? [`${count} ${disposition}`] : [];
  });
  const missing = empty.filter(row => !row.passageDispositions?.length).length;
  return `${empty.length} sections have no extracted objectives. ${counts.length ? `Recorded passage dispositions: ${counts.join(', ')}. ` : ''}`
    + `${missing ? `${missing} of these sections have no recorded passage dispositions. ` : ''}Inspect their recorded reasons and original visuals before applying the outline.`;
}

/** Cues select review targets, not concepts or proof of what the lecturer taught.
 * In particular a parsed chart label cannot establish a plotted relationship. */
export function structurePassageCues(text: string): StructureSourceInventory['targets'][number]['cues'] {
  const cues: StructureSourceInventory['targets'][number]['cues'] = [];
  if (/[=≤≥∑√]|\\(?:frac|sqrt|sum)\b|\b(?:formula|equation)\b/i.test(text)) cues.push('formula');
  if (/\b(?:square root|standard deviation|variance|ratio|denominator|numerator|percent(?:age)?|divid(?:e|ed|ing)|multipl(?:y|ied)|cash.flow|expected.return|beta)\b/i.test(text)) cues.push('numerical-relationship');
  if (/\b(?:figure|diagram|chart|graph|table|row|column|axis|axes)\b|(?:FIRMS?|INVESTORS?|MANAGERS?|STOCKHOLDERS?|BONDHOLDERS?)(?:\s*\n|\s{2,})/i.test(text)) cues.push('visual-relationship');
  return cues;
}

/** New source extractions must either cite or explicitly dispose every parsed
 * passage. This detects an omitted end-of-section relationship even when a
 * neighboring learning point and its single original quote are valid. */
export function assertStructurePassageAccounting(row: SourceExtractionSection, passages: NumberedSourcePassage[]): void {
  const known = new Set(passages.map(passage => passage.id));
  const linked = new Set(row.objectives.flatMap(point => [point.passageId, ...(point.supportingPassages ?? []).map(passage => passage.passageId)]));
  const disposed = new Set<string>();
  for (const item of row.passageDispositions ?? []) {
    if (!known.has(item.passageId) || linked.has(item.passageId) || disposed.has(item.passageId)) {
      throw new Error(`Passage ${item.passageId} has an unknown, duplicate or conflicting disposition.`);
    }
    if (!item.reason.trim()) throw new Error(`Explain the disposition of ${item.passageId}.`);
    disposed.add(item.passageId);
  }
  const missing = passages.filter(passage => !linked.has(passage.id) && !disposed.has(passage.id));
  if (missing.length) throw new Error(`Account for every original passage. Missing objective references or passageDispositions: ${missing.map(passage => passage.id).join(', ')}.`);
}

/** Separate full text traversal, model-attested dispositions, and actual outline
 * links. None of these mechanical facts establish semantic source entailment. */
export function structureSourceInventory(input: {
  sections: StructureSourceSection[];
  extractions: Array<{ source: StructureSourceSection; row: SourceExtractionSection }>;
  evidence: StructureEvidence[];
  themes: StructureResult['themes'];
  passages: (section: StructureSourceSection) => NumberedSourcePassage[];
}): StructureSourceInventory {
  const mapped = new Set(input.themes.flatMap(theme => theme.los.flatMap(lo => lo.evidenceIds)));
  const targets: StructureSourceInventory['targets'] = [];
  for (const section of input.sections) {
    const row = input.extractions.find(item => item.source.id === section.id)?.row;
    const local = { ...section, id: section.localId ?? section.id };
    for (const passage of input.passages(local)) {
      const evidenceIds = input.evidence.filter(point => point.materialId === section.materialId && point.chunkIndex === section.chunkIndex &&
        (point.sourcePassageId === passage.id || point.supportingPassages?.some(support => support.passageId === passage.id))).map(point => point.id);
      const disposition = row?.passageDispositions?.find(item => item.passageId === passage.id);
      targets.push({ materialId: section.materialId, materialName: section.materialName, chunkIndex: section.chunkIndex, sectionId: local.id,
        passageId: passage.id, quote: passage.text, cues: structurePassageCues(passage.text), evidenceIds,
        status: evidenceIds.some(id => mapped.has(id)) ? 'mapped' : evidenceIds.length ? 'unmapped-objective' : disposition?.disposition ?? 'unreviewed',
        ...(disposition ? { reason: disposition.reason } : {}) });
    }
  }
  const los = input.themes.flatMap(theme => theme.los.map(lo => ({ ...lo, label: `${theme.name} / ${lo.name}` })));
  const compared = los.slice(0, 400);
  const potentialRedundantObjectives: StructureSourceInventory['potentialRedundantObjectives'] = [];
  let truncated = compared.length < los.length;
  // Same evidence is a review signal; related skills can legitimately share it.
  outer: for (let first = 0; first < compared.length; first++) for (let second = first + 1; second < compared.length; second++) {
    const shared = compared[first].evidenceIds.filter(id => compared[second].evidenceIds.includes(id));
    if (shared.length && shared.length / new Set([...compared[first].evidenceIds, ...compared[second].evidenceIds]).size >= 0.8) {
      potentialRedundantObjectives.push({ first: compared[first].label, second: compared[second].label, sharedEvidenceIds: shared });
      if (potentialRedundantObjectives.length >= 200) { truncated = true; break outer; }
    }
  }
  const materials = [...new Set(input.sections.map(section => section.materialId))];
  return { version: 'source-passage-inventory-v1', totalPassages: targets.length,
    objectiveLinkedPassages: targets.filter(target => target.evidenceIds.length).length,
    mappedPassages: targets.filter(target => target.status === 'mapped').length, targets,
    materialsWithoutMappedObjectives: materials.filter(id => !input.evidence.some(point => point.materialId === id && mapped.has(point.id))),
    potentialRedundantObjectives, redundancyAudit: { objectivesConsidered: compared.length, totalObjectives: los.length, truncated } };
}
