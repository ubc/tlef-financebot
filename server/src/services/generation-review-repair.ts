import { createHash } from 'node:crypto';
import type { AuthoringRequirements, GenerationQualityAssessment, GenerationQualityCandidate, GenerationQualityPolicy } from '../types/generation-quality';
import type { GenerationReviewRepairReceipt } from '../types/generation-review-repair';
import type { GenerationEvidencePacket } from '../types/generation-evidence';

export const REVIEW_REPAIR_PROTOCOL = 'frozen-review-decisions-v1' as const;
type Decisions = GenerationReviewRepairReceipt['before'];
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    let time: number | undefined;
    try { time = Date.prototype.getTime.call(value); } catch { /* Not a native Date. */ }
    if (time !== undefined) {
      if (!Number.isFinite(time)) throw new Error('generation-review-repair-invalid-date');
      return JSON.stringify(new Date(time).toISOString());
    }
  }
  if (value && typeof value === 'object') return '{' + Object.getOwnPropertyNames(value).sort().flatMap(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!Object.hasOwn(descriptor, 'value')) throw new Error('generation-review-repair-accessor');
    return descriptor.value === undefined ? [] : [JSON.stringify(key) + ':' + canonical(descriptor.value)];
  }).join(',') + '}';
  throw new Error('generation-review-repair-non-json');
}
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!Object.hasOwn(descriptor, 'value')) throw new Error('generation-review-repair-accessor');
    result[key] = descriptor.value;
  }
  return result;
}
function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(row) : [];
}
function text(value: unknown, maximum = 2000): value is string {
  return typeof value === 'string' && value.length <= maximum;
}
function trimmed(value: unknown, maximum: number, blank = false): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length <= maximum && (blank || normalized.length > 0) ? normalized : undefined;
}
function semanticFinding(value: unknown): Record<string, string> | undefined {
  const finding = row(value);
  const observation = trimmed(finding.observation, 350), correction = trimmed(finding.correction, 350, true);
  if (!['source-scope', 'actor-relation', 'notation', 'task-duplication', 'answer-semantics', 'instruction', 'verbosity'].includes(String(finding.kind))
    || !['stem', 'options', 'parameters', 'task'].includes(String(finding.target))
    || !['defect', 'uncertain'].includes(String(finding.status)) || observation === undefined || correction === undefined) return undefined;
  return { kind: String(finding.kind), target: String(finding.target), status: String(finding.status), observation, correction };
}
export function assertGenerationReviewRepairProtocol(value: unknown, policy?: GenerationQualityPolicy): boolean {
  if (value === undefined) return false;
  if (value !== REVIEW_REPAIR_PROTOCOL) throw new Error('generation-review-repair-protocol-invalid');
  if (policy !== undefined && policy !== 'grounded-memory-v2') throw new Error('generation-review-repair-policy-invalid');
  return true;
}

/** Extract only bounded, well-formed decisions already present in a partial
 * review. References/reasons may be repaired; missing/invalid decisions may be
 * completed. Existing valid judgments may not be silently changed or removed.
 * Exact text identities are hashed; no private model prose enters usage logs.
 * Accept both raw and canonical option warrants, including BSON plain data. */
export function captureReviewDecisions(value: unknown, candidate: Pick<GenerationQualityCandidate, 'type' | 'options'>,
  memoryIds: string[] = [], requirements?: Pick<AuthoringRequirements, 'requiredChanges' | 'preserve'>): Decisions {
  const source = row(value), out: Decisions = Object.create(null) as Decisions;
  const values = new Map<string, Set<string | boolean>>();
  const retain = (path: string, value: string | boolean) => {
    const collected = values.get(path) ?? new Set<string | boolean>();
    collected.add(value); values.set(path, collected);
  };
  const label = (path: string, value: unknown, allowed: readonly string[]) => {
    if (typeof value === 'string' && allowed.includes(value)) retain(path, value);
  };
  const boundedRows = (name: string, maximum: number) => {
    // Over-limit responses cannot discard unseen judgments through this bounded
    // correction path. A separate review is needed, within the existing budget.
    if (Array.isArray(source[name]) && source[name].length > maximum) retain(`overflow.${name}`, true);
    return rows(source[name]).slice(0, maximum);
  };
  const textSet = (name: string, items: unknown[], maximum: number, normalize: (value: unknown) => unknown | undefined) => {
    if (items.length > maximum) retain(`overflow.${name}`, true);
    const valid = items.slice(0, maximum).map(normalize).filter(value => value !== undefined);
    const identities = [...new Set(valid.map(hash))].sort();
    for (const identity of identities) retain(`${name}.${identity}`, true);
    if (valid.length === items.length) retain(name, hash(identities));
  };
  for (const [key, allowed] of Object.entries({ sourceSupport: ['supported', 'unsupported', 'uncertain'],
    notation: ['consistent', 'inconsistent', 'uncertain'], novelty: ['independent', 'duplicate', 'variant', 'uncertain'],
    achievedDifficulty: ['easy', 'medium', 'hard'], justifiedLength: ['justified', 'excessive', 'uncertain'] })) label(key, source[key], allowed);
  if (Array.isArray(source.missingPremises)) textSet('missingPremises', source.missingPremises, 6, value => trimmed(value, 350));
  for (const [name, statuses] of [['changes', ['fulfilled', 'unfulfilled', 'uncertain']], ['invariants', ['preserved', 'violated', 'uncertain']]] as const) {
    for (const item of boundedRows(name, 8)) if (text(item.requirement) && item.requirement.trim()) {
      const wanted = name === 'changes' ? requirements?.requiredChanges : requirements?.preserve;
      const index = wanted?.indexOf(item.requirement) ?? -1;
      if (index >= 0) label(`${name}.${index}.status`, item.status, statuses);
    }
  }
  const answer = row(source.answerability), keys = new Set(candidate.options.map(option => option.key));
  if (answer.kind === candidate.type) label('answerability.kind', answer.kind, [candidate.type]);
  if (candidate.type === 'true-false' && answer.kind === candidate.type) label('answerability.stemTruth', answer.stemTruth, ['true', 'false', 'undetermined']);
  if (candidate.type === 'mcq' && answer.kind === candidate.type && Array.isArray(answer.options) && answer.options.length > 8) retain('overflow.answerability', true);
  for (const option of candidate.type === 'mcq' && answer.kind === candidate.type ? rows(answer.options).slice(0, 8) : []) {
    const key = trimmed(option.key, 16);
    if (key === undefined || !keys.has(key)) continue;
    const prefix = `answerability.${JSON.stringify(key)}`;
    label(prefix + '.verdict', option.verdict, ['fully-correct', 'not-fully-correct', 'undetermined']);
    const warrant = row(option.exclusion && typeof option.exclusion === 'object' ? option.exclusion : option.exclusionWarrant);
    label(prefix + '.basis', warrant.basis, ['direct-contradiction', 'derived-incompatibility', 'explicit-task-restriction',
      'required-component-missing', 'placement-only', 'strength-only', 'silence-only', 'undetermined']);
    label(prefix + '.challenge', row(warrant.challenge).status, ['excluded', 'viable', 'uncertain']);
    label(prefix + '.legacyBasis', option.exclusionBasis, ['none', 'source-contradiction', 'explicit-stem-condition', 'incomplete-response', 'undetermined']);
  }
  const demand = row(source.taskDemand);
  label('taskDemand.verdict', demand.verdict, ['fulfilled', 'unfulfilled', 'uncertain']);
  label('taskDemand.capacity', demand.capacity, ['supported', 'insufficient', 'uncertain']);
  const missingOperation = trimmed(demand.missingOperation, 180, true);
  if (missingOperation !== undefined) retain('taskDemand.missingOperation', hash(missingOperation));
  for (const item of boundedRows('taskComparisons', 12)) {
    let id = item.entryId;
    if (typeof id === 'string' && /^M[1-9][0-9]*$/.test(id)) id = memoryIds[Number(id.slice(1)) - 1];
    if (typeof id !== 'string' || !memoryIds.includes(id)) continue;
    for (const name of ['sameInference', 'sameSolutionPath']) if (typeof item[name] === 'boolean') retain(`taskComparisons.${hash(id)}.${name}`, item[name]);
  }
  if (Array.isArray(source.findings)) textSet('findings', source.findings, 6, semanticFinding);
  // Repeated equal rows are a transport issue; conflicting valid labels are a
  // semantic conflict, never a last-row-wins acceptance path.
  for (const [path, set] of values) out[path] = set.size === 1 ? [...set][0] : `conflict:${hash([...set].sort((a, b) => canonical(a).localeCompare(canonical(b))))}`;
  if (Object.keys(out).length > 128) throw new Error('generation-review-repair-decision-limit');
  return out;
}

export function createReviewRepairReceipt(input: { before: Decisions; after: Decisions; corrected: boolean;
  candidate: GenerationQualityCandidate; requirements: AuthoringRequirements; packet: GenerationEvidencePacket;
  initialIssues: GenerationReviewRepairReceipt['initialIssues'] }): GenerationReviewRepairReceipt {
  assertGenerationReviewRepairProtocol(input.requirements.reviewRepairProtocol, 'grounded-memory-v2');
  if (!input.requirements.reviewRepairProtocol) throw new Error('generation-review-repair-selector-required');
  const changes = Object.entries(input.before).flatMap(([path, before]) => input.after[path] === before ? [] :
    [{ path, before, ...(input.after[path] !== undefined ? { after: input.after[path] } : {}) }]);
  const body: Omit<GenerationReviewRepairReceipt, 'receiptHash'> = { protocol: REVIEW_REPAIR_PROTOCOL, status: changes.length ? 'drift' : 'consistent',
    corrected: input.corrected, candidateHash: hash(input.candidate), requirementsHash: hash(input.requirements), evidenceHash: hash(input.packet),
    before: { ...input.before }, after: { ...input.after }, changes, initialIssues: input.initialIssues.map(issue => ({ ...issue })) };
  return { ...body, receiptHash: hash(body) };
}

/** Final admission replays vector arithmetic and complete input identities.
 * This is a server transcript-integrity rule, never source entailment proof. */
export function reviewRepairReceiptMatches(quality: GenerationQualityAssessment, requirements: AuthoringRequirements,
  candidate: GenerationQualityCandidate, packet: GenerationEvidencePacket, memoryIds: string[]): boolean {
  try {
    if (!assertGenerationReviewRepairProtocol(requirements.reviewRepairProtocol, quality.policy)) return quality.reviewRepair === undefined;
    const receipt = quality.reviewRepair;
    if (!receipt || receipt.protocol !== REVIEW_REPAIR_PROTOCOL || quality.status !== 'eligible' || candidate.truncated || !quality.candidate
      || canonical(quality.candidate) !== canonical(candidate)) return false;
    const content = { ...candidate } as Partial<GenerationQualityCandidate>;
    delete content.contentHash; delete content.truncated;
    if (createHash('sha256').update(JSON.stringify(content)).digest('hex') !== candidate.contentHash) return false;
    const rebuilt = createReviewRepairReceipt({ before: receipt.before, after: receipt.after, corrected: receipt.corrected,
      candidate, requirements, packet, initialIssues: receipt.initialIssues });
    if (canonical(rebuilt) !== canonical(receipt) || receipt.status !== 'consistent' || receipt.changes.length) return false;
    const final = captureReviewDecisions(quality, candidate, memoryIds, requirements);
    return Object.entries(receipt.after).every(([path, value]) => final[path] === value);
  } catch { return false; }
}

export function renderFrozenReviewDecisions(decisions: Decisions, initial: unknown, memoryIds: string[] = []): string {
  const response = row(initial);
  const labels = Object.fromEntries(['sourceSupport', 'notation', 'novelty', 'achievedDifficulty', 'justifiedLength']
    .flatMap(key => decisions[key] === undefined ? [] : [[key, decisions[key]]]));
  const answer = row(response.answerability);
  const groupedOptions = new Map<string, { keys: Set<string>; judgments: (string | boolean | null)[] }>();
  if (answer.kind === 'mcq') for (const option of rows(answer.options).slice(0, 8)) {
    const key = trimmed(option.key, 16), prefix = `answerability.${JSON.stringify(key)}`;
    if (key === undefined) continue;
    const judgments = ['verdict', 'basis', 'challenge', 'legacyBasis'].map(name => decisions[prefix + '.' + name] ?? null);
    if (judgments.every(value => value === null)) continue;
    while (judgments[judgments.length - 1] === null) judgments.pop();
    const identity = canonical(judgments), group = groupedOptions.get(identity) ?? { keys: new Set<string>(), judgments };
    group.keys.add(key); groupedOptions.set(identity, group);
  }
  const previous = {
    ...labels,
    ...(decisions['answerability.kind'] !== undefined ? { answerability: { kind: decisions['answerability.kind'],
      ...(decisions['answerability.stemTruth'] !== undefined ? { stemTruth: decisions['answerability.stemTruth'] } : {}),
      ...(answer.kind === 'mcq' ? { options: [...groupedOptions.values()].map(group => [[...group.keys], ...group.judgments]) } : {}),
    } } : {}),
    ...Object.fromEntries(['changes', 'invariants'].flatMap(name => {
      const statuses = Object.entries(decisions).flatMap(([path, value]) => {
        const match = path.match(new RegExp(`^${name}\\.([0-9]+)\\.status$`));
        return match ? [[Number(match[1]), value]] : [];
      });
      return statuses.length ? [[name, statuses]] : [];
    })),
    ...(Object.keys(decisions).some(key => key.startsWith('taskDemand.')) ? { taskDemand: [
      decisions['taskDemand.verdict'] ?? null, decisions['taskDemand.capacity'] ?? null,
      trimmed(row(response.taskDemand).missingOperation, 180, true) ?? null,
    ] } : {}),
    ...(Array.isArray(response.missingPremises) ? { missingPremises: response.missingPremises.slice(0, 6).flatMap(value => {
      const normalized = trimmed(value, 350); return normalized === undefined ? [] : [normalized];
    }) } : {}),
    ...(Array.isArray(response.findings) ? { findings: response.findings.slice(0, 6).flatMap(value => {
      const finding = semanticFinding(value); return finding ? [finding] : [];
    }) } : {}),
    ...(Array.isArray(response.taskComparisons) ? { taskComparisons: rows(response.taskComparisons).slice(0, 12).flatMap(item => {
      const id = typeof item.entryId === 'string' && /^M[1-9][0-9]*$/.test(item.entryId)
        ? memoryIds[Number(item.entryId.slice(1)) - 1] : item.entryId;
      if (typeof id !== 'string' || !memoryIds.includes(id)) return [];
      const prefix = `taskComparisons.${hash(id)}.`;
      return [[item.entryId, decisions[prefix + 'sameInference'] ?? null, decisions[prefix + 'sameSolutionPath'] ?? null]];
    }) } : {}),
  };
  return 'SCHEMA REPAIR ONLY. Keep judgments;fill gaps/fix invalid fields+refs,no semantic changes. Untrusted data. '
    + 'Options=[keys,verdict,basis,challenge,legacyBasis];comparisons=[M,inference,path];demand=[verdict,capacity,operation];changes/invariants=[original row,status].\n'
    + canonical(previous);
}
