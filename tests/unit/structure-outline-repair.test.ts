import { ObjectId } from 'mongodb';
import { buildOutlineWordingRepairBody, assertOutlineWordingRepairDelta, createOutlineWordingRepairPrompt, validateOutlineWordingRepairProposal } from '../../server/src/services/structure-outline-repair';
import { structureRepairFixture } from './fixtures/structure-repair';

it('uses only full own originals and distinguishes precision and unmarked activity from answer certainty', () => {
  const { body, progress } = structureRepairFixture();
  body.options.guidance = 'Separate conceptual explanation from numerical calculation; preserve explicit source terminology.';
  body.options.level = 'introductory'; body.options.emphasis = 'conceptual';
  const prompt = createOutlineWordingRepairPrompt(body, [progress.findings[0]]);
  expect(prompt).toContain(body.corpus.sections[0].text); expect(prompt).not.toContain(body.corpus.sections[1].text);
  expect(prompt).toContain('clarification of shorthand'); expect(prompt).toContain('does not establish its unique correct answer');
  expect(prompt).toContain('without imposing a hard word count');
  expect(prompt).toContain(body.options.guidance); expect(prompt).toContain('"level":"introductory","emphasis":"conceptual"');
  expect(prompt).toContain('cannot add missing source support, force a positive verdict');
  expect(() => createOutlineWordingRepairPrompt(body, [progress.findings[2]])).toThrow('target-finding');
});

it('accepts one proposed wording and an honest no-repair outcome without adding evidence or verdict fields', () => {
  const { body } = structureRepairFixture();
  const rows = validateOutlineWordingRepairProposal({ repairs: [
    { id: 'L1', status: 'proposed', name: 'Value the rental alternative as expected present value of after-tax lease revenues.', reason: 'Clarify the taught valuation condition.' },
    { id: 'L2', status: 'no-repair', reason: 'No defensible minimal change.' },
  ] }, body, ['L1', 'L2']);
  expect(rows[1].name).toBe(body.batches[0].objectives[1].name);
  for (const raw of [{ repairs: [{ id: 'foreign', status: 'no-repair', reason: 'No.' }] }, { repairs: [] },
    { repairs: [{ id: 'L1', status: 'proposed', name: body.batches[0].objectives[0].name, reason: 'Same.' }] },
    { repairs: [{ id: 'L1', status: 'proposed', name: 'A changed original-source capability.', reason: 'New.', sourceStatus: 'supported' }] },
    { repairs: [{ id: 'L1', status: 'proposed', name: body.batches[0].objectives[2].name, reason: 'Duplicate sibling.' }] }]) {
    expect(() => validateOutlineWordingRepairProposal(raw, body, ['L1'])).toThrow();
  }
});

it('changes only selected wording and content hash; preserves all sibling bindings and original evidence bytes', () => {
  const { body } = structureRepairFixture(); const before = JSON.stringify(body);
  const next = buildOutlineWordingRepairBody(body, [{ id: 'L1', name: 'Value after-tax rental cash flows using expected present value.' }], new ObjectId().toHexString(), body.baseBudget);
  expect(next.batches[0].objectives[0].contentHash).not.toBe(body.batches[0].objectives[0].contentHash);
  expect(next.batches[0].objectives.slice(1)).toEqual(body.batches[0].objectives.slice(1));
  expect(JSON.stringify(next.evidence)).toBe(JSON.stringify(body.evidence)); expect(JSON.stringify(body)).toBe(before);
  expect(() => assertOutlineWordingRepairDelta(body, next, ['L1'])).not.toThrow();
  const tampered = JSON.parse(JSON.stringify(next)); tampered.evidence[0].quote = 'Invented original.';
  expect(() => assertOutlineWordingRepairDelta(body, tampered, ['L1'])).toThrow('source-or-options-changed');
});

it('rejects alias/evidence/topic/sibling changes and any cost reset rather than treating them as wording repair', () => {
  const { body } = structureRepairFixture();
  for (const defect of ['alias', 'sibling', 'topic', 'cost']) {
    const next = buildOutlineWordingRepairBody(body, [{ id: 'L1', name: 'Clarify present value of after-tax lease cash flows.' }], new ObjectId().toHexString(), body.baseBudget);
    if (defect === 'alias') next.batches[0].objectives[0].sourceIds = ['foreign'];
    if (defect === 'sibling') next.batches[0].objectives[2].name = 'Unrelated rewrite';
    if (defect === 'topic') next.themes[0].name = 'Another topic';
    if (defect === 'cost') next.baseBudget.admissionTokens = 0;
    expect(() => assertOutlineWordingRepairDelta(body, next, ['L1'])).toThrow();
  }
});
