jest.mock('../../server/src/components/mongodb/collections', () => ({ questionsCol: jest.fn(), questionVersionsCol: jest.fn(), questionPedagogicalFingerprintsCol: jest.fn() }));
jest.mock('../../server/src/components/genai/embeddings', () => ({ embedOne: jest.fn(() => { throw new Error('Embedding dispatch forbidden.'); }) }));

import { ObjectId, type ClientSession } from 'mongodb';
import { questionsCol, questionVersionsCol, questionPedagogicalFingerprintsCol } from '../../server/src/components/mongodb/collections';
import { embedOne } from '../../server/src/components/genai/embeddings';
import { loadGenerationMemory, reloadGenerationMemory, refreshGenerationMemoryForCandidate, selectGenerationMemory, withBatchGenerationMemory,
  assertTaskRetrievalReady, contentFingerprint, type GenerationMemoryContent } from '../../server/src/services/generation-memory.service';
import { retrieveCurrentBankTasks, TASK_RETRIEVAL_PROTOCOL } from '../../server/src/services/generation-task-retrieval';
import type { PedagogicalTaskDescriptor } from '../../server/src/types/authoring-task';

const courseId = new ObjectId('000000000000000000000001'); const loId = new ObjectId('000000000000000000000002');
const otherLo = new ObjectId('000000000000000000000003');
const query = 'CAPM required equity return risk-free beta market premium';
const descriptor: PedagogicalTaskDescriptor = { concepts: ['CAPM', 'beta'], requiredInference: 'Compute required return from a supplied risk-free rate, beta and market premium.',
  solutionPath: ['Multiply beta by market premium.', 'Add the risk-free rate.'], misconception: 'Omit the risk-free rate.', targetDifficulty: 'easy', passageIds: ['E-source-is-not-a-bank-ID'], intent: 'create-independent-task' };
function content(stem: string): GenerationMemoryContent {
  return { type: 'mcq', numericKind: 'conceptual', stem, options: [
    { key: 'A', role: 'correct', text: 'Use the stated relationship.', explanation: 'Read the given inputs and apply the requested operation.' },
    { key: 'B', role: 'common-misconception', text: 'Ignore the stated condition.', explanation: 'The condition is part of the question.' },
  ], paramSlots: [], derivedValues: [], sourceRefs: [] };
}
function fixture(count = 121, cross = false) {
  const rows = Array.from({ length: count }, (_, index) => {
    const id = new ObjectId((1000 + index).toString(16).padStart(24, '0')); const versionId = new ObjectId((10000 + index).toString(16).padStart(24, '0'));
    return { head: { _id: id, currentVersionId: versionId, courseId, templateFamilyId: id, state: 'approved', loIds: [cross ? otherLo : loId], updatedAt: count - index },
      version: { _id: versionId, questionId: id, ...content(index === count - 1 ? 'Using the capital asset pricing model, compute required equity return from risk-free yield, beta and market premium.' : `Coupon calendar item ${index}: which payment date applies?`),
        taskDescriptor: undefined as PedagogicalTaskDescriptor | undefined } };
  });
  const last = rows.at(-1)!;
  const profiles = [{ courseId, questionId: last.head._id, versionId: last.version._id, familyId: last.head._id, policy: 'pedagogical-task-v2',
    contentHash: contentFingerprint(last.version).exact, descriptor: { ...descriptor }, embedding: undefined as number[] | undefined,
    embeddingModel: undefined as string | undefined, embeddingProvider: undefined as string | undefined }];
  return { heads: rows.map(row => row.head), versions: rows.map(row => row.version), profiles };
}
type Data = ReturnType<typeof fixture>;
type Row = Record<string, unknown>;
function equal(left: unknown, right: unknown) { return left instanceof ObjectId ? left.equals(right as ObjectId) : left === right; }
function matches(row: Row, filter: Row): boolean {
  return Object.entries(filter).every(([key, value]) => {
    const actual = row[key];
    if (value && typeof value === 'object' && !(value instanceof ObjectId)) return Object.entries(value).every(([op, operand]) => {
      const values = operand as unknown[];
      if (op === '$in') return Array.isArray(actual) ? actual.some(item => values.some(want => equal(item, want))) : values.some(want => equal(actual, want));
      if (op === '$nin') return Array.isArray(actual) ? actual.every(item => !values.some(want => equal(item, want))) : !values.some(want => equal(actual, want));
      if (op === '$ne') return !equal(actual, operand);
      if (op === '$gt') return (actual as ObjectId).toHexString() > (operand as ObjectId).toHexString();
      throw new Error(`Unexpected mock operator ${op}`);
    });
    return equal(actual, value);
  });
}
function database(data: Data) {
  const find = (name: keyof Data) => jest.fn((filter: Row, options?: { projection?: Record<string, number> }) => {
    let rows = (data[name] as unknown as Row[]).filter(row => matches(row, filter));
    const reader = { sort(order: Record<string, number>) { rows.sort((a, b) => {
      for (const [key, direction] of Object.entries(order)) {
        const left = a[key] instanceof ObjectId ? a[key].toHexString() : a[key] as number;
        const right = b[key] instanceof ObjectId ? b[key].toHexString() : b[key] as number;
        if (left < right) return -direction; if (left > right) return direction;
      } return 0;
    }); return reader; }, limit(count: number) { rows = rows.slice(0, count); return reader; }, async toArray() {
      return rows.map(row => options?.projection ? Object.fromEntries(Object.entries(row).filter(([key]) => options.projection![key] === 1)) : row);
    } };
    return reader;
  });
  const headFind = find('heads'); const versionFind = find('versions'); const profileFind = find('profiles');
  const headOne = jest.fn(async (filter: Row) => data.heads.find(head => matches(head as unknown as Row, filter)) ?? null);
  jest.mocked(questionsCol).mockReturnValue({ find: headFind, findOne: headOne } as never);
  jest.mocked(questionVersionsCol).mockReturnValue({ find: versionFind } as never);
  jest.mocked(questionPedagogicalFingerprintsCol).mockReturnValue({ find: profileFind } as never);
  return { headFind, versionFind, profileFind, headOne };
}
const input = { courseId, loIds: [loId], includeCrossLo: true, query, taskRetrievalProtocol: TASK_RETRIEVAL_PROTOCOL };

describe('full-current local task nomination', () => {
  it.each([[121, false, 120], [81, true, 80]] as const)('exposes an older current task outside the %i-head recency window without another embedding', async (count, cross, oldCount) => {
    const data = fixture(count, cross); database(data);
    const old = await loadGenerationMemory({ courseId, loIds: [loId], includeCrossLo: true });
    expect(old.entries).toHaveLength(oldCount); expect(old.entries.some(row => row.questionId === data.heads.at(-1)!._id.toHexString())).toBe(false);
    const current = await loadGenerationMemory(input); const selection = selectGenerationMemory(current, { query });
    expect(current.taskRetrieval).toMatchObject({ status: 'complete', headsScanned: count, versionsChecked: count, rankerVersion: 'lexical-profile-v1' });
    const target = current.entries.find(row => row.questionId === data.heads.at(-1)!._id.toHexString())!;
    expect(target.taskDescriptor).toEqual(descriptor); expect(target.comparisonRole).toBe('retrieved-task');
    expect(selection.requiredComparisonIds).toContain(target.id); expect(selection.entries).toContain(target);
    const wire = JSON.parse(selection.text.slice(selection.text.indexOf('{')));
    expect(wire.entries.find((row: { id: string }) => row.id === target.id).options).toEqual(target.content.options);
    expect(selection.text.length).toBeLessThanOrEqual(12000); expect(selection.entries.length).toBeLessThanOrEqual(12);
    expect(selection.text).not.toContain('E-source-is-not-a-bank-ID'); expect(embedOne).not.toHaveBeenCalled();
  });

  it('uses raw current question text when no prepared profile exists', async () => {
    const data = fixture(); data.profiles = []; database(data);
    const current = await loadGenerationMemory(input);
    expect(current.taskRetrieval?.nominatedIds).toContain(`q:${data.heads.at(-1)!._id.toHexString()}:${data.versions.at(-1)!._id.toHexString()}`);
    expect(current.taskRetrieval?.missingDescriptors).toBe(121); expect(embedOne).not.toHaveBeenCalled();
  });

  it('does not globally read or retain original-source chunks that are not task comparison content', async () => {
    const data = fixture(1); data.versions[0].sourceRefs = [{ materialId: new ObjectId(), chunk: 'large private original chunk '.repeat(5000) }];
    const db = database(data); const legacy = await loadGenerationMemory({ courseId, loIds: [loId] });
    expect(legacy.entries[0].content.sourceRefs).toEqual(data.versions[0].sourceRefs);
    db.versionFind.mockClear(); const current = await loadGenerationMemory(input);
    const globalReads = db.versionFind.mock.calls.filter(([, options]) => options && 'maxTimeMS' in options);
    expect(globalReads).toHaveLength(1); expect(globalReads[0][1]?.projection).not.toHaveProperty('sourceRefs');
    expect(current.entries[0].content.sourceRefs).toBeUndefined();
    expect(current.entries[0].fingerprint).toEqual(legacy.entries[0].fingerprint);
    expect(selectGenerationMemory(current).text).not.toContain('large private original chunk');
    const replay = await reloadGenerationMemory(current, { courseId, loIds: [loId], includeCrossLo: true });
    expect(replay.snapshotDigest).toBe(current.snapshotDigest); expect(() => assertTaskRetrievalReady(replay)).not.toThrow();
  });

  it('accepts canonical16-passage descriptors and prefers a valid version descriptor over its prepared profile', async () => {
    const data = fixture(1); data.profiles[0].descriptor.passageIds = Array.from({ length: 16 }, (_, index) => `E${index + 1}`); database(data);
    expect((await loadGenerationMemory(input)).entries[0].taskDescriptor?.passageIds).toHaveLength(16);
    data.versions[0].taskDescriptor = { ...descriptor, requiredInference: 'Use this exact current version task.' };
    expect((await loadGenerationMemory(input)).entries[0].taskDescriptor?.requiredInference).toBe('Use this exact current version task.');
  });

  it.each(['empty-concepts', 'empty-steps', 'empty-passages', 'extra-private-field'] as const)('falls back to current text for %s descriptors without importing a model service', async invalid => {
    const data = fixture(1);
    if (invalid === 'empty-concepts') data.profiles[0].descriptor.concepts = [];
    if (invalid === 'empty-steps') data.profiles[0].descriptor.solutionPath = [];
    if (invalid === 'empty-passages') data.profiles[0].descriptor.passageIds = [];
    if (invalid === 'extra-private-field') Object.assign(data.profiles[0].descriptor, { serverVerified: true });
    database(data); const current = await loadGenerationMemory(input);
    expect(current.entries[0].taskDescriptor).toBeUndefined(); expect(current.taskRetrieval).toMatchObject({ missingDescriptors: 1, ignoredProfiles: 1 });
  });

  it('bounds global nominations to64 and retained Bank entries to200 with recent fillers', async () => {
    const data = fixture(270);
    for (const [index, head] of data.heads.entries()) head.loIds = [index < 120 ? loId : otherLo];
    for (const version of data.versions.slice(200)) version.stem = `CAPM required equity return risk-free beta market premium item ${version._id.toHexString()}`;
    data.profiles = []; database(data);
    const current = await loadGenerationMemory(input);
    expect(current.taskRetrieval).toMatchObject({ status: 'complete', headsScanned: 270 });
    expect(current.taskRetrieval?.nominatedIds).toHaveLength(64); expect(current.entries).toHaveLength(200);
    expect(current.taskRetrieval?.requiredComparisonIds).toHaveLength(2);
    expect(current.entries.some(entry => entry.questionId === data.heads[0]._id.toHexString())).toBe(true);
  });

  it('has no mandatory retrieval rows when only unrelated recent fillers exist', async () => {
    const data = fixture(2); for (const row of data.versions) row.stem = 'Coupon calendar payment dates.'; data.profiles = []; database(data);
    const current = await loadGenerationMemory(input);
    expect(current.taskRetrieval).toMatchObject({ status: 'complete', nominatedIds: [], requiredComparisonIds: [] });
    expect(selectGenerationMemory(current).requiredComparisonIds).toEqual([]);
  });

  it('replays a scanner-built known-identity cached vector without a new embedding, and drops it for a different query', async () => {
    const data = fixture(1); data.profiles[0].embedding = [1, 0]; data.profiles[0].embeddingProvider = 'fixture-provider'; data.profiles[0].embeddingModel = 'fixture-model'; database(data);
    const local = await loadGenerationMemory(input);
    const scanned = await retrieveCurrentBankTasks({ protocol: TASK_RETRIEVAL_PROTOCOL, courseId, base: local, scope: local.taskRetrieval!.scope,
      query, queryVector: [1, 0], queryVectorIdentity: { provider: 'fixture-provider', model: 'fixture-model' }, fingerprint: contentFingerprint });
    // Seal an actual scanner-built receipt with the production batch/snapshot helper.
    const cached = withBatchGenerationMemory({ ...local, entries: scanned.entries, taskRetrieval: scanned.receipt, queryEmbedding: [1, 0], semanticRetrieval: 'available' }, []);
    expect(() => assertTaskRetrievalReady(cached)).not.toThrow();
    const same = await reloadGenerationMemory(cached, { courseId, loIds: [loId], includeCrossLo: true });
    expect(same.taskRetrieval?.vectorHash).toBe(cached.taskRetrieval?.vectorHash); expect(same.entries[0].embedding).toEqual([1, 0]);
    expect(same.snapshotDigest).toBe(cached.snapshotDigest);
    const changed = await refreshGenerationMemoryForCandidate(cached, 'coupon calendar');
    expect(changed.taskRetrieval?.queryVector).toBeUndefined(); expect(changed.taskRetrieval?.vectorHash).toBeNull(); expect(changed.queryEmbedding).toBeUndefined();
    expect(embedOne).not.toHaveBeenCalled();
  });

  it.each(['unknown-provider', 'different-model'] as const)('uses lexical fallback for %s profile vectors instead of assuming equal dimensions imply compatibility', async mismatch => {
    const data = fixture(1); data.profiles[0].embedding = [1, 0];
    data.profiles[0].embeddingProvider = mismatch === 'unknown-provider' ? undefined : 'fixture-provider';
    data.profiles[0].embeddingModel = mismatch === 'different-model' ? 'other-model' : 'fixture-model'; database(data);
    const base = await loadGenerationMemory(input);
    const scanned = await retrieveCurrentBankTasks({ protocol: TASK_RETRIEVAL_PROTOCOL, courseId, base, scope: base.taskRetrieval!.scope,
      query, queryVector: [1, 0], queryVectorIdentity: { provider: 'fixture-provider', model: 'fixture-model' }, fingerprint: contentFingerprint });
    expect(scanned.entries[0].embedding).toBeUndefined(); expect(scanned.receipt.status).toBe('complete'); expect(embedOne).not.toHaveBeenCalled();
  });

  it('retains no stale base version, foreign/archive head or old prepared descriptor', async () => {
    const data = fixture(5); data.heads[0].courseId = new ObjectId(); data.heads[1].state = 'archived';
    const obsolete = data.versions.at(-1)!; const changed = { ...obsolete, _id: new ObjectId(), ...content('Which coupon payment date applies?') };
    data.heads.at(-1)!.currentVersionId = changed._id; data.versions.push(changed); database(data);
    const current = await loadGenerationMemory(input);
    expect(current.taskRetrieval).toMatchObject({ status: 'complete', headsScanned: 3 });
    expect(current.entries.some(row => row.versionId === obsolete._id.toHexString())).toBe(false);
    expect(current.entries.some(row => row.questionId === data.heads[0]._id.toHexString() || row.questionId === data.heads[1]._id.toHexString())).toBe(false);
    expect(current.entries.some(row => row.taskDescriptor)).toBe(false);
  });

  it('ignores a stale content-hash profile instead of treating its task text as current', async () => {
    const data = fixture(1); data.profiles[0].contentHash = '0'.repeat(64); data.versions[0].stem = 'What is an ordinary share?'; database(data);
    const current = await loadGenerationMemory(input);
    expect(current.taskRetrieval).toMatchObject({ status: 'complete', missingDescriptors: 1, ignoredProfiles: 1, nominatedIds: [], requiredComparisonIds: [] });
    expect(selectGenerationMemory(current).requiredComparisonIds).toEqual([]);
  });

  it('binds effective prepared metadata and replays the stored query through reload with no embedding work', async () => {
    const data = fixture(); const db = database(data); const current = await loadGenerationMemory(input);
    const same = await reloadGenerationMemory(current, { courseId, loIds: [loId], includeCrossLo: true });
    expect(same.snapshotDigest).toBe(current.snapshotDigest);
    data.profiles[0].descriptor.requiredInference = 'A changed retrieval-only task description.';
    const changed = await reloadGenerationMemory(current, { courseId, loIds: [loId], includeCrossLo: true });
    expect(changed.taskRetrieval?.bindingsDigest).not.toBe(current.taskRetrieval?.bindingsDigest);
    expect(changed.snapshotDigest).not.toBe(current.snapshotDigest);
    expect(db.headFind).toHaveBeenCalled(); expect(embedOne).not.toHaveBeenCalled();
  });

  it.each(['content', 'descriptor', 'query', 'required', 'batch', 'vector'] as const)('rejects private %s tampering even when the stored snapshotDigest is unchanged', async field => {
    const data = fixture(); database(data); let current = await loadGenerationMemory(input);
    if (field === 'content') current.entries[0].content.stem = 'Changed private question text.';
    if (field === 'descriptor') current.entries[0].taskDescriptor!.requiredInference = 'Changed private task text.';
    if (field === 'query') current.taskRetrieval!.query = 'A new query without a new receipt.';
    if (field === 'required') current.taskRetrieval!.requiredComparisonIds = [];
    if (field === 'vector') current.queryEmbedding = [1, 0];
    if (field === 'batch') { current = withBatchGenerationMemory(current, [{ id: 'batch:r:0', content: content('A sibling task.') }]); current.entries.at(-1)!.content.stem = 'Changed sibling.'; }
    expect(() => assertTaskRetrievalReady(current)).toThrow();
  });

  it('preserves receipt/vector metadata through batch reservations while limiting mandatory Bank comparators', async () => {
    const data = fixture(); database(data); const current = await loadGenerationMemory(input);
    const batch = withBatchGenerationMemory(current, [{ id: 'batch:r:0', content: content('A recent sibling.') }]);
    expect(batch.taskRetrieval).toEqual(current.taskRetrieval); expect(() => assertTaskRetrievalReady(batch)).not.toThrow();
    expect(selectGenerationMemory(batch, { query: 'coupon calendar' }).requiredComparisonIds).toEqual(current.taskRetrieval?.requiredComparisonIds);
    expect((await reloadGenerationMemory(batch, { courseId, loIds: [loId], includeCrossLo: true })).snapshotDigest).toBe(batch.snapshotDigest);
  });

  it('refreshes a changed candidate query locally, retaining scope and batch content', async () => {
    database(fixture()); const current = await loadGenerationMemory(input);
    const before = withBatchGenerationMemory(current, [{ id: 'batch:r:0', content: content('A sibling task.') }]);
    const refreshed = await refreshGenerationMemoryForCandidate(before, 'coupon calendar payment date');
    expect(refreshed.taskRetrieval?.scope).toEqual(current.taskRetrieval?.scope); expect(refreshed.taskRetrieval?.query).toBe('coupon calendar payment date');
    expect(refreshed.taskRetrieval?.vectorHash).toBeNull(); expect(refreshed.entries.some(row => row.id === 'batch:r:0')).toBe(true); expect(embedOne).not.toHaveBeenCalled();
  });

  it('keeps the original full comparator plus at most one retrieved task', async () => {
    const data = fixture(); database(data); const original = data.heads[0];
    const current = await loadGenerationMemory({ ...input, excludeQuestionId: original._id, pinnedOriginal: { questionId: original._id, versionId: original.currentVersionId } });
    const selected = selectGenerationMemory(current, { query });
    expect(selected.requiredComparisonIds).toHaveLength(2); expect(selected.requiredComparisonIds![0]).toBe(current.pinnedOriginal?.entryId);
    expect(selected.entries.filter(row => row.comparisonRole === 'pinned-original')).toHaveLength(1);
    expect(selected.entries.filter(row => row.comparisonRole === 'retrieved-task')).toHaveLength(1);
    expect(() => selectGenerationMemory(current, { maxEntries: 1 })).toThrow('generation-memory-required-original-too-large');
  });

  it('keeps both mandatory literal questions and numeric definitions intact while omitting private retrieval diagnostics from the new prompt', async () => {
    const data = fixture(2);
    for (const version of data.versions) {
      version.numericKind = 'numeric';
      version.paramSlots = [{ name: 'BETA', min: 1.1, max: 1.9, step: 0.1 }];
      version.derivedValues = [{ name: 'RETURN', formula: '2 + BETA * 5' }];
      version.taskDescriptor = { ...descriptor };
    }
    database(data); const original = data.heads[0];
    const current = await loadGenerationMemory({ ...input, excludeQuestionId: original._id, pinnedOriginal: { questionId: original._id, versionId: original.currentVersionId } });
    const before = JSON.stringify(current); const selection = selectGenerationMemory(current, { query });
    const wire = JSON.parse(selection.text.slice(selection.text.indexOf('{')));
    expect(wire.coverage).toEqual({ scan: 'complete', omittedCount: 0, contentTruncated: false });
    expect(wire.requiredComparisonIds).toHaveLength(2);
    for (const id of wire.requiredComparisonIds) {
      const full = selection.entries.find(row => row.id === id)!; const rendered = wire.entries.find((row: { id: string }) => row.id === id);
      expect(rendered).toMatchObject({ type: full.content.type, stem: full.content.stem, options: full.content.options,
        numericKind: full.content.numericKind, paramSlots: full.content.paramSlots, derivedValues: full.content.derivedValues });
      expect(rendered.taskDescriptor).toBeUndefined(); expect(full.taskDescriptor).toEqual(descriptor);
    }
    expect(selection.text).not.toContain(current.snapshotDigest); expect(selection.text).not.toContain('bindingsDigest');
    expect(selection.text).not.toContain('rankerVersion'); expect(JSON.stringify(current)).toBe(before);
    expect(() => assertTaskRetrievalReady(current)).not.toThrow();
  });

  it('refuses a mandatory comparator that cannot fit instead of silently clipping question or feedback', async () => {
    const data = fixture(1); data.versions[0].stem = `CAPM ${'long question '.repeat(1800)}`; data.profiles[0].contentHash = contentFingerprint(data.versions[0]).exact; database(data);
    const current = await loadGenerationMemory(input);
    expect(() => selectGenerationMemory(current)).toThrow('generation-memory-required-original-too-large');
  });

  it.each(['missing', 'wrong-owner'] as const)('records incomplete global coverage for a %s current version', async fault => {
    const data = fixture(); if (fault === 'missing') data.versions.pop(); else data.versions.at(-1)!.questionId = new ObjectId(); database(data);
    const current = await loadGenerationMemory(input);
    expect(current.taskRetrieval?.status).toBe('incomplete'); expect(() => assertTaskRetrievalReady(current)).toThrow('generation-task-retrieval-incomplete');
  });

  it('enforces a lower scan ceiling with an explicit unscanned count', async () => {
    database(fixture()); const current = await loadGenerationMemory({ ...input, taskRetrievalLimits: { maxHeads: 2 } });
    expect(current.taskRetrieval).toMatchObject({ status: 'incomplete', incompleteReason: 'head-limit', headsScanned: 2, unscannedHeadsLowerBound: 1 });
    expect(() => assertTaskRetrievalReady(current)).toThrow('generation-task-retrieval-incomplete');
  });

  it('propagates the transaction session on every replay read', async () => {
    const db = database(fixture(130)); const current = await loadGenerationMemory(input); const session = {} as ClientSession;
    db.headFind.mockClear(); db.versionFind.mockClear(); db.profileFind.mockClear();
    await reloadGenerationMemory(current, { courseId, loIds: [loId], includeCrossLo: true, session });
    for (const find of [db.headFind, db.versionFind, db.profileFind]) for (const [, options] of find.mock.calls) expect(options).toEqual(expect.objectContaining({ session }));
  });

  it('refuses invalid new contracts before reads and preserves absent old behavior', async () => {
    const db = database(fixture(1));
    for (const badQuery of ['', ' '.repeat(3), 'x'.repeat(8001), undefined]) await expect(loadGenerationMemory({ ...input, query: badQuery })).rejects.toThrow('query-invalid');
    await expect(loadGenerationMemory({ ...input, taskRetrievalProtocol: 'future' as never })).rejects.toThrow('policy-invalid');
    expect(db.headFind).not.toHaveBeenCalled();
    const old = await loadGenerationMemory({ courseId, loIds: [loId] });
    expect(old.taskRetrieval).toBeUndefined(); expect(selectGenerationMemory(old).requiredComparisonIds).toBeUndefined();
    expect(await refreshGenerationMemoryForCandidate(old, query)).toBe(old);
    expect(() => assertTaskRetrievalReady(old, TASK_RETRIEVAL_PROTOCOL)).toThrow('receipt-invalid');
    const current = await loadGenerationMemory(input);
    await expect(reloadGenerationMemory(current, { courseId: new ObjectId(), loIds: [loId], includeCrossLo: true })).rejects.toThrow('scope-changed');
    await expect(reloadGenerationMemory(current, { ...input, query: 'a different stored query' })).rejects.toThrow('scope-changed');
  });
});
