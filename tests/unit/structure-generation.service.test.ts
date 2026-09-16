jest.mock('../../server/src/components/mongodb/collections', () => ({ materialsCol: jest.fn(), materialChunksCol: jest.fn(), themesCol: jest.fn(), losCol: jest.fn(), contentRunsCol: jest.fn() }));
jest.mock('../../server/src/components/genai/llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../server/src/components/jobs', () => ({ defineJob: jest.fn(), enqueueJob: jest.fn() }));
jest.mock('../../server/src/services/admin.service', () => ({ utilityStepConfig: jest.fn(async () => ({ model: 'test-model' })) }));
jest.mock('../../server/src/services/content-runs.service', () => ({ assertContentRunActive: jest.fn(), updateContentRun: jest.fn(), createStructureGenerationRun: jest.fn(), getContentRun: jest.fn(), failContentRun: jest.fn() }));
import { ObjectId } from 'mongodb';
import { materialsCol, materialChunksCol, themesCol, losCol, contentRunsCol } from '../../server/src/components/mongodb/collections';
import { completeJson } from '../../server/src/components/genai/llm';
import { assertContentRunActive, updateContentRun, createStructureGenerationRun } from '../../server/src/services/content-runs.service';
import { generateStructure, loadStructureCorpus, partialStructure, validateExtraction, validateOutline, enqueueStructureGeneration, sourcePassages, validateReferencedExtraction } from '../../server/src/services/structure-generation.service';
import type { MaterialChunk } from '../../server/src/types/domain';
import type { StructureEvidence } from '../../server/src/types/structure';
const courseId = new ObjectId(); const m1 = new ObjectId(); const m2 = new ObjectId();
let chunks: MaterialChunk[];
let sourceRows: Array<{ _id: ObjectId; name: string }>;
let sourceFilter: unknown;
const cursor = (rows: () => unknown[]) => { const c = { toArray: jest.fn(async () => rows()), sort: jest.fn() }; c.sort.mockReturnValue(c); return c; };
beforeEach(() => {
  jest.clearAllMocks(); jest.mocked(completeJson).mockReset();
  sourceRows = [{ _id: m1, name: 'Lecture.pdf' }, { _id: m2, name: 'Assignment.pdf' }];
  chunks = [
    { courseId, materialId: m1, index: 0, text: 'Newton describes inertia.', characterCount: 24, createdAt: new Date() },
    { courseId, materialId: m1, index: 1, text: 'Late chapter: determine inclined-plane acceleration.', characterCount: 51, createdAt: new Date() },
    { courseId, materialId: m2, index: 0, text: 'Use vector decomposition in force diagrams.', characterCount: 43, createdAt: new Date() },
  ];
  jest.mocked(materialsCol).mockReturnValue({ find: (filter: unknown) => { sourceFilter = filter; return cursor(() => sourceRows); } } as never);
  jest.mocked(materialChunksCol).mockReturnValue({ find: () => cursor(() => chunks) } as never);
  jest.mocked(themesCol).mockReturnValue({ find: () => cursor(() => []) } as never);
  jest.mocked(losCol).mockReturnValue({ find: () => cursor(() => []) } as never);
  jest.mocked(contentRunsCol).mockReturnValue({ findOne: jest.fn(async () => null) } as never);
  jest.mocked(assertContentRunActive).mockResolvedValue();
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
it('requires every section to be considered and verifies quotes against its own source', async () => {
  const { sections } = await loadStructureCorpus(courseId);
  expect(() => validateExtraction({ sections: [] }, sections)).toThrow('Every section');
  const response = { sections: sections.map(s => ({ sectionId: s.id, objectives: [{ name: 'Explain the concept', quote: s.text }] })) };
  expect(validateExtraction(response, sections).sections).toHaveLength(3);
  response.sections[0].objectives[0].quote = sections[2].text;
  expect(() => validateExtraction(response, sections)).toThrow('verbatim');
});
it('rejects invented source IDs, duplicate LOs and ignored explicit counts', () => {
  const outline = { themes: [{ name: 'Mechanics', los: [{ name: 'Calculate acceleration', evidenceIds: ['E1'] }] }] };
  expect(validateOutline(outline, evidence, {})[0].los[0].materialIds).toEqual([m1.toHexString()]);
  expect(() => validateOutline(outline, evidence, { topicCount: 2 })).toThrow('exactly 2');
  outline.themes[0].los[0].evidenceIds = ['invented'];
  expect(() => validateOutline(outline, evidence, {})).toThrow('evidence IDs');
  outline.themes[0].los[0].evidenceIds = ['E1']; outline.themes[0].los.push(outline.themes[0].los[0]);
  expect(() => validateOutline(outline, evidence, {})).toThrow('duplicate');
});
it('projects partial topic and LO strings but never model reasoning or metadata', () => {
  expect(partialStructure('{"reasoning":"SECRET","themes":[{"name":"Force","los":[{"name":"Calculate acc')).toEqual({ themes: [{ name: 'Force', los: [{ name: 'Calculate acc' }] }] });
  expect(partialStructure('')).toEqual({ themes: [] });
});
it('streams real provider fragments, maps both sources, and reports unmapped evidence instead of claiming completeness', async () => {
  jest.mocked(completeJson).mockImplementation(async (prompt, options) => {
    if (prompt.startsWith('Extract')) return { sections: chunks.map((_c, i) => ({ sectionId: `S${i + 1}`, objectives: [{ name: `Explain concept ${i + 1}`, passageId: `S${i + 1}.P1` }] })) } as never;
    expect(prompt).toContain('Decide the number of topics'); expect(prompt).toContain('Explain concept 2');
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
