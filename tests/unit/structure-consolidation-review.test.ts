import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { BSON } from 'mongodb';
import type { AuthoringBudgetReceipt } from '../../server/src/types/authoring-budget';
import type { GroundingObjective } from '../../server/src/types/structure';
import type { OutlineCapabilityComparison } from '../../server/src/types/structure-distinctness';
import { planOutlineCapabilityDistinctness } from '../../server/src/services/structure-capability-distinctness';
import { deriveOutlineConsolidationPlan, OUTLINE_CONSOLIDATION_PROTOCOL } from '../../server/src/services/structure-outline-consolidation';
import { validateOutlineGroundingRows } from '../../server/src/services/structure-outline-grounding';
import { selectCapabilityOutlineGroundingBatch, type CapabilityOutlineGroundingBatch } from '../../server/src/services/structure-capability-grounding';
import { reviewCapabilityStructureProposal, type ReviewProgress } from '../../server/src/services/structure-capability-review';
import { finalizeConsolidationReview, outlineConsolidationReviewProtocolHash, prepareConsolidationReview,
  replayConsolidationReviewDispatches, type ConsolidationReviewDispatch, type ConsolidationReviewPlan } from '../../server/src/services/structure-consolidation-review';

jest.mock('../../server/src/config/env', () => ({ env: {} }));

// SCRIPTED protocol controls, never professor/model judgments or saved yield.
const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` :
  value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}` : JSON.stringify(value);
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
function budget(): AuthoringBudgetReceipt {
  return { version: 1, estimator: 'utf8-bytes-conservative-v1', retryVisibility: 'unknown', limitScope: 'process',
    limits: { maxSends: 100, maxInputTokens: 48000, maxOutputTokens: 6000, maxEstimatedTokens: 2000000 },
    observedSends: 31, estimatedInputTokens: 1268173, reservedOutputTokens: 186000, admissionTokens: 1454173,
    accounting: 'conservative-reservations-v1', pendingSends: 0, settledSends: 0, conservativeFinishedSends: 31,
    reportedInputTokens: null, reportedOutputTokens: null, usageCompleteness: 'unknown',
    queueWaitMs: 0, executionMs: 0, rejectedSends: 0,
    logical: { generatorAttempts: 0, repairCycles: 0, evidenceExpansions: 0,
      limits: { generatorAttempts: 1, repairCycles: 1, evidenceExpansions: 1 } } };
}
function fixture(scrambledCoordinates = false) {
  const texts = [
    'Classify financing choices. Explain how dividends reduce equity. Calculate price appreciation as cost of equity minus dividend yield.',
    'Describe valuation inputs. Compare valuation assumptions. Evaluate valuation outcomes under the stated alternatives.',
    'Identify portfolio inputs. Calculate portfolio outcomes. Explain portfolio limitations in the stated setting.',
  ];
  const pointNames = ['Classify financing choices.', 'Explain how dividends reduce equity.',
    'Calculate price appreciation as cost of equity minus dividend yield.', 'Describe valuation inputs.',
    'Compare valuation assumptions.', 'Evaluate valuation outcomes under the stated alternatives.',
    'Identify portfolio inputs.', 'Calculate portfolio outcomes.', 'Explain portfolio limitations in the stated setting.'];
  const sources = texts.map((text, i) => ({ alias: `S${i + 1}`, id: `S${444 + i}`, localId: `C${i + 1}.S1`,
    materialId: `M${i + 1}`, materialName: `Chapter ${i + 1}.pdf`, chunkIndex: i, text }));
  const points = pointNames.map((objective, i) => ({ id: `E${i + 1}`, objective,
    materialId: `M${Math.floor(i / 3) + 1}`, sourceIds: [`S${Math.floor(i / 3) + 1}`] }));
  const objectives: GroundingObjective[] = points.map((point, i) => {
    const assigned = i === 1 ? [points[1]!, points[2]!] : i === 2 ? points.slice(0, 3) : i === 3 ? [points[3]!, points[4]!] : [point];
    return { id: `L${(i + 1) * 10}`, themeIndex: scrambledCoordinates ? 20 - i * 2 : 4 + Math.floor(i / 3) * 3, loIndex: i % 3 * 2,
      topic: ['Financing', 'Valuation', 'Portfolio'][Math.floor(i / 3)]!,
      name: i === 1 ? 'Explain dividends and calculate price appreciation.' : i === 2 ? 'Classify financing and explain dividends.'
        : i === 3 ? 'Describe valuation inputs and compare valuation assumptions.' : point.objective,
      contentHash: createHash('sha256').update(String(i)).digest('hex'), evidenceIds: assigned.map(row => row.id),
      materialIds: [point.materialId], sourceIds: [...point.sourceIds], learningPoints: structuredClone(assigned) };
  });
  const context = planOutlineCapabilityDistinctness([{ objectives, sources, prompt: '' }], 'outline-capability-distinctness-v1')!;
  const findings = objectives.map(row => validateOutlineGroundingRows({ reviews: [{ id: row.id, sourceStatus: 'supported',
    sourceIds: row.sourceIds, coveredEvidenceIds: row.id === 'L30' ? ['E1', 'E2'] : row.evidenceIds,
    sourceReason: 'SCRIPTED source support.', topicFit: 'fits', topicReason: 'SCRIPTED topic.' }] },
  { objectives: [row], sources, prompt: '' }).findings[0]!);
  const obligations = deriveOutlineConsolidationPlan(context, findings, ['L10', 'L20', 'L30']);
  const proposal = { version: OUTLINE_CONSOLIDATION_PROTOCOL, planHash: obligations.planHash,
    replacements: [{ id: 'L10', name: 'Classify financing choices.', evidenceIds: ['E1'] },
      { id: 'L30', name: 'Explain dividends and calculate price appreciation.', evidenceIds: ['E2', 'E3'] }],
    lineage: [{ previousId: 'L10', successorIds: ['L10'] }, { previousId: 'L20', successorIds: ['L30'] },
      { previousId: 'L30', successorIds: ['L10', 'L30'] }] };
  const input = { parentContext: context, parentSourceFindings: findings, selectedIds: obligations.selectedIds,
    proposal, terminalBudget: budget(), expectedBudgetLimits: { ...budget().limits }, inputLimit: 46500 };
  return { input, plan: prepareConsolidationReview(input) };
}
function verdict(batch: CapabilityOutlineGroundingBatch) {
  const context = batch.capabilityContext;
  return { reviews: batch.objectives.map(row => ({ id: row.id, sourceStatus: 'supported', sourceIds: row.sourceIds,
    coveredEvidenceIds: row.evidenceIds, sourceReason: 'SCRIPTED fresh child source support.', topicFit: 'fits', topicReason: 'SCRIPTED grouping.' })),
  capabilityComparisons: context.nominations.flatMap(row => row.peerIds.map(peerId => {
    const candidate = context.objectives.find(objective => objective.id === row.objectiveId)!;
    const peer = context.objectives.find(objective => objective.id === peerId)!;
    const quote = (id: string) => ({ sourceId: id, quote: context.sources.find(source => source.alias === id)!.text });
    return { objectiveId: candidate.id, peerId, pairId: context.pairs.find(pair => [pair.firstId, pair.secondId].includes(candidate.id) &&
      [pair.firstId, pair.secondId].includes(peerId))!.id, relation: 'distinct' as OutlineCapabilityComparison['relation'],
    candidateOperation: `SCRIPTED ${candidate.id}: ${candidate.name}`, peerOperation: `SCRIPTED ${peer.id}: ${peer.name}`,
    sharedCapabilities: [] as OutlineCapabilityComparison['sharedCapabilities'],
    candidateUniqueCapabilities: [{ operation: candidate.name, quotes: [quote(candidate.sourceIds[0]!)] }],
    peerUniqueCapabilities: [{ operation: peer.name, quotes: [quote(peer.sourceIds[0]!)] }], reason: 'SCRIPTED distinct required operations.' };
  })) };
}
type RawReview = ReturnType<typeof verdict>;
async function scripted(plan: ConsolidationReviewPlan, edit?: (raw: RawReview, ids: string[], attempt: number, item: number) => void) {
  const history: ConsolidationReviewDispatch[] = [], prompts: string[] = [];
  const progress: ReviewProgress = { findings: [], attempts: {}, unresolvedDispatchIds: [], failures: [] };
  let active: { ids: string[]; item: number; attempt: number; promptHash: string };
  let error: unknown;
  try {
    await reviewCapabilityStructureProposal({ batches: plan.batches, progress, assertCurrent: async () => {},
      beforeDispatch: async (ids, attempt, item) => { active = { ids, item, attempt, promptHash: '' }; },
      complete: async (prompt, item, attempt) => {
        prompts.push(prompt); active.promptHash = hash(prompt);
        const batch = selectCapabilityOutlineGroundingBatch(plan.batches[item]!, active.ids) as CapabilityOutlineGroundingBatch;
        const raw = verdict(batch); edit?.(raw, active.ids, attempt, item); return raw;
      },
      afterValidation: async row => { history.push({ planHash: plan.planHash, ...active,
        raw: structuredClone(row.raw), rawHash: hash(row.raw), findings: row.findings, failures: row.failures }); } });
  } catch (caught) { error = caught; }
  return { history, prompts, progress, error };
}

describe('explicit-ID consolidation fresh review layer (scripted, no durable authority)', () => {
  it('packs every full child source, point and directed comparison without retiring or renumbering peers', () => {
    const { plan } = fixture(), context = plan.draft.childContext;
    expect(plan.sourceReviewScope).toBe('all-child-objectives-fresh-no-parent-row-reuse');
    expect(plan.freshSourceTargetIds).toEqual(context.candidateIds);
    expect(plan.freshSourceTargetIds).toEqual(['L10', 'L30', 'L40', 'L50', 'L60', 'L70', 'L80', 'L90']);
    expect(plan.batches.flatMap(batch => batch.objectives.map(row => row.id)).sort()).toEqual([...context.candidateIds].sort());
    expect(plan.batches.every(batch => batch.objectives.length <= 4 && batch.sources.length === 0 && batch.prompt === '')).toBe(true);
    for (const batch of plan.batches) {
      const actual = selectCapabilityOutlineGroundingBatch(batch, batch.objectives.map(row => row.id)) as CapabilityOutlineGroundingBatch;
      for (const original of actual.capabilityContext.sources) {
        expect(original).toEqual(context.sources.find(row => row.alias === original.alias));
        expect(actual.prompt).toContain(original.text);
      }
      for (const objective of batch.objectives) for (const point of objective.learningPoints) expect(actual.prompt).toContain(point.objective);
    }
    expect(plan.freshComparisons).toEqual(plan.draft.comparisonClosure.allChildComparisons);
    expect(plan.packing.minimumAdditionalUnits).toBe(plan.admission.minimumAdditionalUnits);
    expect(plan.admission.fits).toBe(true);
  });

  it('runs the existing driver and replays actual raw dispatches before compacting a 3→2 result', async () => {
    const { plan } = fixture(), run = await scripted(plan);
    expect(run.error).toBeUndefined(); expect(run.history.length).toBe(plan.batches.length);
    const result = await finalizeConsolidationReview(plan, run.history);
    expect(result.status).toBe('reviewed-projection'); expect(result.shortfalls).toEqual([]);
    expect(result.replay.dispatches).toBe(run.history.length); expect(result.grounding.capabilityDistinctness.complete).toBe(true);
    expect(result.retiredIds).toEqual(['L20']); expect(result.stableIndex.map(row => row.id)).toEqual(plan.freshSourceTargetIds);
    expect(result.stableIndex[1]).toEqual({ id: 'L30', originalThemeIndex: 4, originalLoIndex: 4, themeIndex: 0, loIndex: 1 });
    expect(result.themes.map(row => row.name)).toEqual(['Financing', 'Valuation', 'Portfolio']);
    expect(result.themes[0]!.los[1]!.evidenceIds).toEqual(['E2', 'E3']);
    expect(result.creditPreservation.find(row => row.previousId === 'L20' && row.evidenceId === 'E3')!.coveredBy).toEqual(['L30']);
    expect(result.authority).toContain('not-durable-or-apply-authority');
  });

  it('retains valid siblings and reconstructs the exact one-correction subset prompt', async () => {
    const { plan } = fixture(); let broken = '';
    const run = await scripted(plan, (raw, ids, attempt, item) => {
      if (item === 0 && attempt === 0) { broken = ids[0]!; raw.reviews.find(row => row.id === broken)!.sourceIds = ['S999']; }
    });
    expect(run.error).toBeUndefined(); expect(run.history[0]!.findings.length).toBe(plan.batches[0]!.objectives.length - 1);
    expect(run.history[1]!.ids).toEqual([broken]); expect(run.history[1]!.attempt).toBe(1);
    expect(run.prompts[1]).toContain('Correct ONLY the remaining objectives');
    expect((await replayConsolidationReviewDispatches(plan, run.history)).complete).toBe(true);
  });

  it('projects original curriculum coordinates independently of stable numeric IDs or review packing order', async () => {
    const { plan } = fixture(true), run = await scripted(plan), result = await finalizeConsolidationReview(plan, run.history);
    const curriculum = [...plan.draft.childContext.objectives].sort((a, b) => a.themeIndex - b.themeIndex || a.loIndex - b.loIndex);
    expect(result.status).toBe('reviewed-projection'); expect(result.stableIndex.map(row => row.id)).toEqual(curriculum.map(row => row.id));
    expect(result.stableIndex[0]!.id).toBe('L90');
    for (const row of result.stableIndex) expect([row.originalThemeIndex, row.originalLoIndex]).toEqual([
      plan.draft.childContext.objectives.find(objective => objective.id === row.id)!.themeIndex,
      plan.draft.childContext.objectives.find(objective => objective.id === row.id)!.loIndex,
    ]);
    expect(plan.draft.childContext.candidateIds[0]).toBe('L10');
  });

  it('exercises cross-batch prior findings and contradictory relation correction without forcing a positive verdict', async () => {
    const { plan } = fixture(), owner = new Map(plan.batches.flatMap((batch, i) => batch.objectives.map(row => [row.id, i] as const)));
    const pair = plan.freshComparisons.find(row => owner.get(row.objectiveId)! > owner.get(row.peerId)! &&
      plan.freshComparisons.some(other => other.objectiveId === row.peerId && other.peerId === row.objectiveId));
    expect(pair).toBeDefined();
    const run = await scripted(plan, (raw, _ids, attempt) => {
      const row = raw.capabilityComparisons.find(row => row.objectiveId === pair!.objectiveId && row.peerId === pair!.peerId);
      if (row && attempt === 0) { row.relation = 'uncertain'; row.candidateUniqueCapabilities = []; row.peerUniqueCapabilities = []; }
    });
    expect(run.error).toBeUndefined(); expect(run.history.some(row => row.failures.some(failure => failure.reason.includes('relation-conflict')))).toBe(true);
    expect(run.prompts.some(prompt => prompt.includes('Previously retained peer comparisons (untrusted judgments, not source proof)'))).toBe(true);
    expect((await finalizeConsolidationReview(plan, run.history)).status).toBe('reviewed-projection');
  });

  it('withholds a calculation credit that was assigned but not freshly covered, even beside a supported explanation on the same source', async () => {
    const { plan } = fixture(), run = await scripted(plan, raw => {
      const row = raw.reviews.find(row => row.id === 'L30'); if (row) row.coveredEvidenceIds = ['E2'];
    });
    const result = await finalizeConsolidationReview(plan, run.history);
    expect(result.status).toBe('shortfall'); expect(result.themes).toEqual([]);
    expect(result.shortfalls).toContainEqual(expect.objectContaining({ previousId: 'L20', evidenceId: 'E3', coveredBy: [],
      successors: [{ id: 'L30', status: 'credit-not-covered' }] }));
  });

  it.each(['unsupported', 'uncertain', 'lost-credit'] as const)('discloses unrelated unchanged-objective %s losses instead of silently filtering them from a successful projection', async mode => {
    const { plan } = fixture(), run = await scripted(plan, raw => {
      const row = raw.reviews.find(row => row.id === 'L40');
      if (row && mode === 'lost-credit') row.coveredEvidenceIds = ['E4'];
      else if (row) { row.sourceStatus = mode; row.coveredEvidenceIds = []; }
    });
    const result = await finalizeConsolidationReview(plan, run.history);
    expect(result.status).toBe('shortfall'); expect(result.themes).toEqual([]);
    expect(result.shortfalls.some(row => row.scope === 'selected-lineage')).toBe(false);
    expect(result.shortfalls).toContainEqual(expect.objectContaining({ scope: 'unchanged-parent', previousId: 'L40', evidenceId: 'E5', coveredBy: [] }));
    // L50 still covers E5, but it is not an explicit successor of unchanged L40.
    expect(result.replay.findings.find(row => row.id === 'L50')!.coveredEvidenceIds).toEqual(['E5']);
  });

  it('withholds the complete projection when an unchanged source-supported parent becomes capability-held', async () => {
    const { plan } = fixture(), run = await scripted(plan, raw => {
      for (const row of raw.capabilityComparisons) if (['L40', 'L50'].includes(row.objectiveId) && ['L40', 'L50'].includes(row.peerId)) {
        row.relation = 'equivalent'; row.sharedCapabilities = [{ operation: 'SCRIPTED unchanged overlap.',
          candidateQuotes: row.candidateUniqueCapabilities[0]!.quotes, peerQuotes: row.peerUniqueCapabilities[0]!.quotes }];
        row.candidateUniqueCapabilities = []; row.peerUniqueCapabilities = [];
      }
    });
    const result = await finalizeConsolidationReview(plan, run.history);
    expect(result.status).toBe('shortfall'); expect(result.themes).toEqual([]);
    expect(result.shortfalls.some(row => row.scope === 'selected-lineage')).toBe(false);
    expect(result.shortfalls).toContainEqual(expect.objectContaining({ scope: 'unchanged-parent', previousId: 'L40',
      successors: [{ id: 'L40', status: 'capability-held' }] }));
  });

  it.each(['unsupported', 'uncertain'] as const)('does not discharge old credits using a fresh %s successor', async sourceStatus => {
    const { plan } = fixture(), run = await scripted(plan, raw => {
      const row = raw.reviews.find(row => row.id === 'L30');
      if (row) { row.sourceStatus = sourceStatus; row.coveredEvidenceIds = []; }
    });
    const result = await finalizeConsolidationReview(plan, run.history);
    expect(result.status).toBe('shortfall'); expect(result.shortfalls.some(row => row.successors.some(item => item.status === sourceStatus))).toBe(true);
  });

  it('keeps source-supported equivalents held and never treats the old credit union as distinctness approval', async () => {
    const { plan } = fixture(), run = await scripted(plan, raw => {
      for (const row of raw.capabilityComparisons) {
        row.relation = 'equivalent'; row.sharedCapabilities = [{ operation: 'SCRIPTED repeated capability.',
          candidateQuotes: row.candidateUniqueCapabilities[0]!.quotes, peerQuotes: row.peerUniqueCapabilities[0]!.quotes }];
        row.candidateUniqueCapabilities = []; row.peerUniqueCapabilities = [];
      }
    });
    const result = await finalizeConsolidationReview(plan, run.history);
    expect(result.grounding.capabilityDistinctness.complete).toBe(true);
    expect(result.status).toBe('shortfall'); expect(result.themes).toEqual([]);
    expect(result.shortfalls.some(row => row.successors.some(item => item.status === 'capability-held'))).toBe(true);
  });

  it('does not reuse complete parent source rows when child history is absent or partial', async () => {
    const { plan } = fixture(), run = await scripted(plan);
    const absent = await finalizeConsolidationReview(plan, []);
    expect(absent.status).toBe('incomplete'); expect(absent.replay.findings).toEqual([]); expect(absent.themes).toEqual([]);
    const partial = await finalizeConsolidationReview(plan, run.history.slice(0, 1));
    expect(partial.status).toBe('incomplete'); expect(partial.replay.findings.length).toBeLessThan(plan.freshSourceTargetIds.length);
    expect(partial.themes).toEqual([]);
  });

  it('retains two failed raw attempts as incomplete diagnostics without granting a third correction', async () => {
    const { plan } = fixture(), run = await scripted(plan, raw => { raw.reviews[0]!.sourceIds = ['S999']; });
    expect(run.error).toBeInstanceOf(Error); expect(run.history.filter(row => row.ids.includes(plan.batches[0]!.objectives[0]!.id))).toHaveLength(2);
    const result = await finalizeConsolidationReview(plan, run.history);
    expect(result.status).toBe('incomplete'); expect(result.replay.failures.length).toBeGreaterThan(0);
    const third = structuredClone(run.history); third.push({ ...third[1]!, attempt: 2 });
    await expect(finalizeConsolidationReview(plan, third)).rejects.toThrow('dispatch-binding');
  });

  it('keeps a terminal malformed capability quote as an exact replayed incomplete finding without masking binding or budget errors', async () => {
    const { plan } = fixture(), run = await scripted(plan, raw => {
      raw.capabilityComparisons[0]!.candidateUniqueCapabilities[0]!.quotes[0]!.quote = 'THIS IS NOT IN THE ORIGINAL SOURCE';
    });
    expect(run.error).toBeInstanceOf(Error);
    expect((run.error as Error).message).toBe('structure-distinctness-quote-identity');
    const result = await finalizeConsolidationReview(plan, run.history);
    expect(result.status).toBe('incomplete'); expect(result.themes).toEqual([]);
    expect(result.replay.terminalError).toBe('structure-distinctness-quote-identity');
    expect(result.replay.failures.some(row => row.reason === result.replay.terminalError)).toBe(true);
    expect(result.replay.historyHash).toBe(hash(run.history));
    const tampered = structuredClone(run.history); tampered[0]!.promptHash = '0'.repeat(64);
    await expect(finalizeConsolidationReview(plan, tampered)).rejects.toThrow('dispatch-prompt');
  });

  it('gates the whole minimum native reservation before any replay and does not reset the terminal allowance', async () => {
    const { input, plan } = fixture(); input.terminalBudget.limits.maxEstimatedTokens =
      input.terminalBudget.admissionTokens! + plan.admission.minimumAdditionalUnits - 1;
    input.expectedBudgetLimits = { ...input.terminalBudget.limits };
    const refused = prepareConsolidationReview(input);
    expect(refused.admission.fits).toBe(false); expect(refused.admission.remainingUnits).toBe(plan.admission.minimumAdditionalUnits - 1);
    await expect(replayConsolidationReviewDispatches(refused, [])).rejects.toThrow('budget-shortfall');
    input.terminalBudget.limits.maxEstimatedTokens += 1;
    input.expectedBudgetLimits = { ...input.terminalBudget.limits };
    expect(prepareConsolidationReview(input).admission.fits).toBe(true);
  });

  it.each(['sends', 'output'] as const)('refuses a terminal %s allowance shortage', async mode => {
    const { input } = fixture();
    if (mode === 'sends') input.terminalBudget.limits.maxSends = input.terminalBudget.observedSends;
    if (mode === 'output') input.terminalBudget.limits.maxOutputTokens = 5999;
    input.expectedBudgetLimits = { ...input.terminalBudget.limits };
    const plan = prepareConsolidationReview(input); expect(plan.admission.fits).toBe(false);
    await expect(finalizeConsolidationReview(plan, [])).rejects.toThrow('budget-shortfall');
  });

  it.each(['admission', 'pending', 'settled', 'finished', 'accounting', 'missing-counter', 'limits', 'fractional', 'logical', 'usage'] as const)(
    'rejects a newly supplied corrupt %s terminal receipt, rather than merely detecting a later plan mutation', mode => {
      const { input } = fixture();
      if (mode === 'admission') input.terminalBudget.admissionTokens! -= 1;
      if (mode === 'pending') input.terminalBudget.pendingSends = 1;
      if (mode === 'settled') input.terminalBudget.settledSends = 1;
      if (mode === 'finished') input.terminalBudget.conservativeFinishedSends! -= 1;
      if (mode === 'accounting') input.terminalBudget.accounting = 'reported-usage-settlement-v1';
      if (mode === 'missing-counter') delete input.terminalBudget.conservativeFinishedSends;
      if (mode === 'limits') input.terminalBudget.limits.maxEstimatedTokens += 1000;
      if (mode === 'fractional') input.terminalBudget.observedSends = 31.5;
      if (mode === 'logical') input.terminalBudget.logical.repairCycles = 2;
      if (mode === 'usage') input.terminalBudget.reportedInputTokens = -1;
      expect(() => prepareConsolidationReview(input)).toThrow();
    });

  it('refuses correction history whose known native minimum exceeds the inherited complete-plan allowance', async () => {
    const { input, plan: before } = fixture();
    input.terminalBudget.limits.maxEstimatedTokens = input.terminalBudget.admissionTokens! + before.admission.minimumAdditionalUnits;
    input.expectedBudgetLimits = { ...input.terminalBudget.limits };
    const plan = prepareConsolidationReview(input), run = await scripted(plan, (raw, _ids, attempt, item) => {
      if (item === 0 && attempt === 0) raw.reviews[0]!.sourceIds = ['S999'];
    });
    expect(plan.admission.fits).toBe(true);
    await expect(replayConsolidationReviewDispatches(plan, run.history)).rejects.toThrow('dispatch-budget');
  });

  it.each(['plan', 'raw', 'prompt', 'ids', 'result', 'extra'] as const)('rejects altered or replayed %s dispatch authority', async mode => {
    const { plan } = fixture(), run = await scripted(plan), rows = structuredClone(run.history);
    if (mode === 'plan') rows[0]!.planHash = 'a'.repeat(64);
    if (mode === 'raw') (rows[0]!.raw as RawReview).reviews[0]!.sourceReason = 'Changed raw finding.';
    if (mode === 'prompt') rows[0]!.promptHash = 'a'.repeat(64);
    if (mode === 'ids') rows[0]!.ids.reverse();
    if (mode === 'result') rows[0]!.findings[0]!.reason = 'Stored result differs from raw.';
    if (mode === 'extra') rows.push(rows[0]!);
    await expect(finalizeConsolidationReview(plan, rows)).rejects.toThrow();
  });

  it('replays exact plain data through actual BSON and rejects changed sources, proof counts and child drafts', async () => {
    const { plan } = fixture(), run = await scripted(plan);
    const recovered = BSON.deserialize(BSON.serialize({ plan, history: run.history })) as { plan: typeof plan; history: typeof run.history };
    expect(await finalizeConsolidationReview(recovered.plan, recovered.history)).toEqual(await finalizeConsolidationReview(plan, run.history));
    for (const change of [
      (row: ConsolidationReviewPlan) => { row.draft.childContext.sources[0]!.text += ' Changed.'; },
      (row: ConsolidationReviewPlan) => { row.input.terminalBudget.admissionTokens! -= 1; },
      (row: ConsolidationReviewPlan) => { row.freshSourceTargetIds.pop(); },
      (row: ConsolidationReviewPlan) => { row.draft.memberCreditObligations.pop(); },
    ]) {
      const altered = structuredClone(plan); change(altered);
      // A corrupt allowance now refuses before the later full-plan comparison.
      await expect(finalizeConsolidationReview(altered, run.history)).rejects.toThrow('structure-consolidation-review-');
    }
  });

  it('clones exact source and parent inputs and binds current pure dependencies without touching legacy selectors', () => {
    const { input, plan } = fixture(), original = structuredClone(input);
    plan.draft.childContext.sources[0]!.text += ' Caller mutation.';
    expect(input).toEqual(original); expect(prepareConsolidationReview(input).draft.childContext.sources[0]!.text).toBe(original.parentContext.sources[0]!.text);
    expect(outlineConsolidationReviewProtocolHash()).toMatch(/^[a-f0-9]{64}$/);
    expect(createHash('sha256').update(readFileSync('server/src/services/structure-outline-grounding.ts')).digest('hex'))
      .toBe('a6f9fa23f3b7b35c9f2dd52a85303953f9e4e3917c59356fdd0ef1c1e6acf366');
  });
});
