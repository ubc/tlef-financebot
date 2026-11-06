jest.mock('../../server/src/components/genai/llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../server/src/components/mongodb/collections', () => ({}));

import { completeJson } from '../../server/src/components/genai/llm';
import { assessGenerationQuality, snapshotQualityCandidate } from '../../server/src/services/generation-quality.service';
import { sourceCitationSpans, resolveSpanCitations, rebindGenerationTaskPassages, renderSourceCitationSpans } from '../../server/src/services/generation-citation-spans';
import { withBatchGenerationMemory } from '../../server/src/services/generation-memory.service';
import type { GenerationEvidencePacket } from '../../server/src/types/generation-evidence';
import type { GenerationMemoryContent, GenerationMemorySnapshot } from '../../server/src/services/generation-memory.service';

const source = 'Firm-specific risk can be reduced, if not eliminated, by\n  increasing the number of investments in your portfolio. Market-wide risk cannot.\nEach investment is a smaller portfolio share, muting its effect. Positive and negative firm-specific effects can average out.\nCost of Equity = Riskfree rate + Beta * Risk Premium\n                 = 2.75% + 1.0013 (5.76%) = 8.52%';
function packet(text = source): GenerationEvidencePacket {
  return { id: 'packet', schemaVersion: 'source-passages-v1', policyVersion: 'grounded-memory-v2', courseId: 'course', loIds: ['lo'], sourceFingerprint: 'hash', parsingProvenance: 'unrecorded', materials: [{ materialId: 'material', name: 'Long chapter.pdf', role: 'primary', loId: 'lo', revision: 1, activeRunId: null, contentHash: 'hash', chunkCount: 1 }], passages: [{ id: 'E-long-exact-identity', materialId: 'material', materialName: 'Long chapter.pdf', role: 'primary', loId: 'lo', chunkIndex: 0, start: 0, end: text.length, text, selection: 'retrieved' }], coverage: { sourceChunks: 1, selectedChunks: 1, selectedCharacters: text.length, omittedPassages: 0, truncated: false, searchScope: 'retrieved-chunks-and-immediate-neighbors' }, findings: [] };
}
function content(stem: string, answer = 'Firm-specific risk', explanation = 'Firm-specific effects can average out.'): GenerationMemoryContent {
  return { type: 'mcq', stem, options: [{ key: 'A', role: 'correct', text: answer, explanation }, { key: 'B', role: 'common-misconception', text: 'Market-wide risk', explanation: 'Market-wide risk cannot be reduced through diversification.' }] };
}
function input() {
  const empty: GenerationMemorySnapshot = { entries: [], truncated: false, missingVersions: 0, snapshotDigest: 'memory', consistency: 'best-effort' };
  const bank = withBatchGenerationMemory(empty, [{ id: 'batch:original-question', content: content('Does diversification reduce firm-specific risk?', 'Yes', 'Diversification reduces firm-specific risk.') }]);
  bank.entries[0].id = 'q:original-question:immutable-v1'; bank.entries[0].source = 'bank';
  return { packet: packet(), memory: bank, candidate: content('Why can firm-specific risk average out in a larger portfolio?'), item: 0, policy: 'grounded-memory-v2' as const, step: { model: 'synthetic' }, requirements: { intent: 'create-independent-task' as const, requiredChanges: ['Require an independent inference.'], preserve: [] } };
}
function review() {
  return { sourceSupport: 'supported', notation: 'consistent', novelty: 'independent', reasons: ['Source mechanisms support this task.'], citations: [{ kind: 'premise', claim: 'Firm-specific risk is diversifiable.', spanIds: ['S1'] }, { kind: 'solution', claim: 'Smaller shares and offsetting effects explain diversification.', spanIds: ['S1'] }, { kind: 'correction', claim: 'Market risk cannot be diversified away.', spanIds: ['S1'] }], matchedEntryIds: [] as string[], taskComparisons: [{ entryId: 'M1', sameInference: false, sameSolutionPath: false, contrast: 'Candidate explains mechanisms; Bank asks whether the rule holds.' }], changes: [{ requirement: 'Require an independent inference.', status: 'fulfilled', reason: 'Mechanism inference differs from rule recall.' }], invariants: [], achievedDifficulty: 'easy', justifiedLength: 'justified', missingPremises: [] };
}
beforeEach(() => { jest.mocked(completeJson).mockReset().mockResolvedValue(review()); });

describe('deterministic v2 source citation spans', () => {
  function pinnedInput() {
    const value = input(); const entry = value.memory.entries[0];
    Object.assign(entry, { questionId: 'original-question', versionId: 'immutable-v1', comparisonRole: 'pinned-original' });
    value.memory.pinnedOriginal = { questionId: 'original-question', versionId: 'immutable-v1', entryId: entry.id };
    return { ...value, requirements: { ...value.requirements, original: snapshotQualityCandidate(entry.content) } };
  }
  it('requires an explicit original-task comparison even when an independent verdict is returned', async () => {
    jest.mocked(completeJson).mockResolvedValue({ ...review(), taskComparisons: [] });
    const result = await assessGenerationQuality(pinnedInput());
    expect(result).toMatchObject({ status: 'withheld', novelty: 'uncertain' });
    expect(result.responseIssues).toContainEqual(expect.objectContaining({ path: 'taskComparisons', code: 'pinned-original-comparison-required' }));
    expect(completeJson).toHaveBeenCalledTimes(2);
  });
  it('keeps a changed-context original variant withheld and allows an explicitly compared independent inference', async () => {
    jest.mocked(completeJson).mockResolvedValue({ ...review(), novelty: 'variant', taskComparisons: [{ entryId: 'M1', sameInference: true, sameSolutionPath: true, contrast: 'Only the context changed.' }] });
    const variant = await assessGenerationQuality(pinnedInput());
    expect(variant).toMatchObject({ status: 'withheld', novelty: 'variant', matchedEntryIds: ['q:original-question:immutable-v1'] });
    jest.mocked(completeJson).mockReset().mockResolvedValue(review());
    expect((await assessGenerationQuality(pinnedInput())).status).toBe('eligible');
    const prompt = jest.mocked(completeJson).mock.calls[0][0];
    expect(prompt).toContain('MANDATORY ORIGINAL COMPARISON');
    expect(prompt).not.toContain('Original reference:');
  });
  it('does not accept a legacy copied-quote verdict that omits the required pinned-original comparison', async () => {
    const { taskComparisons, ...legacy } = review();
    expect(taskComparisons[0].entryId).toBe('M1');
    jest.mocked(completeJson).mockResolvedValue({ ...legacy, citations: [
      { kind: 'premise', claim: 'Firm-specific risk is diversifiable.', passageId: 'E-long-exact-identity', quote: source },
      { kind: 'solution', claim: 'Smaller shares explain diversification.', passageId: 'E-long-exact-identity', quote: source },
    ] });
    expect((await assessGenerationQuality(pinnedInput())).status).toBe('withheld');
  });
  it('binds generator span aliases and unique original IDs before descriptor persistence', () => {
    const p = packet(source.repeat(3)); const spans = sourceCitationSpans(p);
    expect(rebindGenerationTaskPassages(p, [spans[0].id, spans[1].id, p.passages[0].id])).toEqual([p.passages[0].id]);
    p.passages.push({ ...p.passages[0], id: 'E-second-source' });
    const later = sourceCitationSpans(p).find(span => span.passageId === 'E-second-source')!;
    expect(rebindGenerationTaskPassages(p, ['S1', later.id])).toEqual(['E-long-exact-identity', 'E-second-source']);
  });
  it('never strips unknown, out-of-packet, memory or ambiguous descriptor references', () => {
    for (const ids of [['S999'], ['M1'], ['E-other-packet'], ['S1', 'forged'], []]) expect(() => rebindGenerationTaskPassages(packet(), ids)).toThrow('generation-task-passage-reference-invalid');
    const p = packet(); p.passages.push({ ...p.passages[0] });
    expect(() => rebindGenerationTaskPassages(p, ['S1'])).toThrow('generation-task-passage-reference-invalid');
  });
  it('sends source scope metadata once, retaining originals exactly and keeping private hashes out of prompts', () => {
    const p = packet(source.repeat(3)); p.materials[0].loName = 'Scoped objective';
    const rendered = renderSourceCitationSpans(p);
    expect(rendered).toContain('"loName":"Scoped objective"'); expect(rendered).toContain('"scope":"F1"');
    expect(rendered).not.toContain('E-long-exact-identity'); expect(rendered).not.toContain('materialId');
    const data = JSON.parse(rendered.slice(rendered.indexOf('{')));
    expect(data.passages[0].spans.map((span: {text:string}) => span.text).join('')).toBe(p.passages[0].text);
  });
  it('recovers exact original whitespace without asking the model to reproduce PDF layout', async () => {
    const result = await assessGenerationQuality(input());
    expect(result.status).toBe('eligible'); expect(completeJson).toHaveBeenCalledTimes(1);
    expect(result.citations[0]).toMatchObject({ passageId: 'E-long-exact-identity', quote: source });
    expect(result.citations[0].quote).toContain('by\n  increasing');
    expect(result.taskComparisons?.[0].entryId).toBe('q:original-question:immutable-v1');
    const prompt = jest.mocked(completeJson).mock.calls[0][0];
    expect(prompt).toContain('SOURCE worked examples are never Bank entries'); expect(prompt).toContain('False distractors/T-F claims are allowed');
    expect(prompt).toContain('"spanIds":["S1"]'); expect(prompt).not.toContain('"quote"');
    expect(prompt).not.toContain('"matchedEntryIds":');
    expect(prompt).toContain('"id":"M1"'); expect(prompt).not.toContain('q:original-question:immutable-v1');
  });
  it('retains clipped packet boundaries and never recovers unseen source text', () => {
    const p = packet('Riskfree rate + Beta');
    const result = resolveSpanCitations(p, [{ kind: 'solution', claim: 'Formula', spanIds: ['S1'] }]);
    expect(result.citations[0].quote).toBe('Riskfree rate + Beta');
    expect(result.citations[0].quote).not.toContain('Risk Premium');
  });
  it('covers each packet character once and preserves separate exact nonadjacent groups', () => {
    const p = packet(source.repeat(6)); const spans = sourceCitationSpans(p);
    expect(spans.map(span => span.text).join('')).toBe(p.passages[0].text);
    expect(spans.every(span => span.text.length <= 700)).toBe(true);
    expect(resolveSpanCitations(p, [{ kind: 'solution', claim: 'Same passage', spanIds: ['S1', 'S2'] }]).citations[0].quote).toBe(spans[0].text + spans[1].text);
    for (const spanIds of [['S2', 'S1'], ['S1', 'S3']]) {
      const separate = resolveSpanCitations(p, [{ kind: 'solution', claim: 'Selected support', spanIds }]);
      expect(separate.issues).toEqual([]); expect(separate.citations.map(citation => citation.quote)).toEqual(spanIds.map(id => spans.find(span => span.id === id)!.text));
      expect(separate.citations.every(citation => citation.kind === 'solution' && citation.claim === 'Selected support')).toBe(true);
    }
    expect(resolveSpanCitations(p, [{ kind: 'solution', claim: 'Duplicate', spanIds: ['S1', 'S1'] }]).issues).toContainEqual({ path: 'citations.0.spanIds', code: 'duplicate-source-span' });
  });
  it('keeps cross-passage references separate and rejects ambiguous source IDs', () => {
    const p = packet(); p.passages.push({ ...p.passages[0], id: 'E-second' });
    expect(resolveSpanCitations(p, [{ kind: 'solution', claim: 'Cross-source inference', spanIds: ['S1', 'S2'] }]).citations).toEqual([
      { kind: 'solution', claim: 'Cross-source inference', passageId: p.passages[0].id, quote: source },
      { kind: 'solution', claim: 'Cross-source inference', passageId: p.passages[1].id, quote: source },
    ]);
    p.passages[1].id = p.passages[0].id;
    expect(resolveSpanCitations(p, [{ kind: 'solution', claim: 'Ambiguous ID', spanIds: ['S1'] }]).issues[0].code).toBe('unknown-or-ambiguous-passage');
  });
  it('bounds split citations and refuses mixed valid/unknown references without partial output', () => {
    const p = packet(); p.passages.push({ ...p.passages[0], id: 'E2' }, { ...p.passages[0], id: 'E3' });
    const citation = { kind: 'solution' as const, claim: 'Separate source claims', spanIds: ['S1', 'S2', 'S3'] };
    expect(resolveSpanCitations(p, Array.from({ length: 16 }, () => citation)).citations).toHaveLength(48);
    expect(resolveSpanCitations(p, Array.from({ length: 17 }, () => citation))).toMatchObject({ citations: [], issues: [{ code: 'source-citation-input-bound-exceeded' }] });
    expect(resolveSpanCitations(p, [{ ...citation, spanIds: ['S1', 'S999'] }]).citations).toEqual([]);
    expect(resolveSpanCitations(p, [{ ...citation, spanIds: ['S1', 'S2', 'S3', 'S4'] }]).issues[0].code).toBe('source-span-input-bound-exceeded');
  });
  it('rejects inconsistent original half-open ranges before resolving selected source spans', () => {
    const p = packet(); p.passages[0].end += 1;
    expect(resolveSpanCitations(p, [{ kind: 'premise', claim: 'Bad retained range', spanIds: ['S1'] }])).toMatchObject({ citations: [], issues: [{ code: 'source-span-range-invalid' }] });
  });
  it('splits three adjacent long spans without fabricating a quote beyond the1600-character bound', () => {
    const p = packet('a'.repeat(2100));
    const result = resolveSpanCitations(p, [{ kind: 'solution', claim: 'Selected original support', spanIds: ['S1', 'S2', 'S3'] }]);
    expect(result.issues).toEqual([]); expect(result.citations.map(citation => citation.quote.length)).toEqual([1400, 700]);
    expect(result.citations.map(citation => citation.quote).join('')).toBe(p.passages[0].text);
  });
  it.each(['S999', 'M1', 'S0'])('withholds hallucinated or wrong-namespace citation %s without fuzzy matching', async id => {
    const bad = review(); bad.citations[0].spanIds = [id]; jest.mocked(completeJson).mockResolvedValue(bad);
    const result = await assessGenerationQuality(input());
    expect(result.status).toBe('withheld'); expect(completeJson).toHaveBeenCalledTimes(2);
    expect(result.responseIssues?.length).toBeGreaterThan(0);
  });
  it('preserves unsupported correction findings even when every S locator is valid', async () => {
    jest.mocked(completeJson).mockResolvedValue({ ...review(), sourceSupport: 'unsupported', reasons: ['The proposed correction imports an option-pricing formula absent from the sources.'] });
    const result = await assessGenerationQuality({ ...input(), candidate: content('Why does a Black-Scholes call value change?', 'Volatility', 'Use Black-Scholes.') });
    expect(result).toMatchObject({ status: 'withheld', sourceSupport: 'unsupported' }); expect(completeJson).toHaveBeenCalledTimes(1);
  });
  it('keeps damaged or scope-mismatched source support uncertain', async () => {
    const args = input(); args.packet.findings = [{ code: 'source-text-damage', message: 'Unreadable formula', passageIds: ['E-long-exact-identity'] }];
    expect(await assessGenerationQuality(args)).toMatchObject({ status: 'withheld', sourceSupport: 'uncertain' });
    args.packet.findings = []; args.packet.passages[0].role = 'secondary';
    expect(await assessGenerationQuality(args)).toMatchObject({ status: 'withheld', sourceSupport: 'uncertain' });
  });
});

describe('v2 source and Bank task namespaces', () => {
  it('parses the retained investor/firm negative failure shape with separate exact quotes while preserving an unsupported diagnosis', async () => {
    // The paid probe retained the candidate and noncontiguous-citation error,
    // not its raw review JSON. These semantic findings are an explicit synthetic
    // regression; they must not be labelled an observed model diagnosis.
    const args = input(); args.packet = packet(source.repeat(6));
    args.candidate = content('A risk affects only a few firms. Which approach does the passage identify for investors to mitigate it, and what does the passage say about risk affecting all investments?', 'Diversify across sectors; risk affecting all investments cannot be diversified away.');
    const response = review(); response.sourceSupport = 'unsupported'; response.reasons = ['The candidate transfers a firm action to the investor category.'];
    response.citations[1].spanIds = ['S1', 'S3'];
    jest.mocked(completeJson).mockResolvedValue(response);
    const result = await assessGenerationQuality(args);
    expect(result).toMatchObject({ status: 'withheld', sourceSupport: 'unsupported', notation: 'consistent' });
    expect(result.responseIssues).toBeUndefined(); expect(completeJson).toHaveBeenCalledTimes(1);
    expect(result.citations.filter(citation => citation.kind === 'solution')).toHaveLength(2);
    expect(result.citations.every(citation => args.packet.passages.find(passage => passage.id === citation.passageId)!.text.includes(citation.quote))).toBe(true);
    expect(jest.mocked(completeJson).mock.calls[0][0]).toContain('firm actions cannot be attributed to investors');
  });
  it('parses a numerical-variant negative with nonadjacent exact citations while keeping it ineligible as independent supply', async () => {
    const args = input(); args.packet = packet(source.repeat(6));
    args.candidate = content('For CAPM, rates are fractional decimals. Calculate Cost of Equity and report it as a percentage.', 'Cost of Equity', 'Apply Riskfree rate + Beta * Risk Premium.');
    args.memory.entries[0].content = content('For CAPM, rates are percentages. Calculate Cost of Equity.', 'Cost of Equity', 'Apply Riskfree rate + Beta * Risk Premium.');
    const response = review(); response.novelty = 'variant'; response.reasons = ['Changing rate representation preserves the same CAPM substitution task.'];
    response.taskComparisons = [{ entryId: 'M1', sameInference: true, sameSolutionPath: true, contrast: 'The same CAPM path uses changed representation.' }];
    response.citations[2].spanIds = ['S1', 'S3'];
    jest.mocked(completeJson).mockResolvedValue(response);
    const result = await assessGenerationQuality(args);
    expect(result).toMatchObject({ status: 'withheld', sourceSupport: 'supported', novelty: 'variant', matchedEntryIds: ['q:original-question:immutable-v1'] });
    expect(result.responseIssues).toBeUndefined(); expect(completeJson).toHaveBeenCalledTimes(1);
  });
  it('supports an independent CAPM inference despite a worked example in the source', async () => {
    const result = await assessGenerationQuality({ ...input(), candidate: content('Calculate Cost of Equity using beta and risk premium.', 'Required return', 'Riskfree rate + Beta * Risk Premium') });
    expect(result).toMatchObject({ status: 'eligible', novelty: 'independent', matchedEntryIds: [] });
    expect(jest.mocked(completeJson).mock.calls[0][0]).toContain('Only M IDs below are prior questions');
  });
  it('does not convert a source-example false comparator into eligibility', async () => {
    jest.mocked(completeJson).mockResolvedValue({ ...review(), novelty: 'variant', matchedEntryIds: ['S1'], taskComparisons: [{ entryId: 'S1', sameInference: true, sameSolutionPath: true, contrast: 'Matches the source worked example.' }] });
    const result = await assessGenerationQuality(input());
    expect(result).toMatchObject({ status: 'withheld', novelty: 'uncertain', matchedEntryIds: [] });
    expect(result.responseIssues).toContainEqual(expect.objectContaining({ code: 'unknown-or-duplicate-memory-comparison' }));
  });
  it('permits supported mechanism or classification inference beyond a shared recall concept', async () => {
    for (const stem of ['Why do individual effects average out?', 'Classify a firm-only event and an economy-wide event.']) {
      expect(await assessGenerationQuality({ ...input(), candidate: content(stem) })).toMatchObject({ status: 'eligible', novelty: 'independent' });
    }
  });
  it.each(['duplicate', 'variant'])('still rejects a true same-path %s under another LO', async novelty => {
    jest.mocked(completeJson).mockResolvedValue({ ...review(), novelty, matchedEntryIds: ['M1'], taskComparisons: [{ entryId: 'M1', sameInference: true, sameSolutionPath: true, contrast: 'The same rule is recalled with changed wording/context.' }] });
    const result = await assessGenerationQuality(input());
    expect(result).toMatchObject({ status: 'withheld', novelty, matchedEntryIds: ['q:original-question:immutable-v1'] });
    expect(completeJson).toHaveBeenCalledTimes(1);
  });
  it('corrects a comparison whose negative verdict is based only on shared vocabulary', async () => {
    const bad = { ...review(), novelty: 'duplicate', matchedEntryIds: ['M1'] };
    jest.mocked(completeJson).mockResolvedValueOnce(bad).mockResolvedValueOnce(review());
    expect(await assessGenerationQuality(input())).toMatchObject({ status: 'eligible', novelty: 'independent' });
    expect(completeJson).toHaveBeenCalledTimes(2);
    const correction = jest.mocked(completeJson).mock.calls[1][0];
    expect(correction).toContain('bank-comparator-required');
    expect(correction).toContain('These fields contradict each other');
    expect(correction).toContain('Do not change booleans merely to pass validation');
    expect(correction).toContain('Do not output matchedEntryIds');
  });
  it('allows a contradiction correction to confirm a genuine duplicate without admitting it', async () => {
    const bad = { ...review(), novelty: 'variant' };
    const confirmed = { ...bad, taskComparisons: [{ entryId: 'M1', sameInference: true, sameSolutionPath: true,
      contrast: 'After checking the actual content, both tasks require the same diversification rule.' }] };
    jest.mocked(completeJson).mockResolvedValueOnce(bad).mockResolvedValueOnce(confirmed);
    expect(await assessGenerationQuality(input())).toMatchObject({ status: 'withheld', novelty: 'variant',
      matchedEntryIds: ['q:original-question:immutable-v1'] });
    expect(completeJson).toHaveBeenCalledTimes(2);
  });
  it('never silently repairs an inconsistent independence verdict into a pass', async () => {
    jest.mocked(completeJson).mockResolvedValue({ ...review(), taskComparisons: [{ entryId: 'M1', sameInference: true, sameSolutionPath: true, contrast: 'Same required task.' }] });
    expect(await assessGenerationQuality(input())).toMatchObject({ status: 'withheld', novelty: 'uncertain' });
    expect(completeJson).toHaveBeenCalledTimes(2);
    expect(jest.mocked(completeJson).mock.calls[1][0]).toContain('Do not erase a valid match to gain eligibility');
  });
  it('derives independence from comparison findings despite a redundant referenced-ID field', async () => {
    const response = { ...review(), matchedEntryIds: ['M1'], reasons: ['The Bank recalls the diversification proposition; this candidate classifies firm-only versus market events.'] };
    jest.mocked(completeJson).mockResolvedValue(response);
    const result = await assessGenerationQuality({ ...input(), candidate: content('Classify a one-firm event and an all-investment event.') });
    expect(result).toMatchObject({ status: 'eligible', novelty: 'independent', matchedEntryIds: [] });
    expect(result.responseIssues).toBeUndefined(); expect(completeJson).toHaveBeenCalledTimes(1);
  });
  it('accepts a span review with no redundant matched-ID output field', async () => {
    const response: Partial<ReturnType<typeof review>> = { ...review() }; delete response.matchedEntryIds;
    jest.mocked(completeJson).mockResolvedValue(response);
    expect(await assessGenerationQuality(input())).toMatchObject({ status: 'eligible', matchedEntryIds: [] });
  });
  it('retains intentional original variants without requiring an unrelated Bank task match', async () => {
    const args = input();
    jest.mocked(completeJson).mockResolvedValue({ ...review(), novelty: 'variant', taskComparisons: [] });
    expect(await assessGenerationQuality({ ...args, requirements: { ...args.requirements, intent: 'create-variant', original: snapshotQualityCandidate(content('Original diversification proposition.')) } })).toMatchObject({ status: 'eligible', novelty: 'variant', matchedEntryIds: [] });
  });
  it.each(['duplicate', 'variant'])('never promotes a negative %s verdict when comparison findings differ', async novelty => {
    jest.mocked(completeJson).mockResolvedValue({ ...review(), novelty, matchedEntryIds: ['M1'] });
    const result = await assessGenerationQuality(input());
    expect(result).toMatchObject({ status: 'withheld', novelty: 'uncertain', matchedEntryIds: [] }); expect(completeJson).toHaveBeenCalledTimes(2);
  });
  it('ignores malformed redundant transport IDs without overriding a true task match', async () => {
    jest.mocked(completeJson).mockResolvedValue({ ...review(), novelty: 'independent', matchedEntryIds: { forged: 'S999' }, taskComparisons: [{ entryId: 'M1', sameInference: true, sameSolutionPath: true, contrast: 'The actual required inference and path are the same.' }] });
    expect(await assessGenerationQuality(input())).toMatchObject({ status: 'withheld', novelty: 'uncertain', matchedEntryIds: ['q:original-question:immutable-v1'] });
  });
  it('rejects repeated comparison identities without persisting them as validated matches', async () => {
    const same = { entryId: 'M1', sameInference: true, sameSolutionPath: true, contrast: 'Same task.' };
    jest.mocked(completeJson).mockResolvedValue({ ...review(), novelty: 'duplicate', taskComparisons: [same, same] });
    const result = await assessGenerationQuality(input());
    expect(result).toMatchObject({ status: 'withheld', matchedEntryIds: [] });
    expect(result.responseIssues).toContainEqual(expect.objectContaining({ code: 'unknown-or-duplicate-memory-comparison' }));
  });
});
