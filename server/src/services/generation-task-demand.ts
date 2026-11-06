import { z } from 'zod';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Difficulty } from '../types/domain';
import type { AuthoringRequirements, GenerationQualityAssessment, GenerationQualityCandidate, GenerationTaskDemandAssessment, GenerationValidationFinding } from '../types/generation-quality';
import type { GenerationEvidencePacket } from '../types/generation-evidence';
import { resolveSpanCitations, type CitationIssue } from './generation-citation-spans';

export const taskDemandReviewSchema = z.object({
  verdict: z.enum(['fulfilled', 'unfulfilled', 'uncertain']), capacity: z.enum(['supported', 'insufficient', 'uncertain']),
  rationale: z.string().trim().min(1).max(180), missingOperation: z.string().trim().max(180),
  spanIds: z.array(z.string().regex(/^S[1-9][0-9]*$/)).max(3),
}).strict();
export type TaskDemandReview = z.infer<typeof taskDemandReviewSchema>;
type Candidate = Pick<GenerationQualityCandidate, 'type' | 'numericKind'>;

function requirementsHash(requirements: AuthoringRequirements): string {
  return createHash('sha256').update(JSON.stringify(requirements, (_key, value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value)).digest('hex');
}

export function taskDemandEnabled(requirements?: AuthoringRequirements): boolean {
  const protocol = requirements?.taskDemandProtocol;
  if (protocol !== undefined && protocol !== 'task-demand-v1') throw new Error('generation-task-demand-protocol-invalid');
  if (protocol === undefined) return false;
  if (requirements?.requestedDifficulty !== undefined && !['easy', 'medium', 'hard'].includes(requirements.requestedDifficulty)
    || requirements?.requestedKind !== undefined && !['numeric', 'conceptual'].includes(requirements.requestedKind)
    || requirements?.requestedType !== undefined && !['mcq', 'true-false'].includes(requirements.requestedType)) throw new Error('generation-task-demand-request-invalid');
  return true;
}

export function taskDemandInstruction(): string {
  return 'DEMAND: judge necessary student reasoning, not labels/word count/feedback length. taskDemand:{verdict:fulfilled|unfulfilled|uncertain,capacity:supported|insufficient|uncertain,rationale:<=180chars,missingOperation:<=180chars,spanIds:[<=3 S IDs]}. Explain actual operation/contrast, not hidden reasoning. Fulfilled: capacity supported,1–3 refs,empty missingOperation and requested type/kind/level met. Unfulfilled+supported: cite taught dependencies and name the missing operation for one correction. Insufficient/uncertain: scoped shortfall,not invented prerequisites or chapter-wide absence. Hard needs necessary integration/backward solving or discriminating related rules,not copied clauses. Never change the requested level or just relabel; retain all source/Bank/teacher/answer checks.';
}

/** Exact fields and source joins constrain a model judgment; they do not prove cognitive demand. */
export function evaluateTaskDemand(value: unknown, candidate: Candidate, packet: GenerationEvidencePacket,
  requirements: AuthoringRequirements, difficulty?: Difficulty): {
    assessment: GenerationTaskDemandAssessment; responseIssues: CitationIssue[]; findings: GenerationValidationFinding[];
  } {
  const issues: CitationIssue[] = [], responseIssues: CitationIssue[] = [];
  const add = (path: string, code: string, response = false) => { const issue = { path: `taskDemand.${path}`, code }; issues.push(issue); if (response) responseIssues.push(issue); };
  const requested = { ...(requirements.requestedDifficulty ? { difficulty: requirements.requestedDifficulty } : {}),
    ...(requirements.requestedKind ? { kind: requirements.requestedKind } : {}), ...(requirements.requestedType ? { type: requirements.requestedType } : {}) };
  const achieved = { ...(difficulty ? { difficulty } : {}), ...(candidate.numericKind ? { kind: candidate.numericKind } : {}), type: candidate.type };
  const base: GenerationTaskDemandAssessment = { protocol: 'task-demand-v1', status: 'withheld', verdict: 'uncertain', capacity: 'uncertain',
    rationale: 'No validated task-demand finding.', missingOperation: '', spanIds: [], requirementsHash: requirementsHash(requirements), citations: [], requested, achieved, issues };
  const parsed = taskDemandReviewSchema.safeParse(value);
  if (!parsed.success) { add('response', 'task-demand-schema-invalid', true); return { assessment: base, responseIssues, findings: [] }; }
  const row = parsed.data;
  const resolved = row.spanIds.length ? resolveSpanCitations(packet, [{ kind: 'solution', claim: row.rationale, spanIds: row.spanIds }]) : { citations: [], issues: [] };
  const damaged = new Set(packet.findings.filter(finding => finding.code === 'source-text-damage').flatMap(finding => finding.passageIds));
  const valid = !resolved.issues.length && resolved.citations.every(citation => packet.passages.some(p => p.id === citation.passageId
    && ['primary', 'secondary', 'prerequisite'].includes(p.role) && packet.materials.some(m => m.materialId === p.materialId && m.role === p.role && m.loId === p.loId)) && !damaged.has(citation.passageId));
  if (!valid || row.capacity === 'supported' && !row.spanIds.length) add('spanIds', 'task-demand-evidence-invalid', true);
  if (row.verdict === 'fulfilled' && (row.capacity !== 'supported' || row.missingOperation)
    || row.verdict === 'unfulfilled' && row.capacity === 'supported' && !row.missingOperation) add('verdict', 'task-demand-contradictory-fields', true);
  const mismatch = Boolean(requested.difficulty && requested.difficulty !== achieved.difficulty
    || requested.kind && requested.kind !== achieved.kind || requested.type && requested.type !== achieved.type);
  if (mismatch) add('achieved', 'requested-demand-mismatch');
  // A contradictory semantic label is withheld immediately, not corrected into
  // optimistic eligibility. Valid unfulfilled findings may guide one new task.
  if (row.verdict === 'fulfilled' && mismatch) add('verdict', 'fulfilled-demand-disagrees-with-achieved');
  if (row.verdict !== 'fulfilled') add('verdict', row.verdict === 'uncertain' ? 'task-demand-uncertain' : 'task-demand-unfulfilled');
  if (row.capacity !== 'supported') add('capacity', `task-demand-capacity-${row.capacity}`);
  const assessment: GenerationTaskDemandAssessment = { ...base, ...row, spanIds: valid ? row.spanIds : [], citations: valid ? resolved.citations : [] };
  if (!issues.length) assessment.status = 'passed';
  const repairable = !responseIssues.length && row.verdict === 'unfulfilled' && row.capacity === 'supported' && !!row.missingOperation && valid;
  const findings: GenerationValidationFinding[] = assessment.status !== 'passed' ? [{ kind: 'instruction', target: 'task', status: repairable ? 'defect' : 'uncertain',
    observation: `Requested demand not fulfilled. ${row.rationale}`.slice(0, 350),
    correction: repairable ? `Preserve the fixed request and implement the taught missing operation: ${row.missingOperation}. Do not add untaught premises or merely relabel/lengthen.`.slice(0, 350) : '',
    passageIds: [...new Set(assessment.citations.map(c => c.passageId))], memoryEntryIds: [] }] : [];
  return { assessment, responseIssues, findings };
}

/** Caller supplies snapshotQualityCandidate(actualCandidate), never a stored or
 * model-supplied hash. No I/O is performed inside the final authoring fence. */
export function taskDemandReceiptMatches(assessment: GenerationQualityAssessment, requirements: AuthoringRequirements,
  candidate: GenerationQualityCandidate, packet: GenerationEvidencePacket): boolean {
  if (!taskDemandEnabled(requirements)) return true;
  const receipt = assessment.taskDemand;
  if (!receipt || assessment.policy !== 'grounded-memory-v2' || assessment.evidencePacketId !== packet.id || candidate.truncated
    || !assessment.candidate || assessment.candidate.truncated || !isDeepStrictEqual(candidate, assessment.candidate)) return false;
  const body = { ...candidate } as Partial<GenerationQualityCandidate>;
  delete body.contentHash; delete body.truncated;
  if (createHash('sha256').update(JSON.stringify(body)).digest('hex') !== candidate.contentHash) return false;
  const checked = evaluateTaskDemand({ verdict: receipt.verdict, capacity: receipt.capacity, rationale: receipt.rationale,
    missingOperation: receipt.missingOperation, spanIds: receipt.spanIds }, candidate, packet, requirements, assessment.achievedDifficulty);
  return checked.responseIssues.length === 0 && isDeepStrictEqual(checked.assessment, receipt);
}

export function taskDemandPassed(assessment: GenerationQualityAssessment, requirements: AuthoringRequirements,
  candidate: GenerationQualityCandidate, packet: GenerationEvidencePacket): boolean {
  if (!taskDemandEnabled(requirements)) return true;
  return assessment.status === 'eligible' && assessment.taskDemand?.status === 'passed'
    && taskDemandReceiptMatches(assessment, requirements, candidate, packet);
}
