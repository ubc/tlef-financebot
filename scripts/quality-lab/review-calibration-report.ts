/** Offline reporting only. No application/provider imports or execution authority. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

export type ReportJson = null | boolean | number | string | ReportJson[] | { [key: string]: ReportJson };
export const REVIEW_CALIBRATION_CASES = Object.freeze(['P01', 'P02', 'P04', 'CAPM', 'P03'] as const);
export const REVIEW_CALIBRATION_ARMS = Object.freeze([
  Object.freeze({ id: 'luna-none', model: 'gpt-6-luna', reasoningEffort: 'none', nativeTemperature: 0 }),
  Object.freeze({ id: 'luna-medium', model: 'gpt-6-luna', reasoningEffort: 'medium', nativeTemperature: 'omitted' }),
  Object.freeze({ id: 'sol-medium', model: 'gpt-6.1-sol', reasoningEffort: 'medium', nativeTemperature: 'omitted' }),
] as const);
export const REVIEW_CALIBRATION_SCHEDULE = Object.freeze(REVIEW_CALIBRATION_CASES.flatMap((caseId, caseIndex) =>
  REVIEW_CALIBRATION_ARMS.map((_arm, offset) => {
    const arm = REVIEW_CALIBRATION_ARMS[(caseIndex + offset) % 3];
    return Object.freeze({ order: caseIndex * 3 + offset, id: `${caseId}--${arm.id}--r1`, caseId, armId: arm.id, repetition: 1 as const });
  })));
const pinSchema = z.object({ path: z.string().min(1).max(4096), sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().nonnegative().optional() }).strict();
const count = z.number().int().nonnegative().refine(Number.isSafeInteger);
const nullableCount = count.nullable();
const facetNames = ['source', 'notation', 'bank', 'answerability', 'taskDemand', 'difficulty', 'teacher', 'format', 'drift'] as const;
const caseIdSchema = z.enum(REVIEW_CALIBRATION_CASES);
const bindingSchema = z.object({ candidate: z.string().regex(/^[a-f0-9]{64}$/), packet: z.string().regex(/^[a-f0-9]{64}$/),
  memory: z.string().regex(/^[a-f0-9]{64}$/), requirements: z.string().regex(/^[a-f0-9]{64}$/), context: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const inputDifficultySchema = z.object({ requested: z.enum(['easy', 'medium', 'hard']).nullable(), candidate: z.enum(['easy', 'medium', 'hard']).nullable(), evidence: z.array(pinSchema).min(1) }).strict();
const usageSchema = z.object({ inputTokens: nullableCount, outputTokens: nullableCount, reasoningTokens: nullableCount,
  cachedInputTokens: nullableCount, cacheWriteTokens: nullableCount.optional() }).passthrough();
const logicalSchema = z.object({ logicalAttempt: z.union([z.literal(0), z.literal(1)]), prompt: z.string(), systemPrompt: z.string().optional(),
  productionRequestedOutputCap: count, experimentalNativeOutputCap: z.literal(6000), state: z.enum(['started', 'parsed', 'known-json-exhausted']),
  parsed: z.unknown().optional(), rawText: z.string().nullable().optional(), sdkIds: z.array(count).max(2), evidence: z.array(pinSchema).optional() }).passthrough();
const attemptSchema = z.object({ sdkId: count.refine(value => value > 0), logicalAttempt: z.union([z.literal(0), z.literal(1)]), jsonAttempt: z.union([z.literal(0), z.literal(1)]),
  prompt: z.string(), systemPrompt: z.string().optional(), nativeRequest: z.unknown(), productionRequestedOutputCap: count,
  experimentalNativeOutputCap: z.literal(6000), inputUnits: count, reservationUnits: count, dispatched: z.boolean(), physicalPosts: count,
  settled: z.boolean(), unknown: z.boolean(), visibleOutput: z.string().nullable(), returnedModel: z.string().nullable(), finishReason: z.string().nullable(),
  usage: usageSchema.nullable(), evidence: z.array(pinSchema).optional() }).passthrough();
const cellSchema = z.object({ id: z.string(), cellId: z.string().optional(), caseId: caseIdSchema, armId: z.enum(['luna-none', 'luna-medium', 'sol-medium']), order: count,
  repetition: z.literal(1), state: z.enum(['not-started', 'interrupted', 'reviewed', 'cell-format-invalid']), quality: z.unknown().optional(),
  logicalReviews: z.array(logicalSchema).max(2), attempts: z.array(attemptSchema).max(4), inputBindings: bindingSchema.optional(),
  formatStatus: z.enum(['validated', 'invalid', 'truncated']).optional(), inputDifficulty: inputDifficultySchema.optional() }).passthrough();
export const reviewCalibrationReportInputSchema = z.object({
  version: z.literal('review-calibration-report-input-v1'), mode: z.enum(['scripted-offline', 'recorded-provider']),
  run: z.object({ cells: z.array(cellSchema).max(15), sdkSends: count, physicalWirePosts: count, conservativeReservations: count }).passthrough(),
  rubric: z.object({ version: z.string().min(1).max(200), evidence: z.array(pinSchema).min(1), annotations: z.array(z.object({ caseId: caseIdSchema,
    facet: z.enum(facetNames), origin: z.enum(['manual-ai-diagnostic', 'manual-human-diagnostic']), text: z.string().min(1).max(10000), evidence: z.array(pinSchema) }).strict()).max(100) }).strict(),
  professorLabels: z.array(z.object({ caseId: caseIdSchema, facet: z.enum(facetNames), label: z.string().min(1).max(10000),
    assessor: z.string().min(1).max(300), evidence: z.array(pinSchema).min(1) }).strict()).nullable(),
  evidence: z.array(pinSchema),
}).strict();
export type ReviewCalibrationReportInput = z.infer<typeof reviewCalibrationReportInputSchema>;
type Cell = z.infer<typeof cellSchema>;
type Attempt = z.infer<typeof attemptSchema>;

/** Reject executable/accessor/cyclic/non-JSON data before any projection. Copies
 * are independent; this is a JSON report contract, not BSON/database authority. */
function copyJson(value: unknown): ReportJson {
  const active = new Set<object>(); let nodes = 0;
  const walk = (row: unknown, depth: number): ReportJson => {
    if (++nodes > 250000 || depth > 64) throw new Error('review-calibration-report-json-bound');
    if (row === null || typeof row === 'string' || typeof row === 'boolean') return row;
    if (typeof row === 'number' && Number.isFinite(row)) return row;
    if (!row || typeof row !== 'object' || active.has(row)) throw new Error('review-calibration-report-plain-json-required');
    const proto = Object.getPrototypeOf(row);
    if (!Array.isArray(row) && proto !== Object.prototype && proto !== null) throw new Error('review-calibration-report-plain-json-required');
    active.add(row);
    const descriptors = Object.getOwnPropertyDescriptors(row);
    if (Object.getOwnPropertySymbols(row).length) throw new Error('review-calibration-report-plain-json-required');
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype' || !('value' in descriptor)) throw new Error('review-calibration-report-plain-json-required');
    }
    let result: ReportJson;
    if (Array.isArray(row)) {
      if (row.length > 250000) throw new Error('review-calibration-report-json-bound');
      if (Object.keys(descriptors).some(key => key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key))) throw new Error('review-calibration-report-plain-json-required');
      result = Array.from({ length: row.length }, (_entry, index) => {
        if (!descriptors[index]) throw new Error('review-calibration-report-plain-json-required');
        return walk(descriptors[index].value, depth + 1);
      });
    } else result = Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, walk(descriptor.value, depth + 1)]));
    active.delete(row); return result;
  };
  return walk(value, 0);
}
const object = (value: unknown): Record<string, ReportJson> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, ReportJson> : {};
const field = (value: unknown, key: string): ReportJson => object(value)[key] ?? null;
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
const equal = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
function projectedFacets(value: unknown, fixedDifficulty?: z.infer<typeof inputDifficultySchema>) {
  return { qualityStatus: field(value, 'status'), source: { support: field(value, 'sourceSupport'), citations: field(value, 'citations'), missingPremises: field(value, 'missingPremises') },
    notation: field(value, 'notation'), bank: { novelty: field(value, 'novelty'), taskComparisons: field(value, 'taskComparisons'), matchedEntryIds: field(value, 'matchedEntryIds'), comparedEntryIds: field(value, 'comparedEntryIds') },
    answerability: field(value, 'answerability'), exclusionReview: field(value, 'exclusionReview'), taskDemand: field(value, 'taskDemand'),
    difficulty: { requested: fixedDifficulty?.requested ?? null, candidate: fixedDifficulty?.candidate ?? null, inputEvidence: fixedDifficulty?.evidence ?? [], achieved: field(value, 'achievedDifficulty'), mismatch: field(value, 'difficultyMismatch') },
    teacher: { changes: field(value, 'changes'), invariants: field(value, 'invariants'), justifiedLength: field(value, 'justifiedLength') }, findings: field(value, 'findings') };
}
function responseModelMatches(requested: string, returned: string | null): boolean {
  if (returned === requested) return true;
  if (!returned?.startsWith(requested + '-')) return false;
  const suffix = returned.slice(requested.length + 1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(suffix)) return false;
  const time = Date.parse(suffix + 'T00:00:00.000Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === suffix;
}
/** These are shape observations, never a replay of source entailment or the
 * production semantic schema. Initial partial reviews remain inspectable. */
function facetShapes(value: unknown) {
  const scalar = (key: string, values: string[]) => {
    const row = field(value, key); return row === null ? 'missing' : typeof row === 'string' && values.includes(row) ? 'recognized-enum' : 'invalid-shape';
  };
  const structured = (key: string) => field(value, key) === null ? 'missing' : typeof field(value, key) === 'object' ? 'present-unvalidated' : 'invalid-shape';
  return { source: scalar('sourceSupport', ['supported', 'unsupported', 'uncertain']), notation: scalar('notation', ['consistent', 'inconsistent', 'uncertain']),
    bank: scalar('novelty', ['independent', 'duplicate', 'variant', 'uncertain']), answerability: structured('answerability'), taskDemand: structured('taskDemand'),
    difficulty: scalar('achievedDifficulty', ['easy', 'medium', 'hard']),
    teacher: Array.isArray(field(value, 'changes')) && Array.isArray(field(value, 'invariants')) ? 'present-unvalidated' : 'missing-or-invalid-shape' };
}
function usageTotals(attempts: Attempt[]) {
  const sum = (key: 'inputTokens' | 'outputTokens' | 'reasoningTokens' | 'cachedInputTokens' | 'cacheWriteTokens') => {
    const known = attempts.filter(row => row.dispatched && typeof row.usage?.[key] === 'number');
    const dispatched = attempts.filter(row => row.dispatched).length;
    return { knownTotal: known.length ? known.reduce((total, row) => total + Number(row.usage![key]), 0) : null,
      knownSends: known.length, unknownSends: dispatched - known.length, complete: dispatched > 0 && known.length === dispatched };
  };
  return { input: sum('inputTokens'), output: sum('outputTokens'), reasoningSubsetOfOutput: sum('reasoningTokens'), cachedSubsetOfInput: sum('cachedInputTokens'),
    cacheWrite: sum('cacheWriteTokens'), noDoubleCounting: 'Reasoning is included in output, cached input is included in input. Subsets are not added to totals.',
    providerTokenTotalWhenComplete: attempts.some(row => row.dispatched) && attempts.filter(row => row.dispatched).every(row => row.usage?.inputTokens !== null && row.usage?.inputTokens !== undefined && row.usage?.outputTokens !== null && row.usage?.outputTokens !== undefined)
      ? attempts.filter(row => row.dispatched).reduce((total, row) => total + row.usage!.inputTokens! + row.usage!.outputTokens!, 0) : null };
}
function safeKnown(attempt: Attempt): boolean {
  return attempt.dispatched && attempt.physicalPosts === 1 && attempt.settled && !attempt.unknown
    && attempt.usage?.inputTokens !== null && attempt.usage?.inputTokens !== undefined && attempt.usage?.outputTokens !== null && attempt.usage?.outputTokens !== undefined;
}
function validateCellIdentity(cell: Cell): void {
  const expected = REVIEW_CALIBRATION_SCHEDULE.find(row => row.id === cell.id);
  if (!expected || cell.cellId !== undefined && cell.cellId !== cell.id || cell.caseId !== expected.caseId || cell.armId !== expected.armId || cell.order !== expected.order) throw new Error('review-calibration-report-cell-identity');
  const logicalIds = cell.logicalReviews.map(row => row.logicalAttempt);
  if (logicalIds.some((id, index) => id !== index)) throw new Error('review-calibration-report-logical-order');
  const ids = cell.attempts.map(row => row.sdkId);
  if (new Set(ids).size !== ids.length || new Set(cell.attempts.map(row => `${row.logicalAttempt}:${row.jsonAttempt}`)).size !== ids.length) throw new Error('review-calibration-report-attempt-identity');
  for (const logical of cell.logicalReviews) {
    if (logical.state === 'parsed' && !Object.hasOwn(logical, 'parsed')) throw new Error('review-calibration-report-parsed-value-required');
    const expectedIds = cell.attempts.filter(row => row.logicalAttempt === logical.logicalAttempt).map(row => row.sdkId);
    if (!equal(expectedIds, logical.sdkIds)) throw new Error('review-calibration-report-attempt-links');
  }
  if (cell.attempts.some(row => !logicalIds.includes(row.logicalAttempt))) throw new Error('review-calibration-report-attempt-links');
  for (const logicalId of logicalIds) {
    const jsonIds = cell.attempts.filter(row => row.logicalAttempt === logicalId).map(row => row.jsonAttempt);
    if (jsonIds.some((id, index) => id !== index)) throw new Error('review-calibration-report-json-order');
  }
  if (ids.some((id, index) => index > 0 && id <= ids[index - 1])) throw new Error('review-calibration-report-sdk-order');
}

/** Explicit launcher aliases only; conflicting duplicate fields refuse. The
 * unmodified source run is retained separately and is never overwritten. */
function normalizedAliases(value: ReportJson): ReportJson {
  const normalized = JSON.parse(JSON.stringify(value)) as ReportJson;
  const cells = object(object(normalized).run).cells;
  if (!Array.isArray(cells)) return normalized;
  for (const cell of cells) {
    const attempts = object(cell).attempts;
    if (!Array.isArray(attempts)) continue;
    for (const value of attempts) {
      const row = object(value);
      for (const [canonical, alias] of [['sdkId', 'id'], ['reservationUnits', 'conservativeReservation'], ['dispatched', 'sdkDispatched'], ['experimentalNativeOutputCap', 'experimentalOutputCap']]) {
        if (Object.hasOwn(row, canonical) && Object.hasOwn(row, alias) && row[canonical] !== row[alias]) throw new Error('review-calibration-report-conflicting-alias');
        if (!Object.hasOwn(row, canonical) && Object.hasOwn(row, alias)) row[canonical] = row[alias];
      }
      if (['reserved', 'known', 'unknown'].includes(String(row.state))) {
        const unknown = row.state === 'unknown';
        if (Object.hasOwn(row, 'unknown') && row.unknown !== unknown) throw new Error('review-calibration-report-conflicting-alias');
        row.unknown = unknown;
      }
    }
  }
  return normalized;
}

/** Transparent projection only: hashes/format flags are caller-recorded evidence,
 * not authenticated transcripts, professor truth, execution approval or a judge. */
export function buildReviewCalibrationReport(input: unknown) {
  const copied = copyJson(input);
  const parsed = reviewCalibrationReportInputSchema.parse(normalizedAliases(copied));
  const rawRun = object(copied).run;
  const rawCells = object(rawRun).cells;
  if (new Set(parsed.run.cells.map(row => row.id)).size !== parsed.run.cells.length) throw new Error('review-calibration-report-duplicate-cell');
  parsed.run.cells.forEach(validateCellIdentity);
  const allAttempts = parsed.run.cells.flatMap(row => row.attempts);
  if (new Set(allAttempts.map(row => row.sdkId)).size !== allAttempts.length) throw new Error('review-calibration-report-duplicate-sdk-id');
  const integrityIssues: Array<{ cellId: string | null; code: string }> = [];
  const cells = REVIEW_CALIBRATION_SCHEDULE.map(planned => {
    const found = parsed.run.cells.find(row => row.id === planned.id);
    const cell: Cell = found ?? { ...planned, state: 'not-started', logicalReviews: [], attempts: [] };
    const arm = REVIEW_CALIBRATION_ARMS.find(row => row.id === planned.armId)!;
    const initial = cell.logicalReviews[0] ?? null, final = cell.logicalReviews.at(-1) ?? null;
    for (const attempt of cell.attempts) {
      const native = object(attempt.nativeRequest);
      const units = Buffer.byteLength(attempt.prompt + (attempt.systemPrompt ?? ''), 'utf8') + 32;
      const modelShapeMatches = native.stream === false && equal(native.response_format, { type: 'json_object' }) && equal(native.messages, [{ role: 'user', content: attempt.prompt }]) && attempt.systemPrompt === undefined && native.model === arm.model && native.reasoning_effort === arm.reasoningEffort && native.max_completion_tokens === 6000
        && (arm.nativeTemperature === 'omitted' ? !Object.hasOwn(native, 'temperature') : native.temperature === arm.nativeTemperature);
      const anomalies = [attempt.physicalPosts > 0 && !attempt.dispatched && 'wire-without-sdk-dispatch', !modelShapeMatches && 'native-options-mismatch', attempt.inputUnits !== units && 'input-estimator-mismatch',
        attempt.reservationUnits !== attempt.inputUnits + 6000 && 'reservation-mismatch', attempt.inputUnits > 24000 && 'input-cap-exceeded', attempt.physicalPosts > 1 && 'multiple-wire-posts',
        attempt.usage?.reasoningTokens !== null && attempt.usage?.reasoningTokens !== undefined && attempt.usage.outputTokens !== null && attempt.usage.reasoningTokens > attempt.usage.outputTokens && 'reasoning-subset-exceeds-output',
        attempt.usage?.cachedInputTokens !== null && attempt.usage?.cachedInputTokens !== undefined && attempt.usage.inputTokens !== null && attempt.usage.cachedInputTokens > attempt.usage.inputTokens && 'cached-subset-exceeds-input',
        attempt.usage?.outputTokens !== null && attempt.usage?.outputTokens !== undefined && attempt.usage.outputTokens > 6000 && 'reported-output-cap-exceeded'];
      for (const code of anomalies) if (code) integrityIssues.push({ cellId: cell.id, code });
    }
    const responseIssues = field(cell.quality, 'responseIssues');
    const finalIssueRows = Array.isArray(responseIssues) ? responseIssues.filter(row => field(row, 'attempt') === final?.logicalAttempt) : [];
    if (cell.formatStatus === 'validated' && finalIssueRows.length) integrityIssues.push({ cellId: cell.id, code: 'validated-format-has-final-issues' });
    const completeAttempts = cell.attempts.length > 0 && cell.attempts.every(row => safeKnown(row) && typeof row.visibleOutput === 'string' && Boolean(row.evidence?.length));
    const hasIssues = integrityIssues.some(row => row.cellId === cell.id);
    const finalQuality = cell.quality ?? null;
    const comparisonEligible = cell.inputDifficulty?.requested !== null && cell.inputDifficulty?.requested !== undefined && cell.inputDifficulty?.candidate !== null && cell.inputDifficulty?.candidate !== undefined && cell.state === 'reviewed' && cell.formatStatus === 'validated' && final?.state === 'parsed' && final.parsed !== null
      && ['eligible', 'withheld'].includes(String(field(finalQuality, 'status'))) && completeAttempts && !hasIssues
      && cell.attempts.every(row => responseModelMatches(arm.model, row.returnedModel)) && field(field(finalQuality, 'reviewRepair'), 'status') === 'consistent';
    return { ...planned, sourceRowPresent: Boolean(found), state: cell.state, inputBindings: cell.inputBindings ?? null,
      inputDifficulty: cell.inputDifficulty ?? null,
      initialPromptSha256: initial ? sha(initial.prompt + (initial.systemPrompt ?? '')) : null,
      reviews: { initial, final }, guardedQuality: finalQuality,
      facets: { initial: projectedFacets(initial?.parsed, cell.inputDifficulty), final: projectedFacets(final?.parsed, cell.inputDifficulty), guarded: projectedFacets(finalQuality, cell.inputDifficulty) },
      reviewValidity: { initial: { jsonState: initial?.state ?? null, facetShapes: facetShapes(initial?.parsed) },
        final: { jsonState: final?.state ?? null, facetShapes: facetShapes(final?.parsed) },
        caveat: 'Recognized enums/structured presence describe shape only, not validated citations, source entailment or semantic truth; recorded format/ref issues remain below.' },
      format: { recordedStatus: cell.formatStatus ?? null, logicalReviewStates: cell.logicalReviews.map(row => ({ logicalAttempt: row.logicalAttempt, state: row.state })),
        allResponseIssues: responseIssues, initialIssues: Array.isArray(responseIssues) ? responseIssues.filter(row => field(row, 'attempt') === 0) : null,
        correctedIssues: Array.isArray(responseIssues) ? responseIssues.filter(row => field(row, 'attempt') === 1) : null,
        caveat: 'Historical attempt0 issues do not imply unresolved final format failure; recorded formatStatus is retained without semantic regrading.' },
      drift: { status: field(field(finalQuality, 'reviewRepair'), 'status'), receipt: field(finalQuality, 'reviewRepair') },
      attempts: cell.attempts, usage: usageTotals(cell.attempts), comparisonEligible,
      annotations: parsed.rubric.annotations.filter(row => row.caseId === cell.caseId),
      professorLabels: parsed.professorLabels === null ? null : parsed.professorLabels.filter(row => row.caseId === cell.caseId), retainedObservation: Array.isArray(rawCells) ? rawCells.find(row => field(row, 'id') === planned.id) ?? null : null };
  });
  const dispatched = allAttempts.filter(row => row.dispatched).length;
  const wires = allAttempts.reduce((sum, row) => sum + row.physicalPosts, 0);
  const reservations = allAttempts.reduce((sum, row) => sum + row.reservationUnits, 0);
  if (parsed.run.sdkSends !== dispatched) integrityIssues.push({ cellId: null, code: 'sdk-count-mismatch' });
  if (parsed.run.physicalWirePosts !== wires) integrityIssues.push({ cellId: null, code: 'wire-count-mismatch' });
  if (parsed.run.conservativeReservations !== reservations) integrityIssues.push({ cellId: null, code: 'reservation-total-mismatch' });
  if (parsed.run.sdkSends > 20 || dispatched > 20 || wires > 20 || parsed.run.conservativeReservations > 600000 || reservations > 600000) integrityIssues.push({ cellId: null, code: 'phase-cap-exceeded' });
  if (integrityIssues.some(row => row.cellId === null)) cells.forEach(row => { row.comparisonEligible = false; });
  const caseComparisons = REVIEW_CALIBRATION_CASES.map(caseId => {
    const rows = cells.filter(row => row.caseId === caseId);
    const sameBindings = rows.every(row => row.inputBindings !== null) && rows.every(row => equal(row.inputBindings, rows[0].inputBindings));
    const sameInitialPrompts = rows[0].initialPromptSha256 !== null && rows.every(row => row.initialPromptSha256 === rows[0].initialPromptSha256);
    const sameFixedDifficultyMetadata = rows.every(row => row.inputDifficulty?.requested !== null && row.inputDifficulty?.requested !== undefined && row.inputDifficulty?.candidate !== null && row.inputDifficulty?.candidate !== undefined) && rows.every(row => equal(row.inputDifficulty, rows[0].inputDifficulty));
    const baseComparable = sameFixedDifficultyMetadata && rows.every(row => row.comparisonEligible) && sameBindings && sameInitialPrompts && !integrityIssues.some(row => row.cellId === null);
    const fields: Record<string, boolean> = { source: rows.every(row => row.facets.final.source.support !== null), notation: rows.every(row => row.facets.final.notation !== null),
      bank: rows.every(row => row.facets.final.bank.novelty !== null), answerability: rows.every(row => row.facets.final.answerability !== null), taskDemand: rows.every(row => row.facets.final.taskDemand !== null),
      difficulty: rows.every(row => row.facets.final.difficulty.achieved !== null), teacher: rows.every(row => row.facets.final.teacher.changes !== null && row.facets.final.teacher.invariants !== null) };
    return { caseId, plannedArms: 3, observedRows: rows.filter(row => row.sourceRowPresent).length, sameDeclaredInputBindings: sameBindings,
      sameInitialPrompts, sameFixedDifficultyMetadata, mechanicallyComparableThreeArms: baseComparable, comparableFacets: Object.fromEntries(Object.entries(fields).map(([key, available]) => [key, baseComparable && available])),
      semanticCorrectness: 'unassessed', caveat: 'Comparable means recorded inputs/format/usage/identities align; it is not truth, equivalence, gold labels or reviewer selection.' };
  });
  return { version: 'review-calibration-facet-report-v1' as const, mode: parsed.mode, executionAllowed: false as const,
    authority: 'Report-only projection of caller-provided records; no transcript authentication, semantic oracle, professor attestation or execution authority.',
    denominators: { plannedCases: 5, plannedArms: 3, plannedCells: 15, recordedCellRows: parsed.run.cells.length,
      notStartedCells: cells.filter(row => row.state === 'not-started').length, interruptedCells: cells.filter(row => row.state === 'interrupted').length,
      reviewedCells: cells.filter(row => row.state === 'reviewed').length, formatInvalidCells: cells.filter(row => row.state === 'cell-format-invalid').length,
      mechanicallyComparableCases: caseComparisons.filter(row => row.mechanicallyComparableThreeArms).length },
    cells, caseComparisons, usage: usageTotals(allAttempts), accounting: { recorded: { sdkSends: parsed.run.sdkSends, physicalWirePosts: parsed.run.physicalWirePosts, conservativeReservations: parsed.run.conservativeReservations },
      derived: { sdkSends: dispatched, physicalWirePosts: wires, conservativeReservations: reservations }, integrityIssues },
    rubric: parsed.rubric, rubricAuthority: 'Caller-provided predeclared rubric evidence; no authentication, output-dependent scoring or automatic semantic grading.', professorLabels: parsed.professorLabels, evidence: parsed.evidence,
    retainedRun: rawRun, aliasProjection: 'Only sdkId/id, reservationUnits/conservativeReservation, dispatched/sdkDispatched, effective-cap names and unknown/state are joined with equality checks; original records remain exact.', inputSha256: sha(JSON.stringify(copied)),
    limits: ['One exposed-tuning repetition is not held-out accuracy or a general model ranking.',
      'P01/P04/P03 diagnostics are manually supplied annotations, never keyword grading or automatic gold.',
      'Overall withholding does not prove successful answer-exclusion detection; facets remain separate.',
      'Common experimental6000 differs from production Luna-none2000 and medium6000; reasoning is an output subset.',
      'No automatic reviewer selection, generation, save, adoption, deployment or teacher-time/yield claim.'],
  };
}

/** Explicit local files only; exclusive output never rewrites existing evidence. */
export function runReviewCalibrationReportCli(args: string[]): { output: string; plannedCells: 15 } {
  if (args.length !== 4 || args[0] !== '--input' || args[2] !== '--output') throw new Error('Usage: --input <local-json> --output <new-local-json>');
  if (/^[a-z][a-z0-9+.-]*:/i.test(args[1]) || /^[a-z][a-z0-9+.-]*:/i.test(args[3])) throw new Error('review-calibration-report-local-files-required');
  const input = resolve(args[1]), output = resolve(args[3]);
  if (input === output) throw new Error('review-calibration-report-exclusive-output-required');
  const bytes = readFileSync(input); if (bytes.length > 64 * 1024 * 1024) throw new Error('review-calibration-report-input-size');
  const report = buildReviewCalibrationReport(JSON.parse(bytes.toString('utf8')));
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { output, plannedCells: 15 };
}
if (require.main === module) {
  try { console.log(JSON.stringify(runReviewCalibrationReportCli(process.argv.slice(2)))); }
  catch (error) { console.error(error instanceof Error && (error.message.startsWith('review-calibration-report-') || error.message.startsWith('Usage:')) ? error.message : 'review-calibration-report-invalid-data'); process.exitCode = 1; }
}
