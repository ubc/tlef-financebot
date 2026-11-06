import { defaultJsonReasoningEffort } from '../components/genai/llm/model-capabilities';
import type { StepModelConfig, ReasoningEffort } from '../types/domain';

/** Reasoning tokens and visible JSON share the provider output ceiling. Keep
 * responses concise while allowing the selected model effort to finish them.
 * These caps never bypass enclosing send/output/token admission limits. */
export function generationStageOutputCap(step: StepModelConfig, stage: 'generation' | 'validation' | 'review' | 'quality'): number {
  const effort = step.reasoningEffort ?? defaultJsonReasoningEffort(step.model, step.capabilityProfile);
  const caps: Record<ReasoningEffort, { generation: number; check: number; quality: number }> = {
    none: { generation: 3000, check: 1500, quality: 2000 },
    low: { generation: 5000, check: 3000, quality: 3500 },
    medium: { generation: 8000, check: 6000, quality: 6000 },
    high: { generation: 8000, check: 6000, quality: 6000 },
    xhigh: { generation: 10000, check: 8000, quality: 8000 },
  };
  return stage === 'generation' ? caps[effort].generation : stage === 'quality' ? caps[effort].quality : caps[effort].check;
}
