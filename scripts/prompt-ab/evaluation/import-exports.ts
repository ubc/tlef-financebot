import { z } from 'zod';
import { CaseSchema, DatasetSchema, QuestionSchema, UsageSchema, hashValue } from './schema';
import type { EvaluationDataset, EvaluationRun, EvaluationSlot } from './schema';

export const ExportManifestSchema = z.object({
  experimentId: z.string().min(1).max(160), cases: z.array(CaseSchema).min(1).max(100),
  runs: z.array(z.object({ file: z.string().min(1).max(2000), caseId: z.string().min(1).max(160), repetition: z.number().int().positive().max(100) }).strict()).min(1).max(200),
}).strict();
export type ExportManifest = z.infer<typeof ExportManifestSchema>;

const nullableCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
const candidate = QuestionSchema.extend({ contentHash: z.string(), truncated: z.boolean() }).strip();
/** Read only an explicit projection of server exports; provider bodies and actor
 * identifiers cannot enter the blinded evaluation through incidental keys. */
const ExportSchema = z.object({
  schemaVersion: z.literal('generation-evaluation-export-v1'),
  run: z.object({ id: z.string().min(1), policy: z.enum(['baseline', 'grounded-memory-v1']), requestedSlots: z.number().int().min(1).max(100),
    type: z.enum(['mcq', 'true-false']), difficulty: z.enum(['easy', 'medium', 'hard']).optional(), prompt: z.string().optional(),
    status: z.enum(['completed', 'partial', 'failed']), startedAt: z.string().datetime().optional(), finishedAt: z.string().datetime().optional() }),
  slots: z.array(z.object({ item: z.number().int().min(0).max(99), outcome: z.enum(['saved', 'withheld', 'failed', 'unavailable']),
    candidate: candidate.optional(),
    assessment: z.object({ sourceSupport: z.enum(['supported', 'unsupported', 'uncertain']), notation: z.enum(['consistent', 'inconsistent', 'uncertain']), novelty: z.enum(['independent', 'duplicate', 'variant', 'uncertain']), status: z.enum(['eligible', 'withheld']) }).optional(),
    numericVerification: z.object({ evaluatorVersion: z.number().int().positive(), sampleSeeds: z.array(z.number().finite()).min(1), verifiedAt: z.string().datetime() }).optional(),
    failureCodes: z.array(z.string()), recordedSourceRefsTruncated: z.boolean().optional(),
  })).min(1).max(100),
  usage: z.object({ summary: z.object({ status: z.enum(['complete', 'partial', 'pending', 'unavailable']), inputTokens: nullableCount, outputTokens: nullableCount, totalTokens: nullableCount,
    observedCalls: z.number().int().nonnegative(), unknownCalls: z.number().int().nonnegative(), pendingCalls: z.number().int().nonnegative(), coverageGaps: z.number().int().nonnegative(), untracked: z.boolean() }),
    totalCalls: z.number().int().nonnegative(), callsTruncated: z.boolean() }),
  limitations: z.array(z.string().max(2000)).max(30),
});

export function importGenerationExports(manifestInput: ExportManifest, inputs: unknown[]): EvaluationDataset {
  const manifest = ExportManifestSchema.parse(manifestInput);
  if (inputs.length !== manifest.runs.length) throw new Error('Every manifest run needs exactly one export.');
  const runs: EvaluationRun[] = inputs.map((input, index) => {
    const observed = ExportSchema.parse(input);
    const mapping = manifest.runs[index];
    const fixture = manifest.cases.find(item => item.caseId === mapping.caseId);
    if (!fixture) throw new Error('Export mapping references an unknown case.');
    const request = fixture.context.request;
    if (request.count !== observed.run.requestedSlots || request.type !== observed.run.type || request.instruction !== (observed.run.prompt ?? '') || request.difficulty !== (observed.run.difficulty ?? 'mixed')) throw new Error('Export request differs from its case request. Keep different requests in separate cases.');
    const slots: EvaluationSlot[] = observed.slots.map(slot => {
      const { contentHash: _sourceHash, truncated: _truncated, ...content } = slot.candidate ?? {};
      void _sourceHash; void _truncated;
      const question = slot.candidate ? QuestionSchema.parse(content) : null;
      return { item: slot.item, outcome: slot.outcome === 'unavailable' ? 'missing' : slot.outcome,
        candidate: question ? { content: question, contentHash: hashValue(question), truncated: slot.candidate!.truncated } : null,
        automatic: slot.assessment ? {
          sourceScope: slot.assessment.sourceSupport === 'supported' ? 'pass' : slot.assessment.sourceSupport === 'unsupported' ? 'fail' : 'uncertain',
          notation: slot.assessment.notation === 'consistent' ? 'pass' : slot.assessment.notation === 'inconsistent' ? 'fail' : 'uncertain',
          duplication: slot.assessment.novelty === 'independent' ? 'pass' : slot.assessment.novelty === 'uncertain' ? 'uncertain' : 'fail',
          gate: slot.assessment.status,
        } : { sourceScope: null, notation: null, duplication: null, gate: null },
        numerical: slot.numericVerification ? 'verified' : 'unknown',
        limitations: [...slot.failureCodes, ...(!question ? ['No immutable final candidate was recorded.'] : []), ...(slot.recordedSourceRefsTruncated ? ['Recorded source excerpts were truncated.'] : [])].slice(0, 30),
      };
    });
    const duration = observed.run.finishedAt && observed.run.startedAt ? Date.parse(observed.run.finishedAt) - Date.parse(observed.run.startedAt) : null;
    return { runId: observed.run.id, caseId: mapping.caseId, repetition: mapping.repetition, policy: observed.run.policy,
      contextHash: hashValue(fixture.context),
      comparison: { contextTiming: 'retrospective', isolated: null, controlsHash: null },
      requestedSlots: observed.run.requestedSlots, slots, usage: UsageSchema.parse(observed.usage.summary),
      elapsedMs: duration !== null && duration >= 0 ? duration : null,
      limitations: ['Reference context was supplied after execution; the starting bank, execution settings, and experiment isolation are not reconstructed.',
        'Only final recorded candidates are assessed. Earlier replaced candidates remain outside quality incidence; their recorded usage is included.',
        'Latency covers recorded run start to finish, excluding queue wait and preparation outside that interval.',
        ...(observed.usage.callsTruncated ? ['Individual-call export is truncated; the authoritative run usage summary still covers its recorded accounting scope.'] : []), ...observed.limitations].slice(0, 30),
    };
  });
  return DatasetSchema.parse({ schemaVersion: 'financebot-quality-evaluation-v1', experimentId: manifest.experimentId, origin: 'recorded', rubricVersion: 'financebot-teacher-v1',
    cases: manifest.cases, runs, limitations: ['Retrospective production exports support descriptive issue review, not a controlled baseline-versus-pilot effect estimate or a matched-context judge-error estimate.'] });
}
