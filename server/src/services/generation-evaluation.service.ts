import type { ObjectId, WithId } from 'mongodb';
import { modelCallReceiptsCol, questionsCol, questionVersionsCol } from '../components/mongodb/collections';
import type { QuestionVersion } from '../types/domain';
import type { GenerationEvaluationCall, GenerationEvaluationExport, GenerationEvaluationSlot } from '../types/generation-evaluation';
import { getCourseContentRun } from './content-runs.service';
import { summarizeModelUsage } from './model-usage.service';
import { modelCallDto, modelUsageSummaryDto } from './admin-diagnostics.service';
import { snapshotQualityCandidate } from './generation-quality.service';

const MAX_SLOTS = 100;
const MAX_CALLS = 1000;
const MAX_SOURCE_REFS = 100;
const MAX_SOURCE_CHARACTERS = 30_000;

function unavailable(code: string, status: number): never { throw Object.assign(new Error(code), { status }); }
function iso(date: Date): string { return new Date(date).toISOString(); }

function sourceRefs(version: WithId<QuestionVersion>): Pick<GenerationEvaluationSlot, 'recordedSourceRefs' | 'recordedSourceRefsTruncated'> {
  const originals = version.sourceRefs ?? [];
  let characters = 0;
  let truncated = originals.length > MAX_SOURCE_REFS;
  const references = originals.slice(0, MAX_SOURCE_REFS).map(reference => {
    const chunk = reference.chunk?.slice(0, Math.max(0, MAX_SOURCE_CHARACTERS - characters));
    if (reference.chunk !== undefined) {
      characters += chunk!.length;
      truncated ||= chunk !== reference.chunk;
    }
    return { materialId: reference.materialId.toHexString(), ...(chunk !== undefined ? { chunk } : {}) };
  });
  return { recordedSourceRefs: references, ...(truncated ? { recordedSourceRefsTruncated: true } : {}) };
}

/** No provider, mutation, live source reconstruction, or current-version substitution. */
export async function exportGenerationEvaluation(courseId: ObjectId, runId: ObjectId): Promise<GenerationEvaluationExport> {
  const run = await getCourseContentRun(courseId, runId);
  if (!run || !run.courseId.equals(courseId)) unavailable('content-run-not-found', 404);
  if (run.kind !== 'question-generation') unavailable('content-run-not-generation', 409);
  if (run.status !== 'completed' && run.status !== 'partial' && run.status !== 'failed') unavailable('content-run-not-terminal', 409);
  if (!Number.isSafeInteger(run.input.count) || run.input.count < 1 || run.input.count > MAX_SLOTS) {
    unavailable('evaluation-export-slot-limit', 409);
  }
  const limitations = new Set<string>([
    'This is a retrospective observation export. It does not establish paired arms, source/bank isolation, frozen pre-run model options, or causal quality improvement.',
    'Historical objective text and the complete starting Bank/Queue were not frozen in these run records. Current objective or question versions are never substituted.',
    'Only retained final candidates are available. Earlier generator, numerical-repair and reject-replacement outputs may be absent even when their usage is recorded.',
    'Usage covers observed LLM calls only, excluding embeddings, parsing and infrastructure. Unknown counters remain unknown; SDK-internal retries may be unobserved.',
    'No teacher labels, acceptance decisions, or review time are inferred from publication state or model judgments.',
  ]);
  const filter = { courseId, runId: runId.toHexString() };
  const [versions, receipts, totalCalls, summary] = await Promise.all([
    questionVersionsCol().find({ version: 1, 'provenance.kind': 'generated', 'provenance.runId': runId })
      .sort({ _id: 1 }).limit(MAX_SLOTS + 1).toArray(),
    modelCallReceiptsCol().find(filter).sort({ startedAt: 1, _id: 1 }).limit(MAX_CALLS).toArray(),
    modelCallReceiptsCol().countDocuments(filter),
    summarizeModelUsage({ courseId: courseId.toHexString(), runId: runId.toHexString() }),
  ]);
  if (versions.length > MAX_SLOTS) unavailable('evaluation-export-version-limit', 409);
  // Version records have no course field. Resolve ownership from their heads,
  // without reading current content or publication decisions.
  const heads = versions.length ? await questionsCol().find({
    courseId, _id: { $in: versions.map(version => version.questionId) },
  }, { projection: { _id: 1 } }).toArray() : [];
  const owned = new Set(heads.map(head => head._id.toHexString()));
  const byItem = new Map<number, WithId<QuestionVersion>[]>();
  for (const version of versions) {
    const provenance = version.provenance;
    if (!owned.has(version.questionId.toHexString()) || version.version !== 1 || provenance?.kind !== 'generated' ||
      !provenance.runId.equals(runId) || !Number.isSafeInteger(provenance.item) || provenance.item < 0 || provenance.item >= run.input.count) {
      limitations.add('An original-version record could not be bound to an owned question and exact requested slot; it was omitted.');
      continue;
    }
    const rows = byItem.get(provenance.item) ?? [];
    rows.push(version); byItem.set(provenance.item, rows);
  }
  const assessments = run.result?.quality?.assessments ?? [];
  const slots: GenerationEvaluationSlot[] = Array.from({ length: run.input.count }, (_, item) => {
    const originals = byItem.get(item) ?? [];
    const findings = assessments.filter(assessment => assessment.item === item);
    const assessment = findings.length === 1 ? findings[0] : undefined;
    const failureCodes = [...new Set((run.result?.failures ?? []).filter(failure => failure.item === item).map(failure => failure.code))];
    if (findings.length > 1) limitations.add('Multiple assessments share one slot; no arbitrary assessment was selected.');
    if (originals.length === 1) {
      const version = originals[0];
      const candidate = snapshotQualityCandidate(version);
      if (candidate.truncated) limitations.add('At least one exported candidate is a bounded diagnostic copy. Its hash identifies the full intended question content; omitted content is unavailable here.');
      const sources = sourceRefs(version);
      if (sources.recordedSourceRefsTruncated) limitations.add('At least one saved question source-reference list was truncated to the export budget. These excerpts cannot establish complete source coverage.');
      return { item, outcome: 'saved', candidate, questionVersionId: version._id.toHexString(), failureCodes,
        ...(assessment ? { assessment } : {}), ...sources,
        ...(version.verification ? { numericVerification: { ...version.verification, sampleSeeds: [...version.verification.sampleSeeds], verifiedAt: iso(version.verification.verifiedAt) } } : {}),
      };
    }
    if (originals.length > 1) {
      limitations.add('Multiple immutable generated versions share one requested slot. The export does not choose an arbitrary saved candidate.');
      return { item, outcome: 'unavailable', failureCodes: [...failureCodes, 'export-ambiguous-original-version'] };
    }
    if (assessment?.candidate?.truncated) limitations.add('At least one withheld candidate is a truncated diagnostic copy; the full original output is unavailable.');
    const knownOutcome = assessment?.status === 'withheld' ? 'withheld' : failureCodes.length ? 'failed' : 'unavailable';
    if (knownOutcome === 'unavailable') {
      failureCodes.push('export-unrecorded-slot');
      limitations.add('Some requested slots have no exact retained original version, withheld assessment, or slot failure. Their outcomes remain unavailable rather than inferred from array position or preview text.');
    }
    return { item, outcome: knownOutcome, failureCodes, ...(assessment ? { assessment,
      ...(assessment.candidate ? { candidate: assessment.candidate } : {}) } : {}) };
  });
  const retainedSavedIds = new Set([...byItem.values()].flat().map(version => version.questionId.toHexString()));
  if (run.result?.createdQuestionIds.some(id => !retainedSavedIds.has(id.toHexString()))) {
    limitations.add('The run reports saved questions whose exact original versions or owning heads are unavailable; their content and slot identity cannot be reconstructed.');
  }
  if (!run.result?.quality?.evidence) {
    limitations.add('No frozen source evidence packet is retained for this run. Copied question sourceRefs, when present, are partial original excerpts, not reconstructed source eligibility/version or complete retrieval context.');
  }
  if (run.result?.quality?.evidence?.coverage.truncated) limitations.add('The frozen evidence packet omitted passages because of its generation-time budget.');
  if (assessments.some(assessment => assessment.coverage.memoryTruncated || assessment.coverage.missingVersions > 0)) {
    limitations.add('Question-memory comparison was bounded or contained missing versions. Compared version IDs do not reconstruct the complete starting Bank/Queue.');
  }
  const calls: GenerationEvaluationCall[] = receipts.map(receipt => {
    const call = modelCallDto(receipt);
    return { id: call._id, stage: call.stage, ...(call.item !== undefined ? { item: call.item } : {}),
      ...(call.candidateAttempt !== undefined ? { candidateAttempt: call.candidateAttempt } : {}),
      ...(call.jsonAttempt !== undefined ? { jsonAttempt: call.jsonAttempt } : {}),
      provider: call.provider, requestedModel: call.requestedModel, actualModel: call.actualModel,
      requestOptions: call.requestOptions, outcome: call.outcome, usage: call.usage, retryVisibility: call.retryVisibility,
      startedAt: iso(call.startedAt), ...(call.finishedAt ? { finishedAt: iso(call.finishedAt) } : {}),
      ...(call.durationMs !== undefined ? { durationMs: call.durationMs } : {}),
    };
  });
  if (totalCalls > calls.length) limitations.add('The call-row export is truncated. The usage summary is calculated independently over all retained receipts within the usage service accounting limit, not only exported rows.');
  if (summary.status !== 'complete' || summary.untracked || summary.coverageGaps) limitations.add('Recorded usage is incomplete or unavailable. Its subtotal cannot support a complete cost comparison.');
  if (summary.pendingCalls) limitations.add('Late provider usage may still finalize after this export; re-export to observe later receipts.');
  // A terminal run can still be rewritten by recovery tooling. Do not combine
  // its first input snapshot with a later candidate result without noticing.
  const current = await getCourseContentRun(courseId, runId);
  if (!current || current.revision !== run.revision || current.status !== run.status) unavailable('evaluation-export-run-changed', 409);
  return {
    schemaVersion: 'generation-evaluation-export-v1', exportedAt: new Date().toISOString(),
    run: { id: runId.toHexString(), courseId: courseId.toHexString(), loId: run.input.loId.toHexString(),
      ...(run.input.secondaryLoIds ? { secondaryLoIds: run.input.secondaryLoIds.map(id => id.toHexString()) } : {}),
      policy: run.input.qualityPolicy ?? 'baseline', requestedSlots: run.input.count, type: run.input.type,
      ...(run.input.difficulty ? { difficulty: run.input.difficulty } : {}),
      ...(run.input.hardnessMove ? { hardnessMove: run.input.hardnessMove } : {}), ...(run.input.kind ? { kind: run.input.kind } : {}),
      ...(run.input.prompt !== undefined ? { prompt: run.input.prompt } : {}),
      ...(run.grounding ? { grounding: { allowedMaterialIds: run.grounding.allowedMaterialIds.map(id => id.toHexString()),
        retrievedChunkCount: run.grounding.retrievedChunkCount, ...(run.grounding.pinned !== undefined ? { pinned: run.grounding.pinned } : {}) } } : {}),
      status: run.status, models: { ...run.input.models }, createdAt: iso(run.createdAt),
      ...(run.startedAt ? { startedAt: iso(run.startedAt) } : {}), ...(run.completedAt ? { finishedAt: iso(run.completedAt) } : {}),
    },
    slots, ...(run.result?.quality?.evidence ? { evidence: run.result.quality.evidence } : {}),
    usage: { summary: modelUsageSummaryDto(summary), calls, totalCalls, callsTruncated: totalCalls > calls.length },
    limitations: [...limitations],
  };
}
