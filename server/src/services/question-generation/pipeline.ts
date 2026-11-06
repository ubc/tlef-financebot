import type { ObjectId } from 'mongodb';
import { completeJson } from '../../components/genai/llm';
import { losCol } from '../../components/mongodb/collections';
import type {
  Difficulty, Question, QuestionGenerationResult, QuestionKind, QuestionType, QuestionVersion,
} from '../../types/domain';
import { createQuestion } from '../questions.service';
import { updateContentRun, failContentRun, assertContentRunActive } from '../content-runs.service';
import { withGenerationPreview } from '../generation-preview';
import { courseCollection } from '../materials.service';
import { shuffleOptions } from '../option-order.service';
import { drawSeed } from '../params.service';
import { refreshQuestionSimilarity } from '../question-similarity.service';
import type { ResolvedStepModels } from '../step-models';
import type { GenerationInput } from '../generation.service';
import {
  assignMovesForBatch, inspectCandidate, normalizeDifficulty, sanitizeGenerated, sourceRefsFor,
  withVerificationNote, type GeneratorOutput, type RetrievedChunk, type verifyGeneratedNumerics,
} from './candidate';
import { CHECKER_PROMPT, parseCheckerOutput, uncheckedDecision, type CheckerOutput } from './checker-prompt';
import { GENERATOR_PROMPT, GENERATOR_TEMPERATURE, type RegenerateContext } from './generator-prompt';
import { loadExistingLoStems } from './existing-stems';
import { retrieveChunks, resolveSecondaryLos, taggedLoIds, taggedThemeIds } from './grounding';
import { allocateSlots, type SlotAssignment } from './slots';

export interface CheckedCandidate {
  generated: GeneratorOutput;
  numerics: ReturnType<typeof verifyGeneratedNumerics>;
  check: CheckerOutput;
  sourceRefs: QuestionVersion['sourceRefs'];
}

/** Exactly two model calls: generate, then check. Nothing here retries. */
export async function generateAndCheck(input: {
  type: QuestionType; kind?: QuestionKind; difficulty?: Difficulty; loName: string; secondaryLoNames: string[];
  prompt?: string; chunks: RetrievedChunk[]; slot: SlotAssignment; existingStems: string[]; batchStems: string[];
  regenerate?: RegenerateContext; models: Pick<ResolvedStepModels, 'generator' | 'reviewer'>;
  checkpoint: () => Promise<void>; item: number; onText?: (text: string) => void; preserveOptionOrder?: boolean;
}): Promise<CheckedCandidate> {
  await input.checkpoint();
  const raw = await completeJson<GeneratorOutput>(GENERATOR_PROMPT({
    type: input.type, loName: input.loName, difficulty: input.difficulty, prompt: input.prompt, chunks: input.chunks,
    assignedMove: input.slot.hardnessMove, kind: input.kind, secondaryLoNames: input.secondaryLoNames,
    angle: input.slot.angle, focusChunk: input.slot.focusChunk, existingStems: input.existingStems,
    batchStems: input.batchStems, ...(input.regenerate ? { regenerate: input.regenerate } : {}),
  }), {
    temperature: GENERATOR_TEMPERATURE, ...input.models.generator,
    usageContext: { stage: 'generation', item: input.item }, beforeRequest: input.checkpoint,
    ...(input.onText ? { onText: input.onText } : {}),
  });
  const inspection = inspectCandidate({ type: input.type, kind: input.kind, difficulty: input.difficulty, candidate: raw });
  if (!inspection.storable) throw new Error('generation-invalid-options');
  const clean = sanitizeGenerated(raw);
  // Shuffled BEFORE the checker: it cites options by letter.
  const generated = input.type === 'mcq' && !input.preserveOptionOrder ? { ...clean, options: shuffleOptions(clean.options, drawSeed()) } : clean;
  await input.checkpoint();
  let check: CheckerOutput;
  try {
    check = parseCheckerOutput(await completeJson<unknown>(CHECKER_PROMPT({
      loName: input.loName, secondaryLoNames: input.secondaryLoNames, type: input.type, question: generated,
      chunks: input.chunks, assignedMove: input.slot.hardnessMove, findings: inspection.findings,
    }), { ...input.models.reviewer, usageContext: { stage: 'check', item: input.item }, beforeRequest: input.checkpoint }));
  } catch (error) {
    if (error instanceof Error && error.message === 'content-run-conflict') throw error;
    check = uncheckedDecision(error);
  }
  return { generated, numerics: inspection.numerics, check, sourceRefs: sourceRefsFor(input.chunks, raw.sourceChunkIndexes) };
}

export function agentDecisionFrom(check: CheckerOutput, numericsFailure?: string): NonNullable<Question['agentDecision']> {
  return {
    decision: check.decision,
    reasoning: withVerificationNote(check.reasoning, numericsFailure),
    roleAssessment: check.roleAssessment,
    suggestions: check.suggestions,
    ...(check.suggestedDifficulty ? { suggestedDifficulty: check.suggestedDifficulty } : {}),
  };
}

const failureFrom = (item: number, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const prefix = message.split(':')[0];
  return { item, stage: 'generating' as const, code: /^[a-z0-9-]+$/.test(prefix) ? prefix : 'generation-item-failed', message };
};

/** The queued-run job: retrieve once, allocate slots, then generate → check → save
 * serially so each slot sees the stems written before it. */
export async function runQuestionGeneration(input: GenerationInput, runId: ObjectId): Promise<ObjectId[]> {
  const type: QuestionType = input.type ?? 'mcq';
  const result: QuestionGenerationResult = { createdQuestionIds: [], failures: [], checks: [] };
  const checkpoint = () => assertContentRunActive(runId);
  let stage: 'retrieving' | 'generating' = 'retrieving';
  try {
    if (!input.models) throw new Error('generation-models-missing');
    await updateContentRun(runId, { status: 'running', stage, message: `Retrieving course material (generator ${input.models.generator.model}, checker ${input.models.reviewer.model})` });
    const lo = await losCol().findOne({ _id: input.loId });
    if (!lo) throw new Error('lo-not-found');
    if (!lo.courseId.equals(input.courseId)) throw new Error('lo-not-in-course');
    const secondary = await resolveSecondaryLos(input.courseId, lo, input.secondaryLoIds);
    const secondaryLoNames = secondary.map(entry => entry.lo.name);
    const grounding = await retrieveChunks(courseCollection(input.courseId), input.courseId, lo, input.prompt,
      input.pinnedMaterialIds?.map(id => id.toHexString()), !input.groundingPinned && input.difficulty === 'hard', secondary);
    const loIds = taggedLoIds(input.loId, secondary);
    const existingStems = await loadExistingLoStems({ courseId: input.courseId, loIds });
    const slots = allocateSlots({ count: input.count, kind: input.kind, type, chunkCount: grounding.chunks.length,
      seed: runId.toHexString(), hardnessMoves: assignMovesForBatch(input.difficulty, input.hardnessMove, input.count, type) });
    stage = 'generating';
    await updateContentRun(runId, { status: 'running', stage, message: `Retrieved ${grounding.chunks.length} chunks` });
    const batchStems: string[] = [];
    for (const slot of slots) {
      await checkpoint();
      try {
        await updateContentRun(runId, { message: `Writing and checking question ${slot.item + 1} of ${input.count}` });
        const checked = await withGenerationPreview(runId, slot.item, onText => generateAndCheck({
          type, kind: input.kind, difficulty: input.difficulty, loName: lo.name, secondaryLoNames, prompt: input.prompt,
          chunks: grounding.chunks, slot, existingStems, batchStems: [...batchStems], models: input.models!, checkpoint,
          item: slot.item, onText,
        }));
        batchStems.push(checked.generated.stem);
        const { questionId } = await createQuestion({
          courseId: input.courseId, loIds, themeIds: taggedThemeIds(lo, secondary), type,
          stem: checked.generated.stem, options: checked.generated.options, optionsAlreadyShuffled: true,
          difficulty: normalizeDifficulty(input.difficulty ?? checked.generated.difficulty),
          sourceRefs: checked.sourceRefs, createdBy: input.byPuid,
          provenance: { kind: 'generated', runId, ...(input.blueprintId ? { blueprintId: input.blueprintId } : {}), item: slot.item },
          ...(input.prompt !== undefined ? { generationPrompt: input.prompt } : {}),
          ...checked.numerics.fields,
          agentDecision: agentDecisionFrom(checked.check, checked.numerics.failure),
        });
        result.createdQuestionIds.push(questionId);
        result.checks!.push({ item: slot.item, check: 'quality-review', verdict: checked.check.decision, explanation: checked.check.reasoning.slice(0, 1600), at: new Date() });
        await refreshQuestionSimilarity(questionId);
      } catch (error) {
        if (error instanceof Error && error.message === 'content-run-conflict') throw error;
        result.failures.push(failureFrom(slot.item, error));
      }
      await updateContentRun(runId, { completedUnits: result.createdQuestionIds.length + result.failures.length, result });
    }
    if (result.createdQuestionIds.length === 0) {
      await failContentRun(runId, { code: 'generation-no-questions-created', message: 'No Draft questions could be created from this run.', atStage: stage, retryable: true }, result);
      return [];
    }
    const status = result.createdQuestionIds.length === input.count ? 'completed' : 'partial';
    await updateContentRun(runId, { status, stage, completedUnits: input.count, result,
      message: status === 'completed' ? `Created ${result.createdQuestionIds.length} Draft questions` : `Created ${result.createdQuestionIds.length} of ${input.count} Draft questions` });
    return result.createdQuestionIds;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'content-run-conflict') return result.createdQuestionIds;
    await failContentRun(runId, { code: /^[a-z0-9-]+$/.test(message) ? message : 'generation-run-failed', message, atStage: stage, retryable: true }, result);
    return result.createdQuestionIds;
  }
}
