jest.mock('../../server/src/components/mongodb/collections', () => ({ materialsCol: jest.fn(), materialChunksCol: jest.fn(), themesCol: jest.fn(), losCol: jest.fn(), contentRunsCol: jest.fn(), sourceEvidenceExtractionsCol: jest.fn(), coursesCol: jest.fn(() => ({ findOne: async () => ({}) })) }));
jest.mock('../../server/src/components/genai/llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../server/src/components/jobs', () => ({ defineJob: jest.fn(), enqueueJob: jest.fn() }));
jest.mock('../../server/src/services/admin.service', () => ({ utilityStepConfig: jest.fn(async () => ({ model: 'test-model' })) }));
jest.mock('../../server/src/services/content-runs.service', () => ({ assertContentRunActive: jest.fn(), claimStructureGenerationRun: jest.fn(), updateContentRun: jest.fn(), createStructureGenerationRun: jest.fn(), getContentRun: jest.fn(), failContentRun: jest.fn() }));
jest.mock('../../server/src/services/model-usage.service', () => ({ withModelUsage: jest.fn(async (_scope: unknown, work: () => Promise<unknown>) => work()) }));
jest.mock('../../server/src/services/source-readiness.service', () => ({ ...jest.requireActual('../../server/src/services/source-readiness.service'), assertSourceSelectionReady: jest.fn(), getMaterialSourceReadiness: jest.fn() }));
jest.mock('../../server/src/services/structure-outline-repair.service', () => ({ ...jest.requireActual('../../server/src/services/structure-outline-repair.service'),
  createStructureOutlineCoverageRepair: jest.fn(), getStructureOutlineRepairView: jest.fn(), assertStructureRepairAdoptable: jest.fn(), runStructureOutlineRepair: jest.fn() }));
// These scenarios exercise extraction/organization/review behavior. Durable
// checkpoint CAS and send reservations have separate real-service unit tests.
jest.mock('../../server/src/services/structure-review-checkpoint.service', () => ({
  ...jest.requireActual('../../server/src/services/structure-review-checkpoint.service'),
  readStructureReviewCheckpoint: jest.fn(),
  createStructureReviewCheckpoint: jest.fn(async (_runId: unknown, body: unknown) => ({ _id: 'checkpoint', body })),
  getStructureReviewProgress: jest.fn(async () => ({ findings: [], attempts: {}, failures: [], unresolvedDispatchIds: [] })),
  claimStructureReviewDispatch: jest.fn(async () => 'dispatch'), finishStructureReviewDispatch: jest.fn(async () => undefined),
  reserveStructureReviewSend: jest.fn(async () => 'reservation'), recordStructureReviewSend: jest.fn(async () => undefined),
}));
import { ObjectId, type WithId } from 'mongodb';
import { materialsCol, materialChunksCol, themesCol, losCol, contentRunsCol, sourceEvidenceExtractionsCol } from '../../server/src/components/mongodb/collections';
import { completeJson } from '../../server/src/components/genai/llm';
import { assertContentRunActive, claimStructureGenerationRun, failContentRun, getContentRun, updateContentRun, createStructureGenerationRun } from '../../server/src/services/content-runs.service';
import { generateStructure, runStructureGeneration, loadStructureCorpus, partialStructure, validateExtraction, validateOutline, enqueueStructureGeneration, sourcePassages, validateReferencedExtraction, validateSourceExtraction, validateCachedSourceExtraction, structureSynthesisLedger, structureSynthesisPacks, structureCorpusFingerprint, sourceExtractionPrompt,
  enqueueStructureOutlineCoverageRepair, getStructureOutlineRepairView, assertStructureRepairAdoptable, finalizeStructureCoverage, continueStructureReview } from '../../server/src/services/structure-generation.service';
import * as reviewCheckpoint from '../../server/src/services/structure-review-checkpoint.service';
import { planOutlineGrounding, outlineGroundingProtocolHash } from '../../server/src/services/structure-outline-grounding';
import type { StructureReviewCheckpointBody, StructureReviewProgress } from '../../server/src/types/structure-review';
import { currentAuthoringBudget } from '../../server/src/services/authoring-budget.service';
import * as repair from '../../server/src/services/structure-outline-repair.service';
import { enqueueJob } from '../../server/src/components/jobs';
import { env } from '../../server/src/config/env';
import { assertSourceSelectionReady, getMaterialSourceReadiness, hashSourceChunks } from '../../server/src/services/source-readiness.service';
import type { SourceEvidenceExtraction } from '../../server/src/types/source-evidence';
import type { MaterialChunk, StructureGenerationRun } from '../../server/src/types/domain';
import type { StructureEvidence } from '../../server/src/types/structure';
import { createHash } from 'node:crypto';
import { buildPdfPageMap, locatePdfChunk } from '../../server/src/components/genai/document-parsing/pdf-provenance';
import { buildPdfPageTextObservations } from '../../server/src/components/genai/document-parsing/pdf-page-text-observations';
import * as materialProvenance from '../../server/src/services/material-source-provenance.service';
import type { MaterialSourceProvenance, PdfParseReceipt } from '../../server/src/types/source-provenance';
const courseId = new ObjectId(); const m1 = new ObjectId(); const m2 = new ObjectId();
let chunks: MaterialChunk[];
let sourceRows: Array<{ _id: ObjectId; name: string; revision?: number; ingestRunId?: string }>;
let sourceFilter: unknown;
const cacheRows = new Map<string, SourceEvidenceExtraction>();
let replayRows: unknown[];
const cursor = (rows: () => unknown[]) => { const c = { toArray: jest.fn(async () => rows()), sort: jest.fn(), limit: jest.fn() }; c.sort.mockReturnValue(c); c.limit.mockReturnValue(c); return c; };
beforeEach(() => {
  jest.clearAllMocks(); jest.mocked(completeJson).mockReset();
  jest.mocked(claimStructureGenerationRun).mockReset(); jest.mocked(getContentRun).mockReset();
  cacheRows.clear();
  replayRows = [];
  sourceRows = [{ _id: m1, name: 'Lecture.pdf' }, { _id: m2, name: 'Assignment.pdf' }];
  chunks = [
    { courseId, materialId: m1, index: 0, text: 'Newton describes inertia.', characterCount: 24, createdAt: new Date() },
    { courseId, materialId: m1, index: 1, text: 'Late chapter: determine inclined-plane acceleration.', characterCount: 51, createdAt: new Date() },
    { courseId, materialId: m2, index: 0, text: 'Use vector decomposition in force diagrams.', characterCount: 43, createdAt: new Date() },
  ];
  jest.mocked(materialsCol).mockReturnValue({ find: (filter: { _id?: { $in?: ObjectId[] } }) => { sourceFilter = filter;
    return cursor(() => sourceRows.filter(row => !filter._id?.$in || filter._id.$in.some(id => id.equals(row._id)))); },
    findOne: async (filter: { _id: ObjectId }) => sourceRows.find(row => row._id.equals(filter._id)) ?? null } as never);
  jest.mocked(materialChunksCol).mockReturnValue({ find: () => cursor(() => chunks) } as never);
  jest.mocked(themesCol).mockReturnValue({ find: () => cursor(() => []) } as never);
  jest.mocked(losCol).mockReturnValue({ find: () => cursor(() => []) } as never);
  jest.mocked(contentRunsCol).mockReturnValue({ findOne: jest.fn(async () => null), find: () => cursor(() => replayRows) } as never);
  jest.mocked(assertContentRunActive).mockResolvedValue();
  const snapshot = (id: ObjectId) => ({ materialId: id.toHexString(), revision: sourceRows.find(row => row._id.equals(id))!.revision ?? 0, name: sourceRows.find(row => row._id.equals(id))!.name,
    ingestRunId: sourceRows.find(row => row._id.equals(id))!.ingestRunId,
    sourceTextHash: hashSourceChunks(chunks.filter(chunk => chunk.materialId.equals(id))), chunkCount: chunks.filter(chunk => chunk.materialId.equals(id)).length,
    characterCount: chunks.filter(chunk => chunk.materialId.equals(id)).reduce((sum, chunk) => sum + chunk.text.length, 0), parserVersion: 'test-parser', chunkerVersion: 'test-chunker' });
  jest.mocked(assertSourceSelectionReady).mockImplementation(async (_course, input) => ({ requested: [],
    included: sourceRows.filter(row => !input.materialIds || input.materialIds.includes(row._id.toHexString())).map(row => snapshot(row._id)), excluded: [], ready: true }));
  jest.mocked(getMaterialSourceReadiness).mockImplementation(async (_course, id) => ({ materialId: id.toHexString(), name: snapshot(id).name, ready: true, state: 'indexed', classification: 'completed', snapshot: snapshot(id) }));
  jest.mocked(sourceEvidenceExtractionsCol).mockReturnValue({
    findOne: jest.fn(async (filter: { cacheKey: string }) => cacheRows.get(filter.cacheKey) ?? null),
    updateOne: jest.fn(async (filter: { cacheKey: string }, update: { $set: SourceEvidenceExtraction }) => {
      cacheRows.set(filter.cacheKey, { ...update.$set, sections: JSON.parse(JSON.stringify(update.$set.sections)) });
    }),
  } as never);
});
const evidence: StructureEvidence[] = [{ id: 'E1', objective: 'Calculate acceleration', materialId: m1.toHexString(), materialName: 'Lecture', chunkIndex: 9, quote: 'acceleration' }];
it('reads later chunks and every selected material; fails closed for unavailable or missing text', async () => {
  const corpus = await loadStructureCorpus(courseId, [m1.toHexString(), m2.toHexString()]);
  expect(corpus.sections.map(s => s.text)).toEqual(chunks.map(c => c.text));
  expect(sourceFilter).toMatchObject({ courseId, status: 'ready', deletedAt: { $exists: false } });
  await expect(loadStructureCorpus(courseId, [m1.toHexString(), new ObjectId().toHexString(), m2.toHexString()])).rejects.toThrow('structure-material-unavailable');
  chunks = chunks.filter(c => c.materialId.equals(m1));
  await expect(loadStructureCorpus(courseId)).rejects.toThrow('structure-chunks-missing');
});
it('keeps a new batch plus ten older sources current despite receipt order and retains its explicit exclusions', async () => {
  sourceRows = Array.from({ length: 11 }, (_, index) => ({ _id: new ObjectId(), name: `Chapter ${index + 1}.pdf` }));
  chunks = sourceRows.map((source, index) => ({ courseId, materialId: source._id, index: 0, text: `Original chapter principle ${index + 1}.`, characterCount: 30, createdAt: new Date() }));
  const ready = jest.mocked(assertSourceSelectionReady).getMockImplementation()!;
  const sourceBatchId = new ObjectId().toHexString();
  jest.mocked(assertSourceSelectionReady).mockImplementation(async (course, input) => {
    const report = await ready(course, input);
    if (input.sourceBatchId) {
      report.sourceBatchId = input.sourceBatchId;
      report.included = [report.included[10], ...report.included.slice(0, 10)];
      report.excluded = [{ name: 'Omitted appendix.pdf', clientFileId: 'appendix', reason: 'instructor-selected-subset' }];
    }
    return report;
  });
  successfulSourceModel();
  const options = { sourceBatchId, materialIds: sourceRows.map(source => source._id.toHexString()) };
  const result = await generateStructure(courseId, options);
  expect(result.coverage.materials).toHaveLength(11);
  expect(result.coverage.sourceSelection.excluded).toHaveLength(1);
  expect(jest.mocked(assertSourceSelectionReady).mock.calls.every(([, input]) => input.sourceBatchId === sourceBatchId)).toBe(true);
  const corpus = await loadStructureCorpus(courseId, options.materialIds, sourceBatchId);
  expect(structureCorpusFingerprint([...corpus.sections].reverse(), { ...corpus.sourceSelection, included: [...corpus.sourceSelection.included].reverse() })).toBe(corpus.fingerprint);
  expect(result.coverage.sourceFingerprint).toBe(corpus.fingerprint);
});

it.each(['ingest-identity', 'original', 'excluded-scope'])('rejects a changed %s at the final same-scope source check', async changed => {
  successfulSourceModel(); const success = jest.mocked(completeJson).getMockImplementation()!;
  if (changed === 'excluded-scope') {
    const ready = jest.mocked(assertSourceSelectionReady).getMockImplementation()!; let calls = 0;
    jest.mocked(assertSourceSelectionReady).mockImplementation(async (course, input) => ({ ...await ready(course, input),
      excluded: [{ name: calls++ ? 'Changed omitted file.pdf' : 'Original omitted file.pdf', reason: 'instructor-selected-subset' }] }));
  }
  jest.mocked(completeJson).mockImplementation(async (prompt, options) => {
    const value = await success(prompt, options);
    if (!prompt.startsWith('Extract')) {
      if (changed === 'ingest-identity') sourceRows[0].ingestRunId = new ObjectId().toHexString();
      if (changed === 'original') chunks[0].text = 'Changed original principle after synthesis.';
    }
    return value;
  });
  await expect(generateStructure(courseId, {})).rejects.toThrow('structure-material-changed');
});

it('keeps indexed originals eligible when pending advisory classification settles metadata', async () => {
  successfulSourceModel(); const success = jest.mocked(completeJson).getMockImplementation()!;
  const readiness = jest.mocked(getMaterialSourceReadiness).getMockImplementation()!;
  let settled = false;
  jest.mocked(getMaterialSourceReadiness).mockImplementation(async (course, id) => ({ ...await readiness(course, id), classification: settled ? 'completed' : 'pending' }));
  jest.mocked(completeJson).mockImplementation(async (prompt, options) => {
    const result = await success(prompt, options);
    if (prompt.startsWith('Extract') && !settled) { sourceRows[0].revision = 1; settled = true; }
    return result;
  });
  await expect(generateStructure(courseId, {})).resolves.toMatchObject({ coverage: { analyzedSections: 3, unmappedEvidenceIds: [] } });
  expect(settled).toBe(true);
});
it('requires every section to be considered and verifies quotes against its own source', async () => {
  const { sections } = await loadStructureCorpus(courseId);
  expect(() => validateExtraction({ sections: [] }, sections)).toThrow('Every section');
  const response = { sections: sections.map(s => ({ sectionId: s.id, objectives: [{ name: 'Explain the concept', quote: s.text }] })) };
  expect(validateExtraction(response, sections).sections).toHaveLength(3);
  response.sections[0].objectives[0].quote = sections[2].text;
  expect(() => validateExtraction(response, sections)).toThrow('verbatim');
});
it('rejects invented source IDs and ignored counts, while mechanically merging exact duplicate labels', () => {
  const outline = { themes: [{ name: 'Mechanics', los: [{ name: 'Calculate acceleration', evidenceIds: ['E1'] }] }] };
  expect(validateOutline(outline, evidence, {})[0].los[0].materialIds).toEqual([m1.toHexString()]);
  expect(() => validateOutline(outline, evidence, { topicCount: 2 })).toThrow('exactly 2');
  outline.themes[0].los[0].evidenceIds = ['invented'];
  expect(() => validateOutline(outline, evidence, {})).toThrow('evidence IDs');
  outline.themes[0].los[0].evidenceIds = ['E1']; outline.themes[0].los.push(outline.themes[0].los[0]);
  expect(validateOutline(outline, evidence, {})[0].los).toHaveLength(1);
  const points = [...evidence, { ...evidence[0], id: 'E2', materialId: m2.toHexString() }];
  const duplicates = { themes: [outline.themes[0], { name: ' mechanics ', los: [{ name: 'Calculate acceleration', evidenceIds: ['E2'] }] }] };
  const consolidated = validateOutline(duplicates, points, {});
  expect(consolidated).toHaveLength(1);
  expect(consolidated[0].los[0].evidenceIds).toEqual(['E1', 'E2']);
  expect(consolidated[0].los[0].materialIds).toEqual([m1.toHexString(), m2.toHexString()]);
  expect(() => validateOutline(duplicates, points, { topicCount: 2 })).toThrow('exactly 2');
  duplicates.themes[1].los[0].evidenceIds = ['unrecognized'];
  expect(() => validateOutline(duplicates, points, {})).toThrow('unrecognized');
});
it('retains precise outline validation diagnostics after bounded corrections fail', async () => {
  successfulSourceModel();
  const extraction = jest.mocked(completeJson).getMockImplementation()!;
  jest.mocked(completeJson).mockImplementation(async (prompt, options) => prompt.startsWith('Extract') ? extraction(prompt, options) :
    { themes: [{ name: 'Mechanics', los: [{ name: 'Calculate acceleration', evidenceIds: ['E999'] }] }] } as never);
  await expect(generateStructure(courseId, {}, new ObjectId())).rejects.toMatchObject({ message: 'structure-outline-invalid', validationReason: expect.stringContaining('Unknown IDs: E999') });
  const failures = jest.mocked(updateContentRun).mock.calls.flatMap(([, update]) => update.structureDiagnostics?.synthesisInput?.validationFailures ?? []);
  expect(failures.some(failure => failure.stage === 'outline-synthesis' && failure.attempt === 1 && failure.reason.includes('E999'))).toBe(true);
  expect(jest.mocked(completeJson).mock.calls.filter(([prompt]) => !prompt.startsWith('Extract'))).toHaveLength(2);
});
it('projects partial topic and LO strings but never model reasoning or metadata', () => {
  expect(partialStructure('{"reasoning":"SECRET","themes":[{"name":"Force","los":[{"name":"Calculate acc')).toEqual({ themes: [{ name: 'Force', los: [{ name: 'Calculate acc' }] }] });
  expect(partialStructure('')).toEqual({ themes: [] });
});
it('streams real provider fragments, maps both sources, and reports unmapped evidence instead of claiming completeness', async () => {
  jest.mocked(completeJson).mockImplementation(async (prompt, options) => {
    if (prompt.startsWith('Extract')) {
      const sections = JSON.parse(prompt.split('\n').find(line => line.startsWith('[{'))!);
      return { sections: sections.map((section: { sectionId: string }) => ({ sectionId: section.sectionId, objectives: [{ name: `Explain concept ${section.sectionId}`, passageId: `${section.sectionId}.P1` }] })) } as never;
    }
    expect(prompt).toContain('Decide the number of topics'); expect(prompt).toContain('Explain concept C2.S1');
    options?.onText?.('');
    options?.onText?.('{"themes":[{"name":"Mechanics","los":[{"name":"Resolve');
    await new Promise(resolve => setTimeout(resolve, 220));
    const result = { themes: [{ name: 'Mechanics', los: [{ name: 'Resolve forces and motion', evidenceIds: ['E1', 'E3'] }] }] };
    options?.onText?.(JSON.stringify(result)); return result as never;
  });
  const result = await generateStructure(courseId, {}, new ObjectId());
  expect(result.coverage.analyzedSections).toBe(3);
  expect(result.coverage.unmappedEvidenceIds).toEqual(['E2']);
  expect(result.themes[0].los[0].materialIds).toEqual([m1.toHexString(), m2.toHexString()]);
  expect(jest.mocked(updateContentRun).mock.calls.some(([, update]) => update.structurePreview?.themes[0]?.los[0]?.name === 'Resolve')).toBe(true);
  expect(result.coverage.warnings[0]).toContain('not mapped');
});
it('does not start another paid call after the run is stopped', async () => {
  jest.mocked(assertContentRunActive).mockRejectedValue(new Error('content-run-conflict'));
  await expect(generateStructure(courseId, {}, new ObjectId())).rejects.toThrow('content-run-conflict');
  expect(completeJson).not.toHaveBeenCalled();
});
it('returns the existing active run instead of enqueueing duplicate work', async () => {
  const run = { _id: new ObjectId(), kind: 'structure-generation', status: 'running' };
  jest.mocked(contentRunsCol).mockReturnValue({ findOne: jest.fn(async () => run) } as never);
  expect(await enqueueStructureGeneration(courseId, 'instructor', {})).toBe(run);
  expect(createStructureGenerationRun).not.toHaveBeenCalled();
});
it('selects condition context explicitly for a new durable public request', async () => {
  jest.mocked(createStructureGenerationRun).mockResolvedValue({ _id: new ObjectId(), kind: 'structure-generation' } as never);
  await enqueueStructureGeneration(courseId, 'instructor', {});
  expect(createStructureGenerationRun).toHaveBeenCalledWith(expect.objectContaining({ options: {
    materialIds: [m1.toHexString(), m2.toHexString()], synthesisProtocol: 'source-condition-context-v1', pageTextObservationProtocol: 'native-page-text-observations-v1' } }));
  expect(completeJson).not.toHaveBeenCalled();
});
it('does not silently truncate oversized selections', async () => {
  chunks[0].text = 'x'.repeat(1000001);
  await expect(loadStructureCorpus(courseId)).rejects.toThrow('structure-corpus-too-large');
  expect(completeJson).not.toHaveBeenCalled();
});

it('rejects gaps in the persisted chunk sequence instead of reporting full coverage', async () => {
  chunks[1].index = 2;
  await expect(loadStructureCorpus(courseId)).rejects.toThrow('structure-chunks-missing');
});

it('resolves numbered passages to exact original evidence, including PDF formulas and punctuation', async () => {
  chunks[0].text = 'Newton’s law: F = ma.\nUse \\sum F_x = m a_x; weight is 9.81 m/s². ' + 'Consider the diagram. '.repeat(65);
  const { sections } = await loadStructureCorpus(courseId);
  const passages = sourcePassages(sections[0]);
  expect(passages.length).toBeGreaterThan(1);
  expect(passages.every(p => p.text.length <= 500 && sections[0].text.includes(p.text))).toBe(true);
  expect(passages.map(p => p.text).join(' ').replace(/\s+/g, ' ').trim()).toBe(sections[0].text.replace(/\s+/g, ' ').trim());
  const raw = { sections: sections.map(s => ({ sectionId: s.id, objectives: [{ name: 'Calculate net force', passageId: `${s.id}.P1` }] })) };
  expect(validateReferencedExtraction(raw, sections).sections[0].objectives[0].quote).toBe(passages[0].text);
  raw.sections[0].objectives[0].passageId = 'S2.P1';
  expect(() => validateReferencedExtraction(raw, sections)).toThrow('belonging to S1');
});

it('corrects missing later relationships inside the existing extraction allowance and retains complete exact source groups', async () => {
  sourceRows = [{ _id: m1, name: 'Statistics.pdf' }];
  const text = 'Variance describes the spread of observations. '.repeat(11) + 'The sample denominator is n−1. Standard deviation is the square root of variance.';
  chunks = [{ courseId, materialId: m1, index: 0, text, characterCount: text.length, createdAt: new Date() }];
  let extractionCalls = 0;
  const observations: Array<{ phase: string; prompt?: string; output?: unknown }> = [];
  jest.mocked(completeJson).mockImplementation(async prompt => {
    if (!prompt.startsWith('Extract')) return { themes: [{ name: 'Statistics', los: [{ name: 'Compute variance and standard deviation with the stated denominator', evidenceIds: ['E1'] }] }] } as never;
    extractionCalls++;
    const rows = JSON.parse(prompt.split('\n').find(line => line.startsWith('[{'))!);
    const supports = rows[0].passages.slice(1).map((passage: { id: string }) => passage.id);
    if (extractionCalls === 2) expect(prompt).toContain('Missing objective references or passageDispositions: C1.S1.P2');
    return { sections: [{ sectionId: rows[0].sectionId, objectives: [{ name: 'Compute variance and standard deviation with the stated denominator', passageId: 'C1.S1.P1',
      ...(extractionCalls === 2 ? { supportingPassageIds: supports } : {}) }] }] } as never;
  });
  const result = await generateStructure(courseId, {}, undefined, { record: event => { observations.push(event); } });
  expect(extractionCalls).toBe(2);
  expect(result.coverage.sourceInventory).toMatchObject({ totalPassages: 2, objectiveLinkedPassages: 2, mappedPassages: 2 });
  expect(result.evidence[0].supportingPassages![0].quote).toContain('square root of variance');
  const ledger = JSON.parse(structureSynthesisLedger(result.evidence).ledger);
  expect(ledger.originalPassages).toHaveLength(2);
  expect(ledger.learningPoints[0].supportingPassageIds).toEqual(['P2']);
  expect(observations.map(event => event.phase)).toEqual(['prepared', 'output', 'prepared', 'output', 'prepared', 'output']);
});

it('rejects forged support quotes and cross-section references instead of joining plausible source text', async () => {
  const { sections } = await loadStructureCorpus(courseId);
  const section = { ...sections[0], text: 'First exact premise. '.repeat(25) + 'The exact condition appears later.' };
  const ids = sourcePassages(section).map(passage => passage.id);
  const raw = { sections: [{ sectionId: section.id, objectives: [{ name: 'Apply the original premise with its condition', passageId: ids[0], supportingPassageIds: ids.slice(1) }] }] };
  const checked = validateSourceExtraction(raw, [section], true);
  expect(validateCachedSourceExtraction(checked, [section], true)).toEqual(checked);
  checked[0].objectives[0].supportingPassages![0].quote = 'Plausible but invented source condition.';
  expect(() => validateCachedSourceExtraction(checked, [section], true)).toThrow('Cached reference');
  raw.sections[0].objectives[0].supportingPassageIds = ['FOREIGN.P1'];
  expect(() => validateSourceExtraction(raw, [section], true)).toThrow('belonging to');
});

it('uses the existing outline correction to prevent a whole instructional chapter disappearing', async () => {
  successfulSourceModel(); const success = jest.mocked(completeJson).getMockImplementation()!;
  let synthesisCalls = 0;
  jest.mocked(completeJson).mockImplementation(async (prompt, options) => {
    if (prompt.startsWith('Extract')) return success(prompt, options);
    synthesisCalls++;
    if (synthesisCalls === 1) return { themes: [{ name: 'Only the first lecture', los: [{ name: 'Explain the first lecture principle', evidenceIds: ['E1'] }] }] } as never;
    expect(prompt).toContain('Selected instructional sources missing from the outline: Assignment.pdf');
    return success(prompt, options);
  });
  const result = await generateStructure(courseId, {});
  expect(synthesisCalls).toBe(2);
  expect(result.coverage.sourceInventory?.materialsWithoutMappedObjectives).toEqual([]);
});

it('retains each raw visible JSON failure and exact correction input before propagating a failed parse', async () => {
  sourceRows = [{ _id: m1, name: 'One chapter.pdf' }]; chunks = [chunks[0]];
  const observations: Array<{ phase: string; prompt?: string; text?: string; jsonAttempt?: number }> = [];
  jest.mocked(completeJson).mockImplementation(async (prompt, options) => {
    for (const jsonAttempt of [0, 1]) {
      const actualPrompt = prompt + (jsonAttempt ? '\nJSON correction actually dispatched.' : '');
      await options?.beforeRequest?.({ prompt: actualPrompt, jsonAttempt } as never);
      options?.onText?.(''); options?.onText?.(`Invalid visible reply ${jsonAttempt}`);
      await options?.onAttempt?.({ type: 'finished', usageContext: { jsonAttempt }, outcome: 'succeeded' } as never);
    }
    throw new Error('llm-json-parse-failed');
  });
  await expect(generateStructure(courseId, {}, undefined, { transport: 'stream', record: event => { observations.push(event); } })).rejects.toThrow('llm-json-parse-failed');
  expect(observations.filter(event => event.phase === 'input').map(event => event.jsonAttempt)).toEqual([0, 1]);
  expect(observations.filter(event => event.phase === 'input')[1].prompt).toContain('JSON correction actually dispatched.');
  expect(observations.filter(event => event.phase === 'visible-output').map(event => event.text)).toEqual(['Invalid visible reply 0', 'Invalid visible reply 1']);
  expect(observations.at(-1)?.phase).toBe('failure');
});

it('pins controlled model/effort/caps in actual calls and cache identity without changing platform settings', async () => {
  successfulSourceModel(); const success = jest.mocked(completeJson).getMockImplementation()!;
  const complete: typeof completeJson = jest.fn(success) as never;
  const observer = { record: () => undefined, complete, model: { model: 'gpt-6-luna', reasoningEffort: 'high' as const }, maxOutputTokens: 10000 };
  const first = await generateStructure(courseId, {}, undefined, observer);
  expect(first.coverage.cache.misses).toBe(2);
  expect(jest.mocked(complete).mock.calls.every(([, options]) => options?.model === 'gpt-6-luna' && options.reasoningEffort === 'high' && options.maxTokens === 10000)).toBe(true);
  const warm = await generateStructure(courseId, {}, undefined, observer);
  expect(warm.coverage.cache.hits).toBe(2);
  const changed = await generateStructure(courseId, {}, undefined, { ...observer, model: { ...observer.model, reasoningEffort: 'medium' } });
  expect(changed.coverage.cache.misses).toBe(2);
  const changedCap = await generateStructure(courseId, {}, undefined, { ...observer, maxOutputTokens: 9000 });
  expect(changedCap.coverage.cache.misses).toBe(2);
});
it('uses the JSON runtime Sol effort default in calls and reusable cache identity', async () => {
  successfulSourceModel();
  const observer = { record: () => undefined, model: { model: 'gpt-6.1-sol' } };
  await generateStructure(courseId, {}, undefined, observer);
  expect(jest.mocked(completeJson).mock.calls.every(([, options]) => options?.reasoningEffort === 'medium')).toBe(true);
  const warm = await generateStructure(courseId, {}, undefined, { ...observer, model: { ...observer.model, reasoningEffort: 'medium' } });
  expect(warm.coverage.cache.hits).toBe(2);
  jest.mocked(completeJson).mockClear();
  await expect(generateStructure(courseId, {}, undefined, { ...observer, model: { ...observer.model, reasoningEffort: 'none' } })).rejects.toThrow('model-reasoning-effort-unsupported');
  expect(completeJson).not.toHaveBeenCalled();
});
it('retries invalid batch extraction in smaller sections while retaining complete source coverage', async () => {
  let batches = 0;
  jest.mocked(completeJson).mockImplementation(async prompt => {
    if (!prompt.startsWith('Extract')) return { themes: [{ name: 'Mechanics', los: [{ name: 'Resolve forces and acceleration', evidenceIds: ['E1', 'E2', 'E3'] }] }] } as never;
    const sections = JSON.parse(prompt.split('\n').find(line => line.startsWith('[{'))!);
    if (sections.length > 1) { batches++; return { sections: [] } as never; }
    return { sections: sections.map((s: { sectionId: string }) => ({ sectionId: s.sectionId, objectives: [{ name: 'Explain this physical principle', passageId: `${s.sectionId}.P1` }] })) } as never;
  });
  const result = await generateStructure(courseId, {}, new ObjectId());
  expect(batches).toBe(2);
  expect(result.coverage.analyzedSections).toBe(3);
  expect(result.coverage.mappedObjectives).toBe(3);
  expect(jest.mocked(updateContentRun).mock.calls.some(([, u]) => u.message?.includes('individually'))).toBe(true);
});

function successfulSourceModel(): void {
  jest.mocked(completeJson).mockImplementation(async prompt => {
    if (prompt.startsWith('Extract')) {
      const rows: Array<{ sectionId: string; material: string; passages: Array<{ id: string }> }> = JSON.parse(prompt.split('\n').find(line => line.startsWith('[{'))!);
      return { sections: rows.map(row => ({ sectionId: row.sectionId, objectives: [{ name: `Explain ${row.material} ${row.sectionId}`, passageId: `${row.sectionId}.P1`,
        supportingPassageIds: row.passages.slice(1, 8).map(passage => passage.id) }],
        passageDispositions: row.passages.slice(8).map(passage => ({ passageId: passage.id, disposition: 'context', reason: 'Further explanation of the same supported principle.' })),
        knowledge: [{ kind: 'concept', name: `Principle in ${row.sectionId}`, passageId: `${row.sectionId}.P1` }] })) } as never;
    }
    const ledger: { learningPoints: Array<{ id: string }> } = JSON.parse(prompt.split('Evidence ledger:\n')[1].split('\nCorrect')[0]);
    return { themes: [{ name: 'Course principles', los: [{ name: 'Apply all supported course principles', evidenceIds: ledger.learningPoints.map(row => row.id) }] }] } as never;
  });
}

it('reviews an explicitly pinned small outline even when hierarchical organization was unnecessary', async () => {
  successfulSourceModel(); const ordinary = jest.mocked(completeJson).getMockImplementation()!;
  jest.mocked(completeJson).mockImplementation(async (prompt, options) => {
    if (options?.usageContext?.stage !== 'outline-source-review') return ordinary(prompt, options);
    expect(options.maxTokens).toBe(6000);
    const packet = JSON.parse(prompt.split('\n\n').at(-1)!) as { candidateIds: string[]; objectives: Array<{ id: string; sourceIds: string[];
      learningPointIds: string[] }>; requiredComparisons: unknown[] };
    expect(packet.candidateIds).toHaveLength(1);
    expect(packet.requiredComparisons).toEqual([]);
    return { reviews: packet.objectives.filter(row => packet.candidateIds.includes(row.id)).map(row => ({ id: row.id, sourceStatus: 'supported', sourceIds: row.sourceIds,
      coveredEvidenceIds: row.learningPointIds, sourceReason: 'Scripted full-original support.',
      topicFit: 'fits', topicReason: 'The original topic groups the taught principles.' })), capabilityComparisons: [] } as never;
  });
  const result = await generateStructure(courseId, { capabilityDistinctnessProtocol: 'outline-capability-distinctness-v1' });
  expect(jest.mocked(completeJson).mock.calls.filter(([, options]) => options?.usageContext?.stage === 'outline-source-review')).toHaveLength(1);
  expect(result.coverage.outlineGrounding).toMatchObject({ reviewedObjectives: 1, supportedObjectives: 1,
    capabilityDistinctness: { complete: true, eligibleIds: ['L1'], held: [] } });
});

it('refuses an unknown explicit capability protocol before source reads or model work', async () => {
  await expect(generateStructure(courseId, { capabilityDistinctnessProtocol: 'foreign' as never })).rejects.toThrow('structure-capability-protocol-unsupported');
  expect(materialsCol).not.toHaveBeenCalled(); expect(completeJson).not.toHaveBeenCalled();
});

it('records an insufficient whole-review minimum and refuses its first review send without increasing the allowance', async () => {
  successfulSourceModel();
  const settings = env as unknown as { authoringMaxEstimatedTokens: number };
  const previous = settings.authoringMaxEstimatedTokens; settings.authoringMaxEstimatedTokens = 1;
  try {
    await expect(generateStructure(courseId, { capabilityDistinctnessProtocol: 'outline-capability-distinctness-v1' }, new ObjectId()))
      .rejects.toThrow('structure-capability-review-budget-insufficient');
    expect(jest.mocked(completeJson).mock.calls.some(([, options]) => options?.usageContext?.stage === 'outline-source-review')).toBe(false);
    const plans = jest.mocked(updateContentRun).mock.calls.flatMap(([, update]) => update.structureDiagnostics?.synthesisInput?.capabilityReviewPlan ?? []);
    expect(plans).toContainEqual(expect.objectContaining({ fits: false, remainingUnits: 1, batches: 1 }));
  } finally { settings.authoringMaxEstimatedTokens = previous; }
});

it('refuses historical wording/coverage repair of a capability-aware parent before queueing or claiming another cycle', async () => {
  jest.mocked(getContentRun).mockResolvedValue({ _id: new ObjectId(), courseId, kind: 'structure-generation', status: 'completed',
    input: { capabilityDistinctnessProtocol: 'outline-capability-distinctness-v1' } } as never);
  await expect(enqueueStructureOutlineCoverageRepair(courseId, new ObjectId(), 'teacher', [{ id: 'L1', evidenceIds: ['E1'] }]))
    .rejects.toThrow('structure-repair-capability-consolidation-required');
  expect(repair.createStructureOutlineCoverageRepair).not.toHaveBeenCalled(); expect(enqueueJob).not.toHaveBeenCalled();
  expect(completeJson).not.toHaveBeenCalled();
});

it('reuses identical extraction cache rows while new synthesis alone receives separate source conditions', async () => {
  successfulSourceModel(); const success = jest.mocked(completeJson).getMockImplementation()!;
  jest.mocked(completeJson).mockImplementation(async (prompt, options) => {
    const value = await success(prompt, options);
    if (prompt.startsWith('Extract')) {
      const result = value as unknown as { sections: Array<{ knowledge: Array<{ kind: string; name: string; passageId: string }> }> };
      for (const section of result.sections) section.knowledge.push({ ...section.knowledge[0], kind: 'condition', name: 'Use this principle only under its stated conditions.' });
    }
    return value;
  });
  const legacy = await generateStructure(courseId, {});
  const keys = [...cacheRows.keys()]; const firstCalls = jest.mocked(completeJson).mock.calls.length;
  const originalPrompt = jest.mocked(completeJson).mock.calls.find(([prompt]) => prompt.startsWith('Design'))![0];
  const current = await generateStructure(courseId, { synthesisProtocol: 'source-condition-context-v1' });
  const newCalls = jest.mocked(completeJson).mock.calls.slice(firstCalls);
  expect(newCalls.some(([prompt]) => prompt.startsWith('Extract'))).toBe(false);
  expect([...cacheRows.keys()]).toEqual(keys);
  expect(legacy.coverage.synthesisInput?.conditionContext).toBeUndefined();
  expect(current.coverage.synthesisInput?.conditionContext).toMatchObject({ linkedConditions: 3, orphanConditions: 0 });
  expect(current.evidence).toEqual(legacy.evidence.map(point => ({ ...point, extraction: 'reused' })));
  expect(current.coverage.extractedObjectives).toBe(legacy.coverage.extractedObjectives);
  const newPrompt = newCalls.find(([prompt]) => prompt.startsWith('Design'))![0];
  expect(originalPrompt).not.toContain('Synthesis protocol: source-condition-context-v1');
  expect(newPrompt).toContain('Synthesis protocol: source-condition-context-v1');
  const oldLedger = JSON.parse(originalPrompt.split('Evidence ledger:\n')[1]);
  const newLedger = JSON.parse(newPrompt.split('Evidence ledger:\n')[1]);
  expect(oldLedger.conditionContext).toBeUndefined();
  expect(newLedger.conditionContext.conditions).toHaveLength(3);
  expect(newLedger.learningPoints).toEqual(oldLedger.learningPoints);
  expect(newLedger.originalPassages).toEqual(oldLedger.originalPassages);
  expect(() => validateOutline({ themes: [{ name: 'Invented condition curriculum', los: [{ name: 'Promote a condition to a new objective', evidenceIds: ['K1'] }] }] }, current.evidence, {})).toThrow('Unknown IDs: K1');
  const corpus = await loadStructureCorpus(courseId);
  expect(sourceExtractionPrompt(corpus.sections, {})).toBe(sourceExtractionPrompt(corpus.sections, { synthesisProtocol: 'source-condition-context-v1' }));
});

it('rejects an unknown synthesis selector before source or model work', async () => {
  await expect(generateStructure(courseId, { synthesisProtocol: 'unknown' } as never)).rejects.toThrow('structure-synthesis-protocol-unsupported');
  expect(assertSourceSelectionReady).not.toHaveBeenCalled();
  expect(completeJson).not.toHaveBeenCalled();
});

it('keeps historical page-observation absence and exact extraction bytes/fingerprint while adding current unavailable receipts', async () => {
  Object.assign(sourceRows[0], { format: 'pdf' }); Object.assign(sourceRows[1], { format: 'pdf' });
  const old = await loadStructureCorpus(courseId);
  const current = await loadStructureCorpus(courseId, undefined, undefined, [], 'native-page-text-observations-v1');
  expect(old).not.toHaveProperty('pageTextObservations');
  expect(current.fingerprint).toBe(old.fingerprint); expect(current.sections).toEqual(old.sections);
  expect(current.pageTextObservations).toMatchObject({ version: 'pdf-page-text-obligations-v1', materials: [
    { materialId: m1.toHexString(), observation: { status: 'unavailable', interpretation: 'unknown', teachingCoverage: 'not-assessed' } },
    { materialId: m2.toHexString(), observation: { status: 'unavailable', interpretation: 'unknown', teachingCoverage: 'not-assessed' } },
  ] });
  expect(sourceExtractionPrompt(current.sections, { pageTextObservationProtocol: 'native-page-text-observations-v1' }))
    .toBe(sourceExtractionPrompt(old.sections, {}));
  expect(completeJson).not.toHaveBeenCalled();
});

it('refuses an unknown page-observation selector before source or model work', async () => {
  await expect(generateStructure(courseId, { pageTextObservationProtocol: 'unknown' } as never)).rejects.toThrow('structure-page-text-protocol-unsupported');
  await expect(enqueueStructureGeneration(courseId, 'instructor', { pageTextObservationProtocol: 'unknown' } as never)).rejects.toThrow('structure-page-text-protocol-unsupported');
  expect(assertSourceSelectionReady).not.toHaveBeenCalled(); expect(completeJson).not.toHaveBeenCalled();
});

it('retains available physical-page observations through source loading and final mapping without treating sparse pages as covered', async () => {
  const own = chunks.filter(chunk => chunk.materialId.equals(m1));
  const raw = own.map(chunk => chunk.text).join('\f') + '\f'; const provenanceId = new ObjectId();
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const receipt: PdfParseReceipt = { version: 'pdf-parse-receipt-v1', pdfSha256: hash('synthetic-pdf-identity'), pdfBytes: 22,
    routingPolicy: 'text-poppler-first-v2', requestedFormat: 'text', actualFormat: 'text', successfulEngine: 'poppler-pdftotext', engineVersion: null,
    attempts: [{ engine: 'poppler-pdftotext', outcome: 'succeeded', elapsedMs: 1 }], rawTextSha256: hash(raw), rawTextBytes: Buffer.byteLength(raw), rawTextUtf16Length: raw.length,
    pageCount: { engine: 'pdfinfo', engineVersion: null, status: 'verified', count: own.length }, pageMap: buildPdfPageMap(raw, own.length, 'poppler-pdftotext') };
  if (receipt.pageMap.status !== 'verified') throw new Error('Fixture requires a verified native page map.');
  for (const chunk of own) chunk.sourceProvenance = { provenanceId: provenanceId.toHexString(), pdfSha256: receipt.pdfSha256,
    rawTextSha256: receipt.rawTextSha256, pageMapSha256: receipt.pageMap.sha256, locator: locatePdfChunk(raw, chunk.text, receipt.pageMap) };
  const record: WithId<MaterialSourceProvenance> = { _id: provenanceId, courseId, materialId: m1, sourceTextHash: hashSourceChunks(own), chunkCount: own.length,
    chunkBindings: materialProvenance.createMaterialChunkBindings(own), receipt, rawTextStoragePath: '/private/unit-only-unread-path', createdAt: new Date(),
    pageTextObservations: buildPdfPageTextObservations(raw, receipt) };
  Object.assign(sourceRows[0], { format: 'pdf', sourceManifest: { provenanceId } });
  const read = jest.spyOn(materialProvenance, 'readMaterialSourceProvenance').mockResolvedValue(record);
  try {
    successfulSourceModel();
    const result = await generateStructure(courseId, { pageTextObservationProtocol: 'native-page-text-observations-v1' });
    expect(result.coverage.mappedObjectives).toBeGreaterThan(0);
    expect(result.coverage.pageTextObservations).toMatchObject({ version: 'pdf-page-text-obligations-v1', materials: [
      { materialId: m1.toHexString(), provenanceId: provenanceId.toHexString(), observation: { status: 'available',
        counts: { total: 2, blank: 0, sparse: 2, present: 0 }, interpretation: 'unknown', teachingCoverage: 'not-assessed' } },
    ] });
    expect(JSON.stringify(result.coverage.pageTextObservations)).not.toContain('unit-only-unread-path');
    expect(result.coverage.warnings.some(warning => warning.includes('independent of mapped learning points'))).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
  } finally { read.mockRestore(); }
});

it.each(['native', 'stream'] as const)('keeps record-only observation native and makes %s transport explicit', async transport => {
  successfulSourceModel();
  await generateStructure(courseId, {}, undefined, { record: () => undefined, ...(transport === 'stream' ? { transport } : {}) });
  expect(completeJson).toHaveBeenCalled();
  for (const [, options] of jest.mocked(completeJson).mock.calls) {
    if (transport === 'stream') expect(options?.onText).toEqual(expect.any(Function));
    else expect(options?.onText).toBeUndefined();
  }
});

it('lets the atomic structure-worker winner finish while its duplicate exits without failing the shared run', async () => {
  successfulSourceModel(); const now = new Date(); const runId = new ObjectId();
  const run: WithId<StructureGenerationRun> = { _id: runId, courseId, requestedBy: 'PUID-1', kind: 'structure-generation',
    status: 'running', stage: 'queued', completedUnits: 0, revision: 1, events: [], warnings: [],
    input: { materialIds: [m1.toHexString(), m2.toHexString()] }, createdAt: now, updatedAt: now };
  jest.mocked(claimStructureGenerationRun).mockResolvedValueOnce(run).mockResolvedValueOnce(null);
  jest.mocked(getContentRun).mockResolvedValue(run);
  const record = jest.fn();
  await Promise.all([runStructureGeneration(runId, { transport: 'stream', record }), runStructureGeneration(runId, { transport: 'stream', record })]);
  expect(claimStructureGenerationRun).toHaveBeenCalledTimes(2);
  expect(jest.mocked(completeJson).mock.calls.filter(([prompt]) => prompt.startsWith('Extract'))).toHaveLength(2);
  expect(jest.mocked(completeJson).mock.calls.filter(([prompt]) => !prompt.startsWith('Extract'))).toHaveLength(1);
  expect(jest.mocked(updateContentRun).mock.calls.filter(([, update]) => update.status === 'completed')).toHaveLength(1);
  expect(jest.mocked(updateContentRun).mock.calls.some(([, update]) => update.status === 'running')).toBe(false);
  expect(failContentRun).not.toHaveBeenCalled();
  expect(record).toHaveBeenCalledWith(expect.objectContaining({ phase: 'prepared', stage: 'source-extraction' }));
  expect(jest.mocked(completeJson).mock.calls.every(([, options]) => typeof options?.onText === 'function')).toBe(true);
});

it('reuses ten chapters when Chapter 11 is added, remaps stable IDs, and synthesizes all sources again', async () => {
  sourceRows = Array.from({ length: 10 }, (_, index) => ({ _id: new ObjectId(), name: `Chapter ${index + 1}.pdf` }));
  chunks = sourceRows.map((source, index) => ({ courseId, materialId: source._id, index: 0, text: `Original finance principle ${index + 1}.`, characterCount: 29, createdAt: new Date() }));
  successfulSourceModel();
  const cold = await generateStructure(courseId, {}, new ObjectId());
  expect(cold.coverage.cache).toEqual({ hits: 0, misses: 10, reusedSections: 0, extractedSections: 10 });
  expect([...cacheRows.values()].filter(row => !row.parentCacheKey)).toHaveLength(10);
  expect([...cacheRows.values()].every(row => row.sections[0].sectionId === 'C1.S1' && row.sections[0].knowledge[0].quote.startsWith('Original'))).toBe(true);
  const added = { _id: new ObjectId(), name: 'Chapter 11.pdf' };
  // Insert at the beginning to prove cached local IDs are translated afresh.
  sourceRows.unshift(added);
  chunks.unshift({ courseId, materialId: added._id, index: 0, text: 'A newly introduced advanced principle.', characterCount: 37, createdAt: new Date() });
  jest.mocked(completeJson).mockClear();
  const warm = await generateStructure(courseId, {}, new ObjectId());
  expect(warm.coverage.cache).toEqual({ hits: 10, misses: 1, reusedSections: 10, extractedSections: 1 });
  expect(completeJson).toHaveBeenCalledTimes(2);
  expect(warm.evidence.map(row => row.id)).toEqual(Array.from({ length: 11 }, (_, index) => `E${index + 1}`));
  expect(warm.evidence[0].extraction).toBe('new');
  expect(warm.evidence[1].extraction).toBe('reused');
  expect(jest.mocked(completeJson).mock.calls[1][0]).toContain('Chapter 11.pdf');
  expect(jest.mocked(completeJson).mock.calls[1][0]).toContain('Chapter 10.pdf');
});

it('invalidates only changed source extraction and never treats the same filename as replacement', async () => {
  successfulSourceModel();
  await generateStructure(courseId, {});
  chunks[0].text = 'An updated original principle with a different assumption.';
  jest.mocked(completeJson).mockClear();
  const replaced = await generateStructure(courseId, {});
  expect(replaced.coverage.cache.hits).toBe(1);
  expect(replaced.coverage.cache.misses).toBe(1);
  expect(replaced.coverage.materials).toHaveLength(2);
  expect(completeJson).toHaveBeenCalledTimes(2);
  sourceRows[1].name = sourceRows[0].name;
  const sameName = await generateStructure(courseId, {});
  expect(sameName.coverage.materials).toHaveLength(2);
  expect(sameName.coverage.materials.map(row => row.materialId)).toEqual([m1.toHexString(), m2.toHexString()]);
});

it('invalidates title and exact normalized guidance, but retains instructor assignment changes outside the cache key', async () => {
  successfulSourceModel();
  await generateStructure(courseId, { guidance: 'Preserve conventions' });
  const warm = await generateStructure(courseId, { guidance: ' Preserve conventions ' });
  expect(warm.coverage.cache.hits).toBe(2);
  const guided = await generateStructure(courseId, { guidance: 'Preserve different conventions' });
  expect(guided.coverage.cache.misses).toBe(2);
  sourceRows[0].name = 'Renamed lecture.pdf';
  const renamed = await generateStructure(courseId, { guidance: 'Preserve different conventions' });
  expect(renamed.coverage.cache.hits).toBe(1);
  expect(renamed.coverage.cache.misses).toBe(1);
});

it('rejects forged cache quotes and references instead of using the catalog as authority', async () => {
  successfulSourceModel();
  await generateStructure(courseId, {});
  const first = [...cacheRows.values()].find(row => !row.parentCacheKey)!;
  for (const record of cacheRows.values()) if (record.materialId.equals(first.materialId)) {
    for (const section of record.sections) for (const point of section.objectives) point.quote = 'Invented unsupported formula';
  }
  const result = await generateStructure(courseId, {});
  expect(result.coverage.cache.hits).toBe(1);
  expect(result.coverage.cache.misses).toBe(1);
  expect(result.evidence.every(row => row.quote !== 'Invented unsupported formula')).toBe(true);
  const { sections } = await loadStructureCorpus(courseId);
  expect(() => validateCachedSourceExtraction([{ sectionId: sections[0].id, objectives: [], knowledge: [], skipReason: '' }], [sections[0]])).toThrow();
});

it('preserves completed cache units and names unfinished sections after a worker fails', async () => {
  let releaseSecond!: () => void;
  const secondWaiting = new Promise<void>(resolve => { releaseSecond = resolve; });
  successfulSourceModel();
  const success = jest.mocked(completeJson).getMockImplementation()!;
  jest.mocked(completeJson).mockImplementation(async (prompt, options) => {
    if (prompt.startsWith('Extract') && prompt.includes('Assignment.pdf')) { await secondWaiting; throw new Error('authoring-budget-exhausted:sends'); }
    const value = await success(prompt, options); releaseSecond(); return value;
  });
  let caught: unknown;
  try { await generateStructure(courseId, {}, new ObjectId()); } catch (error) { caught = error; }
  expect([...cacheRows.values()].filter(row => !row.parentCacheKey)).toHaveLength(1);
  expect(caught).toMatchObject({ structureDiagnostics: { unprocessedSections: [{ materialId: m2.toHexString(), name: 'Assignment.pdf', sectionId: 'S3' }] } });
  expect(jest.mocked(updateContentRun).mock.calls.at(-1)?.[1].structureDiagnostics?.cache.extractedSections).toBe(2);
});

it('runs at most two independent extraction batches and merges completion in source order', async () => {
  sourceRows = Array.from({ length: 5 }, (_, index) => ({ _id: new ObjectId(), name: `Chapter ${index + 1}` }));
  chunks = sourceRows.map((source, index) => ({ courseId, materialId: source._id, index: 0, text: `Chapter ${index + 1} original definition.`, characterCount: 29, createdAt: new Date() }));
  successfulSourceModel();
  const success = jest.mocked(completeJson).getMockImplementation()!;
  let active = 0; let maximum = 0;
  jest.mocked(completeJson).mockImplementation(async (prompt, options) => {
    if (!prompt.startsWith('Extract')) return success(prompt, options);
    active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, prompt.includes('Chapter 1') ? 30 : 2));
    const value = await success(prompt, options); active--; return value;
  });
  const result = await generateStructure(courseId, {});
  expect(maximum).toBe(2);
  expect(result.evidence.map(row => row.materialName)).toEqual(sourceRows.map(row => row.name));
});

it('records explicit replacement while preserving the old source and refuses invalid/foreign replacement identities', async () => {
  const originalRows = [...sourceRows];
  const corpus = await loadStructureCorpus(courseId, [m1.toHexString(), m2.toHexString()], undefined,
    [{ previousMaterialId: m1.toHexString(), replacementMaterialId: m2.toHexString() }]);
  expect(corpus.materials.map(row => row.materialId)).toEqual([m2.toHexString()]);
  expect(corpus.sourceSelection.excluded).toEqual([{ materialId: m1.toHexString(), name: 'Lecture.pdf', reason: 'instructor-replaced-source' }]);
  expect(corpus.sourceSelection.replacements).toEqual([{ previousMaterialId: m1.toHexString(), replacementMaterialId: m2.toHexString(),
    previousName: 'Lecture.pdf', replacementName: 'Assignment.pdf' }]);
  expect(sourceRows).toEqual(originalRows);
  await expect(loadStructureCorpus(courseId, undefined, undefined, [{ previousMaterialId: m1.toHexString(), replacementMaterialId: m1.toHexString() }])).rejects.toThrow('structure-replacement-invalid');
  await expect(loadStructureCorpus(courseId, undefined, undefined, [{ previousMaterialId: new ObjectId().toHexString(), replacementMaterialId: m2.toHexString() }])).rejects.toThrow('structure-replacement-unavailable');
});

it('deduplicates original passages without dropping points or conflating identically named sources', () => {
  const quote = 'Original formula and all of its conditions. '.repeat(8);
  const points = Array.from({ length: 6 }, (_, index) => ({ ...evidence[0], id: `E${index + 1}`, objective: `Apply supported learning task ${index + 1}`, quote,
    ...(index === 5 ? { materialId: m2.toHexString(), materialName: 'Lecture' } : {}) }));
  const result = structureSynthesisLedger(points);
  const ledger = JSON.parse(result.ledger);
  expect(result.originalLedger).toBe(JSON.stringify(points.map(point => ({ id: point.id, objective: point.objective,
    material: point.materialName, quote: point.quote }))));
  expect(result.ledger).toBe(JSON.stringify({ originalPassages: ledger.originalPassages, learningPoints: ledger.learningPoints }));
  expect(ledger.learningPoints.map((point: { id: string }) => point.id)).toEqual(points.map(point => point.id));
  expect(ledger.originalPassages).toHaveLength(2);
  expect(ledger.originalPassages.every((passage: { quote: string }) => passage.quote === quote)).toBe(true);
  expect(ledger.learningPoints[0].passageId).not.toBe(ledger.learningPoints[5].passageId);
  expect(result.receipt.originalPassageReferences).toBe(6);
  expect(result.receipt.distinctOriginalPassages).toBe(2);
  expect(result.receipt.deduplicatedLedgerInputEstimate).toBeLessThan(result.receipt.originalLedgerInputEstimate);
});

it('serializes sibling run progress writes while extraction remains parallel', async () => {
  successfulSourceModel();
  let writes = 0; let maximumWrites = 0;
  jest.mocked(updateContentRun).mockImplementation(async () => {
    writes++; maximumWrites = Math.max(maximumWrites, writes);
    if (writes > 1) throw new Error('content-run-conflict');
    await new Promise(resolve => setTimeout(resolve, 2));
    writes--; return undefined as never;
  });
  const result = await generateStructure(courseId, {}, new ObjectId());
  expect(result.coverage.analyzedSections).toBe(3);
  expect(maximumWrites).toBe(1);
  jest.mocked(updateContentRun).mockReset();
});

it('salvages valid sibling rows and corrects only the failed source ID with actual allowed passage IDs', async () => {
  sourceRows = [{ _id: m1, name: 'Lecture.pdf' }];
  chunks = Array.from({ length: 3 }, (_, index) => ({ courseId, materialId: m1, index, text: `Original principle ${index + 1}.`, characterCount: 21, createdAt: new Date() }));
  successfulSourceModel(); const success = jest.mocked(completeJson).getMockImplementation()!;
  let extracted = 0;
  jest.mocked(completeJson).mockImplementation(async (prompt, options) => {
    if (!prompt.startsWith('Extract')) return success(prompt, options);
    const requestRows: Array<{ sectionId: string }> = JSON.parse(prompt.split('\n').find(line => line.startsWith('[{'))!);
    extracted++;
    if (extracted === 1) return { sections: requestRows.map(row => ({ sectionId: row.sectionId,
      objectives: [{ name: 'Explain this original principle', passageId: row.sectionId === 'C2.S1' ? 'OUTSIDE.P1' : `${row.sectionId}.P1` }], knowledge: [] })) } as never;
    expect(requestRows.map(row => row.sectionId)).toEqual(['C2.S1']);
    expect(prompt).toContain('Allowed passage IDs: C2.S1.P1');
    expect(prompt).not.toContain('Original principle 1.');
    return success(prompt, options);
  });
  const result = await generateStructure(courseId, {}, new ObjectId());
  expect(extracted).toBe(2);
  expect(result.coverage.analyzedSections).toBe(3);
  expect(result.evidence.map(row => row.sourcePassageId)).toEqual(['C1.S1.P1', 'C2.S1.P1', 'C3.S1.P1']);
  expect([...cacheRows.values()].filter(row => row.parentCacheKey)).toHaveLength(3);
});

it('recovers valid child rows after a failed paid correction without re-extracting them', async () => {
  sourceRows = [{ _id: m1, name: 'Lecture.pdf' }];
  chunks = Array.from({ length: 3 }, (_, index) => ({ courseId, materialId: m1, index, text: `Original principle ${index + 1}.`, characterCount: 21, createdAt: new Date() }));
  let attempt = 0;
  jest.mocked(completeJson).mockImplementation(async prompt => {
    attempt++; if (attempt > 1) throw new Error('provider-failed');
    const rows: Array<{ sectionId: string }> = JSON.parse(prompt.split('\n').find(line => line.startsWith('[{'))!);
    return { sections: rows.map(row => ({ sectionId: row.sectionId, objectives: [{ name: 'Explain this original principle',
      passageId: row.sectionId === 'C2.S1' ? 'OUTSIDE.P1' : `${row.sectionId}.P1` }], knowledge: [] })) } as never;
  });
  await expect(generateStructure(courseId, {}, new ObjectId())).rejects.toMatchObject({ structureDiagnostics: { cache: { extractedSections: 2 },
    unprocessedSections: [{ materialId: m1.toHexString(), name: 'Lecture.pdf', sectionId: 'S2' }] } });
  expect(cacheRows.size).toBe(2);
  successfulSourceModel(); jest.mocked(completeJson).mockClear();
  const result = await generateStructure(courseId, {}, new ObjectId());
  expect(completeJson).toHaveBeenCalledTimes(2);
  expect(JSON.parse(jest.mocked(completeJson).mock.calls[0][0].split('\n').find(line => line.startsWith('[{'))!).map((row: { sectionId: string }) => row.sectionId)).toEqual(['C2.S1']);
  expect(result.coverage.cache).toEqual({ hits: 2, misses: 1, reusedSections: 2, extractedSections: 1 });
  expect(result.evidence.map(row => row.extraction)).toEqual(['reused', 'new', 'reused']);
});

function finalObjectivesPerOriginal(packs: Array<{ themes: Array<{ los: Array<{ evidenceIds: string[] }> }> }>) {
  const ids = [...new Set(packs.flatMap(pack => pack.themes.flatMap(theme => theme.los.flatMap(lo => lo.evidenceIds))))].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  return { themes: [{ name: 'Supported combined curriculum', los: ids.map((id, index) => ({ name: `Apply principle ${index + 1} with its stated units and limiting assumptions`, evidenceIds: [id] })) }] };
}
function supportedOriginalReview(prompt: string) {
  expect(Buffer.byteLength(prompt, 'utf8') + 32).toBeLessThanOrEqual(20000);
  const data: { objectives: Array<{ id: string; sourceIds: string[]; learningPoints: Array<{ id: string; sourceIds: string[] }> }>;
    originalSections: Array<{ id: string; material: string; chunkIndex: number; text: string }> } = JSON.parse(prompt.split('\nThe review schema or objective/source identities were invalid.')[0].split('\n\n').at(-1)!);
  for (const source of data.originalSections) {
    const material = sourceRows.find(row => row.name === source.material)!;
    const original = chunks.find(chunk => chunk.materialId.equals(material._id) && chunk.index === source.chunkIndex)!;
    expect(source.text).toBe(original.text);
  }
  return { reviews: data.objectives.map(objective => {
    expect(objective.sourceIds.length).toBeGreaterThan(0);
    expect(objective.sourceIds.every(id => data.originalSections.some(source => source.id === id))).toBe(true);
    expect(objective.learningPoints.length).toBeGreaterThan(0);
    return { id: objective.id, sourceStatus: 'supported', sourceIds: objective.sourceIds, coveredEvidenceIds: objective.learningPoints.map(point => point.id),
      sourceReason: 'The assigned full original section explicitly describes the principle, units and limiting assumptions.',
      topicFit: 'fits', topicReason: 'The supplied topic groups this capability.' };
  }) };
}

it('partitions complete originals and hierarchically organizes every evidence ID within the input limit', async () => {
  const settings = env as unknown as { authoringStructureMaxInputTokens: number };
  const previous = settings.authoringStructureMaxInputTokens; settings.authoringStructureMaxInputTokens = 20000;
  try {
    sourceRows = Array.from({ length: 5 }, (_, index) => ({ _id: new ObjectId(), name: `Chapter ${index + 1}` }));
    chunks = sourceRows.flatMap((source, sourceIndex) => Array.from({ length: 8 }, (_, index) => {
      const text = `Chapter ${sourceIndex + 1} original ${index}. ` + 'Original formula, units, notation and limiting assumptions are explained here. '.repeat(10);
      return { courseId, materialId: source._id, index, text, characterCount: text.length, createdAt: new Date() };
    }));
    successfulSourceModel(); const success = jest.mocked(completeJson).getMockImplementation()!;
    let packs = 0; let organizations = 0; let reviews = 0;
    jest.mocked(completeJson).mockImplementation(async (prompt, options) => {
      if (prompt.startsWith('Extract')) return success(prompt, options);
      if (options?.usageContext?.stage === 'outline-source-review') { reviews++; return supportedOriginalReview(prompt) as never; }
      expect(Buffer.byteLength(prompt, 'utf8') + 32).toBeLessThanOrEqual(20000);
      const ledger = JSON.parse(prompt.split('Evidence ledger:\n')[1]);
      if (ledger.packs) {
        organizations++;
        return finalObjectivesPerOriginal(ledger.packs) as never;
      }
      packs++; return success(prompt, options);
    });
    const result = await generateStructure(courseId, {}, new ObjectId());
    expect(packs).toBeGreaterThan(1); expect(organizations).toBe(1);
    expect(result.coverage.extractedObjectives).toBe(40);
    expect(reviews).toBeGreaterThan(0);
    expect(result.coverage.outlineGrounding).toMatchObject({ reviewedObjectives: 40, supportedObjectives: 40, withheldObjectives: 0 });
    expect(result.coverage.unmappedEvidenceIds).toEqual([]);
    expect(result.coverage.synthesisInput?.completedPacks).toBe(packs);
    expect(result.coverage.synthesisInput?.organizationInputEstimate).toBeLessThanOrEqual(20000);
    const partitioned = structureSynthesisPacks(result.evidence, 12000);
    expect(partitioned.flat().map(point => point.id)).toEqual(result.evidence.map(point => point.id));
    expect(partitioned.flat().map(point => point.quote)).toEqual(result.evidence.map(point => point.quote));
  } finally { settings.authoringStructureMaxInputTokens = previous; }
});

it.each([false, true])('scopes condition packs and refuses oversized final input (oversized: %s; mocked models only)', excessive => {
  return (async () => {
    const settings = env as unknown as { authoringStructureMaxInputTokens: number };
    const previous = settings.authoringStructureMaxInputTokens; settings.authoringStructureMaxInputTokens = 20000;
    try {
      const materialCount = excessive ? 5 : 2;
      sourceRows = Array.from({ length: materialCount }, (_, index) => ({ _id: new ObjectId(), name: `Chapter ${index + 1}` }));
      chunks = sourceRows.flatMap((source, sourceIndex) => Array.from({ length: 8 }, (_, index) => {
        const text = `Chapter ${sourceIndex + 1} original ${index}. ` + 'Original formula, units, notation and limiting assumptions are explained here. '.repeat(10);
        return { courseId, materialId: source._id, index, text, characterCount: text.length, createdAt: new Date() };
      }));
      successfulSourceModel(); const success = jest.mocked(completeJson).getMockImplementation()!;
      let packs = 0; let organizations = 0;
      jest.mocked(completeJson).mockImplementation(async (prompt, options) => {
        if (prompt.startsWith('Extract')) {
          const value = await success(prompt, options);
          const rows = value as unknown as { sections: Array<{ knowledge: Array<{ kind: string; name: string }> }> };
          for (const row of rows.sections) { row.knowledge[0].kind = 'condition'; row.knowledge[0].name = excessive ? 'Long explicit source condition '.repeat(16) : 'Preserve the stated limiting assumptions.'; }
          return value;
        }
        if (options?.usageContext?.stage === 'outline-source-review') return supportedOriginalReview(prompt) as never;
        const ledger = JSON.parse(prompt.split('Evidence ledger:\n')[1]);
        expect(Buffer.byteLength(prompt, 'utf8') + 32).toBeLessThanOrEqual(20000);
        if (ledger.packs) {
          organizations++;
          if (ledger.conditionContext) {
            expect(ledger.conditionContext.conditions).toHaveLength(materialCount * 8);
            expect(ledger.conditionContext.conditions.flatMap((row: { evidenceIds: string[] }) => row.evidenceIds).sort()).toEqual(chunks.map((_, index) => `E${index + 1}`).sort());
          }
          return finalObjectivesPerOriginal(ledger.packs) as never;
        }
        packs++;
        const own = new Set(ledger.learningPoints.map((row: { id: string }) => row.id));
        if (ledger.conditionContext) {
          expect(ledger.conditionContext.conditions.length).toBeGreaterThan(0);
          expect(ledger.conditionContext.conditions.every((row: { evidenceIds: string[] }) => row.evidenceIds.every(id => own.has(id)))).toBe(true);
          expect(JSON.stringify(ledger.conditionContext)).not.toContain('quote');
        }
        return success(prompt, options);
      });
      let legacyPacks = 0;
      if (!excessive) {
        await generateStructure(courseId, {}, new ObjectId()); legacyPacks = packs;
        const saved = jest.mocked(updateContentRun).mock.calls.flatMap(([, update]) => update.structureSynthesisPacks ? [update.structureSynthesisPacks] : []).at(-1)!;
        replayRows = [{ kind: 'structure-generation', structureSynthesisPacks: saved }];
      }
      const result = generateStructure(courseId, { synthesisProtocol: 'source-condition-context-v1' }, new ObjectId());
      if (excessive) {
        await expect(result).rejects.toThrow('structure-condition-context-too-large');
        expect(organizations).toBe(0);
      } else {
        const completed = await result;
        expect(completed.coverage.extractedObjectives).toBe(16);
        expect(completed.coverage.synthesisInput?.conditionContext).toMatchObject({ linkedConditions: 16, orphanConditions: 0 });
        expect(organizations).toBe(2);
        expect(packs).toBeGreaterThan(legacyPacks); // Old prompt identities cannot masquerade as condition-aware packs.
        const newPacks = packs;
        const saved = jest.mocked(updateContentRun).mock.calls.flatMap(([, update]) => update.structureSynthesisPacks ? [update.structureSynthesisPacks] : []).at(-1)!;
        replayRows = [{ kind: 'structure-generation', structureSynthesisPacks: saved }];
        const replay = await generateStructure(courseId, { synthesisProtocol: 'source-condition-context-v1' }, new ObjectId());
        expect(packs).toBe(newPacks);
        expect(replay.coverage.synthesisInput?.reusedPacks).toBe(saved.length);
        expect(replay.coverage.synthesisInput?.newPacks).toBe(0);
      }
      expect(packs).toBeGreaterThan(1);
    } finally { settings.authoringStructureMaxInputTokens = previous; }
  })();
});

it('replays exact validated synthesis groups and remaps their IDs after an earlier chapter is added', async () => {
  const settings = env as unknown as { authoringStructureMaxInputTokens: number };
  const previous = settings.authoringStructureMaxInputTokens; settings.authoringStructureMaxInputTokens = 20000;
  try {
    sourceRows = Array.from({ length: 5 }, (_, index) => ({ _id: new ObjectId(), name: `Chapter ${index + 1}` }));
    chunks = sourceRows.flatMap((source, sourceIndex) => Array.from({ length: 8 }, (_, index) => {
      const text = `Chapter ${sourceIndex + 1} original ${index}. ` + 'Original formula, units, notation and limiting assumptions are explained here. '.repeat(10);
      return { courseId, materialId: source._id, index, text, characterCount: text.length, createdAt: new Date() };
    }));
    successfulSourceModel(); const success = jest.mocked(completeJson).getMockImplementation()!;
    let packs = 0; let organizations = 0; let reviews = 0;
    jest.mocked(completeJson).mockImplementation(async (prompt, options) => {
      if (prompt.startsWith('Extract')) return success(prompt, options);
      if (options?.usageContext?.stage === 'outline-source-review') { reviews++; return supportedOriginalReview(prompt) as never; }
      const ledger = JSON.parse(prompt.split('Evidence ledger:\n')[1]);
      if (!ledger.packs) { packs++; return success(prompt, options); }
      organizations++;
      return finalObjectivesPerOriginal(ledger.packs) as never;
    });
    const cold = await generateStructure(courseId, {}, new ObjectId());
    const initialPacks = packs;
    const initialReviews = reviews;
    const stored = jest.mocked(updateContentRun).mock.calls.flatMap(([, update]) => update.structureSynthesisPacks ? [update.structureSynthesisPacks] : []).at(-1)!;
    replayRows = [{ kind: 'structure-generation', structureSynthesisPacks: stored }];
    expect(stored.length).toBe(initialPacks);
    jest.mocked(completeJson).mockClear();
    const warm = await generateStructure(courseId, {}, new ObjectId());
    expect(packs).toBe(initialPacks); expect(organizations).toBe(2);
    const warmReviews = reviews - initialReviews;
    expect(warmReviews).toBeGreaterThan(0);
    expect(jest.mocked(completeJson).mock.calls.filter(([, options]) => options?.usageContext?.stage === 'outline-organization')).toHaveLength(1);
    expect(jest.mocked(completeJson).mock.calls.filter(([, options]) => options?.usageContext?.stage === 'outline-source-review')).toHaveLength(warmReviews);
    expect(completeJson).toHaveBeenCalledTimes(1 + warmReviews);
    expect(warm.coverage.outlineGrounding).toMatchObject({ reviewedObjectives: 40, supportedObjectives: 40, withheldObjectives: 0 });
    expect(warm.coverage.synthesisInput).toMatchObject({ reusedPacks: initialPacks, newPacks: 0 });
    expect(warm.coverage.unmappedEvidenceIds).toEqual([]);
    const addition = { _id: new ObjectId(), name: 'Earlier additional chapter' };
    sourceRows.unshift(addition);
    chunks.unshift({ courseId, materialId: addition._id, index: 0, text: 'Apply a new original addition.', characterCount: 30, createdAt: new Date() });
    jest.mocked(completeJson).mockClear();
    const appended = await generateStructure(courseId, {}, new ObjectId());
    expect(appended.coverage.synthesisInput).toMatchObject({ reusedPacks: initialPacks, newPacks: 1 });
    expect(appended.coverage.extractedObjectives).toBe(cold.coverage.extractedObjectives + 1);
    expect(appended.coverage.unmappedEvidenceIds).toEqual([]);
    expect(appended.themes[0].los[0].evidenceIds).toContain('E1');
    expect(appended.themes[0].los[0].materialIds).toContain(addition._id.toHexString());
    expect(jest.mocked(completeJson).mock.calls.filter(([prompt]) => prompt.startsWith('Extract'))).toHaveLength(1);
    // A forged cached reference cannot be used as a validated organization aid.
    replayRows = [{ kind: 'structure-generation', structureSynthesisPacks: stored.map((pack, index) => index ? pack : {
      ...pack, themes: [{ name: 'Forged', los: [{ name: 'Use an unknown source', evidenceIds: ['invented'], materialIds: [] }] }],
    }) }];
    const before = packs;
    await generateStructure(courseId, {}, new ObjectId());
    expect(packs).toBeGreaterThan(before);
  } finally { settings.authoringStructureMaxInputTokens = previous; }
});

it('keeps validated synthesis siblings after a pack fails and retries only the remaining originals', async () => {
  const settings = env as unknown as { authoringStructureMaxInputTokens: number };
  const previous = settings.authoringStructureMaxInputTokens; settings.authoringStructureMaxInputTokens = 20000;
  try {
    sourceRows = Array.from({ length: 3 }, (_, index) => ({ _id: new ObjectId(), name: `Chapter ${index + 1}` }));
    chunks = sourceRows.flatMap((source, sourceIndex) => Array.from({ length: 12 }, (_, index) => {
      const text = `Chapter ${sourceIndex + 1} original ${index}. ` + 'Original formula, units, notation and limiting assumptions are explained here. '.repeat(10);
      return { courseId, materialId: source._id, index, text, characterCount: text.length, createdAt: new Date() };
    }));
    successfulSourceModel(); const success = jest.mocked(completeJson).getMockImplementation()!;
    let fail = true; let reviews = 0;
    jest.mocked(completeJson).mockImplementation(async (prompt, options) => {
      if (prompt.startsWith('Extract')) return success(prompt, options);
      if (options?.usageContext?.stage === 'outline-source-review') { reviews++; return supportedOriginalReview(prompt) as never; }
      const ledger = JSON.parse(prompt.split('Evidence ledger:\n')[1].split('\nCorrect')[0]);
      if (!ledger.packs) {
        if (fail && options?.usageContext?.item === 1) return { themes: [{ name: 'Invalid', los: [{ name: 'Invent an unsupported reference', evidenceIds: ['unknown'] }] }] } as never;
        return success(prompt, options);
      }
      return finalObjectivesPerOriginal(ledger.packs) as never;
    });
    await expect(generateStructure(courseId, {}, new ObjectId())).rejects.toThrow('structure-outline-invalid');
    const saved = jest.mocked(updateContentRun).mock.calls.flatMap(([, update]) => update.structureSynthesisPacks ? [update.structureSynthesisPacks] : []).at(-1)!;
    expect(saved.length).toBeGreaterThan(0);
    replayRows = [{ kind: 'structure-generation', structureSynthesisPacks: saved }];
    fail = false; jest.mocked(completeJson).mockClear();
    const recovered = await generateStructure(courseId, {}, new ObjectId());
    expect(recovered.coverage.synthesisInput?.reusedPacks).toBe(saved.length);
    expect(recovered.coverage.synthesisInput?.newPacks).toBeGreaterThan(0);
    expect(recovered.coverage.synthesisInput?.packCount).toBe(saved.length + recovered.coverage.synthesisInput!.newPacks!);
    expect(recovered.coverage.unmappedEvidenceIds).toEqual([]);
    expect(reviews).toBeGreaterThan(0);
    expect(recovered.coverage.outlineGrounding).toMatchObject({ reviewedObjectives: 36, supportedObjectives: 36, withheldObjectives: 0 });
    expect(jest.mocked(completeJson).mock.calls.filter(([prompt]) => prompt.startsWith('Extract'))).toHaveLength(0);
    expect(jest.mocked(completeJson).mock.calls.filter(([, options]) => options?.usageContext?.stage === 'outline-organization')).toHaveLength(1);
    expect(jest.mocked(completeJson).mock.calls.filter(([, options]) => options?.usageContext?.stage === 'outline-source-review')).toHaveLength(reviews);
    expect(completeJson).toHaveBeenCalledTimes(recovered.coverage.synthesisInput!.newPacks! + 1 + reviews);
  } finally { settings.authoringStructureMaxInputTokens = previous; }
});

type LargeOutlineModel = (prompt: string, options?: Parameters<typeof completeJson>[1]) => Promise<unknown>;
async function withLargeOriginalReview(work: (base: LargeOutlineModel) => Promise<void>): Promise<void> {
  const settings = env as unknown as { authoringStructureMaxInputTokens: number };
  const previous = settings.authoringStructureMaxInputTokens; settings.authoringStructureMaxInputTokens = 20000;
  try {
    sourceRows = Array.from({ length: 3 }, (_, index) => ({ _id: new ObjectId(), name: `Review Chapter ${index + 1}` }));
    chunks = sourceRows.flatMap((source, sourceIndex) => Array.from({ length: 12 }, (_, index) => {
      const text = `Chapter ${sourceIndex + 1} original ${index}. ` + 'Original formula, units, notation and limiting assumptions are explained here. '.repeat(10);
      return { courseId, materialId: source._id, index, text, characterCount: text.length, createdAt: new Date() };
    }));
    successfulSourceModel(); const extraction = jest.mocked(completeJson).getMockImplementation()!;
    const base: LargeOutlineModel = async (prompt, options) => {
      if (prompt.startsWith('Extract')) return extraction(prompt, options);
      if (options?.usageContext?.stage === 'outline-source-review') return supportedOriginalReview(prompt.split('\nThe review schema or objective/source identities were invalid.')[0]);
      const ledger = JSON.parse(prompt.split('Evidence ledger:\n')[1]);
      return ledger.packs ? finalObjectivesPerOriginal(ledger.packs) : extraction(prompt, options);
    };
    jest.mocked(completeJson).mockImplementation(async (prompt, options) => await base(prompt, options) as never);
    await work(base);
  } finally { settings.authoringStructureMaxInputTokens = previous; }
}
const finalReviewDiagnostics = () => jest.mocked(updateContentRun).mock.calls.flatMap(([, update]) => update.structureDiagnostics ? [update.structureDiagnostics] : []).at(-1)!;

it('retains a complete original-bound diagnostic receipt when every merged objective is withheld', async () => {
  await withLargeOriginalReview(async base => {
    jest.mocked(completeJson).mockImplementation(async (prompt, options) => {
      if (options?.usageContext?.stage !== 'outline-source-review') return await base(prompt, options) as never;
      const checked = supportedOriginalReview(prompt);
      return { reviews: checked.reviews.map((row, index) => ({ ...row, sourceStatus: index % 2 ? 'uncertain' : 'unsupported', sourceIds: [], coveredEvidenceIds: [],
        sourceReason: 'The final wording transfers the formula to an actor whose relationship is not established by the supplied original section.' })) } as never;
    });
    await expect(generateStructure(courseId, {}, new ObjectId())).rejects.toThrow('structure-grounding-no-supported-objectives');
    const receipt = finalReviewDiagnostics().outlineGrounding!;
    expect(receipt).toMatchObject({ totalObjectives: 36, reviewedObjectives: 36, supportedObjectives: 0, withheldObjectives: 36, complete: true });
    expect(receipt.findings).toHaveLength(36);
    expect(receipt.findings.every(row => row.materialIds.length > 0 && row.evidenceIds.length > 0 && row.reason.includes('actor'))).toBe(true);
    expect(new Set(receipt.findings.flatMap(row => row.materialIds))).toEqual(new Set(sourceRows.map(row => row._id.toHexString())));
    expect(finalReviewDiagnostics().unprocessedSections).toEqual([]);
    expect(jest.mocked(updateContentRun).mock.calls.some(([, update]) => update.structureResult)).toBe(false);
  });
});

it('persists mixed original review findings and leaves withheld evidence visible as coverage gaps', async () => {
  await withLargeOriginalReview(async base => {
    jest.mocked(completeJson).mockImplementation(async (prompt, options) => {
      if (options?.usageContext?.stage !== 'outline-source-review') return await base(prompt, options) as never;
      const checked = supportedOriginalReview(prompt);
      return { reviews: checked.reviews.map(row => Number(row.id.slice(1)) % 3 ? row : { ...row, sourceStatus: 'uncertain', sourceIds: [], coveredEvidenceIds: [],
        sourceReason: 'The original diagram does not establish the actor relationship claimed by this merged objective.' }) } as never;
    });
    const result = await generateStructure(courseId, {}, new ObjectId());
    expect(result.coverage.outlineGrounding).toMatchObject({ totalObjectives: 36, reviewedObjectives: 36, supportedObjectives: 24, withheldObjectives: 12, complete: true });
    const withheld = result.coverage.outlineGrounding!.findings.filter(row => row.status !== 'supported');
    expect(result.themes.flatMap(theme => theme.los)).toHaveLength(24);
    expect(result.coverage.unmappedEvidenceIds).toEqual(withheld.flatMap(row => row.evidenceIds));
    expect(result.coverage.materials.map(row => row.mappedObjectives)).toEqual([8, 8, 8]);
    const gapTargets = result.coverage.sourceInventory!.targets.filter(target => target.status === 'unmapped-objective');
    expect(new Set(gapTargets.flatMap(target => target.evidenceIds))).toEqual(new Set(withheld.flatMap(row => row.evidenceIds)));
    for (const id of result.coverage.unmappedEvidenceIds) {
      const point = result.evidence.find(point => point.id === id)!;
      expect(gapTargets.filter(target => target.evidenceIds.includes(id)).map(target => target.passageId)).toEqual([
        point.sourcePassageId, ...(point.supportingPassages ?? []).map(passage => passage.passageId),
      ]);
    }
    expect(result.coverage.warnings.join(' ')).toContain('12 merged learning objectives were withheld');
    expect(result.coverage.warnings.join(' ')).toContain('actor relationship');
    expect(finalReviewDiagnostics().outlineGrounding).toEqual(result.coverage.outlineGrounding);
  });
});

it('records partial review progress as incomplete when a later review provider call fails', async () => {
  await withLargeOriginalReview(async base => {
    let reviews = 0;
    jest.mocked(completeJson).mockImplementation(async (prompt, options) => {
      if (options?.usageContext?.stage === 'outline-source-review' && ++reviews === 2) throw new Error('original-review-provider-unavailable');
      return await base(prompt, options) as never;
    });
    await expect(generateStructure(courseId, {}, new ObjectId())).rejects.toThrow('original-review-provider-unavailable');
    const receipt = finalReviewDiagnostics().outlineGrounding!;
    expect(receipt.totalObjectives).toBe(36); expect(receipt.complete).toBe(false);
    expect(receipt.reviewedObjectives).toBeGreaterThan(0); expect(receipt.reviewedObjectives).toBeLessThan(receipt.totalObjectives);
    expect(receipt.supportedObjectives).toBe(receipt.reviewedObjectives); expect(receipt.withheldObjectives).toBe(0);
    expect(receipt.findings).toHaveLength(receipt.reviewedObjectives);
    expect(jest.mocked(completeJson).mock.calls.filter(([, options]) => options?.usageContext?.stage === 'outline-source-review')).toHaveLength(2);
  });
});

it.each(['before', 'after'])('rejects an original changed %s the new final-objective review', async when => {
  await withLargeOriginalReview(async base => {
    let changed = false;
    jest.mocked(completeJson).mockImplementation(async (prompt, options) => {
      const value = await base(prompt, options);
      const stage = options?.usageContext?.stage;
      const lastReview = stage === 'outline-source-review' && prompt.includes('"id":"L36"');
      if (!changed && ((when === 'before' && stage === 'outline-organization') || (when === 'after' && lastReview))) {
        chunks[0].text += ' The original changed after its frozen extraction.'; chunks[0].characterCount = chunks[0].text.length; changed = true;
      }
      return value as never;
    });
    await expect(generateStructure(courseId, {}, new ObjectId())).rejects.toThrow('structure-material-changed');
    expect(changed).toBe(true);
    const calls = jest.mocked(completeJson).mock.calls.filter(([, options]) => options?.usageContext?.stage === 'outline-source-review');
    if (when === 'before') expect(calls).toHaveLength(0);
    else {
      expect(calls.length).toBeGreaterThan(0);
      // A source change after the response invalidates that batch before its
      // verdicts can enter the checkpoint; only earlier valid rows survive.
      expect(finalReviewDiagnostics().outlineGrounding).toMatchObject({ totalObjectives: 36, complete: false });
      expect(finalReviewDiagnostics().outlineGrounding!.reviewedObjectives).toBeLessThan(36);
    }
  });
});

it('retries a malformed review once and records the exact review item and attempt before recovery', async () => {
  await withLargeOriginalReview(async base => {
    let malformed = true;
    jest.mocked(completeJson).mockImplementation(async (prompt, options) => {
      if (options?.usageContext?.stage === 'outline-source-review' && malformed) {
        malformed = false; const checked = supportedOriginalReview(prompt); return { reviews: checked.reviews.slice(1) } as never;
      }
      return await base(prompt, options) as never;
    });
    const result = await generateStructure(courseId, {}, new ObjectId());
    const reviews = jest.mocked(completeJson).mock.calls.filter(([, options]) => options?.usageContext?.stage === 'outline-source-review');
    expect(reviews.slice(0, 2).map(([, options]) => ({ item: options?.usageContext?.item, attempt: options?.usageContext?.candidateAttempt }))).toEqual([{ item: 0, attempt: 0 }, { item: 0, attempt: 1 }]);
    expect(reviews[1][0]).toContain('The review schema or objective/source identities were invalid.');
    const reviewInput = (prompt: string) => JSON.parse(prompt.split('\nThe review schema or objective/source identities were invalid.')[0].split('\n\n').at(-1)!) as { objectives: Array<{ id: string }> };
    expect(reviewInput(reviews[0][0]).objectives.length).toBeGreaterThan(1);
    expect(reviewInput(reviews[1][0]).objectives.map(row => row.id)).toEqual([reviewInput(reviews[0][0]).objectives[0].id]);
    expect(reviews[1][0].length).toBeLessThan(reviews[0][0].length);
    expect(result.coverage.synthesisInput?.validationFailures).toContainEqual({ stage: 'outline-source-review', item: 0, attempt: 0, reason: 'structure-grounding-review-incomplete' });
    expect(result.coverage.outlineGrounding).toMatchObject({ totalObjectives: 36, reviewedObjectives: 36, supportedObjectives: 36, complete: true });
    expect(finalReviewDiagnostics().synthesisInput?.validationFailures).toEqual(result.coverage.synthesisInput?.validationFailures);
  });
});

it('admits source-supported objectives with independent grouping suggestions without reporting them as source refusals', async () => {
  await withLargeOriginalReview(async base => {
    jest.mocked(completeJson).mockImplementation(async (prompt, options) => {
      if (options?.usageContext?.stage !== 'outline-source-review') return await base(prompt, options) as never;
      const checked = supportedOriginalReview(prompt);
      return { reviews: checked.reviews.map(row => row.id === 'L1' ? { ...row, topicFit: 'misgrouped',
        topicReason: 'The capability is taught, but a financing heading would organize it more clearly.' } : row) } as never;
    });
    const result = await generateStructure(courseId, {}, new ObjectId());
    expect(result.themes.flatMap(theme => theme.los)).toHaveLength(36);
    expect(result.coverage.outlineGrounding).toMatchObject({ version: 'original-final-lo-review-v2', supportedObjectives: 36,
      withheldObjectives: 0, groupingIssues: 1, complete: true });
    expect(result.coverage.warnings.join(' ')).toContain('topic-grouping suggestions');
    expect(result.coverage.warnings.join(' ')).not.toContain('were withheld');
    expect(result.coverage.unmappedEvidenceIds).toEqual([]);
  });
});

it('retains both bounded malformed-review failures without claiming a completed review', async () => {
  await withLargeOriginalReview(async base => {
    jest.mocked(completeJson).mockImplementation(async (prompt, options) => {
      if (options?.usageContext?.stage !== 'outline-source-review') return await base(prompt, options) as never;
      const checked = supportedOriginalReview(prompt.split('\nThe review schema or objective/source identities were invalid.')[0]);
      return { reviews: options.usageContext.candidateAttempt ? [checked.reviews[0], checked.reviews[0]] : checked.reviews.slice(1) } as never;
    });
    await expect(generateStructure(courseId, {}, new ObjectId())).rejects.toThrow('structure-grounding-review-identity');
    const partial = finalReviewDiagnostics().outlineGrounding!;
    expect(partial).toMatchObject({ totalObjectives: 36, withheldObjectives: 0, complete: false });
    expect(partial.reviewedObjectives).toBeGreaterThan(0); expect(partial.reviewedObjectives).toBeLessThan(36);
    expect(partial.supportedObjectives).toBe(partial.reviewedObjectives); expect(partial.findings).toHaveLength(partial.reviewedObjectives);
    expect(finalReviewDiagnostics().synthesisInput?.validationFailures).toEqual([
      { stage: 'outline-source-review', item: 0, attempt: 0, reason: 'structure-grounding-review-incomplete' },
      { stage: 'outline-source-review', item: 0, attempt: 1, reason: 'structure-grounding-review-identity' },
    ]);
    expect(jest.mocked(completeJson).mock.calls.filter(([, options]) => options?.usageContext?.stage === 'outline-source-review')).toHaveLength(2);
  });
});

it.each(['missing', 'empty', 'unknown'])('withholds a supported verdict with %s covered learning-point identities', async omission => {
  await withLargeOriginalReview(async base => {
    jest.mocked(completeJson).mockImplementation(async (prompt, options) => {
      if (options?.usageContext?.stage !== 'outline-source-review') return await base(prompt, options) as never;
      const checked = supportedOriginalReview(prompt.split('\nThe review schema or objective/source identities were invalid.')[0]);
      const { id, sourceStatus, sourceIds, sourceReason, topicFit, topicReason } = checked.reviews[0];
      const withoutCoverage = { id, sourceStatus, sourceIds, sourceReason, topicFit, topicReason };
      const invalid = omission === 'missing' ? withoutCoverage : { ...withoutCoverage, coveredEvidenceIds: omission === 'empty' ? [] : ['unseen-learning-point'] };
      return { reviews: [invalid, ...checked.reviews.slice(1)] } as never;
    });
    await expect(generateStructure(courseId, {}, new ObjectId())).rejects.toThrow();
    const diagnostics = finalReviewDiagnostics();
    expect(diagnostics.outlineGrounding).toMatchObject({ totalObjectives: 36, complete: false });
    expect(diagnostics.outlineGrounding!.reviewedObjectives).toBeGreaterThan(0);
    expect(diagnostics.outlineGrounding!.supportedObjectives).toBe(diagnostics.outlineGrounding!.reviewedObjectives);
    expect(diagnostics.outlineGrounding!.findings.every(row => row.id !== 'L1')).toBe(true);
    expect(diagnostics.synthesisInput?.validationFailures?.map(({ stage, item, attempt }) => ({ stage, item, attempt }))).toEqual([
      { stage: 'outline-source-review', item: 0, attempt: 0 }, { stage: 'outline-source-review', item: 0, attempt: 1 },
    ]);
    expect(jest.mocked(completeJson).mock.calls.filter(([, options]) => options?.usageContext?.stage === 'outline-source-review')).toHaveLength(2);
  });
});

it('removes an uncovered cited point and its material from an admitted merged objective', async () => {
  await withLargeOriginalReview(async base => {
    jest.mocked(completeJson).mockImplementation(async (prompt, options) => {
      if (options?.usageContext?.stage === 'outline-organization') {
        const value = await base(prompt, options) as ReturnType<typeof finalObjectivesPerOriginal>;
        value.themes[0].los[0].evidenceIds = ['E1', 'E13'];
        value.themes[0].los = value.themes[0].los.filter(lo => lo.evidenceIds[0] !== 'E13');
        return value as never;
      }
      if (options?.usageContext?.stage === 'outline-source-review') {
        const checked = supportedOriginalReview(prompt);
        const data: { objectives: Array<{ id: string; learningPoints: Array<{ id: string; sourceIds: string[] }> }> } = JSON.parse(prompt.split('\n\n').at(-1)!);
        const first = data.objectives.find(objective => objective.id === 'L1');
        if (first) {
          const original = first.learningPoints.find(point => point.id === 'E1')!;
          checked.reviews[0].coveredEvidenceIds = ['E1']; checked.reviews[0].sourceIds = original.sourceIds;
        }
        return checked as never;
      }
      return await base(prompt, options) as never;
    });
    const result = await generateStructure(courseId, {}, new ObjectId());
    expect(result.themes[0].los[0].evidenceIds).toEqual(['E1']);
    expect(result.themes[0].los[0].materialIds).toEqual([sourceRows[0]._id.toHexString()]);
    expect(result.coverage.unmappedEvidenceIds).toEqual(['E13']);
    expect(result.coverage.outlineGrounding).toMatchObject({ totalObjectives: 35, reviewedObjectives: 35, supportedObjectives: 35, complete: true });
    expect(result.coverage.materials.map(row => row.mappedObjectives)).toEqual([12, 11, 12]);
    expect(finalReviewDiagnostics().outlineGrounding).toEqual(result.coverage.outlineGrounding);
  });
});

describe('bounded outline workspace worker integration', () => {
  const parentId = new ObjectId(), childId = new ObjectId();
  const selection = [{ id: 'L3', evidenceIds: ['E4'] }];
  const child = () => ({ _id: childId, courseId, kind: 'structure-generation', status: 'queued', requestedBy: 'owner',
    input: { materialIds: [m1.toHexString()] }, structureRepair: { parentRunId: parentId, branchId: new ObjectId(), inputHash: 'authority' } } as WithId<StructureGenerationRun>);

  beforeEach(() => {
    jest.mocked(repair.createStructureOutlineCoverageRepair).mockReset().mockResolvedValue(child());
    jest.mocked(repair.getStructureOutlineRepairView).mockReset(); jest.mocked(repair.assertStructureRepairAdoptable).mockReset();
    jest.mocked(repair.runStructureOutlineRepair).mockReset(); jest.mocked(enqueueJob).mockReset().mockResolvedValue(undefined);
  });

  it('queues the supported coverage branch using the existing durable worker without running model stages', async () => {
    expect((await enqueueStructureOutlineCoverageRepair(courseId, parentId, 'owner', selection))._id.equals(childId)).toBe(true);
    expect(repair.createStructureOutlineCoverageRepair).toHaveBeenCalledWith(courseId, parentId, 'owner', selection, expect.any(Function));
    expect(enqueueJob).toHaveBeenCalledWith('structure.generate', { runId: childId.toHexString() });
    expect(completeJson).not.toHaveBeenCalled(); expect(repair.runStructureOutlineRepair).not.toHaveBeenCalled();
  });

  it('does not enqueue an already terminal idempotent branch', async () => {
    jest.mocked(repair.createStructureOutlineCoverageRepair).mockResolvedValue({ ...child(), status: 'completed' });
    await enqueueStructureOutlineCoverageRepair(courseId, parentId, 'owner', selection);
    expect(enqueueJob).not.toHaveBeenCalled(); expect(completeJson).not.toHaveBeenCalled();
  });

  it('persists enqueue failure on the same child without a retryable new cycle', async () => {
    jest.mocked(enqueueJob).mockRejectedValueOnce(new Error('scripted queue failure'));
    await expect(enqueueStructureOutlineCoverageRepair(courseId, parentId, 'owner', selection)).rejects.toThrow('structure-repair-enqueue-failed');
    expect(failContentRun).toHaveBeenCalledWith(childId, expect.objectContaining({ code: 'structure-repair-enqueue-failed', retryable: false }));
    expect(completeJson).not.toHaveBeenCalled();
  });

  it('supplies the real source loader and complete coverage finalizer to read and adoption helpers', async () => {
    await getStructureOutlineRepairView(courseId, parentId, { page: 2, pageSize: 5 });
    expect(repair.getStructureOutlineRepairView).toHaveBeenCalledWith(courseId, parentId, expect.any(Function), finalizeStructureCoverage, { page: 2, pageSize: 5 });
    const run = child();
    jest.mocked(repair.assertStructureRepairAdoptable).mockResolvedValue({ parentRunId: parentId.toHexString(), mode: 'coverage-wording-outline-repair-v1' });
    await expect(assertStructureRepairAdoptable(courseId, run)).resolves.toMatchObject({ mode: 'coverage-wording-outline-repair-v1' });
    expect(repair.assertStructureRepairAdoptable).toHaveBeenCalledWith(courseId, run, expect.any(Function), finalizeStructureCoverage);
    expect(completeJson).not.toHaveBeenCalled(); expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('dispatches a claimed repair through the shared worker and completes under the source fence', async () => {
    const run = { ...child(), status: 'running' as const };
    const corpus = await loadStructureCorpus(courseId, run.input.materialIds);
    const result = { themes: [], evidence: [], coverage: { sourceFingerprint: corpus.fingerprint } } as never;
    jest.mocked(claimStructureGenerationRun).mockResolvedValueOnce(run).mockResolvedValueOnce(null);
    jest.mocked(repair.runStructureOutlineRepair).mockResolvedValue(result);
    await Promise.all([runStructureGeneration(childId), runStructureGeneration(childId)]);
    expect(repair.runStructureOutlineRepair).toHaveBeenCalledTimes(1);
    expect(updateContentRun).toHaveBeenLastCalledWith(childId, { status: 'completed', structureResult: result, message: 'Draft ready for review' });
    expect(completeJson).not.toHaveBeenCalled();
  });

  it('keeps a failed coverage assessment a failed child instead of publishing a fallback result', async () => {
    const run = { ...child(), status: 'running' as const };
    jest.mocked(claimStructureGenerationRun).mockResolvedValueOnce(run); jest.mocked(getContentRun).mockResolvedValue(run);
    jest.mocked(repair.runStructureOutlineRepair).mockRejectedValueOnce(new Error('structure-repair-coverage-shortfall'));
    await runStructureGeneration(childId);
    expect(failContentRun).toHaveBeenCalledWith(childId, expect.objectContaining({ code: 'structure-repair-coverage-shortfall' }));
    expect(jest.mocked(updateContentRun).mock.calls.some(([, update]) => update.structureResult !== undefined)).toBe(false);
    expect(completeJson).not.toHaveBeenCalled();
  });
});

// Portable continuation controls: actual service/source/finalizer with only
// storage and model boundaries mocked. No retained artifacts are dependencies.
describe('continuation worker inherited budget coherence', () => {
  afterEach(() => jest.restoreAllMocks());
  async function setup() {
    const parentId = new ObjectId(), childId = new ObjectId(), checkpointId = new ObjectId();
    const corpus = await loadStructureCorpus(courseId), source = corpus.sections[0]!;
    const points = [{ id: 'E1', objective: 'Explain the stated original principle.', materialId: source.materialId,
      materialName: source.materialName, chunkIndex: source.chunkIndex, quote: source.text }];
    const themes = [{ name: 'Original principle', los: [{ name: points[0]!.objective, evidenceIds: ['E1'], materialIds: [source.materialId] }] }];
    const budget = { version: 1 as const, estimator: 'utf8-bytes-conservative-v1' as const, retryVisibility: 'unknown' as const,
      limitScope: 'process' as const, observedSends: 20, estimatedInputTokens: 800000, reservedOutputTokens: 200000,
      admissionTokens: 1000000, pendingSends: 0, accounting: 'conservative-reservations-v1' as const,
      reportedInputTokens: null, reportedOutputTokens: null, usageCompleteness: 'unknown' as const,
      queueWaitMs: 0, executionMs: 0, rejectedSends: 0,
      logical: { generatorAttempts: 0, repairCycles: 0, evidenceExpansions: 0, limits: { generatorAttempts: 2, repairCycles: 1, evidenceExpansions: 1 } },
      limits: { maxSends: 100, maxInputTokens: 48000, maxOutputTokens: 6000, maxEstimatedTokens: 2000000 } };
    const cachedSources = corpus.sections.map(section => ({ ...section, id: section.localId ?? section.id }));
    const cached = cachedSources.map(section => validateSourceExtraction({ sections: [{ sectionId: section.id,
      objectives: [{ name: 'Explain the stated original principle.', passageId: `${section.id}.P1` }], knowledge: [] }] }, [section], true)[0]!);
    const model = { model: 'test-model', reasoningEffort: 'medium' as const };
    const body: StructureReviewCheckpointBody = { version: 'exact-outline-review-v1', courseId: courseId.toHexString(), rootRunId: parentId.toHexString(),
      origin: 'production-proposal-v1', options: {}, corpus, themes, evidence: points,
      extractions: corpus.sections.map((section, i) => ({ sectionId: section.id, row: cached[i]!, reused: true })),
      excludedSections: [], cache: { hits: 3, misses: 0, reusedSections: 3, extractedSections: 0 },
      batches: planOutlineGrounding(themes, points, corpus.sections, 48000), reviewInputLimit: 48000, model,
      providerIdentityHash: reviewCheckpoint.structureReviewHash({ provider: env.llmProvider, endpoint: env.llmEndpoint }),
      protocolHash: outlineGroundingProtocolHash(), baseBudget: structuredClone(budget) };
    const checkpoint = { _id: checkpointId, courseId, runId: parentId, hash: reviewCheckpoint.structureReviewHash(body), body, createdAt: new Date() };
    const progress: StructureReviewProgress = { courseId, checkpointId, checkpointHash: checkpoint.hash, ownerRunId: childId,
      continuationRunId: childId, continuationStartReservations: 20, continuationBaseBudget: structuredClone(budget),
      findings: [], attempts: {}, failures: [], unresolvedDispatchIds: [], pendingNative: [], revision: 0,
      usedTokens: 1000000, reservations: 20, maxTokens: 2000000, maxSends: 100, updatedAt: new Date() };
    const run = { _id: childId, kind: 'structure-generation', status: 'running', courseId,
      structureReview: { checkpointId, checkpointHash: checkpoint.hash, parentRunId: parentId }, input: {} };
    jest.mocked(getContentRun).mockResolvedValue(run as never);
    jest.mocked(reviewCheckpoint.readStructureReviewCheckpoint).mockResolvedValue(checkpoint);
    jest.mocked(reviewCheckpoint.getStructureReviewProgress).mockImplementation(async () => progress as never);
    jest.mocked(completeJson).mockImplementation(async prompt => {
      const packet = JSON.parse(prompt.slice(prompt.lastIndexOf('\n\n') + 2)) as { objectives: Array<{ id: string; sourceIds: string[]; learningPoints: Array<{ id: string }> }> };
      return { reviews: packet.objectives.map(row => ({ id: row.id, sourceStatus: 'supported', sourceIds: row.sourceIds,
        coveredEvidenceIds: row.learningPoints.map(point => point.id), sourceReason: 'SCRIPTED original-source control.', topicFit: 'fits', topicReason: 'SCRIPTED.' })) } as never;
    });
    return { body, progress, childId, observer: { model, record: async () => {} } };
  }
  const beforeAnyDispatch = () => {
    expect(completeJson).not.toHaveBeenCalled(); expect(reviewCheckpoint.claimStructureReviewDispatch).not.toHaveBeenCalled();
    expect(reviewCheckpoint.reserveStructureReviewSend).not.toHaveBeenCalled(); expect(updateContentRun).not.toHaveBeenCalled();
  };
  it.each((['maxSends', 'maxInputTokens', 'maxOutputTokens', 'maxEstimatedTokens'] as const).flatMap(key => [-1, 1].map(delta => ({ key, delta }))))('refuses changed continuation-base $key ($delta) before model/diagnostic work', async ({ key, delta }) => {
    const row = await setup(); row.progress.continuationBaseBudget!.limits[key] += delta;
    await expect(continueStructureReview(row.childId, row.observer)).rejects.toThrow('structure-review-budget-limits-changed'); beforeAnyDispatch();
  });
  it('refuses diagnostic256 versus immutable100 without normalizing the stored receipt', async () => {
    const row = await setup(); row.progress.continuationBaseBudget!.limits.maxSends = 256;
    await expect(continueStructureReview(row.childId, row.observer)).rejects.toThrow('structure-review-budget-limits-changed');
    expect(row.progress.continuationBaseBudget!.limits.maxSends).toBe(256); beforeAnyDispatch();
  });
  it('refuses reverse diagnostic100 versus immutable256', async () => {
    const row = await setup(); row.body.baseBudget.limits.maxSends = 256; row.progress.maxSends = 256;
    await expect(continueStructureReview(row.childId, row.observer)).rejects.toThrow('structure-review-budget-limits-changed'); beforeAnyDispatch();
  });
  it.each(['maxSends', 'maxTokens'] as const)('does not trust coherent changed receipt+progress %s instead of immutable checkpoint limits', async key => {
    const row = await setup(); row.progress[key]++;
    if (key === 'maxSends') row.progress.continuationBaseBudget!.limits.maxSends++; else row.progress.continuationBaseBudget!.limits.maxEstimatedTokens++;
    await expect(continueStructureReview(row.childId, row.observer)).rejects.toThrow('structure-review-budget-limits-changed'); beforeAnyDispatch();
  });
  it('keeps coherent historical-selector-absent continuation output and exact cumulative ceilings', async () => {
    const row = await setup(); delete row.body.baseBudget.accounting; delete row.progress.continuationBaseBudget!.accounting;
    const result = await continueStructureReview(row.childId, row.observer);
    expect(completeJson).toHaveBeenCalledTimes(1); expect(result.coverage.budget.limits).toEqual(row.body.baseBudget.limits);
    expect(row.body.options.capabilityDistinctnessProtocol).toBeUndefined(); expect(row.progress.continuationBaseBudget!.accounting).toBeUndefined();
  });

  it('rechecks a changed durable ceiling on the next currentness read before the first dispatch', async () => {
    const row = await setup(); let reads = 0;
    jest.mocked(reviewCheckpoint.getStructureReviewProgress).mockImplementation(async () => {
      if (++reads === 2) row.progress.continuationBaseBudget!.limits.maxSends = 256;
      return row.progress as never;
    });
    await expect(continueStructureReview(row.childId, row.observer)).rejects.toThrow('structure-review-budget-limits-changed');
    expect(reads).toBe(2); beforeAnyDispatch();
  });

  it('never widens a coherent smaller inherited worker input cap', async () => {
    const row = await setup(); row.body.baseBudget.limits.maxInputTokens = 12000; row.progress.continuationBaseBudget!.limits.maxInputTokens = 12000;
    const complete = jest.mocked(completeJson).getMockImplementation()!; let observed: number | undefined;
    jest.mocked(completeJson).mockImplementation(async (...args) => { observed = currentAuthoringBudget()?.snapshot().limits.maxInputTokens; return complete(...args); });
    await continueStructureReview(row.childId, row.observer);
    expect(observed).toBe(12000);
  });

  it('never widens a coherent smaller inherited worker output cap to the required6000', async () => {
    const row = await setup(); row.body.baseBudget.limits.maxOutputTokens = 4000; row.progress.continuationBaseBudget!.limits.maxOutputTokens = 4000;
    await expect(continueStructureReview(row.childId, row.observer)).rejects.toThrow('structure-review-budget-exhausted'); beforeAnyDispatch();
  });
});
