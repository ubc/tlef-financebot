import { z } from 'zod';
import type { GeneratorOutput } from '../../server/src/services/generation.service';

const bounded = z.string().min(1).max(10000);
const descriptor = z.object({ concepts: z.array(bounded).min(1).max(12), requiredInference: bounded,
  solutionPath: z.array(bounded).min(1).max(12), misconception: bounded, targetDifficulty: z.enum(['easy', 'medium', 'hard']),
  achievedDifficulty: z.enum(['easy', 'medium', 'hard']).optional(), passageIds: z.array(bounded).min(1).max(20),
  intent: z.enum(['edit-existing', 'create-variant', 'create-independent-task']) }).strict();
export const generatedCandidateSchema = z.object({ stem: bounded, difficulty: z.enum(['easy', 'medium', 'hard']),
  numericKind: z.enum(['numeric', 'conceptual']),
  paramSlots: z.array(z.object({ name: bounded, min: z.number().finite().optional(), max: z.number().finite().optional(), step: z.number().finite().optional(),
    values: z.array(z.number().finite()).min(1).max(100).optional() }).strict()).max(30),
  derivedValues: z.array(z.object({ name: bounded, formula: bounded, errorModel: bounded.optional() }).strict()).max(30),
  options: z.array(z.object({ key: z.enum(['A', 'B', 'C', 'D']), text: bounded,
    role: z.enum(['correct', 'common-misconception', 'partially-correct', 'clearly-wrong']), explanation: bounded }).strict()).min(2).max(4),
  taskDescriptor: descriptor, hardnessMove: bounded.optional() }).strict();
/** Do not silently replace malformed output. Raw JSON remains in the transcript. */
export function parseLabCandidate(value: unknown, type: 'mcq' | 'true-false'): GeneratorOutput {
  const candidate = generatedCandidateSchema.parse(value);
  const expected = type === 'mcq' ? 4 : 2;
  if (candidate.options.length !== expected || new Set(candidate.options.map(option => option.key)).size !== expected ||
    candidate.options.filter(option => option.role === 'correct').length !== 1 ||
    candidate.options.filter(option => option.role === 'common-misconception').length !== 1) throw new Error('quality-lab-option-contract-invalid');
  if (type === 'true-false' && (candidate.options[0]?.key !== 'A' || candidate.options[1]?.key !== 'B' || candidate.options[0]?.text !== 'True' || candidate.options[1]?.text !== 'False' || candidate.numericKind !== 'conceptual')) throw new Error('quality-lab-true-false-contract-invalid');
  return candidate;
}
