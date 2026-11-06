jest.mock('../../server/src/config/env', () => ({ env: { embeddingsModel: 'fixture-embedding' } }));
jest.mock('../../server/src/components/genai/llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../server/src/components/genai/embeddings', () => ({ embedOne: jest.fn() }));
jest.mock('../../server/src/components/mongodb/collections', () => ({ authoringTaskPlansCol: jest.fn(), contentRunsCol: jest.fn(), questionPedagogicalFingerprintsCol: jest.fn() }));
jest.mock('../../server/src/services/authoring-commit.service', () => ({ authoringCollection: (value: unknown) => value, withCourseAuthoringFirstWrite: jest.fn(async (_course, work) => work()) }));
import { ObjectId } from 'mongodb';
import { completeJson } from '../../server/src/components/genai/llm';
import { authoringTaskPlansCol, contentRunsCol, questionPedagogicalFingerprintsCol } from '../../server/src/components/mongodb/collections';
import { prepareAuthoringTaskPlan, recordQuestionPedagogicalFingerprint } from '../../server/src/services/authoring-task-plan.service';
import type { GenerationEvidencePacket } from '../../server/src/types/generation-evidence';
import type { PedagogicalTaskDescriptor } from '../../server/src/types/authoring-task';

const courseId = new ObjectId(); const runId = new ObjectId();
const packet: GenerationEvidencePacket = { id: 'packet', policyVersion: 'grounded-memory-v2', courseId: courseId.toHexString(), loIds: [], schemaVersion: 'source-passages-v1', sourceFingerprint: 'source', parsingProvenance: 'unrecorded', materials: [],
  passages: [{ id: 'E1', materialId: new ObjectId().toHexString(), materialName: 'Chapter', role: 'primary', chunkIndex: 0, start: 0, end: 19, text: 'Beta measures risk.', selection: 'retrieved' }], findings: [], coverage: { sourceChunks: 1, selectedChunks: 1, selectedCharacters: 19, omittedPassages: 0, truncated: false, searchScope: 'retrieved-chunks-and-immediate-neighbors' } };
const task: PedagogicalTaskDescriptor = { concepts: ['CAPM', 'systematic risk'], requiredInference: 'Distinguish beta from volatility.', solutionPath: ['Identify systematic risk.', 'Choose beta.'], misconception: 'Volatility equals beta.', targetDifficulty: 'easy', passageIds: ['E1'], intent: 'create-independent-task' };
let insert: jest.Mock; let findOne: jest.Mock; let find: jest.Mock; let fingerprint: jest.Mock;
const input = () => ({ courseId, runId, count: 6, loName: 'Systematic risk', difficulty: 'hard' as const, evidence: packet,
  memory: { entries: [], truncated: false, missingVersions: 0, snapshotDigest: 'memory', consistency: 'best-effort' as const }, model: { model: 'fixture' }, beforeRequest: jest.fn(async () => undefined) });
beforeEach(() => {
  jest.clearAllMocks(); insert = jest.fn(async () => ({})); findOne = jest.fn(async () => null); find = jest.fn(() => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) })); fingerprint = jest.fn(async () => ({}));
  jest.mocked(authoringTaskPlansCol).mockReturnValue({ findOne, insertOne: insert, find } as never);
  jest.mocked(questionPedagogicalFingerprintsCol).mockReturnValue({ updateOne: fingerprint } as never);
  jest.mocked(contentRunsCol).mockReturnValue({ find: jest.fn(() => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) })) } as never);
  jest.mocked(completeJson).mockResolvedValue({ tasks: [task], reasons: ['The thin source set supports one remaining independent task.'] });
});
describe('bounded supported-task planning', () => {
  it('pins grouped full originals only for explicitly selected new planning and retains teacher instructions', async () => {
    const result = await prepareAuthoringTaskPlan({ ...input(), authoringPromptProtocol: 'compact-authoring-v1', prompt: 'Keep every lecture convention.' });
    const prompt = jest.mocked(completeJson).mock.calls[0][0];
    expect(prompt).toContain('Original passages grouped by source');
    expect(prompt).toContain(packet.passages[0].id); expect(prompt).toContain(packet.passages[0].text);
    expect(prompt).toContain('Keep every lecture convention.');
    expect(result.authoringPromptProtocol).toBe('compact-authoring-v1');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ authoringPromptProtocol: 'compact-authoring-v1' }));
    jest.mocked(completeJson).mockClear();
    await prepareAuthoringTaskPlan(input());
    expect(jest.mocked(completeJson).mock.calls[0][0]).toContain('Original passages:\n');
    expect(jest.mocked(completeJson).mock.calls[0][0]).not.toContain('Original passages grouped');
  });
  it('refuses unknown rendering or changed durable pins before reading or sending new work', async () => {
    await expect(prepareAuthoringTaskPlan({ ...input(), authoringPromptProtocol: 'unknown' as never })).rejects.toThrow('generation-quality-protocol-invalid');
    expect(findOne).not.toHaveBeenCalled(); expect(completeJson).not.toHaveBeenCalled();
    const existing = await prepareAuthoringTaskPlan(input());
    findOne.mockResolvedValue(existing); jest.mocked(completeJson).mockClear();
    await expect(prepareAuthoringTaskPlan({ ...input(), authoringPromptProtocol: 'compact-authoring-v1' })).rejects.toThrow('authoring-plan-context-changed');
    expect(completeJson).not.toHaveBeenCalled();
  });
  it('persists numeric-review selection without changing planning input and refuses recovery drift', async () => {
    const legacy = await prepareAuthoringTaskPlan(input());
    const oldPrompt = jest.mocked(completeJson).mock.calls[0][0];
    jest.mocked(completeJson).mockClear();
    const pinned = await prepareAuthoringTaskPlan({ ...input(), numericReviewProtocol: 'server-rendered-numeric-review-v1' });
    expect(jest.mocked(completeJson).mock.calls[0][0]).toBe(oldPrompt);
    expect(pinned.numericReviewProtocol).toBe('server-rendered-numeric-review-v1');
    findOne.mockResolvedValue(legacy); jest.mocked(completeJson).mockClear();
    await expect(prepareAuthoringTaskPlan({ ...input(), numericReviewProtocol: 'server-rendered-numeric-review-v1' })).rejects.toThrow('authoring-plan-context-changed');
    findOne.mockResolvedValue(pinned);
    await expect(prepareAuthoringTaskPlan(input())).rejects.toThrow('authoring-plan-context-changed');
    await expect(prepareAuthoringTaskPlan({ ...input(), numericReviewProtocol: 'unknown' as never })).rejects.toThrow('generation-numeric-review-protocol-invalid');
    expect(completeJson).not.toHaveBeenCalled();
  });
  it('refuses a concurrent historical plan winner rather than upgrading its absent numeric pin', async () => {
    const existing = await prepareAuthoringTaskPlan(input()); jest.mocked(completeJson).mockClear();
    findOne.mockReset().mockResolvedValueOnce(null).mockResolvedValueOnce(existing);
    insert.mockRejectedValueOnce(Object.assign(new Error('duplicate run plan'), { code: 11000 }));
    await expect(prepareAuthoringTaskPlan({ ...input(), numericReviewProtocol: 'server-rendered-numeric-review-v1' })).rejects.toThrow('authoring-plan-context-changed');
    expect(completeJson).toHaveBeenCalledTimes(1);
  });
  it('persists exclusion-review selection without changing planning input and refuses recovery drift', async () => {
    const legacy = await prepareAuthoringTaskPlan(input());
    const oldPrompt = jest.mocked(completeJson).mock.calls[0][0];
    jest.mocked(completeJson).mockClear();
    const pinned = await prepareAuthoringTaskPlan({ ...input(), exclusionReviewProtocol: 'literal-exclusion-warrants-v1' });
    expect(jest.mocked(completeJson).mock.calls[0][0]).toBe(oldPrompt);
    expect(pinned.exclusionReviewProtocol).toBe('literal-exclusion-warrants-v1');
    findOne.mockResolvedValue(legacy); jest.mocked(completeJson).mockClear();
    await expect(prepareAuthoringTaskPlan({ ...input(), exclusionReviewProtocol: 'literal-exclusion-warrants-v1' })).rejects.toThrow('authoring-plan-context-changed');
    findOne.mockResolvedValue(pinned);
    await expect(prepareAuthoringTaskPlan(input())).rejects.toThrow('authoring-plan-context-changed');
    await expect(prepareAuthoringTaskPlan({ ...input(), exclusionReviewProtocol: 'unknown' as never })).rejects.toThrow('generation-exclusion-review-protocol-invalid');
    expect(completeJson).not.toHaveBeenCalled();
  });
  it('refuses a concurrent historical plan winner rather than upgrading its absent exclusion pin', async () => {
    const existing = await prepareAuthoringTaskPlan(input()); jest.mocked(completeJson).mockClear();
    findOne.mockReset().mockResolvedValueOnce(null).mockResolvedValueOnce(existing);
    insert.mockRejectedValueOnce(Object.assign(new Error('duplicate run plan'), { code: 11000 }));
    await expect(prepareAuthoringTaskPlan({ ...input(), exclusionReviewProtocol: 'literal-exclusion-warrants-v1' })).rejects.toThrow('authoring-plan-context-changed');
    expect(completeJson).toHaveBeenCalledTimes(1);
  });
  it('persists review-repair selection without changing planning input and refuses recovery drift', async () => {
    const legacy = await prepareAuthoringTaskPlan(input());
    const oldPrompt = jest.mocked(completeJson).mock.calls[0][0];
    jest.mocked(completeJson).mockClear();
    const pinned = await prepareAuthoringTaskPlan({ ...input(), reviewRepairProtocol: 'frozen-review-decisions-v1' });
    expect(jest.mocked(completeJson).mock.calls[0][0]).toBe(oldPrompt);
    expect(pinned.reviewRepairProtocol).toBe('frozen-review-decisions-v1');
    findOne.mockResolvedValue(legacy); jest.mocked(completeJson).mockClear();
    await expect(prepareAuthoringTaskPlan({ ...input(), reviewRepairProtocol: 'frozen-review-decisions-v1' })).rejects.toThrow('authoring-plan-context-changed');
    findOne.mockResolvedValue(pinned);
    await expect(prepareAuthoringTaskPlan(input())).rejects.toThrow('authoring-plan-context-changed');
    await expect(prepareAuthoringTaskPlan({ ...input(), reviewRepairProtocol: 'unknown' as never })).rejects.toThrow('generation-review-repair-protocol-invalid');
    expect(completeJson).not.toHaveBeenCalled();
  });
  it('refuses a concurrent historical plan winner rather than upgrading its absent review-repair pin', async () => {
    const existing = await prepareAuthoringTaskPlan(input()); jest.mocked(completeJson).mockClear();
    findOne.mockReset().mockResolvedValueOnce(null).mockResolvedValueOnce(existing);
    insert.mockRejectedValueOnce(Object.assign(new Error('duplicate run plan'), { code: 11000 }));
    await expect(prepareAuthoringTaskPlan({ ...input(), reviewRepairProtocol: 'frozen-review-decisions-v1' })).rejects.toThrow('authoring-plan-context-changed');
    expect(completeJson).toHaveBeenCalledTimes(1);
  });
  it('new demand protocol refuses easier planned slots without changing the fixed request or buying another call', async () => {
    const result = await prepareAuthoringTaskPlan({ ...input(), taskDemandProtocol: 'task-demand-v1' });
    expect(result.slots).toHaveLength(0); expect(result.shortfall).toBe(6);
    expect(result.reasons.join(' ')).toContain('fixed requested hard demand');
    expect(completeJson).toHaveBeenCalledTimes(1); expect(jest.mocked(completeJson).mock.calls[0][0]).toContain('Fixed task demand');
  });
  it('new demand planning retains matching source-bound tasks and source-appropriate unset levels', async () => {
    jest.mocked(completeJson).mockResolvedValue({ tasks: [{ ...task, targetDifficulty: 'hard' }], reasons: [] });
    expect((await prepareAuthoringTaskPlan({ ...input(), taskDemandProtocol: 'task-demand-v1' })).slots).toHaveLength(1);
    jest.mocked(completeJson).mockResolvedValue({ tasks: [task], reasons: [] });
    expect((await prepareAuthoringTaskPlan({ ...input(), difficulty: undefined, taskDemandProtocol: 'task-demand-v1' })).slots).toHaveLength(1);
  });
  it('unknown explicit demand protocols fail before planning completion', async () => {
    await expect(prepareAuthoringTaskPlan({ ...input(), taskDemandProtocol: 'unknown' as never })).rejects.toThrow('generation-task-demand-protocol-invalid');
    expect(completeJson).not.toHaveBeenCalled();
  });
  it('renders fixed type/kind capacity only for new demand requests without changing the descriptor wire', async () => {
    await prepareAuthoringTaskPlan({ ...input(), taskDemandProtocol: 'task-demand-v1', requestedKind: 'numeric', requestedType: 'mcq' });
    expect(jest.mocked(completeJson).mock.calls[0][0]).toContain('Fixed type/kind capacity: {"type":"mcq","kind":"numeric"}');
    expect(jest.mocked(completeJson).mock.calls[0][0]).toContain('conceptual fallback does not fulfill it');
    jest.mocked(completeJson).mockClear();
    await prepareAuthoringTaskPlan({ ...input(), requestedKind: 'numeric', requestedType: 'mcq' });
    expect(jest.mocked(completeJson).mock.calls[0][0]).not.toContain('Fixed type/kind capacity');
  });
  it('plans honest independent supply without padding six slots or forcing Hard', async () => {
    const result = await prepareAuthoringTaskPlan(input());
    expect(result.shortfall).toBe(5); expect(result.slots).toHaveLength(1); expect(result.slots[0].descriptor.targetDifficulty).toBe('easy');
    expect(result.slots[0].slotId).toBe(`task:${runId.toHexString()}:0`); expect(completeJson).toHaveBeenCalledTimes(1);
    expect(jest.mocked(completeJson).mock.calls[0][0]).toMatch(/return only a json object/i);
    expect(jest.mocked(completeJson).mock.calls[0][0]).toContain('Being unable to fill the full count is not a reason to return zero');
    expect(jest.mocked(completeJson).mock.calls[0][0]).toContain('one recognition question does not establish that its entire learning objective is already covered');
    expect(jest.mocked(completeJson).mock.calls[0][0]).toContain('changing the context while keeping the same inference remains a variant');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ requestedCount: 6, memoryDigest: 'memory', evidencePacketId: 'packet' }));
  });
  it('rejects forged source IDs, variants and exact repeated task paths', async () => {
    jest.mocked(completeJson).mockResolvedValue({ tasks: [task, task, { ...task, passageIds: ['forged'] }, { ...task, intent: 'create-variant' }], reasons: [] });
    const result = await prepareAuthoringTaskPlan(input()); expect(result.slots).toHaveLength(1); expect(result.reasons.join(' ')).toContain('omitted');
  });
  it('does not reserve independent slots for an identical inference/path with changed example numbers', async () => {
    const calculation = { ...task, requiredInference: 'Calculate CAPM return at beta 1.2.', solutionPath: ['Substitute RF = 2.5 and premium = 4.0.', 'Calculate RF + Beta * Premium.'] };
    jest.mocked(completeJson).mockResolvedValue({ tasks: [calculation, { ...calculation, requiredInference: 'Calculate CAPM return at beta 1.8.', solutionPath: ['Substitute RF = 3.5 and premium = 5.0.', 'Calculate RF + Beta * Premium.'] }], reasons: [] });
    const result = await prepareAuthoringTaskPlan(input());
    expect(result.slots).toHaveLength(1); expect(result.shortfall).toBe(5); expect(completeJson).toHaveBeenCalledTimes(1);
  });
  it('keeps different source-supported solution paths despite shared concepts and quantities', async () => {
    jest.mocked(completeJson).mockResolvedValue({ tasks: [task, { ...task, requiredInference: 'Explain why firm-specific effects average out.', solutionPath: ['Identify positive and negative firm-specific effects.', 'Explain offsetting portfolio effects.'] }], reasons: [] });
    const result = await prepareAuthoringTaskPlan(input());
    expect(result.slots).toHaveLength(2); expect(result.shortfall).toBe(4);
    const prompt = jest.mocked(completeJson).mock.calls[0][0];
    expect(prompt).toContain('Source worked examples are teaching evidence, not previously generated Bank questions');
    expect(prompt).toContain('what the student must infer to choose the answer');
    expect(prompt).toContain('without fixing sample numerical inputs');
  });
  it('invalid planning output produces zero slots and a named reason', async () => {
    jest.mocked(completeJson).mockResolvedValue({ tasks: ['invented task'], reasons: [] });
    const result = await prepareAuthoringTaskPlan(input()); expect(result.shortfall).toBe(6); expect(result.slots).toHaveLength(0); expect(result.reasons.join(' ')).toContain('valid bounded plan');
  });
  it('keeps valid neighboring rows when malformed or out-of-scope tasks cannot be admitted', async () => {
    const second = { ...task, requiredInference: 'Explain how offsetting effects reduce firm-specific risk.', solutionPath: ['Identify positive and negative firm effects.', 'Explain averaging in a large portfolio.'] };
    jest.mocked(completeJson).mockResolvedValue({ tasks: ['malformed', { ...task, passageIds: ['E-other-course'] }, task, { ...task, requiredInference: '' }, second], reasons: [] });
    const result = await prepareAuthoringTaskPlan({ ...input(), count: 2 });
    expect(result.slots.map(slot => slot.item)).toEqual([0, 1]);
    expect(result.slots.map(slot => slot.descriptor.requiredInference)).toEqual([task.requiredInference, second.requiredInference]);
    expect(result.shortfall).toBe(0); expect(result.reasons).toEqual(expect.arrayContaining([expect.stringContaining('valid bounded plan descriptor'), expect.stringContaining('outside the supplied source scope')]));
    expect(completeJson).toHaveBeenCalledTimes(1);
  });
  it('rejects an oversized or unknown-key envelope without reading beyond the bounded task array', async () => {
    jest.mocked(completeJson).mockResolvedValueOnce({ tasks: Array.from({ length: 21 }, () => task), reasons: [] });
    const oversized = await prepareAuthoringTaskPlan(input());
    expect(oversized.slots).toHaveLength(0); expect(oversized.shortfall).toBe(6);
    jest.mocked(completeJson).mockResolvedValueOnce({ tasks: [task], reasons: [], extra: 'unbounded' });
    const unknown = await prepareAuthoringTaskPlan({ ...input(), runId: new ObjectId() });
    expect(unknown.slots).toHaveLength(0); expect(unknown.reasons.join(' ')).toContain('valid bounded plan');
    expect(completeJson).toHaveBeenCalledTimes(2);
  });
  it('discloses every malformed task in a fully bounded response and the supported shortfall', async () => {
    jest.mocked(completeJson).mockResolvedValue({ tasks: Array.from({ length: 20 }, () => ({ invented: 'invalid' })), reasons: [] });
    const result = await prepareAuthoringTaskPlan(input());
    expect(result.slots).toHaveLength(0); expect(result.reasons).toHaveLength(21);
    expect(result.reasons[19]).toContain('Planned task 20'); expect(result.reasons[20]).toContain('0 of 6'); expect(completeJson).toHaveBeenCalledTimes(1);
  });
  it('replays a durable plan without another model call', async () => {
    const first = await prepareAuthoringTaskPlan(input()); findOne.mockResolvedValue(first);
    expect(await prepareAuthoringTaskPlan(input())).toBe(first); expect(completeJson).toHaveBeenCalledTimes(1);
  });
  it('shows active course task reservations without treating them as teaching evidence', async () => {
    jest.mocked(contentRunsCol).mockReturnValue({ find: jest.fn(() => ({ sort: () => ({ limit: () => ({ toArray: async () => [{ _id: new ObjectId() }] }) }) })) } as never);
    find.mockReturnValue({ sort: () => ({ limit: () => ({ toArray: async () => [{ slots: [{ slotId: 'reserved-task', status: 'reserved', descriptor: task }] }] }) }) });
    const result = await prepareAuthoringTaskPlan(input()); expect(jest.mocked(completeJson).mock.calls[0][0]).toContain('reserved-task');
    expect(result.slots).toHaveLength(0); expect(result.reasons.join(' ')).toContain('reserved by an active course run');
  });
  it('bounds verbose active reservations and reports known omissions without comparing terminal slots', async () => {
    const activeId = new ObjectId();
    jest.mocked(contentRunsCol).mockReturnValue({ find: jest.fn(() => ({ sort: () => ({ limit: () => ({ toArray: async () => [{ _id: activeId }] }) }) })) } as never);
    const verbose = { ...task, requiredInference: 'Inference '.repeat(70), solutionPath: Array.from({ length: 8 }, () => 'Step '.repeat(70)), concepts: Array.from({ length: 8 }, () => 'Concept '.repeat(20)) };
    find.mockReturnValue({ sort: () => ({ limit: () => ({ toArray: async () => [{ slots: Array.from({ length: 25 }, (_, i) => ({ slotId: `active-${i}`, status: i === 24 ? 'withheld' : 'reserved', descriptor: verbose })) }] }) }) });
    await prepareAuthoringTaskPlan(input());
    const prompt = jest.mocked(completeJson).mock.calls[0][0];
    const active = JSON.parse(prompt.slice(prompt.indexOf('Active task reservations')).split(': ').slice(1).join(': '));
    expect(active.entries).toHaveLength(20); expect(active.omittedKnownSlots).toBe(4); expect(active.truncated).toBe(true);
    expect(active.entries.every((entry: { descriptor: unknown; contentTruncated: boolean }) => JSON.stringify(entry.descriptor).length <= 700 && entry.contentTruncated)).toBe(true);
    expect(prompt).not.toContain('active-24'); expect(completeJson).toHaveBeenCalledTimes(1);
  });
  it('releases terminal partial-run reservations before planning another run', async () => {
    await prepareAuthoringTaskPlan(input());
    expect(find).not.toHaveBeenCalled();
    expect(jest.mocked(contentRunsCol).mock.results[0].value.find).toHaveBeenCalledWith(expect.objectContaining({ status: { $in: ['queued', 'running'] } }));
  });
  it('records immutable version fingerprints without making another summary call or storing prompt data', async () => {
    await recordQuestionPedagogicalFingerprint({ courseId, questionId: new ObjectId(), versionId: new ObjectId(), familyId: new ObjectId(), model: { model: 'fixture' }, descriptor: task, embedding: [0.1, 0.2], content: { type: 'mcq', stem: 'Which risk?', options: [] } });
    const saved = fingerprint.mock.calls[0][1].$setOnInsert;
    expect(saved.policy).toBe('pedagogical-task-v2'); expect(saved.contentHash).toMatch(/^[a-f0-9]{64}$/); expect(saved.embeddingModel).toBe('fixture-embedding'); expect(saved.content).toBeUndefined(); expect(completeJson).not.toHaveBeenCalled();
  });
});
