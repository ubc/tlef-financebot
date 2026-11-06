import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { OUTLINE_REVIEW_PROBE_LIMITS, assertReviewProbeCli, assertReviewProbeLedgerPrefix, main, prepareOutlineReviewCases, recoverGroundingProbeFunctions,
  type RetainedReviewRun } from '../../scripts/quality-lab/run-outline-review-probe';
import type { GroundingSection } from '../../server/src/services/structure-outline-grounding';
import type { GroundingObjective, OutlineGroundingFinding } from '../../server/src/types/structure';
import type { CapturedCompletion } from '../../scripts/quality-lab/protocol';
import type { ConservativeLedger } from '../../scripts/quality-lab/ledger';
import { hashControl } from '../../scripts/quality-lab/protocol';

jest.mock('../../server/src/config/env', () => { throw new Error('Outline review file-only tests must not import runtime config.'); });
jest.mock('../../server/src/components/genai/llm', () => { throw new Error('Outline review file-only tests must not import provider code.'); });
jest.mock('../../server/src/components/mongodb', () => { throw new Error('Outline review file-only tests must not import Mongo.'); });

/** Synthetic retained format tests source/binding integrity only. These rows
 * are not a claim about real PDFs or a teacher quality label. */
function synthetic() {
  const a = { id: 'original-A', localId: 'C1.S1', materialId: 'a'.repeat(24), materialName: 'Unit bond chapter.pdf', chunkIndex: 0,
    text: 'Lending covenants restrict actions that hurt bondholders. Puttable bonds return face value. Ratings-sensitive notes adjust interest; hybrid bonds can include conversion options or warrants.' };
  const b = { id: 'original-B', localId: 'C1.S1', materialId: 'b'.repeat(24), materialName: 'Unit beta chapter.pdf', chunkIndex: 0,
    text: 'The beta estimate has a standard error. R-squared distinguishes market and firm-specific risk shares.' };
  const sections: GroundingSection[] = [a, b];
  const l14: GroundingObjective = { id: 'L14', themeIndex: 1, loIndex: 8, topic: 'Governance, Ownership, and Corporate Control',
    name: 'Explain how lending covenants and bond features protect bondholders.', evidenceIds: ['E91'], materialIds: [a.materialId], sourceIds: ['S50'],
    learningPoints: [{ id: 'E91', objective: 'Explain how lending covenants and bond features protect bondholders.', materialId: a.materialId, sourceIds: ['S50'] }], contentHash: '' };
  const originals = [{ ...a, alias: 'S50' }];
  l14.contentHash = createHash('sha256').update(JSON.stringify({ topic: l14.topic, name: l14.name, evidenceIds: l14.evidenceIds,
    materialIds: l14.materialIds, learningPoints: l14.learningPoints, originals })).digest('hex');
  const finding: OutlineGroundingFinding = { ...l14, status: 'unsupported', reason: 'The original section supports the capability, but its topic placement is unsuitable.', citedSourceIds: ['S50'], coveredEvidenceIds: ['E91'] };
  const reviewPayload = (id: 'L14' | 'L38') => ({ objectives: id === 'L14' ? [{ id, topic: l14.topic, objective: l14.name, sourceIds: l14.sourceIds, learningPoints: l14.learningPoints }] : [
    { id: 'L34', topic: 'Neighbor', objective: 'An unrelated sibling.', sourceIds: ['S136'], learningPoints: [{ id: 'E200', objective: 'An unrelated sibling.', materialId: a.materialId, sourceIds: ['S136'] }] },
    { id, topic: 'Beta Regression and Risk Attribution', objective: 'Interpret beta uncertainty and market risk shares.', sourceIds: ['S139'],
      learningPoints: [{ id: 'E207', objective: 'Explain beta uncertainty.', materialId: b.materialId, sourceIds: ['S139'] }] },
  ], originalSections: id === 'L14' ? [{ id: 'S50', material: a.materialName, chunkIndex: 0, text: a.text }] : [
    { id: 'S136', material: a.materialName, chunkIndex: 0, text: a.text }, { id: 'S139', material: b.materialName, chunkIndex: 0, text: b.text },
  ] });
  const capture = (stage: string, payload: unknown, parsed: unknown, suffix: string): RetainedReviewRun['captures'][number] => ({ file: `synthetic-${suffix}.json`, transcript: {
    version: 1, stage, request: { stage, prompt: JSON.stringify(payload), model: 'gpt-6-luna', effort: 'medium', maxOutputTokens: stage === 'outline-source-review' ? 6000 : 24000,
      maxInputTokens: 200000, allowedActualModels: ['gpt-6-luna'], maxSends: 2 }, attempts: [], parsed, status: 'succeeded', error: null, modelIdentityVerified: true,
    startedAt: 'unit-only', elapsedMs: 0, hiddenReasoning: 'not-captured', transport: 'toolkit-streamConversation-visible-content; JSON option is not strict native schema',
  } as CapturedCompletion });
  const quoted = { originalPassages: [
    { id: 'P1', materialId: a.materialId, material: a.materialName, chunkIndex: 0, quote: 'Lending covenants restrict actions that hurt bondholders.' },
    { id: 'P2', materialId: a.materialId, material: a.materialName, chunkIndex: 0, quote: 'Puttable bonds return face value.' },
    { id: 'P3', materialId: b.materialId, material: b.materialName, chunkIndex: 0, quote: 'The beta estimate has a standard error.' },
  ], learningPoints: [{ id: 'E91', objective: l14.name, passageId: 'P1', supportingPassageIds: ['P2'] }, { id: 'E207', objective: 'Explain beta uncertainty.', passageId: 'P3' }] };
  const foreign = { reviews: [{ id: 'L38', status: 'unsupported', sourceIds: ['S139', 'S136'], coveredEvidenceIds: ['E207'], reason: 'Historical invalid source alias.' }] };
  const prior: RetainedReviewRun = { status: 'stopped', result: null, error: { message: 'structure-grounding-review-source' }, runId: 'c'.repeat(24), controlsSha256: 'unit',
    diagnosticRun: { status: 'failed', structureDiagnostics: { outlineGrounding: { version: 'original-final-lo-review-v1', findings: [finding] } } },
    liveCorpus: { sections, fingerprint: 'synthetic-source-fingerprint' }, captures: [
      capture('outline-synthesis', quoted, { themes: [] }, 'original-quotes'),
      capture('outline-source-review', reviewPayload('L14'), { reviews: [{ id: 'L14', status: 'unsupported', sourceIds: ['S50'], coveredEvidenceIds: ['E91'], reason: finding.reason }] }, 'L14'),
      capture('outline-source-review', reviewPayload('L38'), foreign, 'L38-first'), capture('outline-source-review', reviewPayload('L38'), foreign, 'L38-second'),
    ] };
  return { prior, sections, l14, quoted, capture };
}
const changedPrompt = (capture: RetainedReviewRun['captures'][number], change: (value: Record<string, unknown>) => void) => {
  const value = JSON.parse(capture.transcript.request.prompt) as Record<string, unknown>; change(value); capture.transcript.request.prompt = JSON.stringify(value);
};

describe('current v2 outline review probe source and case controls', () => {
  let currentSource: string; let functions: ReturnType<typeof recoverGroundingProbeFunctions>['functions'];
  beforeAll(async () => { currentSource = await readFile(path.resolve(__dirname, '../../server/src/services/structure-outline-grounding.ts'), 'utf8'); functions = recoverGroundingProbeFunctions(currentSource).functions; });
  it('uses the actual current source/topic schema and allows supported wording with an advisory misgrouped topic', () => {
    const fixture = synthetic(); const item = prepareOutlineReviewCases(fixture.prior, fixture.sections, functions)[0];
    const valid = { reviews: [{ id: 'L14', sourceStatus: 'supported', sourceIds: ['S50'], coveredEvidenceIds: ['E91'], sourceReason: 'The original teaches these bondholder protections.', topicFit: 'misgrouped', topicReason: 'The capability belongs under lender protection.' }] };
    expect(functions.validateOutlineGrounding(valid, item.batch)[0]).toMatchObject({ status: 'supported', topicFit: 'misgrouped' });
    expect(() => functions.validateOutlineGrounding({ reviews: [{ id: 'L14', status: 'supported', sourceIds: ['S50'], coveredEvidenceIds: ['E91'], reason: 'Old schema.' }] }, item.batch)).toThrow();
    const foreign = structuredClone(valid); foreign.reviews[0].sourceIds = ['S136']; expect(() => functions.validateOutlineGrounding(foreign, item.batch)).toThrow('review-source');
  });
  it('preserves the durable L14 hash, separate original quote groups and all its full original text', () => {
    const fixture = synthetic(); const item = prepareOutlineReviewCases(fixture.prior, fixture.sections, functions)[0];
    expect(item.binding.kind).toBe('retained-durable-original'); expect(item.batch.objectives[0].contentHash).toBe(fixture.l14.contentHash);
    expect(item.batch.sources[0].text).toBe(fixture.sections[0].text); expect(item.quotedOriginalGroups[0].groups).toHaveLength(2);
    expect(item.historicalRows).toHaveLength(1); expect(item.expectedSourceStatus).toBe('supported');
  });
  it('binds L38 freshly and removes only its foreign neighbor context while retaining global source aliases', () => {
    const fixture = synthetic(); const item = prepareOutlineReviewCases(fixture.prior, fixture.sections, functions)[1];
    expect(item.binding.kind).toBe('fresh-probe-binding'); expect(item.binding.originalContentHash).toBeNull(); expect(item.batch.objectives).toHaveLength(1);
    expect(item.batch.objectives[0].id).toBe('L38'); expect(item.batch.sources.map(source => source.alias)).toEqual(['S139']); expect(item.batch.prompt).not.toContain('S136');
    expect(item.batch.sources[0].text).toBe(fixture.sections[1].text); expect(item.historicalRows).toHaveLength(2); expect(item.expectedSourceStatus).toBeNull();
  });
  it('changes only objective wording and its binding in the labelled Black-Scholes negative', () => {
    const fixture = synthetic(); const [positive, , negative] = prepareOutlineReviewCases(fixture.prior, fixture.sections, functions);
    expect(negative.expectedSourceStatus).toBe('not-supported'); expect(negative.batch.objectives[0].name).toContain('Black-Scholes');
    expect(hashControl(negative.batch.sources)).toBe(hashControl(positive.batch.sources));
    expect(negative.batch.objectives[0].learningPoints).toEqual(positive.batch.objectives[0].learningPoints);
    expect(negative.batch.objectives[0].contentHash).not.toBe(positive.batch.objectives[0].contentHash);
    expect(negative.batch.objectives[0].id).toBe(positive.batch.objectives[0].id); expect(negative.historicalRows).toEqual([]);
  });
  it('rejects original-source drift, altered durable hashes and mismatched point ownership', () => {
    const drift = synthetic(); const sections = structuredClone(drift.sections); sections[0].text += ' changed'; expect(() => prepareOutlineReviewCases(drift.prior, sections, functions)).toThrow('originals-changed');
    const hash = synthetic(); hash.prior.diagnosticRun.structureDiagnostics.outlineGrounding.findings[0].contentHash = '0'.repeat(64);
    expect(() => prepareOutlineReviewCases(hash.prior, hash.sections, functions)).toThrow('durable production binding');
    const owner = synthetic(); changedPrompt(owner.prior.captures[0], value => { (value.originalPassages as Array<{ materialId: string }>)[0].materialId = owner.sections[1].materialId; });
    expect(() => prepareOutlineReviewCases(owner.prior, owner.sections, functions)).toThrow();
  });
  it('rejects invented or conflicting original quote groups and lost historical alias failures', () => {
    const invented = synthetic(); changedPrompt(invented.prior.captures[0], value => { (value.originalPassages as Array<{ quote: string }>)[0].quote = 'A sentence absent from every original.'; });
    expect(() => prepareOutlineReviewCases(invented.prior, invented.sections, functions)).toThrow("own unchanged original");
    const conflict = synthetic(); const different = structuredClone(conflict.quoted); different.originalPassages[0].quote = 'Puttable bonds return face value.';
    conflict.prior.captures.push(conflict.capture('outline-synthesis', different, {}, 'conflicting-quotes'));
    expect(() => prepareOutlineReviewCases(conflict.prior, conflict.sections, functions)).toThrow('Conflicting retained quote groups');
    const lost = synthetic(); lost.prior.captures.pop(); expect(() => prepareOutlineReviewCases(lost.prior, lost.sections, functions)).toThrow();
  });
  it('separates pack-local E91 collisions from final evidence IDs using exact wording and owned original coordinates', () => {
    const fixture = synthetic();
    changedPrompt(fixture.prior.captures[0], value => {
      const rows = value.learningPoints as Array<{ id: string; objective: string; passageId: string }>;
      rows[0].id = 'E17'; rows.push({ id: 'E91', objective: 'A foreign convertible-debt capability.', passageId: 'P3' });
    });
    const item = prepareOutlineReviewCases(fixture.prior, fixture.sections, functions)[0];
    expect(item.quotedOriginalGroups[0].evidenceId).toBe('E91'); expect(item.quotedOriginalGroups[0].retainedMappings[0].packLocalLearningPointId).toBe('E17');
    expect(item.quotedOriginalGroups[0].groups.every(group => group.materialId === fixture.sections[0].materialId)).toBe(true);
  });
  it('fails rather than truncating an objective whose full original input exceeds24k', () => {
    const fixture = synthetic(); fixture.sections[1].text += 'Untrimmed original context '.repeat(1500);
    for (const capture of fixture.prior.captures.filter(item => item.transcript.stage === 'outline-source-review' && item.transcript.request.prompt.includes('L38'))) {
      changedPrompt(capture, value => { const rows = value.originalSections as Array<{ id: string; text: string }>; rows.find(row => row.id === 'S139')!.text = fixture.sections[1].text; });
    }
    expect(() => prepareOutlineReviewCases(fixture.prior, fixture.sections, functions)).toThrow('full-original-input-too-large:L38');
  });
  it('requires a terminal evidenced v1 source-identity stop and exact Luna medium review options', () => {
    const fixture = synthetic(); fixture.prior.status = 'running'; expect(() => prepareOutlineReviewCases(fixture.prior, fixture.sections, functions)).toThrow('terminal-v1');
    const wrong = synthetic(); wrong.prior.captures[1].transcript.request.effort = 'low'; expect(() => prepareOutlineReviewCases(wrong.prior, wrong.sections, functions)).toThrow();
    expect(() => recoverGroundingProbeFunctions(currentSource.replace('sourceStatus: z.enum', 'oldStatus: z.enum'))).toThrow('v2-schema');
  });
});
function ledger(): ConservativeLedger {
  return { version: 1, createdAt: 'unit', scope: 'phase-two-unit', accounting: 'conservative-reservations-v1', limits: { maxSends: 160, maxConservativeTokens: 4_000_000, maxInputTokens: 200000 },
    reservedSends: 1, conservativeTokens: 7000, reservations: [{ id: 'old-id', cellId: 'outline', stage: 'outline-source-review', jsonAttempt: 0, inputSha256: 'unit', inputEstimate: 1000, outputReservation: 6000, reservedAt: 'unit' }] };
}
describe('small probe uses the shared phase ledger without reset or widened caps', () => {
  it('declares four sends including JSON correction,24k input/6k output and120k native conservative units', () => {
    expect(OUTLINE_REVIEW_PROBE_LIMITS).toEqual({ maxSends: 4, maxInputTokens: 24000, maxOutputTokens: 6000, maxEstimatedTokens: 120000 });
  });
  it('preserves the exact historical ledger prefix and only admits this probe’s added source-review reservations', () => {
    const before = ledger(); const current = structuredClone(before); current.reservations.push({ ...current.reservations[0], id: 'probe-id', cellId: 'probe-L14', stage: 'outline-source-review-probe' });
    current.reservedSends++; current.conservativeTokens += 7000; expect(() => assertReviewProbeLedgerPrefix(before, current, 'probe')).not.toThrow();
    const edited = structuredClone(current); edited.reservations[0].inputSha256 = 'rewritten'; expect(() => assertReviewProbeLedgerPrefix(before, edited, 'probe')).toThrow();
    const foreign = structuredClone(current); foreign.reservations[1].cellId = 'other-run'; expect(() => assertReviewProbeLedgerPrefix(before, foreign, 'probe')).toThrow();
    const widened = structuredClone(current); widened.limits.maxSends++; expect(() => assertReviewProbeLedgerPrefix(before, widened, 'probe')).toThrow();
  });
  it('rejects duplicate reservation IDs and more than four added attempts without releasing previous work', () => {
    const before = ledger(); const duplicate = structuredClone(before); duplicate.reservations.push({ ...duplicate.reservations[0] }); duplicate.reservedSends++; duplicate.conservativeTokens += 7000;
    expect(() => assertReviewProbeLedgerPrefix(before, duplicate)).toThrow();
    const many = structuredClone(before); for (let index = 0; index < 5; index++) many.reservations.push({ ...many.reservations[0], id: `new-${index}`, cellId: 'probe-case', stage: 'outline-source-review-probe' });
    many.reservedSends += 5; many.conservativeTokens += 35000; expect(() => assertReviewProbeLedgerPrefix(before, many, 'probe')).toThrow();
  });
  it('does not interpret controls alone or an invalid live switch as paid execution authority', async () => {
    const old = process.argv;
    try {
      process.argv = ['node', 'unit', '--output', '/tmp/never-created-outline-review-probe', '--controls', '/tmp/never-read.json']; await expect(main()).rejects.toThrow('Explicit --live once');
      process.argv = ['node', 'unit', '--output', '/tmp/never-created-outline-review-probe', '--live', 'yes']; await expect(main()).rejects.toThrow();
    } finally { process.argv = old; }
  });
  it('rejects unknown, duplicate, missing-value and mixed live/preflight flags', () => {
    for (const args of [['--output', '/tmp/x', '--wat', 'yes'], ['--output', '/tmp/x', '--output', '/tmp/y'], ['--output'],
      ['--live', 'once', '--prior', '/tmp/old'], ['--output', '--live']]) expect(() => assertReviewProbeCli(['node', 'unit', ...args])).toThrow();
  });
});
