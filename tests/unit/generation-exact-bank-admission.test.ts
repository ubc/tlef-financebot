jest.mock('../../server/src/components/genai/llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../server/src/components/genai/embeddings', () => ({ embedOne: jest.fn() }));
jest.mock('../../server/src/components/mongodb', () => ({ getDb: jest.fn(), getMongoClient: jest.fn() }));
jest.mock('../../server/src/components/mongodb/collections', () => ({
  questionsCol: jest.fn(), questionVersionsCol: jest.fn(), questionPedagogicalFingerprintsCol: jest.fn(),
}));

import { ObjectId, type ClientSession } from 'mongodb';
import { completeJson } from '../../server/src/components/genai/llm';
import { embedOne } from '../../server/src/components/genai/embeddings';
import { getDb, getMongoClient } from '../../server/src/components/mongodb';
import { questionsCol, questionVersionsCol, questionPedagogicalFingerprintsCol } from '../../server/src/components/mongodb/collections';
import { initializeAuthoringCommitSupport, withCourseAuthoringWrite } from '../../server/src/services/authoring-commit.service';
import { assertGenerationExactBankCurrent } from '../../server/src/services/generation-exact-bank';
import { assessGenerationQuality, snapshotQualityCandidate } from '../../server/src/services/generation-quality.service';
import {
  checkGenerationMemory, GENERATION_EXACT_BANK_PROTOCOL, GENERATION_MEMORY_MAX_HEADS,
  loadGenerationMemory, lookupGenerationExactBank,
} from '../../server/src/services/generation-memory.service';
import type { GenerationMemoryContent, GenerationMemorySnapshot, GenerationExactBankReceipt } from '../../server/src/services/generation-memory.service';
import type { GenerationEvidencePacket } from '../../server/src/services/generation-evidence.service';
import type { AuthoringRequirements, GenerationQualityAssessment } from '../../server/src/types/generation-quality';
import type { PublicationState } from '../../server/src/types/domain';

// Synthetic storage and scripted judgments exercise production admission logic.
// They establish neither Mongo snapshot isolation nor semantic model quality.
const courseId = new ObjectId('000000000000000000000001');
const foreignCourseId = new ObjectId('000000000000000000000002');
const loId = new ObjectId('000000000000000000000003');
const materialId = new ObjectId('000000000000000000000004');
const source = 'CAPM uses beta for systematic risk. Total volatility includes diversifiable risk.';
const oid = (number: number) => new ObjectId(number.toString(16).padStart(24, '0'));

function candidate(stem = 'Which input measures systematic risk in CAPM?'): GenerationMemoryContent {
  return { type: 'mcq', numericKind: 'conceptual', stem, options: [
    { key: 'A', text: 'Beta', role: 'correct', explanation: 'CAPM uses beta for systematic risk.' },
    { key: 'B', text: 'Total volatility', role: 'common-misconception', explanation: 'Total volatility includes diversifiable risk.' },
  ] };
}

type Head = { _id: ObjectId; courseId: ObjectId; currentVersionId: ObjectId; state: PublicationState; loIds: ObjectId[]; updatedAt: number };
type Version = GenerationMemoryContent & { _id: ObjectId; questionId: ObjectId };
function row(index: number, content = candidate(`Distinct bond cash-flow task ${index}.`), state: PublicationState = 'approved') {
  const head: Head = { _id: oid(1000 + index), courseId, currentVersionId: oid(10_000 + index), state, loIds: [loId], updatedAt: index };
  const version: Version = { _id: head.currentVersionId, questionId: head._id, ...content };
  return { head, version };
}

type HeadQuery = { courseId: ObjectId; state: { $in: PublicationState[] }; _id?: { $gt?: ObjectId; $ne?: ObjectId }; loIds?: { $in?: ObjectId[]; $nin?: ObjectId[] } };
type ReadOptions = { session?: ClientSession; projection?: Record<string, number>; maxTimeMS?: number };
function cursor<T extends { _id: ObjectId }>(rows: T[]) {
  let selected = [...rows];
  interface Reader {
    sort(order: { _id?: number; updatedAt?: number }): Reader;
    limit(limit: number): Reader;
    toArray(): Promise<T[]>;
  }
  const reader: Reader = {
    sort: jest.fn((order: { _id?: number; updatedAt?: number }) => {
      selected.sort((left, right) => {
        if (order.updatedAt) {
          const difference = (Number((left as T & { updatedAt: number }).updatedAt) - Number((right as T & { updatedAt: number }).updatedAt)) * order.updatedAt;
          if (difference) return difference;
        }
        return left._id.toHexString().localeCompare(right._id.toHexString()) * (order._id ?? 1);
      });
      return reader;
    }),
    limit: jest.fn((limit: number) => { selected = selected.slice(0, limit); return reader; }),
    toArray: jest.fn(async () => selected),
  };
  return reader;
}

function database(rows: ReturnType<typeof row>[] = []) {
  const heads = rows.map(item => item.head);
  const versions = rows.map(item => item.version);
  const findHeads = jest.fn((query: HeadQuery, _options?: ReadOptions) => cursor(heads.filter(head => head.courseId.equals(query.courseId)
    && query.state.$in.includes(head.state)
    && (!query._id?.$ne || !head._id.equals(query._id.$ne))
    && (!query._id?.$gt || head._id.toHexString() > query._id.$gt.toHexString())
    && (!query.loIds?.$in || head.loIds.some(id => query.loIds!.$in!.some(wanted => wanted.equals(id))))
    && (!query.loIds?.$nin || !head.loIds.some(id => query.loIds!.$nin!.some(wanted => wanted.equals(id)))))));
  const findVersions = jest.fn((query: { _id: { $in: ObjectId[] } }, _options?: ReadOptions) => cursor(versions.filter(version => query._id.$in.some(id => id.equals(version._id)))));
  jest.mocked(questionsCol).mockReturnValue({ find: findHeads } as never);
  jest.mocked(questionVersionsCol).mockReturnValue({ find: findVersions } as never);
  return { heads, versions, findHeads, findVersions };
}

function packet(): GenerationEvidencePacket {
  return { id: 'synthetic-source-receipt', schemaVersion: 'source-passages-v1', policyVersion: 'grounded-memory-v1',
    courseId: courseId.toHexString(), loIds: [loId.toHexString()], sourceFingerprint: 'synthetic-source-hash', parsingProvenance: 'unrecorded',
    materials: [{ materialId: materialId.toHexString(), name: 'Synthetic CAPM notes', contentHash: 'synthetic-material-hash', revision: 1,
      activeRunId: null, chunkCount: 1, role: 'primary', loId: loId.toHexString() }],
    passages: [{ id: 'E1', materialId: materialId.toHexString(), materialName: 'Synthetic CAPM notes', chunkIndex: 0,
      start: 0, end: source.length, text: source, role: 'primary', loId: loId.toHexString(), selection: 'retrieved' }],
    coverage: { sourceChunks: 1, selectedChunks: 1, selectedCharacters: source.length, omittedPassages: 0,
      truncated: false, searchScope: 'retrieved-chunks-and-immediate-neighbors' }, findings: [] };
}

function memory(): GenerationMemorySnapshot {
  return { entries: [], truncated: false, missingVersions: 0, snapshotDigest: 'synthetic-empty-memory', consistency: 'best-effort' };
}
function requirements(intent: AuthoringRequirements['intent'] = 'create-independent-task'): AuthoringRequirements {
  return { intent, requiredChanges: [], preserve: [], exactBankProtocol: GENERATION_EXACT_BANK_PROTOCOL };
}
function review(novelty: 'independent' | 'variant' = 'independent') {
  return { sourceSupport: 'supported', notation: 'consistent', novelty, reasons: ['Scripted source assessment for admission mechanics only.'],
    citations: [
      { kind: 'premise', claim: 'CAPM uses beta.', passageId: 'E1', quote: 'CAPM uses beta for systematic risk.' },
      { kind: 'solution', claim: 'Total volatility differs.', passageId: 'E1', quote: 'Total volatility includes diversifiable risk.' },
    ], matchedEntryIds: [], changes: [], invariants: [], achievedDifficulty: 'easy', justifiedLength: 'justified' };
}
function assessmentInput() {
  const complete = jest.fn(async () => review());
  return { packet: packet(), memory: memory(), candidate: candidate(), item: 0, step: { model: 'never-dispatched-fixture' },
    policy: 'grounded-memory-v2' as const, requirements: requirements(), complete: complete as typeof completeJson };
}
async function reviewed() {
  const input = assessmentInput();
  const assessment = await assessGenerationQuality(input);
  expect(assessment.status).toBe('eligible');
  expect(assessment.exactBank?.status).toBe('complete');
  return { input, assessment };
}
function assertCurrent(input: ReturnType<typeof assessmentInput>, assessment: GenerationQualityAssessment, session?: ClientSession) {
  return assertGenerationExactBankCurrent({ courseId, candidate: input.candidate, requirements: input.requirements, assessment, session });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(completeJson).mockImplementation(async () => { throw new Error('A configured provider must never be reached.'); });
  jest.mocked(embedOne).mockImplementation(async () => { throw new Error('Embedding is outside this exact-admission fixture.'); });
  jest.mocked(questionPedagogicalFingerprintsCol).mockImplementation(() => { throw new Error('Prepared fingerprints must not authorize an exact Bank scan.'); });
  database();
});
afterEach(() => {
  expect(completeJson).not.toHaveBeenCalled();
  expect(embedOne).not.toHaveBeenCalled();
  expect(questionPedagogicalFingerprintsCol).not.toHaveBeenCalled();
});

describe('exact Bank admission with actual lookup and synthetic in-memory collections', () => {
  it('records a complete zero-match receipt before a scripted review and rechecks the unchanged empty Bank', async () => {
    const db = database();
    const { input, assessment } = await reviewed();
    expect(assessment.exactBank).toMatchObject({ protocol: GENERATION_EXACT_BANK_PROTOCOL, courseId: courseId.toHexString(),
      status: 'complete', headsScanned: 0, versionsChecked: 0, exactMatchCount: 0, matches: [] });
    expect(input.complete).toHaveBeenCalledTimes(1);
    await expect(assertCurrent(input, assessment)).resolves.toBeUndefined();
    expect(db.findHeads).toHaveBeenCalledTimes(2);
    expect(db.findVersions).not.toHaveBeenCalled();
  });

  it('withholds an exact old question outside the actual 200-head semantic memory without either completion boundary', async () => {
    const old = row(0, candidate());
    const db = database([old, ...Array.from({ length: GENERATION_MEMORY_MAX_HEADS + 2 }, (_, index) => row(index + 1))]);
    const semantic = await loadGenerationMemory({ courseId, loIds: [loId] });
    expect(semantic.entries).toHaveLength(GENERATION_MEMORY_MAX_HEADS);
    expect(semantic.truncated).toBe(true);
    expect(semantic.entries.some(entry => entry.questionId === old.head._id.toHexString())).toBe(false);
    expect(checkGenerationMemory(candidate(), semantic)).toEqual([]);
    db.findHeads.mockClear();
    const input = { ...assessmentInput(), memory: semantic };
    const result = await assessGenerationQuality(input);
    expect(result).toMatchObject({ status: 'withheld', novelty: 'duplicate', sourceSupport: 'uncertain', notation: 'uncertain',
      exactBank: { status: 'complete', headsScanned: 203, versionsChecked: 203, exactMatchCount: 1,
        matches: [{ questionId: old.head._id.toHexString(), versionId: old.version._id.toHexString() }] } });
    expect(result.matchedEntryIds).toEqual([`q:${old.head._id.toHexString()}:${old.version._id.toHexString()}`]);
    expect(result.reasons.join(' ')).toContain('outside the semantic prompt window');
    expect(db.findHeads).toHaveBeenCalledTimes(2);
    expect(input.complete).not.toHaveBeenCalled();
  });

  it.each(['missing', 'wrong-owner', 'malformed-content', 'duplicate-version'] as const)('withholds a %s current version before any scripted or configured provider call', async fault => {
    const db = database([row(1)]);
    if (fault === 'missing') db.versions.length = 0;
    if (fault === 'wrong-owner') db.versions[0].questionId = oid(999);
    if (fault === 'malformed-content') db.versions[0].options[0].explanation = undefined as never;
    if (fault === 'duplicate-version') db.versions.push({ ...db.versions[0] });
    const input = assessmentInput();
    const result = await assessGenerationQuality(input);
    expect(result).toMatchObject({ status: 'withheld', sourceSupport: 'uncertain', novelty: 'uncertain', exactBank: {
      status: 'incomplete', incompleteReason: 'missing-or-invalid-version', headsScanned: 1,
      missingVersions: fault === 'missing' ? 1 : 0, invalidVersions: fault === 'missing' ? 0 : 1,
    } });
    expect(result.reasons.join(' ')).toContain('no quality model call was sent');
    expect(input.complete).not.toHaveBeenCalled();
  });

  it('does not let foreign, archived, or obsolete exact versions contaminate a current course receipt', async () => {
    const foreign = row(1, candidate()); foreign.head.courseId = foreignCourseId;
    const archived = row(2, candidate(), 'archived');
    const active = row(3);
    const db = database([foreign, archived, active]);
    db.versions.push({ ...active.version, _id: oid(77_777), ...candidate() });
    const { input, assessment } = await reviewed();
    expect(assessment.exactBank).toMatchObject({ headsScanned: 1, versionsChecked: 1, exactMatchCount: 0 });
    await expect(assertCurrent(input, assessment)).resolves.toBeUndefined();
  });

  it.each(['edit-content', 'replace-current-version', 'change-state', 'insert-nonmatch'] as const)('refuses an otherwise unique candidate after %s changes an all-head binding', async change => {
    const db = database([row(1)]);
    const { input, assessment } = await reviewed();
    if (change === 'edit-content') db.versions[0].stem = 'An intervening edit to an unrelated current question.';
    if (change === 'replace-current-version') {
      db.heads[0].currentVersionId = oid(80_000);
      db.versions.push({ ...db.versions[0], _id: db.heads[0].currentVersionId });
    }
    if (change === 'change-state') db.heads[0].state = 'paused';
    if (change === 'insert-nonmatch') {
      const added = row(2); db.heads.push(added.head); db.versions.push(added.version);
    }
    const fresh = await lookupGenerationExactBank({ protocol: GENERATION_EXACT_BANK_PROTOCOL, courseId, candidate: input.candidate });
    expect(fresh).toMatchObject({ status: 'complete', exactMatchCount: 0 });
    expect(fresh!.bindingsDigest).not.toBe(assessment.exactBank!.bindingsDigest);
    await expect(assertCurrent(input, assessment)).rejects.toThrow('authoring-memory-changed');
  });

  it('refuses a new exact current head inserted after review, even when semantic memory stays unchanged', async () => {
    const db = database([row(1)]);
    const { input, assessment } = await reviewed();
    const sameSemanticDigest = input.memory.snapshotDigest;
    const added = row(2, candidate()); db.heads.push(added.head); db.versions.push(added.version);
    await expect(assertCurrent(input, assessment)).rejects.toThrow('authoring-exact-bank-duplicate');
    expect(input.memory.snapshotDigest).toBe(sameSemanticDigest);
    expect(input.complete).toHaveBeenCalledTimes(1);
  });

  it.each(['missing', 'corrupt'] as const)('refuses a freshly %s version instead of trusting a formerly complete receipt', async fault => {
    const db = database([row(1)]);
    const { input, assessment } = await reviewed();
    if (fault === 'missing') db.versions.length = 0;
    else db.versions[0].questionId = oid(99_999);
    await expect(assertCurrent(input, assessment)).rejects.toThrow('authoring-exact-bank-incomplete');
  });

  it.each([
    ['candidate', (receipt: GenerationExactBankReceipt) => { receipt.candidateHash = 'a'.repeat(64); }],
    ['course', (receipt: GenerationExactBankReceipt) => { receipt.courseId = foreignCourseId.toHexString(); }],
    ['excluded original', (receipt: GenerationExactBankReceipt) => { receipt.excludedQuestionId = oid(12_345).toHexString(); }],
    ['protocol', (receipt: GenerationExactBankReceipt) => { receipt.protocol = 'foreign-protocol' as never; }],
    ['incomplete status', (receipt: GenerationExactBankReceipt) => { receipt.status = 'incomplete'; }],
    ['observed duplicate', (receipt: GenerationExactBankReceipt) => { receipt.exactMatchCount = 1; }],
    ['match IDs', (receipt: GenerationExactBankReceipt) => { receipt.matches = [{ entryId: 'forged', questionId: oid(45).toHexString(), versionId: oid(46).toHexString(), state: 'approved' }]; }],
    ['missing version count', (receipt: GenerationExactBankReceipt) => { receipt.missingVersions = 1; }],
    ['invalid version count', (receipt: GenerationExactBankReceipt) => { receipt.invalidVersions = 1; }],
    ['invalid head count', (receipt: GenerationExactBankReceipt) => { receipt.invalidHeads = 1; }],
    ['unscanned heads', (receipt: GenerationExactBankReceipt) => { receipt.unscannedHeadsLowerBound = 1; }],
    ['inconsistent head count', (receipt: GenerationExactBankReceipt) => { receipt.headsScanned += 1; }],
    ['inconsistent version count', (receipt: GenerationExactBankReceipt) => { receipt.versionsChecked += 1; }],
    ['negative counts', (receipt: GenerationExactBankReceipt) => { receipt.headsScanned = -1; receipt.versionsChecked = -1; }],
    ['fractional counts', (receipt: GenerationExactBankReceipt) => { receipt.headsScanned = 1.5; receipt.versionsChecked = 1.5; }],
    ['malformed digest', (receipt: GenerationExactBankReceipt) => { receipt.bindingsDigest = 'not-a-digest'; }],
  ] as const)('rejects a tampered %s receipt before querying current storage', async (_label, tamper) => {
    const db = database([row(1)]);
    const { input, assessment } = await reviewed();
    tamper(assessment.exactBank!);
    db.findHeads.mockClear(); db.findVersions.mockClear();
    await expect(assertCurrent(input, assessment)).rejects.toThrow('generation-exact-bank-receipt-invalid');
    expect(db.findHeads).not.toHaveBeenCalled(); expect(db.findVersions).not.toHaveBeenCalled();
  });

  it('rejects a missing receipt and a changed candidate before storage access', async () => {
    const db = database(); const { input, assessment } = await reviewed();
    db.findHeads.mockClear();
    await expect(assertCurrent(input, { ...assessment, exactBank: undefined })).rejects.toThrow('generation-exact-bank-receipt-invalid');
    input.candidate.stem += ' Additional interpretation.';
    await expect(assertCurrent(input, assessment)).rejects.toThrow('generation-exact-bank-receipt-invalid');
    expect(db.findHeads).not.toHaveBeenCalled();
  });

  it.each(['digest', 'joint head/version counts'] as const)('rechecks a well-formed but forged %s binding against actual storage', async field => {
    database([row(1)]); const { input, assessment } = await reviewed();
    if (field === 'digest') assessment.exactBank!.bindingsDigest = 'b'.repeat(64);
    else { assessment.exactBank!.headsScanned += 1; assessment.exactBank!.versionsChecked += 1; }
    await expect(assertCurrent(input, assessment)).rejects.toThrow('authoring-memory-changed');
  });

  it.each(['withheld', 'legacy-policy'] as const)('does not use an otherwise current receipt to authorize a %s assessment', async change => {
    const db = database(); const { input, assessment } = await reviewed();
    if (change === 'withheld') assessment.status = 'withheld';
    else assessment.policy = 'grounded-memory-v1';
    db.findHeads.mockClear();
    await expect(assertCurrent(input, assessment)).rejects.toThrow('generation-exact-bank-receipt-invalid');
    expect(db.findHeads).not.toHaveBeenCalled();
  });

  it('propagates the caller session to every actual paginated assertion query', async () => {
    const db = database(Array.from({ length: 129 }, (_, index) => row(index)));
    const { input, assessment } = await reviewed();
    db.findHeads.mockClear(); db.findVersions.mockClear();
    const session = { fixture: 'caller-owned-session' } as unknown as ClientSession;
    await assertCurrent(input, assessment, session);
    expect(db.findHeads).toHaveBeenCalledTimes(2); expect(db.findVersions).toHaveBeenCalledTimes(2);
    for (const [, options] of [...db.findHeads.mock.calls, ...db.findVersions.mock.calls]) expect(options).toMatchObject({ session, maxTimeMS: expect.any(Number) });
  });

  it('leaves an absent historical selector query-free for review and commit, without treating it as a new receipt', async () => {
    const db = database([row(1, candidate())]);
    const input = assessmentInput(); delete input.requirements.exactBankProtocol;
    const result = await assessGenerationQuality(input);
    expect(result.status).toBe('eligible'); expect(result.exactBank).toBeUndefined();
    await assertCurrent(input, result);
    expect(db.findHeads).not.toHaveBeenCalled(); expect(db.findVersions).not.toHaveBeenCalled();
    expect(input.complete).toHaveBeenCalledTimes(1);
  });

  it.each(['edit-existing', 'create-variant'] as const)('keeps intentional %s semantics and skips the independent exact scanner', async intent => {
    const db = database([row(1, candidate())]); const input = assessmentInput();
    input.requirements = { ...requirements(intent), original: snapshotQualityCandidate(candidate('Original wording to be edited.')) };
    input.complete = jest.fn(async () => review(intent === 'create-variant' ? 'variant' : 'independent')) as typeof completeJson;
    const result = await assessGenerationQuality(input);
    expect(result.status).toBe('eligible'); expect(result.exactBank).toBeUndefined();
    await assertCurrent(input, result);
    expect(db.findHeads).not.toHaveBeenCalled(); expect(db.findVersions).not.toHaveBeenCalled();
    expect(input.complete).toHaveBeenCalledTimes(1);
  });

  it.each(['edit-existing', 'create-variant', 'create-independent-task'] as const)('retains the no-op gate before exact lookup for %s, including answer reshuffling', async intent => {
    const db = database([row(1, candidate())]); const input = assessmentInput();
    input.requirements = { ...requirements(intent), original: snapshotQualityCandidate(input.candidate) };
    input.candidate.options.reverse();
    const result = await assessGenerationQuality(input);
    expect(result.status).toBe('withheld'); expect(result.reasons.join(' ')).toContain('No material change');
    expect(result.exactBank).toBeUndefined(); expect(input.complete).not.toHaveBeenCalled();
    expect(db.findHeads).not.toHaveBeenCalled(); expect(db.findVersions).not.toHaveBeenCalled();
  });

  it('rejects unknown or non-v2 exact protocols rather than silently replaying the new policy', async () => {
    const db = database(); const input = assessmentInput();
    input.requirements.exactBankProtocol = 'future-exact-v9' as never;
    await expect(assessGenerationQuality(input)).rejects.toThrow('generation-exact-bank-policy-invalid');
    await expect(assertGenerationExactBankCurrent({ courseId, candidate: input.candidate, requirements: input.requirements,
      assessment: {} as GenerationQualityAssessment })).rejects.toThrow('generation-exact-bank-policy-invalid');
    input.requirements.exactBankProtocol = GENERATION_EXACT_BANK_PROTOCOL;
    await expect(assessGenerationQuality({ ...input, policy: 'grounded-memory-v1' })).rejects.toThrow('generation-exact-bank-policy-invalid');
    expect(input.complete).not.toHaveBeenCalled(); expect(db.findHeads).not.toHaveBeenCalled();
  });

  it('honors cancellation after the local scan without sending a quality completion', async () => {
    database([row(1)]); const input = assessmentInput(); const stop = new Error('content-run-conflict');
    const beforeRequest = jest.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(stop);
    await expect(assessGenerationQuality({ ...input, beforeRequest })).rejects.toBe(stop);
    expect(beforeRequest).toHaveBeenCalledTimes(2); expect(input.complete).not.toHaveBeenCalled();
  });

  it('withholds an expired database scan without dispatching a quality completion or claiming complete absence', async () => {
    const db = database([row(1)]); const input = assessmentInput();
    db.findHeads.mockImplementationOnce(() => { throw Object.assign(new Error('Synthetic local query deadline.'), { code: 50 }); });
    const result = await assessGenerationQuality(input);
    expect(result).toMatchObject({ status: 'withheld', exactBank: { status: 'incomplete', incompleteReason: 'deadline', headsScanned: 0 } });
    expect(db.findVersions).not.toHaveBeenCalled(); expect(input.complete).not.toHaveBeenCalled();
  });

  it('serializes two competing writes through the real course-fence wrapper with a simulated transaction backend', async () => {
    const db = database(); const { input, assessment } = await reviewed();
    let tail = Promise.resolve();
    const sessions: Array<{ withTransaction: jest.Mock; endSession: jest.Mock }> = [];
    const courseWrite = jest.fn(async () => ({ matchedCount: 1 }));
    jest.mocked(getDb).mockReturnValue({ admin: () => ({ command: jest.fn(async () => ({ setName: 'synthetic-transaction-backend' })) }),
      collection: () => ({ updateOne: courseWrite }) } as never);
    jest.mocked(getMongoClient).mockReturnValue({ startSession: () => {
      const session = { withTransaction: jest.fn(async (work: () => Promise<unknown>) => {
        const previous = tail; let release!: () => void;
        tail = new Promise<void>(resolve => { release = resolve; });
        await previous;
        try { return await work(); } finally { release(); }
      }), endSession: jest.fn(async () => undefined) };
      sessions.push(session); return session;
    } } as never);
    await initializeAuthoringCommitSupport();
    let saved = 0;
    const write = () => withCourseAuthoringWrite(courseId, async session => {
      await assertCurrent(input, assessment, session);
      const added = row(100 + saved, candidate()); db.heads.push(added.head); db.versions.push(added.version); saved += 1;
    }, { required: true });
    const outcomes = await Promise.allSettled([write(), write()]);
    expect(outcomes[0].status).toBe('fulfilled');
    expect(outcomes[1]).toMatchObject({ status: 'rejected', reason: new Error('authoring-exact-bank-duplicate') });
    expect(saved).toBe(1); expect(sessions).toHaveLength(2);
    expect(courseWrite).toHaveBeenCalledTimes(2);
    expect(sessions.every(session => session.endSession.mock.calls.length === 1)).toBe(true);
    expect(db.findHeads.mock.calls.at(-1)![1]?.session).toBe(sessions[1]);
    expect(input.complete).toHaveBeenCalledTimes(1);
    // The serial queue above is a controlled interleaving, not real Mongo
    // transaction isolation, rollback, write-conflict retry or topology proof.
  });
});
