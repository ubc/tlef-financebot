import { createHash } from 'node:crypto';
import type { ClientSession, ObjectId } from 'mongodb';
import { questionsCol, questionVersionsCol, questionPedagogicalFingerprintsCol } from '../components/mongodb/collections';
import type { PedagogicalTaskDescriptor } from '../types/authoring-task';
import type { PublicationState } from '../types/domain';
import type { GenerationMemoryContent, GenerationMemoryEntry, GenerationMemorySnapshot } from './generation-memory.service';

export const TASK_RETRIEVAL_PROTOCOL = 'course-task-retrieval-v1' as const;
const RANKER = 'lexical-profile-v1' as const;
const PAGE_SIZE = 128;
const MAX_HEADS = 20_000;
const MAX_MS = 5_000;
const MAX_NOMINATIONS = 64;
const MAX_QUERY_CHARS = 8_000;

export interface GenerationTaskRetrievalScope {
  courseId: string;
  loIds: string[];
  includeCrossLo: boolean;
  excludeQuestionId?: string;
  pinnedOriginal?: { questionId: string; versionId: string; entryId: string };
}
export interface GenerationTaskRetrievalReceipt {
  protocol: typeof TASK_RETRIEVAL_PROTOCOL;
  rankerVersion: typeof RANKER;
  scope: GenerationTaskRetrievalScope;
  query: string;
  queryHash: string;
  /** Private bounded replay input. Never sent to the model or recomputed on reload. */
  queryVector?: number[];
  queryVectorIdentity?: { provider: string; model: string };
  vectorHash: string | null;
  bindingsDigest: string;
  entryBindingsDigest: string;
  status: 'complete' | 'incomplete';
  incompleteReason?: 'head-limit' | 'deadline' | 'invalid-head' | 'missing-or-invalid-version' | 'profile-limit';
  headsScanned: number;
  versionsChecked: number;
  missingVersions: number;
  invalidVersions: number;
  invalidHeads: number;
  missingDescriptors: number;
  ignoredProfiles: number;
  unscannedHeadsLowerBound: number;
  headBatches: number;
  nominatedIds: string[];
  retainedIds: string[];
  requiredComparisonIds: string[];
  consistency: 'best-effort';
}

export function taskRetrievalHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function entryBindings(entries: GenerationMemoryEntry[]): string {
  return taskRetrievalHash(entries.filter(entry => entry.source === 'bank').map(entry => ({ id: entry.id, source: entry.source,
    questionId: entry.questionId, versionId: entry.versionId, familyId: entry.familyId, state: entry.state, content: entry.content,
    fingerprint: entry.fingerprint, taskDescriptor: entry.taskDescriptor ?? null, embedding: entry.embedding ?? null, comparisonRole: entry.comparisonRole ?? null })));
}
export function assertTaskRetrievalQuery(query: unknown): asserts query is string {
  if (typeof query !== 'string' || !query.trim() || query.length > MAX_QUERY_CHARS) throw new Error('generation-task-retrieval-query-invalid');
}
function validVector(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 8192 && value.every(number => typeof number === 'number' && Number.isFinite(number) && Math.abs(number) <= 1_000_000);
}
function validVectorIdentity(value: unknown): value is { provider: string; model: string } {
  const row = value as { provider?: unknown; model?: unknown } | undefined;
  return !!row && [row.provider, row.model].every(item => typeof item === 'string' && item.trim().length > 0 && item.length <= 200);
}
function descriptor(value: unknown): PedagogicalTaskDescriptor | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as PedagogicalTaskDescriptor;
  const keys = ['concepts', 'requiredInference', 'solutionPath', 'misconception', 'targetDifficulty', 'achievedDifficulty', 'passageIds', 'intent'];
  const strings = (values: unknown, max: number, chars: number, trim = true): values is string[] => Array.isArray(values) && values.length >= 1 && values.length <= max
    && values.every(item => typeof item === 'string' && (trim ? item.trim() : item).length >= 1 && (trim ? item.trim() : item).length <= chars);
  // Match taskDescriptorSchema without importing its provider-owning service.
  if (Object.keys(row).some(key => !keys.includes(key)) || !strings(row.concepts, 8, 160)
    || typeof row.requiredInference !== 'string' || !row.requiredInference.trim() || row.requiredInference.trim().length > 700
    || !strings(row.solutionPath, 8, 350) || typeof row.misconception !== 'string' || !row.misconception.trim() || row.misconception.trim().length > 350
    || !strings(row.passageIds, 16, 160, false) || !['easy', 'medium', 'hard'].includes(row.targetDifficulty)
    || (row.achievedDifficulty !== undefined && !['easy', 'medium', 'hard'].includes(row.achievedDifficulty))
    || !['create-independent-task', 'create-variant', 'edit-existing'].includes(row.intent)) return undefined;
  return { concepts: row.concepts.map(item => item.trim()), requiredInference: row.requiredInference.trim(), solutionPath: row.solutionPath.map(item => item.trim()), misconception: row.misconception.trim(),
    targetDifficulty: row.targetDifficulty, ...(row.achievedDifficulty ? { achievedDifficulty: row.achievedDifficulty } : {}), passageIds: [...row.passageIds], intent: row.intent };
}
function tokens(value: string): Set<string> { return new Set(value.toLocaleLowerCase('en').match(/[\p{L}\p{N}_]{3,}/gu) ?? []); }
function score(entry: GenerationMemoryEntry, query: Set<string>, vector?: number[]): number {
  const words = tokens(`${JSON.stringify(entry.taskDescriptor ?? {})} ${entry.content.stem} ${entry.content.options.filter(option => option.role === 'correct').map(option => `${option.text} ${option.explanation}`).join(' ')}`);
  const lexical = [...query].filter(word => words.has(word)).length / Math.max(1, query.size);
  if (!vector || !entry.embedding || vector.length !== entry.embedding.length) return lexical;
  const dot = vector.reduce((sum, number, index) => sum + number * entry.embedding![index], 0);
  const norm = Math.sqrt(vector.reduce((sum, number) => sum + number * number, 0) * entry.embedding.reduce((sum, number) => sum + number * number, 0));
  return lexical + (norm ? dot / norm : 0);
}

/** Current-version local nomination only; scores and profiles never establish
 * source support or task duplication. No embedding/model/write is performed. */
export async function retrieveCurrentBankTasks(input: {
  protocol: typeof TASK_RETRIEVAL_PROTOCOL;
  courseId: ObjectId;
  base: GenerationMemorySnapshot;
  scope: GenerationTaskRetrievalScope;
  query: string;
  queryVector?: number[];
  queryVectorIdentity?: { provider: string; model: string };
  session?: ClientSession;
  fingerprint: (content: GenerationMemoryContent) => GenerationMemoryEntry['fingerprint'] | undefined;
  limits?: { maxHeads?: number; maxMs?: number };
}): Promise<{ entries: GenerationMemoryEntry[]; receipt: GenerationTaskRetrievalReceipt }> {
  if (input.protocol !== TASK_RETRIEVAL_PROTOCOL) throw new Error('generation-task-retrieval-policy-invalid');
  assertTaskRetrievalQuery(input.query);
  if (input.queryVector !== undefined && (!validVector(input.queryVector) || !validVectorIdentity(input.queryVectorIdentity))) throw new Error('generation-task-retrieval-vector-invalid');
  const ceiling = (value: number | undefined, max: number) => value === undefined ? max : Number.isSafeInteger(value) && value > 0 ? Math.min(value, max) : 0;
  const maxHeads = ceiling(input.limits?.maxHeads, MAX_HEADS); const maxMs = ceiling(input.limits?.maxMs, MAX_MS);
  if (!maxHeads || !maxMs) throw new Error('generation-task-retrieval-limits-invalid');
  const vector = input.queryVector ? [...input.queryVector] : undefined;
  const receipt: GenerationTaskRetrievalReceipt = { protocol: input.protocol, rankerVersion: RANKER, scope: input.scope, query: input.query,
    queryHash: taskRetrievalHash(input.query), ...(vector ? { queryVector: vector, queryVectorIdentity: { ...input.queryVectorIdentity! } } : {}),
    vectorHash: vector ? taskRetrievalHash({ vector, identity: input.queryVectorIdentity }) : null,
    bindingsDigest: '', entryBindingsDigest: '', status: 'complete', headsScanned: 0, versionsChecked: 0, missingVersions: 0, invalidVersions: 0, invalidHeads: 0,
    missingDescriptors: 0, ignoredProfiles: 0, unscannedHeadsLowerBound: 0, headBatches: 0, nominatedIds: [], retainedIds: [], requiredComparisonIds: [], consistency: 'best-effort' };
  const hash = createHash('sha256'); hash.update(JSON.stringify({ protocol: input.protocol, ranker: RANKER, scope: input.scope }) + '\n');
  const stop = (reason: NonNullable<GenerationTaskRetrievalReceipt['incompleteReason']>) => { receipt.status = 'incomplete'; receipt.incompleteReason = reason; };
  const deadline = Date.now() + maxMs;
  const options = () => ({ ...(input.session ? { session: input.session } : {}), maxTimeMS: Math.max(1, deadline - Date.now()) });
  const states: PublicationState[] = ['draft', 'pending-review', 'reviewed', 'approved', 'paused'];
  const queryTokens = tokens(input.query); const nominations: Array<{ entry: GenerationMemoryEntry; score: number }> = [];
  const baseIds = new Set(input.base.entries.filter(entry => entry.source === 'bank').map(entry => entry.id));
  const currentFillers = new Map<string, GenerationMemoryEntry>();
  let after: ObjectId | undefined;
  try {
    while (true) {
      if (Date.now() >= deadline) { stop('deadline'); break; }
      const remaining = maxHeads - receipt.headsScanned; const count = Math.min(PAGE_SIZE, remaining + 1);
      const page = await questionsCol().find({ courseId: input.courseId, state: { $in: states }, ...(after ? { _id: { $gt: after } } : {}) },
        { ...options(), projection: { _id: 1, courseId: 1, currentVersionId: 1, templateFamilyId: 1, state: 1 } }).sort({ _id: 1 }).limit(count).toArray();
      receipt.headBatches += 1;
      if (Date.now() >= deadline) { receipt.unscannedHeadsLowerBound = page.length; stop('deadline'); break; }
      if (!page.length) break;
      const heads = page.slice(0, remaining); let last = after?.toHexString();
      for (const head of heads) {
        const id = head._id?.toHexString?.();
        if (!id || !/^[a-f0-9]{24}$/.test(id) || (last !== undefined && id <= last) || !head.courseId?.equals?.(input.courseId)
          || !/^[a-f0-9]{24}$/.test(head.currentVersionId?.toHexString?.() ?? '') || !states.includes(head.state)) receipt.invalidHeads += 1;
        last = id;
      }
      if (receipt.invalidHeads) { receipt.unscannedHeadsLowerBound = page.length; stop('invalid-head'); break; }
      if (!heads.length) { receipt.unscannedHeadsLowerBound = page.length; stop('head-limit'); break; }
      if (Date.now() >= deadline) { receipt.unscannedHeadsLowerBound = page.length; stop('deadline'); break; }
      const versions = await questionVersionsCol().find({ _id: { $in: heads.map(head => head.currentVersionId) } }, { ...options(), projection: {
        _id: 1, questionId: 1, type: 1, stem: 1, options: 1, numericKind: 1, paramSlots: 1, derivedValues: 1, taskDescriptor: 1,
      } }).toArray();
      if (Date.now() >= deadline) { receipt.unscannedHeadsLowerBound = page.length; stop('deadline'); break; }
      const profiles = await questionPedagogicalFingerprintsCol().find({ courseId: input.courseId, versionId: { $in: heads.map(head => head.currentVersionId) }, policy: 'pedagogical-task-v2' }, options()).limit(PAGE_SIZE + 1).toArray();
      if (profiles.length > PAGE_SIZE) { stop('profile-limit'); break; }
      const scannedBefore = receipt.headsScanned;
      for (const head of heads) {
        if (Date.now() >= deadline) { stop('deadline'); break; }
        receipt.headsScanned += 1;
        const matches = versions.filter(version => version._id?.equals?.(head.currentVersionId)); const version = matches[0];
        let fingerprint: GenerationMemoryEntry['fingerprint'] | undefined;
        if (matches.length === 1 && version.questionId?.equals?.(head._id)) {
          try { fingerprint = input.fingerprint(version); } catch { /* Corrupt current content remains explicitly unavailable. */ }
        }
        if (!matches.length) receipt.missingVersions += 1;
        else if (!fingerprint) receipt.invalidVersions += 1;
        if (!fingerprint) { hash.update(JSON.stringify({ id: head._id.toHexString(), versionId: head.currentVersionId.toHexString(), state: head.state, unavailable: true }) + '\n'); continue; }
        receipt.versionsChecked += 1;
        const bound = profiles.filter(profile => profile.questionId?.equals?.(head._id) && profile.versionId?.equals?.(version._id)
          && profile.courseId?.equals?.(input.courseId) && profile.policy === 'pedagogical-task-v2' && profile.contentHash === fingerprint!.exact);
        const profile = bound.length === 1 && descriptor(bound[0].descriptor) ? bound[0] : undefined;
        const task = descriptor(version.taskDescriptor) ?? descriptor(profile?.descriptor);
        const profileProvider = (profile as unknown as { embeddingProvider?: string } | undefined)?.embeddingProvider;
        const embedding = vector && profile && profileProvider === input.queryVectorIdentity!.provider
          && profile.embeddingModel === input.queryVectorIdentity!.model && validVector(profile.embedding) ? [...profile.embedding] : undefined;
        receipt.ignoredProfiles += profiles.filter(profile => profile.versionId?.equals?.(version._id)).length - (profile ? 1 : 0);
        if (!task) receipt.missingDescriptors += 1;
        const content: GenerationMemoryContent = { type: version.type, stem: version.stem, options: version.options,
          ...(version.numericKind ? { numericKind: version.numericKind } : {}), ...(version.paramSlots ? { paramSlots: version.paramSlots } : {}),
          ...(version.derivedValues ? { derivedValues: version.derivedValues } : {}) };
        const entry: GenerationMemoryEntry = { id: `q:${head._id.toHexString()}:${version._id.toHexString()}`, source: 'bank', questionId: head._id.toHexString(), versionId: version._id.toHexString(),
          familyId: (head.templateFamilyId ?? head._id).toHexString(), state: head.state, content, fingerprint,
          ...(task ? { taskDescriptor: task } : {}), ...(embedding ? { embedding } : {}) };
        if (baseIds.has(entry.id)) currentFillers.set(entry.id, { ...entry,
          ...(entry.id === input.base.pinnedOriginal?.entryId ? { comparisonRole: 'pinned-original' as const } : {}) });
        hash.update(JSON.stringify({ id: entry.questionId, versionId: entry.versionId, state: head.state, contentHash: fingerprint.exact,
          effectiveProfileHash: taskRetrievalHash({ descriptor: task ?? null, embedding: embedding ?? null,
            embeddingIdentity: embedding ? input.queryVectorIdentity : null }) }) + '\n');
        if (entry.questionId === input.scope.excludeQuestionId || entry.id === input.base.pinnedOriginal?.entryId) continue;
        const relevance = score(entry, queryTokens, vector);
        if (relevance > 0) { nominations.push({ entry, score: relevance }); nominations.sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id)); nominations.length = Math.min(MAX_NOMINATIONS, nominations.length); }
      }
      if (receipt.status === 'incomplete') { receipt.unscannedHeadsLowerBound = page.length - (receipt.headsScanned - scannedBefore); break; }
      after = heads.at(-1)!._id;
      if (page.length > heads.length) { receipt.unscannedHeadsLowerBound = page.length - heads.length; stop('head-limit'); break; }
      if (page.length < count) break;
    }
  } catch (error) {
    if ((error as { code?: number })?.code === 50 || (error as { codeName?: string })?.codeName === 'MaxTimeMSExpired') stop('deadline'); else throw error;
  }
  if (receipt.status === 'complete' && (receipt.missingVersions || receipt.invalidVersions)) stop('missing-or-invalid-version');
  receipt.bindingsDigest = hash.digest('hex'); receipt.nominatedIds = nominations.map(row => row.entry.id);
  const pin = input.base.pinnedOriginal; const original = pin ? currentFillers.get(pin.entryId) : undefined;
  if (pin && !original) throw new Error(receipt.status === 'complete' ? 'generation-memory-original-changed' : 'generation-task-retrieval-incomplete');
  const required = [...(original ? [original.id] : []), ...receipt.nominatedIds.slice(0, original ? 1 : 2)];
  const entries = new Map<string, GenerationMemoryEntry>();
  if (original) entries.set(original.id, original);
  for (const { entry } of nominations) entries.set(entry.id, { ...entry, ...(required.includes(entry.id) ? { comparisonRole: 'retrieved-task' as const } : {}) });
  for (const previous of input.base.entries) {
    const entry = currentFillers.get(previous.id);
    if (entry && !entries.has(entry.id) && entries.size < 200) entries.set(entry.id, entry);
  }
  receipt.retainedIds = [...entries.values()].filter(entry => entry.source === 'bank').map(entry => entry.id);
  receipt.requiredComparisonIds = required;
  receipt.entryBindingsDigest = entryBindings([...entries.values()]);
  return { entries: [...entries.values()], receipt };
}

/** Receipt shape/bindings only. Callers must replay the scan for currentness. */
export function assertTaskRetrievalReady(memory: GenerationMemorySnapshot, protocol?: typeof TASK_RETRIEVAL_PROTOCOL): void {
  const receipt = memory.taskRetrieval;
  if (protocol === undefined && !receipt) return;
  if ((protocol !== undefined && protocol !== TASK_RETRIEVAL_PROTOCOL) || (receipt && receipt.protocol !== TASK_RETRIEVAL_PROTOCOL)) throw new Error('generation-task-retrieval-policy-invalid');
  if (!receipt || receipt.rankerVersion !== RANKER) throw new Error('generation-task-retrieval-receipt-invalid');
  assertTaskRetrievalQuery(receipt.query);
  const ids = (value: unknown, max: number): value is string[] => Array.isArray(value) && value.length <= max && value.every(id => typeof id === 'string') && new Set(value).size === value.length;
  if (!receipt.scope || !/^[a-f0-9]{24}$/.test(receipt.scope.courseId) || !ids(receipt.scope.loIds, 256) || !receipt.scope.loIds.length
    || receipt.scope.loIds.some(id => !/^[a-f0-9]{24}$/.test(id)) || typeof receipt.scope.includeCrossLo !== 'boolean'
    || (receipt.scope.excludeQuestionId !== undefined && !/^[a-f0-9]{24}$/.test(receipt.scope.excludeQuestionId))
    || taskRetrievalHash(receipt.scope.pinnedOriginal ?? null) !== taskRetrievalHash(memory.pinnedOriginal ?? null)
    || !ids(receipt.nominatedIds, MAX_NOMINATIONS) || !ids(receipt.retainedIds, 200) || !ids(receipt.requiredComparisonIds, 2)
    || [receipt.headsScanned, receipt.versionsChecked, receipt.missingVersions, receipt.invalidVersions, receipt.invalidHeads,
      receipt.missingDescriptors, receipt.ignoredProfiles, receipt.unscannedHeadsLowerBound, receipt.headBatches].some(value => !Number.isSafeInteger(value) || value < 0)
    || receipt.headsScanned > MAX_HEADS || receipt.versionsChecked + receipt.missingVersions + receipt.invalidVersions !== receipt.headsScanned) throw new Error('generation-task-retrieval-receipt-invalid');
  const bankIds = memory.entries.filter(entry => entry.source === 'bank').map(entry => entry.id);
  const required = [...(memory.pinnedOriginal ? [memory.pinnedOriginal.entryId] : []),
    ...receipt.nominatedIds.filter(id => id !== memory.pinnedOriginal?.entryId).slice(0, memory.pinnedOriginal ? 1 : 2)];
  if (receipt.queryHash !== taskRetrievalHash(receipt.query) || receipt.vectorHash !== (receipt.queryVector ? taskRetrievalHash({ vector: receipt.queryVector, identity: receipt.queryVectorIdentity }) : null)
    || taskRetrievalHash(memory.queryEmbedding ?? null) !== taskRetrievalHash(receipt.queryVector ?? null)
    || (receipt.queryVector !== undefined && (!validVector(receipt.queryVector) || !validVectorIdentity(receipt.queryVectorIdentity)))
    || (receipt.queryVector === undefined && receipt.queryVectorIdentity !== undefined) || !/^[a-f0-9]{64}$/.test(receipt.bindingsDigest)
    || receipt.entryBindingsDigest !== entryBindings(memory.entries)
    || receipt.nominatedIds.length > MAX_NOMINATIONS || receipt.retainedIds.length > 200 || receipt.requiredComparisonIds.length > 2
    || taskRetrievalHash(receipt.retainedIds) !== taskRetrievalHash(bankIds)
    || taskRetrievalHash(receipt.requiredComparisonIds) !== taskRetrievalHash(required) || receipt.nominatedIds.some(id => !bankIds.includes(id))
    || new Set(receipt.requiredComparisonIds).size !== receipt.requiredComparisonIds.length
    || receipt.requiredComparisonIds.some(id => !bankIds.includes(id) || (id !== memory.pinnedOriginal?.entryId && !receipt.nominatedIds.includes(id)))
    || receipt.requiredComparisonIds.some(id => memory.entries.find(entry => entry.id === id)?.comparisonRole !== (id === memory.pinnedOriginal?.entryId ? 'pinned-original' : 'retrieved-task'))
    || memory.entries.some(entry => entry.comparisonRole === 'retrieved-task' && !receipt.requiredComparisonIds.includes(entry.id))) throw new Error('generation-task-retrieval-receipt-invalid');
  if (receipt.status !== 'complete' || receipt.missingVersions || receipt.invalidVersions || receipt.invalidHeads || receipt.unscannedHeadsLowerBound
    || receipt.versionsChecked !== receipt.headsScanned) throw new Error('generation-task-retrieval-incomplete');
}
