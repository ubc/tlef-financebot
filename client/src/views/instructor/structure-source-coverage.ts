import { materialSourceUrl, type Material, type PdfPageTextObservationSummary, type StructureGenerationRun, type StructureResult } from '../../api.js';
import { el } from '../../dom.js';
import { previewEvidence } from './coverage-graph.js';

type ReviewCategory = 'gaps' | 'visual' | 'other';
type CategoryFilter = ReviewCategory | 'all';
interface CoveragePassage { passageId?: string; quote: string; label?: string }
export interface StructureCoverageReviewItem {
  id: string; reviewId: string; kind: 'learning-point' | 'passage' | 'section'; category: ReviewCategory; status: string; title: string; reason: string;
  materialId?: string; materialName: string; chunkIndex?: number; sourceLabel: string;
  evidenceIds: string[]; passages: CoveragePassage[]; searchText: string; filterMaterialIds?: string[];
}
export interface StructureCoverageFile {
  materialId: string; name: string; sections?: number; extracted?: number; mapped?: number;
  unmapped?: number; visual?: number; unreviewed?: number;
}
export interface StructureCoverageReviewModel {
  files: StructureCoverageFile[]; items: StructureCoverageReviewItem[]; notes: string[]; incomplete?: boolean;
  pageTextObservations?: StructureResult['coverage']['pageTextObservations']; pageTextMaterialIds?: string[];
  totals?: { materials?: number; extracted?: number; mapped?: number; unmapped?: number; mappedPassages?: number; totalPassages?: number };
}

const count = (value: unknown): number | undefined => typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
const plural = (value: number, label: string): string => `${value.toLocaleString()} ${label}${value === 1 ? '' : 's'}`;

/** This read model displays persisted receipts. It never infers source support,
 * changes objective selection, or treats a missing historical count as zero. */
export function buildStructureCoverageReviewModel(result: StructureResult): StructureCoverageReviewModel {
  const coverage = result.coverage;
  const evidence = Array.isArray(result.evidence) ? result.evidence : [];
  const materials = Array.isArray(coverage.materials) ? coverage.materials : [];
  const materialRecords = new Map<string, typeof materials>();
  for (const material of materials) materialRecords.set(material.materialId, [...(materialRecords.get(material.materialId) ?? []), material]);
  const ambiguousMaterialIds = new Set([...materialRecords].filter(([, records]) => records.length > 1).map(([id]) => id));
  const unmappedIds = [...new Set(Array.isArray(coverage.unmappedEvidenceIds) ? coverage.unmappedEvidenceIds : [])];
  const pointRecords = new Map<string, typeof evidence>();
  for (const point of evidence) pointRecords.set(point.id, [...(pointRecords.get(point.id) ?? []), point]);
  const duplicatePointIds = new Set([...pointRecords].filter(([, records]) => records.length > 1).map(([id]) => id));
  // An ambiguous identifier must never silently choose the first or last source.
  const points = new Map([...pointRecords].filter(([, records]) => records.length === 1).map(([id, records]) => [id, records[0]]));
  const mappedIds = new Set((Array.isArray(result.themes) ? result.themes : []).flatMap(theme => theme.los.flatMap(lo => lo.evidenceIds)));
  const mappingConflicts = new Set(unmappedIds.filter(id => mappedIds.has(id)));
  const knownMaterialIds = new Set(materialRecords.keys());
  const inventory = coverage.sourceInventory;
  const targets = Array.isArray(inventory?.targets) ? inventory.targets : undefined;
  const targetIdentity = (target: NonNullable<typeof targets>[number]) => JSON.stringify([target.materialId, target.chunkIndex, target.sectionId, target.passageId]);
  const targetCounts = new Map<string, number>();
  for (const target of targets ?? []) targetCounts.set(targetIdentity(target), (targetCounts.get(targetIdentity(target)) ?? 0) + 1);
  const duplicateTargetKeys = new Set([...targetCounts].filter(([, size]) => size > 1).map(([key]) => key));
  const inventoryComplete = !!targets && count(inventory?.totalPassages) === targets.length && !duplicateTargetKeys.size;
  const excluded = Array.isArray(coverage.excludedSections) ? coverage.excludedSections : [];
  const evidenceComplete = count(coverage.extractedObjectives) === evidence.length && points.size === evidence.length;
  const mappedIdsComplete = [...mappedIds].every(id => points.has(id));
  const missingGapIds = evidenceComplete && mappedIdsComplete ? [...points.keys()].filter(id => !mappedIds.has(id) && !unmappedIds.includes(id)) : [];
  const unmappedComplete = Array.isArray(coverage.unmappedEvidenceIds) && unmappedIds.every(id => points.has(id)) && !mappingConflicts.size && !missingGapIds.length;
  const invalidPointBindings = new Set<string>();
  const invalidTargetBindings = new Set<number>();
  const invalidTargetMappings = new Set<number>();
  const affectedSourceFiles = new Set<string>(ambiguousMaterialIds);
  const affectedMappingFiles = new Set<string>();
  const relatedFiles = new Map<string, Set<string>>();
  function affectPoint(id: string, materialId?: string): void {
    invalidPointBindings.add(id);
    const ids = relatedFiles.get(id) ?? new Set<string>();
    if (materialId) ids.add(materialId);
    for (const point of pointRecords.get(id) ?? []) ids.add(point.materialId);
    relatedFiles.set(id, ids);
    for (const file of ids) affectedSourceFiles.add(file);
  }
  for (const point of evidence) if (duplicatePointIds.has(point.id) || !knownMaterialIds.has(point.materialId) || ambiguousMaterialIds.has(point.materialId) || count(point.chunkIndex) === undefined) affectPoint(point.id);
  for (const [index, target] of (targets ?? []).entries()) {
    if (!knownMaterialIds.has(target.materialId) || ambiguousMaterialIds.has(target.materialId) || count(target.chunkIndex) === undefined || duplicateTargetKeys.has(targetIdentity(target))) {
      invalidTargetBindings.add(index); affectedSourceFiles.add(target.materialId);
    }
    for (const id of target.evidenceIds) {
      const point = points.get(id);
      const passageIds = point ? [point.sourcePassageId, ...(point.supportingPassages ?? []).map(passage => passage.passageId)].filter(Boolean) : [];
      if (!point || point.materialId !== target.materialId || point.chunkIndex !== target.chunkIndex || (passageIds.length && !passageIds.includes(target.passageId))) {
        invalidTargetBindings.add(index); affectPoint(id, target.materialId);
      }
    }
    const hasMappedPoint = target.evidenceIds.some(id => mappedIds.has(id));
    if ((target.status === 'mapped' && !hasMappedPoint) || (target.status === 'unmapped-objective' && (!target.evidenceIds.length || hasMappedPoint)) ||
      (!['mapped', 'unmapped-objective'].includes(target.status) && target.evidenceIds.length > 0)) {
      invalidTargetMappings.add(index); affectedMappingFiles.add(target.materialId);
    }
  }
  for (const id of mappingConflicts) for (const point of pointRecords.get(id) ?? []) affectedMappingFiles.add(point.materialId);
  const mappedTotalConsistent = evidenceComplete && mappedIdsComplete && count(coverage.mappedObjectives) === mappedIds.size && !mappingConflicts.size && !invalidPointBindings.size && !invalidTargetMappings.size;
  const notes: string[] = [];
  const names = (values: Iterable<string>) => [...values].slice(0, 8).join(', ') + ([...values].length > 8 ? ', …' : '');
  if (ambiguousMaterialIds.size) notes.push(`Ambiguous source receipt IDs: ${names(ambiguousMaterialIds)}. Each raw receipt remains inspectable; no duplicate is chosen to supply source counts or context bindings.`);
  if (Array.isArray(coverage.unmappedEvidenceIds) && unmappedIds.length !== coverage.unmappedEvidenceIds.length) notes.push('Repeated learning-point IDs in the historical gap receipt are shown once. Review-item counts use distinct IDs.');
  if (duplicatePointIds.size) notes.push(`Ambiguous learning-point IDs: ${names(duplicatePointIds)}. Every recorded quote remains inspectable, but no source or context action is bound to an ambiguous ID.`);
  if (duplicateTargetKeys.size) notes.push('Duplicate passage identities occur in this receipt. All recorded rows remain visible; passage totals and per-file visual-review counts are unavailable.');
  if (invalidPointBindings.size || invalidTargetBindings.size) notes.push(`Conflicting source bindings require review${invalidPointBindings.size ? ` for learning-point IDs ${names(invalidPointBindings)}` : ''}. Affected counts and source/context actions are unavailable; recorded quotes are retained as unverified receipt text.`);
  if (mappingConflicts.size || invalidTargetMappings.size) notes.push(`Conflicting mapping receipt${mappingConflicts.size ? ` for learning-point IDs ${names(mappingConflicts)}` : ''}. Gap and draft-link records disagree; affected mapped and unmapped counts are unavailable.`);
  if (missingGapIds.length) notes.push(`Missing learning-point gap IDs: ${names(missingGapIds)}. These recorded learning points have no retained draft links, but are absent from the gap receipt. Gap totals are unavailable; no replacement receipt entries have been invented.`);
  if (!targets) notes.push('This historical draft has no passage inventory. Visual-review and unreviewed-passage counts are unavailable. Open the original files to check their diagrams and equations.');
  else if (!inventoryComplete) notes.push('The recorded passage list is incomplete or inconsistent with its receipt. Per-file visual-review and unreviewed-passage counts are unavailable.');
  if (!evidenceComplete) notes.push('The recorded learning-point list is incomplete or inconsistent with its receipt. Per-file extracted counts are unavailable.');
  if (!unmappedComplete) notes.push('Some learning-point gap records are unavailable in this snapshot. Their IDs remain listed for review; per-file gap counts are unavailable.');
  if (!mappedTotalConsistent) notes.push('The mapped learning-point total cannot be reconciled with the retained AI draft links and source records. Its aggregate count is unavailable.');
  const files = new Map<string, StructureCoverageFile>();
  for (const [id, records] of materialRecords) {
    const material = records[0];
    files.set(id, records.length === 1 ? { materialId: id, name: material.name, sections: count(material.sections), mapped: count(material.mappedObjectives) }
      : { materialId: id, name: `Ambiguous source receipt (${id})` });
  }
  for (const source of [...evidence, ...(targets ?? [])]) {
    if (!files.has(source.materialId)) files.set(source.materialId, { materialId: source.materialId, name: source.materialName || 'Source name unavailable' });
  }
  for (const source of excluded) if (!files.has(source.materialId)) files.set(source.materialId, { materialId: source.materialId, name: 'Source name unavailable' });
  for (const file of files.values()) {
    if (evidenceComplete && !affectedSourceFiles.has(file.materialId)) file.extracted = evidence.filter(point => point.materialId === file.materialId).length;
    const linked = [...points.values()].filter(point => point.materialId === file.materialId && mappedIds.has(point.id)).length;
    if (!evidenceComplete || !mappedIdsComplete || affectedSourceFiles.has(file.materialId) || affectedMappingFiles.has(file.materialId) || file.mapped !== linked || (file.extracted !== undefined && file.mapped > file.extracted)) {
      if (evidenceComplete && mappedIdsComplete && file.mapped !== undefined && file.mapped !== linked) notes.push(`Per-file mapped counts conflict for ${file.name}: the receipt records ${file.mapped}, while ${linked} distinct learning points have retained draft links. The displayed mapped count is unavailable.`);
      file.mapped = undefined;
    }
    if (unmappedComplete && !affectedSourceFiles.has(file.materialId) && !affectedMappingFiles.has(file.materialId)) file.unmapped = unmappedIds.filter(id => points.get(id)?.materialId === file.materialId).length;
    if (inventoryComplete && !affectedSourceFiles.has(file.materialId)) {
      file.visual = targets!.filter(target => target.materialId === file.materialId && target.status === 'visual-review').length;
      file.unreviewed = targets!.filter(target => target.materialId === file.materialId && target.status === 'unreviewed').length;
    }
  }
  const items: StructureCoverageReviewItem[] = [];
  function add(item: Omit<StructureCoverageReviewItem, 'searchText'>): void {
    items.push({ ...item, searchText: [item.materialName, item.title, item.reason, item.sourceLabel, item.status,
      ...item.evidenceIds, ...item.passages.flatMap(passage => [passage.label ?? '', passage.passageId ?? '', passage.quote])].join(' ').toLocaleLowerCase() });
  }
  function addPoint(id: string, category: ReviewCategory): void {
    const records = pointRecords.get(id) ?? [];
    const point = points.get(id);
    const ambiguous = duplicatePointIds.has(id);
    const sourceConflict = invalidPointBindings.has(id);
    const mappingConflict = mappingConflicts.has(id);
    const reason = ambiguous ? `${records.length} records share learning-point ID ${id}. Their source binding is ambiguous. All recorded versions are shown below without choosing a source.`
      : sourceConflict ? `Recorded source bindings conflict for learning-point ID ${id}. Source and context actions are unavailable until this receipt is reconciled.`
        : mappingConflict ? `The gap receipt lists ${id} as unmapped, but the retained AI draft links it to an objective. Its mapping status is unavailable until these records are reconciled.`
          : point ? 'This extracted learning point has no link to an objective in the AI draft.' : 'Its source record is not available in this historical snapshot.';
    const passages: CoveragePassage[] = records.flatMap((record, index) => {
      const label = ambiguous || sourceConflict ? `Recorded version ${index + 1}: ${record.objective} · ${record.materialName} · material ${record.materialId} · chunk ${record.chunkIndex}` : undefined;
      return [{ passageId: record.sourcePassageId, quote: record.quote, label }, ...(record.supportingPassages ?? []).map(passage => ({ ...passage, label }))];
    });
    add({ id: `point:${id}`, reviewId: id, kind: 'learning-point', category,
      status: ambiguous ? 'Ambiguous learning-point ID' : sourceConflict ? 'Source binding unavailable' : mappingConflict ? 'Conflicting mapping receipt' : 'Unmapped learning point',
      title: point?.objective ?? `Learning point ${id}`, reason,
      ...(point && !sourceConflict ? { materialId: point.materialId, chunkIndex: point.chunkIndex } : {}),
      materialName: sourceConflict ? 'Source binding unavailable' : point?.materialName ?? 'Source unavailable', sourceLabel: point && !sourceConflict ? `Section ${point.chunkIndex + 1} · ${id}` : id,
      filterMaterialIds: sourceConflict ? [...(relatedFiles.get(id) ?? [])] : undefined, evidenceIds: [id], passages });
  }
  for (const id of unmappedIds) addPoint(id, 'gaps');
  for (const id of invalidPointBindings) if (!unmappedIds.includes(id)) addPoint(id, 'other');
  for (const [index, target] of (targets ?? []).entries()) {
    const sourceConflict = invalidTargetBindings.has(index);
    const mappingConflict = invalidTargetMappings.has(index);
    if (target.status === 'mapped' && !sourceConflict && !mappingConflict) continue;
    const linked = target.evidenceIds.map(id => points.get(id)?.objective).filter((text): text is string => !!text);
    const gap = target.status === 'unmapped-objective';
    add({ id: `passage:${index}:${target.materialId}:${target.sectionId}:${target.passageId}`,
      reviewId: target.passageId, kind: 'passage',
      category: gap ? 'gaps' : ['visual-review', 'unreviewed'].includes(target.status) ? 'visual' : 'other',
      status: sourceConflict ? 'Source binding unavailable' : mappingConflict ? 'Conflicting mapping receipt' : gap ? 'Unmapped original passage' : target.status === 'visual-review' ? 'Visual review needed' : target.status === 'unreviewed' ? 'Unreviewed original passage' : `Recorded ${target.status}`,
      title: gap && linked.length ? linked.join(' · ') : `Original passage ${target.passageId}`,
      reason: sourceConflict || mappingConflict ? `This passage has ${sourceConflict ? 'conflicting or duplicate source bindings' : 'a mapping status inconsistent with the retained draft links'}. Recorded status: ${target.status}. ${target.reason ?? ''}`
        : target.reason || (gap ? 'This original passage supports extracted learning points, but none are linked to the AI draft.' : 'This original passage has no recorded instructional decision.'),
      ...(!sourceConflict ? { materialId: target.materialId, chunkIndex: target.chunkIndex } : {}), materialName: target.materialName,
      filterMaterialIds: sourceConflict ? [target.materialId] : undefined,
      sourceLabel: `Section ${target.chunkIndex + 1} · ${target.sectionId} · ${target.passageId}`,
      evidenceIds: target.evidenceIds, passages: target.quote ? [{ passageId: target.passageId, quote: target.quote,
        ...(sourceConflict ? { label: `Recorded source: ${target.materialName} · material ${target.materialId} · chunk ${target.chunkIndex}` } : {}) }] : [] });
  }
  for (const [index, section] of excluded.entries()) add({
    id: `section:${index}:${section.materialId}:${section.chunkIndex}`, reviewId: `${section.materialId}:${section.chunkIndex}`, kind: 'section', category: 'other', status: 'No extracted objectives',
    title: `Section ${section.chunkIndex + 1} has no extracted objectives`, reason: section.reason || 'No reason was recorded.',
    materialId: section.materialId, materialName: files.get(section.materialId)?.name ?? 'Source name unavailable',
    chunkIndex: section.chunkIndex, sourceLabel: `Section ${section.chunkIndex + 1}`, evidenceIds: [], passages: [],
  });
  for (const id of ambiguousMaterialIds) for (const [index, record] of materialRecords.get(id)!.entries()) add({
    id: `material-record:${id}:${index}`, reviewId: id, kind: 'section', category: 'other', status: 'Ambiguous source receipt',
    title: `Recorded source receipt ${index + 1}: ${record.name}`, materialName: record.name, sourceLabel: `Recorded material ${id}`, filterMaterialIds: [id],
    reason: `Multiple source receipts share material ID ${id}. Recorded fields: sections ${count(record.sections) ?? 'unavailable'}; chunks ${count(record.chunks) ?? 'unavailable'}; mapped points ${count(record.mappedObjectives) ?? 'unavailable'}. These values have not been selected as authoritative source counts.`,
    evidenceIds: [], passages: [],
  });
  const mappedPassages = (targets ?? []).filter(target => target.status === 'mapped').length;
  return { files: [...files.values()], items, notes, pageTextObservations: coverage.pageTextObservations, pageTextMaterialIds: materials.map(material => material.materialId), totals: {
    ...(Array.isArray(coverage.materials) && !ambiguousMaterialIds.size ? { materials: materials.length } : {}),
    ...(evidenceComplete && !invalidPointBindings.size ? { extracted: coverage.extractedObjectives } : {}),
    ...(mappedTotalConsistent ? { mapped: coverage.mappedObjectives } : {}),
    ...(unmappedComplete && !invalidPointBindings.size ? { unmapped: unmappedIds.length } : {}),
    ...(inventoryComplete && !invalidTargetBindings.size && !invalidTargetMappings.size ? { totalPassages: inventory!.totalPassages } : {}),
    ...(inventoryComplete && !invalidTargetBindings.size && !invalidTargetMappings.size && count(inventory?.mappedPassages) === mappedPassages ? { mappedPassages } : {}),
  } };
}

/** Paginated, read-only inspection of the AI draft's original-source receipts. */
export function createStructureSourceCoverage(courseId: string, result: StructureResult, model = buildStructureCoverageReviewModel(result)): HTMLElement {
  return renderStructureSourceCoverage(courseId, model);
}

/** Failed runs can expose processing diagnostics without claiming that a
 * complete outline, learning-point list or passage inventory exists. */
export function createStructureCoverageDiagnostics(courseId: string, diagnostics: NonNullable<StructureGenerationRun['structureDiagnostics']>, materials: Material[]): HTMLElement {
  const files = new Map<string, StructureCoverageFile>();
  for (const source of diagnostics.sourceSelection.requested) files.set(source.materialId, { materialId: source.materialId, name: source.name });
  for (const source of diagnostics.unprocessedSections) if (!files.has(source.materialId)) files.set(source.materialId, { materialId: source.materialId,
    name: source.name || materials.find(material => material._id === source.materialId)?.name || 'Source name unavailable' });
  const items: StructureCoverageReviewItem[] = diagnostics.unprocessedSections.map((source, index) => ({
    id: `unprocessed:${index}:${source.materialId}:${source.sectionId}`, reviewId: source.sectionId, kind: 'section', category: 'visual',
    status: 'Unprocessed source section', title: source.sectionId, materialId: source.materialId,
    materialName: source.name || files.get(source.materialId)?.name || 'Source name unavailable', sourceLabel: source.sectionId,
    reason: 'The run did not complete validated extraction for this source section. No applicable outline or coverage finding is available for it.',
    evidenceIds: [], passages: [], searchText: `${source.name} ${source.sectionId} unprocessed source section`.toLocaleLowerCase(),
  }));
  return renderStructureSourceCoverage(courseId, { files: [...files.values()], items, incomplete: true, notes: [
    'This run ended without a complete validated outline. Extracted, mapped, gap and visual-review totals are unavailable; the rows below show only recorded unprocessed sections. Existing course content is unchanged.',
  ] });
}

function renderStructureSourceCoverage(courseId: string, model: StructureCoverageReviewModel): HTMLElement {
  const element = el('section', { class: 'structure-source-coverage', 'aria-label': 'Source coverage review' });
  let page = 1;
  let filePage = 1;
  let pageSize = 10;
  let category: CategoryFilter = model.items.some(item => item.category === 'gaps') ? 'gaps' : model.items.some(item => item.category === 'visual') ? 'visual' : 'all';
  const search = el('input', { type: 'search', class: 'input', placeholder: 'Search file, learning point, quote or reason…', 'aria-label': 'Search source coverage' });
  const gapPoints = model.items.filter(item => item.category === 'gaps' && item.kind === 'learning-point').length;
  const gapPassages = model.items.filter(item => item.category === 'gaps' && item.kind === 'passage').length;
  const categorySelect = el('select', { class: 'input', 'aria-label': 'Review category' },
    ...([['gaps', `Learning-point gaps · ${gapPoints} points + ${gapPassages} passages`], ['visual', model.incomplete ? 'Unprocessed source sections' : 'Visual or unreviewed passages'], ['other', 'Other source decisions'], ['all', 'All review items']] as const).map(([value, label]) =>
      el('option', { value, text: `${label} (${value === 'all' ? model.items.length : model.items.filter(item => item.category === value).length})` })));
  categorySelect.value = category;
  const fileSelect = el('select', { class: 'input', 'aria-label': 'Source file' }, el('option', { value: '', text: 'All source files' }),
    ...model.files.map(file => el('option', { value: file.materialId, text: file.name })));
  const sizeSelect = el('select', { class: 'input', 'aria-label': 'Rows per page' }, ...[10, 25, 50].map(value => el('option', { value: String(value), text: `${value} / page` })));
  const rows = el('div', { class: 'structure-source-coverage__rows', 'data-coverage-review-rows': '' });
  const range = el('span', { role: 'status', 'aria-live': 'polite' });
  const previous = el('button', { type: 'button', class: 'btn btn--ghost btn--sm', 'aria-label': 'Previous review page', onclick: () => { page--; drawRows(); } }, 'Previous');
  const next = el('button', { type: 'button', class: 'btn btn--ghost btn--sm', 'aria-label': 'Next review page', onclick: () => { page++; drawRows(); } }, 'Next');
  const reset = el('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => {
    search.value = ''; fileSelect.value = ''; category = 'all'; categorySelect.value = 'all'; page = 1; drawRows();
  } }, 'Clear filters');
  const fileBody = el('tbody');
  const fileRange = el('span', { role: 'status', 'aria-live': 'polite' });
  const previousFile = el('button', { type: 'button', class: 'btn btn--ghost btn--sm', 'aria-label': 'Previous source page', onclick: () => { filePage--; drawFiles(); } }, 'Previous');
  const nextFile = el('button', { type: 'button', class: 'btn btn--ghost btn--sm', 'aria-label': 'Next source page', onclick: () => { filePage++; drawFiles(); } }, 'Next');
  function drawFiles(): void {
    const size = 10;
    const pages = Math.max(1, Math.ceil(model.files.length / size));
    filePage = Math.max(1, Math.min(filePage, pages));
    const start = (filePage - 1) * size;
    const metric = (value: number | undefined) => el('td', { text: value === undefined ? 'Unavailable' : value.toLocaleString(), class: value === undefined ? 'is-unavailable' : '' });
    fileBody.replaceChildren(...model.files.slice(start, start + size).map(file => el('tr', { 'data-source-id': file.materialId },
      el('th', { scope: 'row' }, el('button', { type: 'button', class: 'structure-source-coverage__file', title: `Review ${file.name}`, onclick: () => {
        fileSelect.value = file.materialId; page = 1; drawRows();
      } }, file.name)), metric(file.sections), metric(file.extracted), metric(file.mapped), metric(file.unmapped), metric(file.visual), metric(file.unreviewed))));
    previousFile.disabled = filePage === 1; nextFile.disabled = filePage === pages;
    fileRange.textContent = model.files.length ? `${start + 1}–${Math.min(start + size, model.files.length)} of ${plural(model.files.length, 'file')}` : 'No per-file source receipt is available.';
  }
  function detailFor(item: StructureCoverageReviewItem): HTMLElement {
    const detail = el('details', { class: 'structure-source-coverage__item', 'data-coverage-review-id': item.id, 'data-row-kind': item.kind, 'data-review-id': item.reviewId });
    detail.append(el('summary', {}, el('span', { class: 'structure-source-coverage__tag', text: item.status }),
      el('strong', { text: item.title }), el('small', { text: `${item.materialName} · ${item.sourceLabel}` })));
    let built = false;
    detail.addEventListener('toggle', () => {
      if (!detail.open || built) return;
      built = true;
      const body = el('div', { class: 'structure-source-coverage__detail' }, el('p', { text: item.reason }));
      if (item.evidenceIds.length) body.append(el('small', { text: `Recorded learning-point IDs: ${item.evidenceIds.join(', ')}` }));
      for (const passage of item.passages) body.append(el('div', {}, passage.label ? el('small', { text: passage.label }) : false, passage.passageId ? el('small', { text: passage.passageId }) : false,
        el('blockquote', { text: passage.quote }), item.materialId && item.chunkIndex !== undefined && passage.quote ? el('button', {
          type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => previewEvidence(courseId, item.materialId!, item.chunkIndex!, passage.quote),
        }, 'Show passage in context') : false));
      if (!item.passages.length) body.append(el('p', { class: 'structure-ai-note', text: 'No exact quote is recorded for this item. Check the original source.' }));
      if (item.materialId) body.append(el('a', { href: materialSourceUrl(courseId, item.materialId), target: '_blank', rel: 'noopener', text: 'Open original source ↗' }));
      detail.append(body);
    });
    return detail;
  }
  function drawRows(): void {
    const query = search.value.trim().toLocaleLowerCase();
    const filtered = model.items.filter(item => (category === 'all' || item.category === category) && (!fileSelect.value || item.materialId === fileSelect.value || item.filterMaterialIds?.includes(fileSelect.value)) && (!query || item.searchText.includes(query)));
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    page = Math.max(1, Math.min(page, pages));
    const start = (page - 1) * pageSize;
    rows.replaceChildren(...filtered.slice(start, start + pageSize).map(detailFor));
    if (!filtered.length) rows.append(el('p', { class: 'structure-source-coverage__empty', text: model.items.length ? 'No review items match these filters. Clear filters to inspect the other source records.' : model.incomplete ? 'No unprocessed-section rows were retained. Coverage is unavailable because this run did not complete.' : 'This receipt lists no unmapped points or source decisions. Verify the original diagrams and syllabus before accepting coverage.' }));
    range.textContent = `${filtered.length ? start + 1 : 0}–${Math.min(start + pageSize, filtered.length)} of ${plural(filtered.length, 'review item')} · Page ${page} of ${pages}`;
    previous.disabled = page === 1; next.disabled = page === pages;
  }
  search.addEventListener('input', () => { page = 1; drawRows(); });
  fileSelect.addEventListener('change', () => { page = 1; drawRows(); });
  categorySelect.addEventListener('change', () => { category = categorySelect.value as CategoryFilter; page = 1; drawRows(); });
  sizeSelect.addEventListener('change', () => { pageSize = Number(sizeSelect.value); page = 1; drawRows(); });
  rows.setAttribute('role', 'region'); rows.setAttribute('aria-label', 'Source review items');
  element.append(el('h3', { text: model.incomplete ? 'Source processing receipt' : 'Review source coverage by file' }),
    el('p', { class: 'structure-ai-note', text: model.incomplete ? 'Processing diagnostics from an incomplete run. All learning-point and passage-coverage counts are unavailable.' : 'This receipt describes the AI draft before your edits and selections. Mapped points and parsed-passage links do not establish complete teaching coverage or instructor approval.' }),
    el('div', { class: 'structure-source-coverage__table-wrap', tabindex: '0', role: 'region', 'aria-label': 'Per-file source counts' },
      el('table', { class: 'structure-source-coverage__table', 'aria-label': 'Source files' }, el('caption', { text: model.incomplete ? 'Incomplete source processing · counts unavailable' : 'AI draft source receipt · counts by file' }),
        el('thead', {}, el('tr', {}, ...['Source file', 'Sections', 'Extracted points', 'Mapped points', 'Unmapped points', 'Visual review', 'Unreviewed'].map(text => el('th', { scope: 'col', text })))), fileBody)),
    el('div', { class: 'structure-source-coverage__pagination' }, fileRange, el('div', {}, previousFile, nextFile)),
    ...model.notes.map(text => el('p', { class: 'structure-source-coverage__notice', text })),
    createPageTextObservations(courseId, model.pageTextObservations, model.pageTextMaterialIds ?? []),
    el('h3', { text: 'Source records to inspect' }),
    el('p', { class: 'structure-ai-note', text: 'Learning-point gaps and original-passage records are separate review items and may refer to the same content. Context and non-instructional labels are recorded AI decisions to inspect.' }),
    el('div', { class: 'structure-source-coverage__filters' },
      el('label', {}, el('span', { text: 'Search source coverage' }), search),
      el('label', {}, el('span', { text: 'Review category' }), categorySelect),
      el('label', {}, el('span', { text: 'Source file' }), fileSelect),
      el('label', {}, el('span', { text: 'Rows per page' }), sizeSelect), reset),
    rows, el('div', { class: 'structure-source-coverage__pagination' }, range, el('div', {}, previous, next)));
  drawFiles(); drawRows();
  return element;
}

type PageTextState = 'blank' | 'sparse' | 'present';
type AvailablePageText = Extract<PdfPageTextObservationSummary, { status: 'available' }>;
interface PageTextFile {
  key: string; materialId: string; materialName: string; provenanceId?: string;
  observation?: AvailablePageText; reason?: string; linkReason?: string;
}

/** Physical-page observations are a separate unit from parsed passages and LO
 * links. Range pagination keeps the DOM bounded without expanding every page. */
function createPageTextObservations(courseId: string, receipt: StructureResult['coverage']['pageTextObservations'], materialIds: string[]): HTMLElement {
  const element = el('section', { class: 'structure-source-coverage__page-text', 'aria-label': 'Physical-page text observations' },
    el('h3', { text: 'Physical-page text observations' }),
    el('p', { class: 'structure-ai-note', text: 'Native text volume is independent of parsed passages and mapped learning points. Blank means no non-whitespace text; sparse means fewer than 120 non-whitespace UTF-16 characters. A short title may be valid. These signals do not classify charts or establish teaching coverage. All visual interpretation remains unknown.' }));
  if (!receipt) {
    element.append(el('p', { class: 'structure-source-coverage__notice', text: 'Physical-page text observations are unavailable for this historical run. No missing page counts are treated as zero.' }));
    return element;
  }
  if (receipt.version !== 'pdf-page-text-obligations-v1' || !Array.isArray(receipt.materials)) {
    element.append(el('p', { class: 'structure-source-coverage__notice', text: 'The physical-page observation receipt has an unknown version or invalid source list. Counts and page actions are unavailable.' }));
    return element;
  }
  const entries = receipt.materials;
  const idCounts = new Map<string, number>();
  const provenanceCounts = new Map<string, number>();
  const sourceCounts = new Map<string, number>();
  for (const id of materialIds) sourceCounts.set(id, (sourceCounts.get(id) ?? 0) + 1);
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    idCounts.set(entry.materialId, (idCounts.get(entry.materialId) ?? 0) + 1);
    if (entry.provenanceId) provenanceCounts.set(entry.provenanceId, (provenanceCounts.get(entry.provenanceId) ?? 0) + 1);
  }
  const files: PageTextFile[] = entries.map((entry, index) => {
    const file: PageTextFile = { key: String(index), materialId: typeof entry?.materialId === 'string' ? entry.materialId : '',
      materialName: typeof entry?.materialName === 'string' ? entry.materialName : 'Source name unavailable', provenanceId: entry?.provenanceId };
    const observation = entry?.observation;
    if (!entry || typeof entry !== 'object' || !file.materialId || sourceCounts.get(file.materialId) !== 1) file.reason = 'The page observation does not identify one unambiguous source in this run.';
    else if (idCounts.get(file.materialId) !== 1 || entry.provenanceId && provenanceCounts.get(entry.provenanceId) !== 1) file.reason = 'Duplicate material or provenance identities make this page observation ambiguous. No recorded version has been chosen.';
    else if (!observation || observation.version !== 'native-page-text-observations-v1' || observation.interpretation !== 'unknown' || observation.teachingCoverage !== 'not-assessed') file.reason = 'The native page-text observation version or interpretation contract is unavailable.';
    else if (observation.status === 'unavailable') file.reason = typeof observation.reason === 'string' ? observation.reason : 'No native page-text observations were recorded for this source.';
    else if (observation.status !== 'available') file.reason = 'The native page-text observation status is unavailable.';
    else {
      const counts = observation.counts;
      const validCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
      const hashes = [observation.pdfSha256, observation.rawTextSha256, observation.pageMapSha256, observation.observationsSha256];
      if (observation.sparseThreshold !== 120 || hashes.some(hash => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))) file.reason = 'The recorded native-text identities or sparse threshold are invalid. These shapes are not independent proof of current source bytes.';
      else if (!counts || ![counts.total, counts.blank, counts.sparse, counts.present].every(validCount) || counts.total < 1 || counts.total > 20_000 || counts.blank + counts.sparse + counts.present !== counts.total || !Array.isArray(observation.ranges) || observation.ranges.length > counts.total) file.reason = 'Physical-page counts and ranges cannot be reconciled with this receipt. Counts and page actions are unavailable.';
      else {
        const found = { blank: 0, sparse: 0, present: 0 };
        let nextPage = 1;
        for (const range of observation.ranges) {
          if (!range || !validCount(range.startPage) || !validCount(range.endPage) || range.startPage !== nextPage || range.endPage < range.startPage || range.endPage > counts.total || !['blank', 'sparse', 'present'].includes(range.state)) {
            file.reason = 'Physical-page ranges are missing, overlapping, out of order or invalid. Counts and page actions are unavailable.';
            break;
          }
          found[range.state] += range.endPage - range.startPage + 1;
          nextPage = range.endPage + 1;
        }
        if (!file.reason && (nextPage !== counts.total + 1 || found.blank !== counts.blank || found.sparse !== counts.sparse || found.present !== counts.present)) file.reason = 'Physical-page ranges do not exhaustively match the recorded counts. Counts and page actions are unavailable.';
        if (!file.reason) file.observation = observation;
      }
    }
    if (file.observation && (!/^[a-f0-9]{24}$/.test(file.materialId) || typeof file.provenanceId !== 'string' || !/^[a-f0-9]{24}$/.test(file.provenanceId))) file.linkReason = 'No valid provenance-bound physical-page action was recorded. Text counts remain past-run observations.';
    return file;
  });
  const available = files.filter(file => file.observation);
  const totals = available.reduce((sum, file) => {
    const counts = file.observation!.counts;
    return { total: sum.total + counts.total, blank: sum.blank + counts.blank, sparse: sum.sparse + counts.sparse, present: sum.present + counts.present };
  }, { total: 0, blank: 0, sparse: 0, present: 0 });
  element.append(el('p', { class: 'structure-source-coverage__notice', text: available.length
    ? `${plural(totals.total, 'physical page')} recorded across ${plural(available.length, 'source')}: ${totals.blank.toLocaleString()} blank · ${totals.sparse.toLocaleString()} sparse · ${totals.present.toLocaleString()} present. ${files.length - available.length ? `${plural(files.length - available.length, 'source receipt')} unavailable; these are recorded-source subtotals. ` : ''}Interpretation: unknown. Teaching coverage: not assessed.`
    : 'Physical-page counts are unavailable for every recorded source. No missing values are treated as zero.' }),
  el('p', { class: 'structure-ai-note', text: 'This is an immutable past-run observation of the PDFs listed in this receipt; other selected sources have no physical-page counts here. Opening an original physical page asks the server to recheck its provenance; an old, changed or removed source may now be unavailable. A mapped neighboring chunk cannot clear a blank or sparse physical-page observation.' }));
  let filePage = 1;
  const fileBody = el('tbody');
  const fileRange = el('span', { role: 'status', 'aria-live': 'polite' });
  const previousFile = el('button', { type: 'button', class: 'btn btn--ghost btn--sm', 'aria-label': 'Previous page-text source page', onclick: () => { filePage--; drawFiles(); } }, 'Previous');
  const nextFile = el('button', { type: 'button', class: 'btn btn--ghost btn--sm', 'aria-label': 'Next page-text source page', onclick: () => { filePage++; drawFiles(); } }, 'Next');
  const metric = (value?: number) => el('td', { text: value === undefined ? 'Unavailable' : value.toLocaleString(), class: value === undefined ? 'is-unavailable' : '' });
  function drawFiles(): void {
    const pages = Math.max(1, Math.ceil(files.length / 10));
    filePage = Math.max(1, Math.min(filePage, pages));
    const start = (filePage - 1) * 10;
    fileBody.replaceChildren(...files.slice(start, start + 10).map(file => {
      const identity = el('th', { scope: 'row' }, file.observation ? el('button', { type: 'button', class: 'structure-source-coverage__file', onclick: () => {
        fileSelect.value = file.key; page = 1; drawPages();
      } }, file.materialName) : el('span', { text: file.materialName }));
      if (file.reason || file.linkReason) identity.append(el('small', { class: 'structure-source-coverage__page-reason', text: file.reason ?? file.linkReason }));
      const detail = el('details', {}, el('summary', { text: 'Recorded observation identity' }));
      detail.addEventListener('toggle', () => {
        if (detail.open && detail.childElementCount === 1) detail.append(el('pre', { text: JSON.stringify({ materialId: file.materialId, provenanceId: file.provenanceId,
          ...(file.observation ? { pdfSha256: file.observation.pdfSha256, rawTextSha256: file.observation.rawTextSha256, pageMapSha256: file.observation.pageMapSha256, observationsSha256: file.observation.observationsSha256 } : {}),
          interpretation: 'unknown', teachingCoverage: 'not-assessed', unavailableReason: file.reason }, null, 2) }));
      });
      identity.append(detail);
      return el('tr', { 'data-page-source-record': file.key }, identity, metric(file.observation?.counts.total), metric(file.observation?.counts.blank), metric(file.observation?.counts.sparse), metric(file.observation?.counts.present));
    }));
    fileRange.textContent = `${files.length ? start + 1 : 0}–${Math.min(start + 10, files.length)} of ${plural(files.length, 'recorded source receipt')}`;
    previousFile.disabled = filePage === 1; nextFile.disabled = filePage === pages;
  }
  const fileDetails = el('details', {}, el('summary', { text: 'Physical-page counts by file' }),
    el('div', { class: 'structure-source-coverage__table-wrap', tabindex: '0', role: 'region', 'aria-label': 'Physical-page file counts' },
      el('table', { class: 'structure-source-coverage__table', 'aria-label': 'Physical-page source counts' }, el('caption', { text: 'Native text volume by physical page · separate from passage and learning-point counts' }),
        el('thead', {}, el('tr', {}, ...['Source file', 'Total pages', 'Blank', 'Sparse', 'Present'].map(text => el('th', { scope: 'col', text })))), fileBody)),
    el('div', { class: 'structure-source-coverage__pagination' }, fileRange, el('div', {}, previousFile, nextFile)));
  element.append(fileDetails);
  drawFiles();
  if (!available.length) return element;

  let page = 1;
  let pageSize = 10;
  let state = totals.blank + totals.sparse ? 'gaps' : 'all';
  const search = el('input', { type: 'search', class: 'input', placeholder: 'Search file, signal or physical page number…', 'aria-label': 'Search physical pages' });
  const stateSelect = el('select', { class: 'input', 'aria-label': 'Page text signal' }, ...[
    ['gaps', 'Blank or sparse native text'], ['blank', 'Blank native text'], ['sparse', 'Sparse native text'], ['present', 'Native text present'], ['all', 'All physical pages'],
  ].map(([value, text]) => el('option', { value, text })));
  stateSelect.value = state;
  const fileSelect = el('select', { class: 'input', 'aria-label': 'Page source file' }, el('option', { value: '', text: 'All recorded sources' }),
    ...files.map(file => el('option', { value: file.key, text: file.materialName })));
  const sizeSelect = el('select', { class: 'input', 'aria-label': 'Physical pages per page' }, ...[10, 25, 50].map(size => el('option', { value: String(size), text: `${size} / page` })));
  const body = el('tbody');
  const rangeLabel = el('span', { role: 'status', 'aria-live': 'polite' });
  const previous = el('button', { type: 'button', class: 'btn btn--ghost btn--sm', 'aria-label': 'Previous physical-page result', onclick: () => { page--; drawPages(); } }, 'Previous');
  const next = el('button', { type: 'button', class: 'btn btn--ghost btn--sm', 'aria-label': 'Next physical-page result', onclick: () => { page++; drawPages(); } }, 'Next');
  const stateLabel = (value: PageTextState) => value === 'blank' ? 'Blank native text' : value === 'sparse' ? 'Sparse native text (<120 characters)' : 'Native text present (≥120 characters)';
  function drawPages(): void {
    const query = search.value.trim().toLocaleLowerCase();
    const pageQuery = /^(?:(?:physical\s+)?page\s*|p\s*)?(\d+)$/.exec(query);
    const pageNumber = pageQuery ? Number(pageQuery[1]) : undefined;
    const matching: Array<{ file: PageTextFile; startPage: number; endPage: number; state: PageTextState }> = [];
    for (const file of available) {
      if (fileSelect.value && fileSelect.value !== file.key) continue;
      for (const range of file.observation!.ranges) {
        if (state !== 'all' && (state === 'gaps' ? range.state === 'present' : range.state !== state)) continue;
        if (pageNumber !== undefined) {
          if (pageNumber >= range.startPage && pageNumber <= range.endPage) matching.push({ file, startPage: pageNumber, endPage: pageNumber, state: range.state });
        } else if (!query || `${file.materialName} ${file.materialId} ${stateLabel(range.state)}`.toLocaleLowerCase().includes(query)) matching.push({ file, ...range });
      }
    }
    const total = matching.reduce((sum, range) => sum + range.endPage - range.startPage + 1, 0);
    const pages = Math.max(1, Math.ceil(total / pageSize));
    page = Math.max(1, Math.min(page, pages));
    let skip = (page - 1) * pageSize;
    const rows: HTMLElement[] = [];
    for (const range of matching) {
      const length = range.endPage - range.startPage + 1;
      if (skip >= length) { skip -= length; continue; }
      for (let physicalPage = range.startPage + skip; physicalPage <= range.endPage && rows.length < pageSize; physicalPage++) {
        const file = range.file;
        rows.push(el('tr', { 'data-physical-page': physicalPage, 'data-page-material-id': file.materialId, 'data-page-text-state': range.state },
          el('th', { scope: 'row', text: file.materialName }), el('td', { text: `Physical page ${physicalPage}` }), el('td', { text: stateLabel(range.state) }), el('td', { text: 'Unknown · teaching coverage not assessed' }),
          el('td', {}, file.linkReason ? el('span', { class: 'is-unavailable', title: file.linkReason, text: 'Page link unavailable' }) : el('a', { href: `${materialSourceUrl(courseId, file.materialId, file.provenanceId)}#page=${physicalPage}`, target: '_blank', rel: 'noopener', text: 'Open original physical page' }))));
      }
      skip = 0;
      if (rows.length === pageSize) break;
    }
    if (!rows.length) rows.push(el('tr', {}, el('td', { colspan: 5, class: 'structure-source-coverage__empty', text: 'No physical pages match these filters. Unavailable sources remain listed in the per-file receipt.' })));
    body.replaceChildren(...rows);
    rangeLabel.textContent = `${total ? (page - 1) * pageSize + 1 : 0}–${Math.min(page * pageSize, total)} of ${plural(total, 'physical page')} · Page ${page} of ${pages}`;
    previous.disabled = page === 1; next.disabled = page === pages;
  }
  search.addEventListener('input', () => { page = 1; drawPages(); });
  stateSelect.addEventListener('change', () => { state = stateSelect.value; page = 1; drawPages(); });
  fileSelect.addEventListener('change', () => { page = 1; drawPages(); });
  sizeSelect.addEventListener('change', () => { pageSize = Number(sizeSelect.value); page = 1; drawPages(); });
  const clear = el('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => { search.value = ''; fileSelect.value = ''; state = 'all'; stateSelect.value = state; page = 1; drawPages(); } }, 'Clear page filters');
  element.append(el('div', { class: 'structure-source-coverage__filters' },
    el('label', {}, el('span', { text: 'Search physical pages' }), search), el('label', {}, el('span', { text: 'Page text signal' }), stateSelect),
    el('label', {}, el('span', { text: 'Page source file' }), fileSelect), el('label', {}, el('span', { text: 'Physical pages per page' }), sizeSelect), clear),
  el('div', { class: 'structure-source-coverage__table-wrap', tabindex: '0', role: 'region', 'aria-label': 'Physical-page observations' },
    el('table', { class: 'structure-source-coverage__table structure-source-coverage__pages', 'aria-label': 'Physical pages' }, el('caption', { text: 'Original physical-page native text signals · not AI passage decisions' }),
      el('thead', {}, el('tr', {}, ...['Source file', 'Physical page', 'Native text signal', 'Interpretation', 'Original source'].map(text => el('th', { scope: 'col', text })))), body)),
  el('div', { class: 'structure-source-coverage__pagination' }, rangeLabel, el('div', {}, previous, next)));
  drawPages();
  return element;
}
