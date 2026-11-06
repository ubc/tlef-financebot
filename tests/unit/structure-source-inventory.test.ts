import { assertStructurePassageAccounting, structurePassageCues, structureSourceInventory, structureNoObjectiveWarning } from '../../server/src/services/structure-source-inventory';
import type { SourceExtractionSection } from '../../server/src/types/source-evidence';

const passages = [{ id: 'C1.S1.P1', text: 'Variance measures spread.' }, { id: 'C1.S1.P2', text: 'Standard deviation is the square root of variance.' }];
const row = (): SourceExtractionSection => ({ sectionId: 'C1.S1', objectives: [{ name: 'Distinguish variance and standard deviation', passageId: passages[0].id, quote: passages[0].text }], knowledge: [] });

it('exposes a dropped later numerical relationship despite a valid first quote', () => {
  expect(() => assertStructurePassageAccounting(row(), passages)).toThrow('C1.S1.P2');
  const corrected = row(); corrected.objectives[0].supportingPassages = [{ passageId: passages[1].id, quote: passages[1].text }];
  expect(() => assertStructurePassageAccounting(corrected, passages)).not.toThrow();
});

it.each(['C2.S1.P2', 'C1.S1.P1'])('rejects unknown or conflicting exclusions %s', passageId => {
  expect(() => assertStructurePassageAccounting({ ...row(), passageDispositions: [{ passageId, disposition: 'context', reason: 'Same skill.' }] }, passages)).toThrow('unknown, duplicate or conflicting');
});

it('keeps unreadable visual relationships explicit instead of inferring values from labels', () => {
  const excluded: SourceExtractionSection = { sectionId: 'C1.S1', objectives: [], knowledge: [], skipReason: 'Chart without readable values.',
    passageDispositions: [{ passageId: 'C1.S1.P1', disposition: 'visual-review', reason: 'Axes and labels survive, data points do not.' }] };
  const section = { id: 'S1', localId: 'C1.S1', materialId: 'chart', materialName: 'Chapter 10.pdf', chunkIndex: 0, text: 'Dividends and Buybacks chart, 1988–2024.' };
  const inventory = structureSourceInventory({ sections: [section], extractions: [{ source: section, row: excluded }], evidence: [], themes: [],
    passages: source => [{ id: `${source.id}.P1`, text: source.text }] });
  expect(inventory).toMatchObject({ totalPassages: 1, mappedPassages: 0, materialsWithoutMappedObjectives: ['chart'],
    targets: [{ cues: ['visual-relationship'], status: 'visual-review', reason: 'Axes and labels survive, data points do not.' }] });
});

it('retains every chapter including unmapped and unreviewed originals', () => {
  const sections = ['chapter1', 'chapter2'].map((materialId, index) => ({ id: `S${index + 1}`, localId: 'C1.S1', materialId, materialName: materialId, chunkIndex: 0, text: 'A supported skill.' }));
  const evidence = sections.map((source, index) => ({ id: `E${index + 1}`, objective: 'Apply the original skill', materialId: source.materialId, materialName: source.materialName, chunkIndex: 0,
    quote: source.text, sourcePassageId: 'C1.S1.P1' }));
  const inventory = structureSourceInventory({ sections, extractions: [], evidence, themes: [{ name: 'First chapter', los: [{ name: 'Apply the skill', evidenceIds: ['E1'], materialIds: ['chapter1'] }] }],
    passages: source => [{ id: `${source.id}.P1`, text: source.text }, { id: `${source.id}.P2`, text: 'A later formula: y = x².' }] });
  expect(inventory.totalPassages).toBe(4);
  expect(inventory.targets.map(target => target.status)).toEqual(['mapped', 'unreviewed', 'unmapped-objective', 'unreviewed']);
  expect(inventory.materialsWithoutMappedObjectives).toEqual(['chapter2']);
});

it('flags evidence overlap without asserting that two capabilities are semantically duplicates', () => {
  const inventory = structureSourceInventory({ sections: [], extractions: [], evidence: [], passages: () => [], themes: [{ name: 'Risk', los: [
    { name: 'Explain risk', materialIds: [], evidenceIds: ['E1', 'E2'] }, { name: 'Calculate risk', materialIds: [], evidenceIds: ['E1', 'E2'] }] }] });
  expect(inventory.potentialRedundantObjectives).toHaveLength(1);
});

it('detects formula, numerical convention and diagram actor review cues without treating them as proof', () => {
  expect(structurePassageCues('Variance = σ². Standard deviation is the square root of variance.')).toEqual(['formula', 'numerical-relationship']);
  expect(structurePassageCues('FIRMS\nSectors and countries\nINVESTORS\nHold many stocks')).toEqual(['visual-relationship']);
  expect(structurePassageCues('Course title and author')).toEqual([]);
});

it('reports mixed visual/context/administrative passage labels without classifying every empty section as non-instructional', () => {
  const empty = (sectionId: string, disposition: 'visual-review' | 'context' | 'non-instructional'): SourceExtractionSection => ({ sectionId,
    objectives: [], knowledge: [], skipReason: 'Recorded source-specific reason.', passageDispositions: [{ passageId: `${sectionId}.P1`, disposition, reason: 'Recorded reason.' }] });
  const warning = structureNoObjectiveWarning([row(), empty('S2', 'visual-review'), empty('S3', 'context'), empty('S4', 'non-instructional')]);
  expect(warning).toContain('3 sections have no extracted objectives');
  expect(warning).toContain('1 visual-review, 1 context, 1 non-instructional');
  expect(warning).not.toContain('sections were classified as non-instructional');
});

it('leaves missing historical dispositions explicit and emits no exclusion warning for a fully extracted set', () => {
  expect(structureNoObjectiveWarning([row()])).toBeUndefined();
  expect(structureNoObjectiveWarning([{ sectionId: 'S2', objectives: [], knowledge: [], skipReason: 'Legacy reason.' }]))
    .toContain('1 of these sections have no recorded passage dispositions');
});
