import { createHash } from 'node:crypto';
import { z } from 'zod';

// Synthetic assertions exercise contracts and deterministic decisions. They are
// neither teacher labels nor evidence that a model can judge free-text support.
const id = z.string().min(1).max(128);
const ids = z.array(id).max(100);
const notation = z.object({ conceptId: id, symbol: z.string().min(1).max(80), definition: z.string().min(1).max(500) }).strict();
const passage = z.object({
  passageId: id, page: z.number().int().positive().optional(), text: z.string().min(1).max(8000),
  supportedConceptIds: ids, notation: z.array(notation).max(20),
}).strict();
const material = z.object({
  sourceId: id, contentHash: z.string().regex(/^[a-f0-9]{64}$/), parserVersion: id,
  passages: z.array(passage).min(1).max(50),
}).strict();

export const PedagogicalFingerprintSchema = z.object({
  conceptIds: ids.min(1), cognitiveTask: id, solutionPath: ids.min(1), targetMisconception: id,
  familyId: id,
}).strict();
const content = z.object({
  type: z.enum(['mcq', 'true-false']), stem: z.string().min(1).max(4000),
  options: z.array(z.object({ key: id, text: z.string().min(1).max(1000), role: z.enum(['correct', 'distractor']) }).strict()).min(2).max(4),
  correctExplanation: z.string().min(1).max(2000),
}).strict();
const question = z.object({
  questionId: id, version: id, state: z.enum(['approved', 'draft']), variantOf: id.optional(),
  content, fingerprint: PedagogicalFingerprintSchema,
}).strict();
const candidate = z.object({
  candidateId: id, content, dependencyConceptIds: ids.min(1), evidenceIds: ids,
  notation: z.array(notation).max(20), fingerprint: PedagogicalFingerprintSchema,
}).strict();
const expectation = z.object({
  candidateId: id,
  sourceScope: z.enum(['supported', 'unsupported', 'insufficient-evidence']),
  notation: z.enum(['consistent', 'inconsistent', 'not-applicable']),
  novelty: z.enum(['independent', 'variant', 'exact-duplicate']),
  relatedQuestionIds: ids, missingConceptIds: ids,
  rationale: z.string().min(1).max(2000),
}).strict();

export const SyntheticQualityFixtureSchema = z.object({
  caseId: id,
  category: z.enum(['source-scope', 'notation', 'novelty', 'thin-lo', 'false-statement']),
  courseScopeId: id, loId: id, loVersion: id, objectiveText: z.string().min(1).max(1000),
  materials: z.array(material).min(1).max(10),
  allowedMaterialIds: ids.min(1),
  prerequisites: z.array(z.object({ prerequisiteId: id, sourceIds: ids.min(1) }).strict()).max(20),
  allowedPrerequisiteIds: ids,
  bankSnapshot: z.array(question).max(30), batchSnapshot: z.array(question).max(30),
  request: z.object({
    type: z.enum(['mcq', 'true-false']), difficulty: z.enum(['easy', 'medium', 'hard']),
    independentSlots: z.number().int().min(0).max(20), intentionalVariantSlots: z.number().int().min(0).max(20),
    teacherInstruction: z.string().max(2000).optional(),
  }).strict().refine(value => value.independentSlots + value.intentionalVariantSlots > 0, 'At least one slot is required.'),
  rubricVersion: z.literal('synthetic-grounding-v1'),
  expectationOrigin: z.literal('fixture-authored'), labels: z.null(),
  expectedChecks: z.array(z.string().min(1).max(1000)).min(1).max(10),
  candidates: z.array(candidate).min(1).max(10),
  expectations: z.array(expectation).min(1).max(10),
  supplyExpectation: z.object({
    basis: z.literal('authored-task-inventory'),
    independentTaskIds: ids, independentCandidates: z.number().int().nonnegative(),
    variantCandidates: z.number().int().nonnegative(), unmetIndependentSlots: z.number().int().nonnegative(),
  }).strict().optional(),
}).strict().superRefine((fixture, context) => {
  const fail = (message: string, path: Array<string | number> = []): void => context.addIssue({ code: z.ZodIssueCode.custom, message, path });
  const unique = (values: string[], field: string): void => {
    if (new Set(values).size !== values.length) fail(`Duplicate identifiers in ${field}.`, [field]);
  };
  unique(fixture.materials.map(value => value.sourceId), 'materials');
  unique(fixture.materials.flatMap(value => value.passages.map(item => item.passageId)), 'passages');
  unique(fixture.allowedMaterialIds, 'allowedMaterialIds');
  unique(fixture.allowedPrerequisiteIds, 'allowedPrerequisiteIds');
  unique(fixture.prerequisites.map(value => value.prerequisiteId), 'prerequisites');
  unique(fixture.bankSnapshot.map(value => value.questionId), 'bankSnapshot');
  unique(fixture.batchSnapshot.map(value => value.questionId), 'batchSnapshot');
  unique(fixture.candidates.map(value => value.candidateId), 'candidates');
  unique(fixture.expectations.map(value => value.candidateId), 'expectations');
  const sources = new Set(fixture.materials.map(value => value.sourceId));
  for (const sourceId of fixture.allowedMaterialIds) if (!sources.has(sourceId)) fail('Allowed material is absent from the frozen snapshot.', ['allowedMaterialIds']);
  for (const prerequisite of fixture.prerequisites) for (const sourceId of prerequisite.sourceIds) {
    if (!sources.has(sourceId)) fail('Prerequisite material is absent from the frozen snapshot.', ['prerequisites']);
  }
  const prerequisites = new Set(fixture.prerequisites.map(value => value.prerequisiteId));
  for (const prerequisiteId of fixture.allowedPrerequisiteIds) if (!prerequisites.has(prerequisiteId)) fail('Allowed prerequisite is absent from the snapshot.', ['allowedPrerequisiteIds']);
  for (const [index, source] of fixture.materials.entries()) {
    if (source.contentHash !== hashSyntheticSource(source.passages)) fail('Source content hash does not match its original text.', ['materials', index, 'contentHash']);
    for (const item of source.passages) for (const symbol of item.notation) {
      if (!item.supportedConceptIds.includes(symbol.conceptId)) fail('A notation rule must reference a supported concept in its passage.', ['materials', index, 'passages']);
    }
  }
  const candidates = new Set(fixture.candidates.map(value => value.candidateId));
  if (fixture.expectations.length !== fixture.candidates.length) fail('Every candidate needs exactly one authored expectation.', ['expectations']);
  const questionIds = new Set([...fixture.bankSnapshot, ...fixture.batchSnapshot].map(value => value.questionId));
  for (const item of fixture.expectations) {
    if (!candidates.has(item.candidateId)) fail('Expectation references an unknown candidate.', ['expectations']);
    for (const questionId of item.relatedQuestionIds) if (!questionIds.has(questionId)) fail('Expected comparison question is absent from memory.', ['expectations']);
  }
  for (const item of [...fixture.bankSnapshot, ...fixture.batchSnapshot]) {
    if (item.variantOf && !questionIds.has(item.variantOf)) fail('Variant lineage references an absent comparison question.', ['bankSnapshot']);
  }
  for (const item of [...fixture.bankSnapshot, ...fixture.batchSnapshot, ...fixture.candidates]) {
    const keys = item.content.options.map(option => option.key);
    if (new Set(keys).size !== keys.length || item.content.options.filter(option => option.role === 'correct').length !== 1) fail('Question options require unique keys and one intended correct option.', ['candidates']);
    if (item.content.type === 'true-false' && keys.length !== 2 || item.content.type === 'mcq' && keys.length !== 4) fail('Question type and option count disagree.', ['candidates']);
  }
  if (fixture.candidates.some(item => item.content.type !== fixture.request.type)) fail('Candidate format must match the requested format.', ['candidates']);
  if (fixture.supplyExpectation) {
    const expected = fixture.supplyExpectation;
    const independents = fixture.expectations.filter(item => item.sourceScope === 'supported' && item.notation !== 'inconsistent' && item.novelty === 'independent');
    const taskIds = new Set(independents.flatMap(item => {
      const authored = fixture.candidates.find(value => value.candidateId === item.candidateId);
      return authored ? [authored.fingerprint.cognitiveTask] : [];
    }));
    if (expected.independentCandidates !== taskIds.size || new Set(expected.independentTaskIds).size !== taskIds.size || expected.independentTaskIds.some(task => !taskIds.has(task))) fail('Supply inventory must count distinct supported authored tasks.', ['supplyExpectation']);
    if (expected.variantCandidates !== fixture.expectations.filter(item => item.novelty === 'variant').length) fail('Variant supply count disagrees with authored expectations.', ['supplyExpectation']);
    if (expected.unmetIndependentSlots !== Math.max(0, fixture.request.independentSlots - expected.independentCandidates)) fail('Independent shortfall must retain the requested-slot denominator.', ['supplyExpectation']);
  }
});

export const SyntheticQualityFixtureSetSchema = z.object({
  schemaVersion: z.literal('synthetic-finance-v1'), expectationOrigin: z.literal('fixture-authored'), labels: z.null(),
  limitations: z.array(z.string().min(1)).min(1), cases: z.array(SyntheticQualityFixtureSchema).min(1).max(30),
}).strict().superRefine((value, context) => {
  if (new Set(value.cases.map(item => item.caseId)).size !== value.cases.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Fixture case IDs must be unique.', path: ['cases'] });
});

export type SyntheticQualityFixture = z.infer<typeof SyntheticQualityFixtureSchema>;
export type SyntheticQualityFixtureSet = z.infer<typeof SyntheticQualityFixtureSetSchema>;

export function hashSyntheticSource(passages: Array<{ passageId: string; page?: number; text: string }>): string {
  const original = passages.map(item => ({ passageId: item.passageId, page: item.page ?? null, text: item.text }));
  return createHash('sha256').update(JSON.stringify(original), 'utf8').digest('hex');
}

export function parseSyntheticQualityFixtures(value: unknown): SyntheticQualityFixtureSet {
  return SyntheticQualityFixtureSetSchema.parse(value);
}
