import { readFileSync } from 'node:fs';
import { auditOutlineExtraction } from '../../scripts/quality-lab/audit-outline-extraction';
import { recoverOutlineFunctions, type OutlineSection } from '../../scripts/quality-lab/outline-controls';

const functions = recoverOutlineFunctions(readFileSync('server/src/services/structure-generation.service.ts', 'utf8'),
  readFileSync('server/src/services/structure-source-inventory.ts', 'utf8')).functions;
const sections: OutlineSection[] = ['A', 'B'].map((materialId, index) => ({ id: `S${index + 1}`, localId: 'C1.S1', materialId,
  materialName: `Chapter ${materialId}`, chunkIndex: 0, text: 'Newton describes inertia.' }));
const prompt = (index = 0) => functions.sourceExtractionPrompt([{ ...sections[index]!, id: 'C1.S1' }], {});
const output = (passageId = 'C1.S1.P1') => ({ sections: [{ sectionId: 'C1.S1', objectives: [{ name: 'Explain inertia using the stated principle', passageId }], knowledge: [], passageDispositions: [] }] });
const pair = (id: string, item = 0, attempt = 0, raw: unknown = output()) => [
  { phase: 'prepared', stage: 'source-extraction', callId: id, item, attempt,
    prompt: prompt(item) + (attempt ? '\nCorrect only the remaining sections. Use its original passage IDs.' : '') },
  { phase: 'output', stage: 'source-extraction', callId: id, item, attempt, output: raw },
];

it('measures exact invalid-reference recovery without counting the corrected section twice', () => {
  const audit = auditOutlineExtraction({ events: [...pair('first', 0, 0, output('invented')), ...pair('second', 0, 1)], sections, options: {}, functions });
  expect(audit).toMatchObject({ capturedRequests: 2, completedLogicalOutputs: 2, rowObservations: 2,
    invalidRowObservations: 1, uniqueValidatedSections: 1, uniqueSectionsWithAnInvalidObservation: 1, uniqueStructurallyRecoveredSections: 1 });
  expect(audit.stillUnvalidatedAfterAnInvalidObservation).toEqual([]);
  expect(audit.calls[0]!.rows[0]!.error).toContain('Use a passage ID');
});

it('keeps identical section aliases in two different materials independent', () => {
  const audit = auditOutlineExtraction({ events: [...pair('chapter-a'), ...pair('chapter-b', 1)], sections, options: {}, functions });
  expect(audit.uniqueValidatedSections).toBe(2);
  expect(audit.calls.flatMap(call => call.rows.map(row => row.key))).toEqual(['A:C1.S1', 'B:C1.S1']);
});

it('records an unfinished request without inventing a failed or zero-dispatch result', () => {
  const audit = auditOutlineExtraction({ events: pair('pending').slice(0, 1), sections, options: {}, functions });
  expect(audit).toMatchObject({ capturedRequests: 1, completedLogicalOutputs: 0, withoutCompletedOutput: 1, uniqueValidatedSections: 0 });
  expect(audit.calls[0]!.status).toBe('no-completed-output');
});

it('records unknown output rows as ignored while rejecting duplicate requested rows', () => {
  const raw = output(); raw.sections.push({ ...raw.sections[0]!, sectionId: 'foreign' });
  const valid = auditOutlineExtraction({ events: pair('extra', 0, 0, raw), sections, options: {}, functions });
  expect(valid.uniqueValidatedSections).toBe(1); expect(valid.calls[0]!.extraRowIds).toEqual(['foreign']);
  raw.sections.push(raw.sections[0]!);
  const duplicate = auditOutlineExtraction({ events: pair('duplicate', 0, 0, raw), sections, options: {}, functions });
  expect(duplicate.uniqueValidatedSections).toBe(0); expect(duplicate.stillUnvalidatedAfterAnInvalidObservation).toEqual(['A:C1.S1']);
});

it.each(['source', 'guidance', 'anchor', 'duplicate-call'])('refuses changed %s controls rather than auditing a different request', defect => {
  const events = pair('first'); const originals = structuredClone(sections); let options = {};
  if (defect === 'source') originals[0]!.text = 'A different original statement.';
  if (defect === 'guidance') options = { guidance: 'A changed objective scope' };
  if (defect === 'anchor') events[0]!.item = 1;
  if (defect === 'duplicate-call') events.push(...pair('first'));
  expect(() => auditOutlineExtraction({ events, sections: originals, options, functions })).toThrow(/outline-extraction-audit-/);
});
