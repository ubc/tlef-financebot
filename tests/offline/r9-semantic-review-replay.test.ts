// Opt-in reprocessing of closed R9 replies, never a provider/native SDK probe.
jest.mock('../../server/src/config/env', () => ({ env: { llmProvider: 'openai', llmDefaultModel: 'gpt-6-luna',
  llmModelGenerator: 'DENIED', llmModelValidator: 'DENIED', llmModelReviewer: 'DENIED' } }));
jest.mock('../../server/src/components/genai/llm', () => ({ completeJson: jest.fn(() => { throw new Error('OFFLINE SDK denied'); }) }));
jest.mock('../../server/src/components/mongodb/collections', () => new Proxy({}, { get: (_target, key) => key === '__esModule' ? false
  : () => { throw new Error('OFFLINE database denied'); } }));
jest.mock('../../server/src/components/mongodb', () => new Proxy({}, { get: (_target, key) => key === '__esModule' ? false
  : () => { throw new Error('OFFLINE database denied'); } }));
jest.mock('../../server/src/components/genai/embeddings', () => ({ embedOne: jest.fn(() => { throw new Error('OFFLINE embedding denied'); }) }));
jest.mock('../../server/src/components/qdrant', () => ({ search: jest.fn(() => { throw new Error('OFFLINE vector denied'); }) }));
jest.mock('../../server/src/components/jobs', () => ({ defineJob: jest.fn(), enqueueJob: jest.fn(() => { throw new Error('OFFLINE queue denied'); }),
  scheduleRecurring: jest.fn(() => { throw new Error('OFFLINE queue denied'); }) }));
jest.mock('../../server/src/components/param-worker', () => ({ executeGenerate: jest.fn(() => { throw new Error('OFFLINE worker denied'); }) }));

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { completeJson, type CompleteJsonOptions } from '../../server/src/components/genai/llm';
import { estimateAuthoringTokens } from '../../server/src/components/genai/llm/authoring-budget';
import { embedOne } from '../../server/src/components/genai/embeddings';
import { search } from '../../server/src/components/qdrant';
import { enqueueJob } from '../../server/src/components/jobs';
import { assessGenerationQuality } from '../../server/src/services/generation-quality.service';
import { AuthoringBudget, withAuthoringBudget } from '../../server/src/services/authoring-budget.service';
import type { GenerationMemoryContent, GenerationMemorySnapshot } from '../../server/src/services/generation-memory.service';
import type { AuthoringRequirements, GenerationQualityAssessment } from '../../server/src/types/generation-quality';
import type { GenerationEvidencePacket } from '../../server/src/types/generation-evidence';

const ROOT = path.resolve(__dirname, '../..');
const AUDIT = 'audit-results/semantic-review-repair-2026-10-17/r9-offline-replay-r1';
const INPUTS = 'audit-results/answer-exclusion-warrants-2026-10-17/proposed-paid-preflight-r1/fixed-five-contexts.json';
const DECLARATION = 'audit-results/answer-exclusion-warrants-2026-10-17/live-preflight-r9/declaration.json';
const JOURNAL = 'audit-results/quality-lab-exclusion-warrants-2026-10-17-live-r9/journal.jsonl';
const SUMMARY = 'audit-results/quality-lab-exclusion-warrants-2026-10-17-live-r9/summary.json';
const CODE = [
  'server/src/services/generation-quality.service.ts', 'server/src/services/generation-review-repair.ts',
  'server/src/types/generation-review-repair.ts', 'server/src/types/generation-quality.ts',
  'server/src/services/generation-answerability.ts', 'server/src/services/generation-exclusion-review.ts',
  'server/src/services/generation-numeric-review.ts', 'server/src/services/generation-numeric-review.service.ts',
  'server/src/services/numeric-verification.service.ts', 'server/src/services/numeric-input-display.service.ts',
  'server/src/services/params.service.ts', 'server/src/services/finite-slot-domain.ts',
  'server/src/services/generation-task-demand.ts', 'server/src/services/generation-citation-spans.ts',
  'server/src/services/generation-task-comparisons.ts', 'server/src/services/generation-source-interpretation.ts',
  'server/src/services/generation-planning-evidence.ts', 'server/src/services/generation-model-budget.ts',
  'server/src/services/generation-memory.service.ts', 'server/src/services/generation-evidence.service.ts',
  'server/src/services/generation-task-query.ts', 'server/src/services/authoring-budget.service.ts',
  'server/src/components/genai/llm/model-capabilities.ts', 'server/src/components/genai/llm/authoring-budget.ts',
  'jest.config.js', 'tests/tsconfig.json', 'package.json', 'package-lock.json',
  'tests/offline/r9-semantic-review-replay.test.ts', 'tests/offline/r9-semantic-review-replay.jest.config.cjs',
];
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const jsonHash = (value: unknown) => hash(JSON.stringify(value));
const read = (name: string) => fs.readFileSync(path.join(ROOT, name), 'utf8');
const pin = (name: string) => { const data = fs.readFileSync(path.join(ROOT, name)); return { path: name, sha256: hash(data), bytes: data.length }; };
interface FixedCase { id: string; type: 'mcq'; candidate: Omit<GenerationMemoryContent, 'type'>; packet: GenerationEvidencePacket;
  memory: GenerationMemorySnapshot; requirements: AuthoringRequirements }
interface JournalRow { body: { sequence: number; kind: string; previous: string; data: Record<string, unknown> }; sha256: string }
interface RecordedResponse { sdkId: number; caseId: string; raw: string; parsed: unknown; originalPrompt: string;
  originalInputUnits: number; native: Record<string, unknown>; journalRowSha256: string }

it('replays exact closed R9 responses through absent and selected same-candidate guards without external work', async () => {
  const run = process.env.R9_OFFLINE_REPLAY_RUN ?? 'run-r1';
  if (!/^run-r[1-9][0-9]*$/.test(run)) throw new Error('Fresh offline run-rN output required');
  const out = path.join(ROOT, AUDIT, run); fs.mkdirSync(out, { recursive: false });
  const write = (name: string, value: unknown) => { const file = path.join(out, name); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    return { path: path.relative(ROOT, file), sha256: hash(fs.readFileSync(file)), bytes: fs.statSync(file).size }; };
  const codeBefore = CODE.map(pin);
  write('code-before.json', { status: 'Explicit as-run source/test pins; not a live native CLI import manifest', files: codeBefore });
  const inputs = JSON.parse(read(INPUTS)) as { caseOrder: string[]; cases: FixedCase[] };
  const declaration = JSON.parse(read(DECLARATION)) as { fixedInputs: { sha256: string }; limits: Record<string, number> };
  const originalSummary = JSON.parse(read(SUMMARY)) as { cases: Array<{ id: string; quality: GenerationQualityAssessment }> };
  const rows = read(JOURNAL).trimEnd().split('\n').map(line => JSON.parse(line) as JournalRow);
  const observed: RecordedResponse[] = [];
  let previous = '0'.repeat(64);
  for (const [index, entry] of rows.entries()) {
    expect(entry.body.sequence).toBe(index + 1); expect(entry.body.previous).toBe(previous);
    expect(jsonHash(entry.body)).toBe(entry.sha256); previous = entry.sha256;
    if (entry.body.kind !== 'sdk-result') continue;
    const value = entry.body.data as unknown as { sdkId: number; caseId: string;
      response: { choices: Array<{ message: { content: string } }> } };
    const reserved = rows.find(row => row.body.kind === 'sdk-reserved' && row.body.data.sdkId === value.sdkId)!;
    const raw = value.response.choices[0].message.content;
    expect((reserved.body.data.admission as { systemPrompt?: string }).systemPrompt).toBeUndefined();
    expect((reserved.body.data.nativeRequest as { stream?: boolean }).stream).toBe(false);
    observed.push({ sdkId: value.sdkId, caseId: value.caseId, raw, parsed: JSON.parse(raw) as unknown,
      originalPrompt: (reserved.body.data.admission as { prompt: string }).prompt,
      originalInputUnits: reserved.body.data.inputUnits as number,
      native: reserved.body.data.nativeRequest as Record<string, unknown>, journalRowSha256: entry.sha256 });
  }
  expect(pin(INPUTS).sha256).toBe(declaration.fixedInputs.sha256);
  expect(observed).toHaveLength(7); expect(inputs.caseOrder).toEqual(['P01', 'P02', 'P04', 'CAPM', 'P03']);
  expect(inputs.cases.find(item => item.id === 'P03')!.packet.passages.some(passage => passage.id.includes('-108-'))).toBe(false);
  write('input-pins.json', { historicalR9Closed: true, providerAllowance: 0, files: [INPUTS, DECLARATION, JOURNAL, SUMMARY].map(pin),
    sourcePacketBoundary: 'P03 retains only its original packet; CAPM-only p108 is never copied into it.' });
  write('exact-inputs.json', inputs);
  write('exact-recorded-responses.json', observed);
  const networkCalls: string[] = [];
  const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => { networkCalls.push('fetch'); throw new Error('OFFLINE network denied'); });
  const httpSpy = jest.spyOn(http, 'request').mockImplementation((() => { networkCalls.push('http'); throw new Error('OFFLINE network denied'); }) as typeof http.request);
  const httpsSpy = jest.spyOn(https, 'request').mockImplementation((() => { networkCalls.push('https'); throw new Error('OFFLINE network denied'); }) as typeof https.request);
  const outcomes: Array<{ cohort: string; cases: Array<Record<string, unknown>>; callbackInvocations: number; eligible: number }> = [];
  try {
    for (const selected of [false, true]) {
      const cohort = selected ? 'selected-frozen-review' : 'historical-absent-selector';
      const cases: Array<Record<string, unknown>> = [];
      let callbackInvocations = 0;
      for (const [item, original] of inputs.cases.entries()) {
        const input = structuredClone(original); const pristine = jsonHash(input);
        expect(input.requirements.reviewRepairProtocol).toBeUndefined();
        const requirements = structuredClone(input.requirements);
        if (selected) requirements.reviewRepairProtocol = 'frozen-review-decisions-v1';
        const sameRequirements = { ...requirements }; delete sameRequirements.reviewRepairProtocol;
        expect(sameRequirements).toEqual(input.requirements);
        const replies = observed.filter(response => response.caseId === input.id);
        let index = 0;
        const calls: Array<Record<string, unknown>> = [];
        const budget = new AuthoringBudget(`OFFLINE-R9-${cohort}-${input.id}`, { maxSends: declaration.limits.maxSdkSends,
          maxInputTokens: declaration.limits.maxInputUnitsPerSend, maxOutputTokens: declaration.limits.maxOutputTokensPerSend,
          maxEstimatedTokens: declaration.limits.maxConservativeReservationUnits });
        const quality = await withAuthoringBudget(budget, () => assessGenerationQuality({ candidate: { ...input.candidate, type: input.type },
          packet: input.packet, memory: input.memory, requirements, item, policy: 'grounded-memory-v2',
          step: { model: 'gpt-6-luna', reasoningEffort: 'none', temperature: 0 },
          complete: async <T>(prompt: string, options: CompleteJsonOptions = {}): Promise<T> => {
            const response = replies[index++]; if (!response) throw new Error('OFFLINE no additional recorded reply; dispatch forbidden');
            await options.beforeRequest?.(); callbackInvocations++;
            const prefix = `${cohort}/${input.id}/callback-${index}`;
            const projectedNative: Record<string, unknown> = { ...response.native, messages: [{ role: 'user', content: prompt }] };
            expect(options.systemPrompt).toBeUndefined(); expect(projectedNative.stream).toBe(false);
            const body = JSON.stringify(projectedNative);
            const historicalAdmissionInputUnits = estimateAuthoringTokens(prompt, options.systemPrompt ?? '');
            if (!selected) expect(historicalAdmissionInputUnits).toBe(response.originalInputUnits);
            const promptFile = write(prefix + '-prompt.txt', prompt), rawFile = write(prefix + '-raw-response.txt', response.raw);
            const call = { callback: index, recordedSdkId: response.sdkId, prompt: promptFile, originalRawResponse: rawFile,
              sourceJournalRowSha256: response.journalRowSha256, baselinePromptMatchesHistoricalR9: prompt === response.originalPrompt,
              requestOptions: { model: options.model, reasoningEffort: options.reasoningEffort, temperature: options.temperature,
                maxTokens: options.maxTokens, usageContext: options.usageContext },
              nativeProjection: projectedNative, nativeProjectionSha256: jsonHash(projectedNative),
              projectedBodyUtf8Bytes: Buffer.byteLength(body, 'utf8'), projectedBodyUtf16Units: body.length,
              historicalAdmissionInputUnits, originalRecordedInputUnits: response.originalInputUnits,
              historicalAdmissionEstimator: 'estimateAuthoringTokens(rawPrompt, systemPrompt): UTF-8 bytes+32; historical R9 nonstreaming sendMessage, no system prompt',
              declaredInputLimit: declaration.limits.maxInputUnitsPerSend,
              projectedHistoricalAdmissionFits: historicalAdmissionInputUnits <= declaration.limits.maxInputUnitsPerSend,
              admissionExecuted: false, nativeSdkInvocations: 0, providerPostCalls: 0,
              caveat: 'Offline callback evaluates an already recorded JSON reply. Body UTF-8/UTF-16 sizes are separate from the historical raw-prompt admission estimator. Neither projection is an executed admission, SDK call or billing token count.' };
            calls.push(call); write(prefix + '-input-output.json', call);
            return structuredClone(response.parsed) as T;
          } }));
        expect(index).toBe(replies.length); expect(jsonHash(input)).toBe(pristine);
        expect(budget.snapshot().observedSends).toBe(0);
        if (!selected) expect(quality.status).toBe(originalSummary.cases.find(row => row.id === input.id)!.quality.status);
        const assessment = write(`${cohort}/${input.id}/assessment.json`, quality);
        write(`${cohort}/${input.id}/inputs.json`, { ...input, requirements });
        cases.push({ id: input.id, status: quality.status, originalR9Status: originalSummary.cases.find(row => row.id === input.id)!.quality.status,
          sourceSupport: quality.sourceSupport, notation: quality.notation, novelty: quality.novelty,
          answerabilityStatus: quality.answerability?.status, taskDemandStatus: quality.taskDemand?.status,
          reviewRepair: quality.reviewRepair ?? null, reasons: quality.reasons, responseIssues: quality.responseIssues ?? [],
          assessment, calls, budgetSnapshot: budget.snapshot(), allRecordedRepliesConsumed: index === replies.length,
          sourceCandidateMemoryUnchanged: true, requirementsDeltaOnly: selected ? { reviewRepairProtocol: 'frozen-review-decisions-v1' } : {} });
      }
      outcomes.push({ cohort, cases, callbackInvocations, eligible: cases.filter(row => row.status === 'eligible').length });
    }
    expect(completeJson).not.toHaveBeenCalled(); expect(embedOne).not.toHaveBeenCalled(); expect(search).not.toHaveBeenCalled();
    expect(enqueueJob).not.toHaveBeenCalled(); expect(networkCalls).toEqual([]);
    for (const before of codeBefore) expect(pin(before.path)).toEqual(before);
    const changes = inputs.caseOrder.map(id => {
      const before = outcomes[0].cases.find(row => row.id === id)!, after = outcomes[1].cases.find(row => row.id === id)!;
      return { id, beforeStatus: before.status, afterStatus: after.status, beforeAnswerability: before.answerabilityStatus,
        afterAnswerability: after.answerabilityStatus, reviewRepair: after.reviewRepair,
        semanticModelJudgmentsChanged: false, interpretation: 'Same retained model replies; only server interpretation/currentness policy differs.' };
    });
    write('results.json', { version: 1, status: 'OFFLINE_RECORDED_OUTPUT_REPLAY_COMPLETE', declaredR9Caps: declaration.limits,
      cohorts: outcomes, changes, actualProviderCalls: 0, actualPhysicalPosts: 0, actualSdkSends: 0, newReportedTokenUsage: null,
      saved: 0, adopted: 0, teacherAcceptance: null, historicalReplies: 7, offlineCallbackInvocations: outcomes.reduce((n, row) => n + row.callbackInvocations, 0),
      exactInputsAndRepliesUnmodified: true, codeBefore, codeAfter: CODE.map(pin), networkCalls,
      limitations: ['This reprocesses exact historical judgments; selected-protocol prompts were not sent to any model.',
        'No API allowance, model behavior prediction, paid token/cost estimate, saved yield or semantic quality gain follows.',
        'Native body sizes and the historical raw-prompt admission estimate are distinct diagnostics; actual completeJson/SDK/admission was not executed.',
        'AuthoringBudget records logical corrections but zero native observed sends; its zero native usage is not historical R9 cost.'] });
  } catch (error) {
    write('failure.json', { error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
      outcomes, networkCalls, codeBefore, codeAfter: CODE.map(pin), providerCalls: 0 });
    throw error;
  } finally { fetchSpy.mockRestore(); httpSpy.mockRestore(); httpsSpy.mockRestore(); }
}, 60000);
