import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  hashSyntheticSource, parseSyntheticQualityFixtures, SyntheticQualityFixtureSchema,
  type SyntheticQualityFixture,
} from '../../scripts/prompt-ab/quality-fixture-schema';

const original: unknown = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/generation-quality/synthetic-finance.json'), 'utf8'));
const fixtures = parseSyntheticQualityFixtures(original);
const find = (id: string): SyntheticQualityFixture => structuredClone(fixtures.cases.find(item => item.caseId === id)!);

// These probes consume fixture-authored annotations. They deliberately do not
// infer concepts, entailment, or pedagogical fingerprints from question text.
function annotatedScope(fixture: SyntheticQualityFixture, index = 0): { verdict: string; missing: string[] } {
  const item = fixture.candidates[index];
  const prerequisiteSources = fixture.prerequisites.filter(value => fixture.allowedPrerequisiteIds.includes(value.prerequisiteId)).flatMap(value => value.sourceIds);
  const eligibleSources = new Set([...fixture.allowedMaterialIds, ...prerequisiteSources]);
  const cited = fixture.materials.filter(source => eligibleSources.has(source.sourceId)).flatMap(source => source.passages).filter(passage => item.evidenceIds.includes(passage.passageId));
  const supported = new Set(cited.flatMap(passage => passage.supportedConceptIds));
  const missing = item.dependencyConceptIds.filter(concept => !supported.has(concept));
  return { verdict: !cited.length && !item.evidenceIds.length ? 'insufficient-evidence' : missing.length ? 'unsupported' : 'supported', missing };
}

function annotatedNotation(fixture: SyntheticQualityFixture, index = 0): string {
  const item = fixture.candidates[index];
  if (!item.notation.length) return 'not-applicable';
  const rules = fixture.materials.filter(source => fixture.allowedMaterialIds.includes(source.sourceId)).flatMap(source => source.passages).flatMap(passage => passage.notation);
  return item.notation.every(symbol => rules.some(rule => rule.conceptId === symbol.conceptId && rule.symbol === symbol.symbol && rule.definition === symbol.definition)) ? 'consistent' : 'inconsistent';
}

function annotatedNovelty(fixture: SyntheticQualityFixture, index = 0): { verdict: string; related: string[] } {
  const item = fixture.candidates[index];
  const memory = [...fixture.bankSnapshot, ...fixture.batchSnapshot];
  const exact = memory.filter(question => JSON.stringify(question.content) === JSON.stringify(item.content));
  if (exact.length) return { verdict: 'exact-duplicate', related: exact.map(question => question.questionId) };
  const fingerprint = (value: typeof item.fingerprint) => JSON.stringify({ ...value, conceptIds: [...value.conceptIds].sort() });
  const variants = memory.filter(question => fingerprint(question.fingerprint) === fingerprint(item.fingerprint));
  return { verdict: variants.length ? 'variant' : 'independent', related: variants.map(question => question.questionId) };
}

describe('authored synthetic finance quality fixture contract', () => {
  it('loads ten cases without teacher labels or model results', () => {
    expect(fixtures.cases).toHaveLength(10);
    expect(fixtures.cases.flatMap(item => item.candidates)).toHaveLength(12);
    expect(fixtures.labels).toBeNull();
    expect(fixtures.expectationOrigin).toBe('fixture-authored');
    expect(fixtures.cases.every(item => item.labels === null && item.expectationOrigin === 'fixture-authored')).toBe(true);
  });

  it.each(fixtures.cases.map(item => [item.caseId, item] as const))('%s preserves its explicit support, notation, and novelty annotations', (_id, fixture) => {
    fixture.candidates.forEach((candidate, index) => {
      const expectation = fixture.expectations.find(item => item.candidateId === candidate.candidateId)!;
      expect(annotatedScope(fixture, index)).toEqual({ verdict: expectation.sourceScope, missing: expectation.missingConceptIds });
      expect(annotatedNotation(fixture, index)).toBe(expectation.notation);
      expect(annotatedNovelty(fixture, index)).toEqual({ verdict: expectation.novelty, related: expectation.relatedQuestionIds });
    });
  });

  it('does not authorize another uploaded material simply because its citation exists', () => {
    const fixture = find('excluded-material');
    expect(fixture.materials.some(source => source.passages.some(passage => fixture.candidates[0].evidenceIds.includes(passage.passageId)))).toBe(true);
    expect(annotatedScope(fixture).verdict).toBe('unsupported');
    fixture.allowedMaterialIds.push('source-npv');
    expect(annotatedScope(fixture).verdict).toBe('supported');
  });

  it('requires the authored dependencies, not only a real in-scope citation', () => {
    const fixture = find('real-citation-without-support');
    expect(fixture.candidates[0].evidenceIds).toEqual(['capm-risk']);
    expect(annotatedScope(fixture).missing).toEqual(fixture.expectations[0].missingConceptIds);
    fixture.candidates[0].evidenceIds.push('capm-formula');
    expect(annotatedScope(fixture).verdict).toBe('supported');
  });

  it('separates notation mismatch from source support and mathematical equivalence', () => {
    const fixture = find('equivalent-notation-mismatch');
    expect(annotatedScope(fixture).verdict).toBe('supported');
    expect(annotatedNotation(fixture)).toBe('inconsistent');
    fixture.candidates[0].notation[0].symbol = 'R_f';
    expect(annotatedNotation(fixture)).toBe('consistent');
  });

  it('keeps intentional numerical variants in the variant denominator', () => {
    const fixture = find('intentional-numerical-variant');
    expect(fixture.request.independentSlots).toBe(0);
    expect(fixture.request.intentionalVariantSlots).toBe(1);
    expect(annotatedNovelty(fixture).verdict).toBe('variant');
  });

  it('allows similar words with a different authored inference task', () => {
    const fixture = find('similar-words-new-inference');
    expect(fixture.candidates[0].fingerprint.cognitiveTask).not.toBe(fixture.bankSnapshot[0].fingerprint.cognitiveTask);
    expect(annotatedNovelty(fixture).verdict).toBe('independent');
  });

  it('checks queued drafts as memory before they are approved', () => {
    const fixture = find('queued-exact-duplicate');
    expect(fixture.bankSnapshot).toEqual([]);
    expect(fixture.batchSnapshot[0].state).toBe('draft');
    expect(annotatedNovelty(fixture)).toEqual({ verdict: 'exact-duplicate', related: ['queue-direct'] });
  });

  it('grounds the correction for an intentional false statement', () => {
    const fixture = find('intentional-false-statement');
    expect(fixture.candidates[0].content.options.find(item => item.role === 'correct')?.text).toBe('False');
    expect(annotatedScope(fixture).verdict).toBe('supported');
    expect(fixture.candidates[0].content.correctExplanation).toContain('systematic');
  });

  it('retains the requested independent-slot denominator when a thin inventory has variants', () => {
    const fixture = find('thin-lo-shortfall');
    expect(fixture.request.independentSlots).toBe(3);
    expect(fixture.supplyExpectation).toMatchObject({ independentCandidates: 1, variantCandidates: 2, unmetIndependentSlots: 2 });
    fixture.supplyExpectation!.unmetIndependentSlots = 0;
    expect(SyntheticQualityFixtureSchema.safeParse(fixture).success).toBe(false);
  });

  it.each([
    ['a changed original without a new hash', (fixture: SyntheticQualityFixture) => { fixture.materials[0].passages[0].text += ' Changed'; }],
    ['an unknown allowed material', (fixture: SyntheticQualityFixture) => { fixture.allowedMaterialIds.push('unknown'); }],
    ['an unknown prerequisite', (fixture: SyntheticQualityFixture) => { fixture.allowedPrerequisiteIds.push('unknown'); }],
    ['a missing expectation', (fixture: SyntheticQualityFixture) => { fixture.expectations = []; }],
    ['an unknown comparison question', (fixture: SyntheticQualityFixture) => { fixture.expectations[0].relatedQuestionIds.push('unknown'); }],
    ['duplicate candidate IDs', (fixture: SyntheticQualityFixture) => { fixture.candidates.push(structuredClone(fixture.candidates[0])); }],
    ['two intended correct options', (fixture: SyntheticQualityFixture) => { fixture.candidates[0].content.options[1].role = 'correct'; }],
    ['a candidate of another format', (fixture: SyntheticQualityFixture) => { fixture.request.type = 'true-false'; }],
  ] as const)('rejects %s', (_description, mutate) => {
    const fixture = find('supported-capm'); mutate(fixture);
    expect(SyntheticQualityFixtureSchema.safeParse(fixture).success).toBe(false);
  });

  it('accepts an intentionally revised original only with its matching source hash', () => {
    const fixture = find('supported-capm');
    fixture.materials[0].passages[0].text += ' Changed';
    fixture.materials[0].contentHash = hashSyntheticSource(fixture.materials[0].passages);
    expect(SyntheticQualityFixtureSchema.safeParse(fixture).success).toBe(true);
  });

  it('rejects teacher-label substitution and unknown top-level result fields', () => {
    expect(() => parseSyntheticQualityFixtures({ ...fixtures, labels: { accepted: true } })).toThrow();
    expect(() => parseSyntheticQualityFixtures({ ...fixtures, measuredQuality: 1 })).toThrow();
    expect(() => parseSyntheticQualityFixtures({ ...fixtures, cases: [...fixtures.cases, fixtures.cases[0]] })).toThrow();
  });
});
