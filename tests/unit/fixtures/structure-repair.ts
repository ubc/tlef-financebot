import { ObjectId, type WithId } from 'mongodb';
import { env } from '../../../server/src/config/env';
import { outlineGroundingProtocolHash, outlineGroundingReceipt, planOutlineGrounding, validateOutlineGroundingRows } from '../../../server/src/services/structure-outline-grounding';
import { structureReviewHash } from '../../../server/src/services/structure-review-checkpoint.service';
import type { StructureReviewCheckpoint, StructureReviewCheckpointBody, StructureReviewProgress } from '../../../server/src/types/structure-review';
import type { StructureGenerationRun } from '../../../server/src/types/domain';

export function structureRepairFixture() {
  const courseId = new ObjectId('000000000000000000000003'); const rootId = new ObjectId('000000000000000000000004');
  const parentId = new ObjectId('000000000000000000000006'); const checkpointId = new ObjectId('000000000000000000000007');
  const sections = [
    'The rental alternative is the expected present value of after-tax rental or lease revenues.',
    'Without taxes, bankruptcy or agency costs and with fixed cash flows, financing does not change firm value. Evaluate the choices posed in the unmarked activity.',
    'Diversification reduces firm-specific risk.',
  ].map((text, index) => ({ id: `source-${index}`, materialId: `00000000000000000000001${index}`, materialName: `Chapter ${index + 1}.pdf`, chunkIndex: 0, text }));
  const evidence = sections.map((section, index) => ({ id: `E${index + 1}`, objective: `Apply the exact taught capability ${index + 1}`,
    materialId: section.materialId, materialName: section.materialName, chunkIndex: 0, quote: section.text }));
  const names = ['Value an owned asset using rental value.', 'Explain capital-structure irrelevance and the definitive signal of preferred stock.', 'Explain how diversification reduces firm-specific risk.'];
  const themes = [{ name: 'Taught finance capabilities', los: evidence.map((point, index) => ({ name: names[index], evidenceIds: [point.id], materialIds: [point.materialId] })) }];
  const baseBudget = { version: 1 as const, estimator: 'utf8-bytes-conservative-v1' as const, retryVisibility: 'unknown' as const, limitScope: 'process' as const,
    observedSends: 31, estimatedInputTokens: 1274173, reservedOutputTokens: 180000, admissionTokens: 1454173, pendingSends: 0,
    accounting: 'conservative-reservations-v1' as const, reportedInputTokens: 200000, reportedOutputTokens: 120000, usageCompleteness: 'complete' as const,
    conservativeFinishedSends: 31, settledSends: 0, queueWaitMs: 0, executionMs: 1000, rejectedSends: 0,
    logical: { generatorAttempts: 0, repairCycles: 0, evidenceExpansions: 0, limits: { generatorAttempts: 2, repairCycles: 1, evidenceExpansions: 1 } },
    limits: { maxSends: 100, maxInputTokens: 200000, maxOutputTokens: 24000, maxEstimatedTokens: 2000000 } };
  const materialIds = sections.map(row => row.materialId);
  const body: StructureReviewCheckpointBody = { version: 'exact-outline-review-v1', origin: 'production-proposal-v1', courseId: courseId.toHexString(), rootRunId: rootId.toHexString(),
    options: { materialIds }, corpus: { sections, fingerprint: 'exact-originals', materials: sections.map(row => ({ materialId: row.materialId, name: row.materialName, chunks: 1, sections: 1,
      sourceTextHash: structureReviewHash(row.text), parserVersion: 'parser', chunkerVersion: 'chunker' })), sourceSelection: { ready: true, requested: [], excluded: [],
      included: sections.map(row => ({ materialId: row.materialId, name: row.materialName, sourceTextHash: structureReviewHash(row.text), chunkCount: 1, characterCount: row.text.length,
        parserVersion: 'parser', chunkerVersion: 'chunker', revision: 1 })) } },
    themes, evidence, extractions: sections.map(row => ({ sectionId: row.id, reused: true, row: { sectionId: row.id, objectives: [{ name: 'Apply the taught capability', passageId: `${row.id}.P1`, quote: row.text }], knowledge: [] } })),
    excludedSections: [], cache: { hits: 3, misses: 0, reusedSections: 3, extractedSections: 0 }, reviewInputLimit: 46500, batches: planOutlineGrounding(themes, evidence, sections, 46500),
    model: { model: 'gpt-6-luna', reasoningEffort: 'medium' }, providerIdentityHash: structureReviewHash({ provider: env.llmProvider, endpoint: env.llmEndpoint }),
    protocolHash: outlineGroundingProtocolHash(), baseBudget };
  const findings = validateOutlineGroundingRows({ reviews: body.batches[0].objectives.map((row, index) => ({ id: row.id, sourceStatus: index < 2 ? 'uncertain' : 'supported',
    sourceIds: row.sourceIds, sourceReason: index < 2 ? 'Clarify the stated condition or avoid claiming an unmarked answer.' : 'The exact source teaches this capability.',
    coveredEvidenceIds: index < 2 ? [] : row.evidenceIds, topicFit: 'fits', topicReason: 'Fits the topic.' })) }, body.batches[0]).findings;
  const grounding = outlineGroundingReceipt(findings, 3); const now = new Date('2026-10-17T00:00:00Z');
  const checkpoint: WithId<StructureReviewCheckpoint> = { _id: checkpointId, courseId, runId: rootId, hash: structureReviewHash(body), body, createdAt: now };
  const progress: WithId<StructureReviewProgress> = { _id: new ObjectId(), courseId, checkpointId, checkpointHash: checkpoint.hash, ownerRunId: parentId, continuationRunId: parentId,
    revision: 20, updatedAt: now, findings, attempts: { L1: 1, L2: 2, L3: 1 }, failures: [], unresolvedDispatchIds: [], usedTokens: baseBudget.admissionTokens,
    reservations: baseBudget.observedSends, pendingNative: [], maxTokens: 2000000, maxSends: 100 };
  const parent: WithId<StructureGenerationRun> = { _id: parentId, courseId, requestedBy: 'owner', kind: 'structure-generation', status: 'completed', stage: 'checking',
    input: { materialIds }, completedUnits: 0, revision: 20, createdAt: now, updatedAt: now, completedAt: now, events: [], warnings: [],
    structureReview: { checkpointId, checkpointHash: checkpoint.hash, parentRunId: rootId },
    structureDiagnostics: { sourceSelection: body.corpus.sourceSelection, cache: body.cache, budget: baseBudget, outlineGrounding: grounding, unprocessedSections: [] },
    structureResult: { themes: [{ name: themes[0].name, los: [themes[0].los[2]] }], evidence, coverage: { sourceFingerprint: body.corpus.fingerprint,
      sourceSelection: body.corpus.sourceSelection, cache: body.cache, budget: baseBudget, outlineGrounding: grounding, materials: [], analyzedSections: 3,
      extractedObjectives: 3, mappedObjectives: 1, unmappedEvidenceIds: ['E1', 'E2'], excludedSections: [], warnings: [] } } };
  return { courseId, rootId, parentId, checkpointId, body, checkpoint, progress, parent };
}
