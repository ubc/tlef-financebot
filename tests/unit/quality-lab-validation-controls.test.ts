import { selectRetainedValidationControls } from '../../scripts/quality-lab/run-validation-controls';
import { hashControl } from '../../scripts/quality-lab/protocol';

function retained() {
  const text = 'Firm actions and investor actions are different rows.';
  const candidate = { type: 'mcq', stem: 'Which action belongs to an investor?', difficulty: 'easy', numericKind: 'conceptual', paramSlots: [], derivedValues: [],
    options: [{ key: 'A', text: 'Action A', role: 'correct', explanation: 'Explanation A.' }, { key: 'B', text: 'Action B', role: 'common-misconception', explanation: 'Explanation B.' },
      { key: 'C', text: 'Action C', role: 'partially-correct', explanation: 'Explanation C.' }, { key: 'D', text: 'Action D', role: 'clearly-wrong', explanation: 'Explanation D.' }],
    taskDescriptor: { concepts: ['Actions'], requiredInference: 'Identify the actor.', solutionPath: ['Read the actor row.'], misconception: 'Swap rows.', targetDifficulty: 'easy', passageIds: ['E1'], intent: 'create-independent-task' },
    agentDecision: { decision: 'reject', reasoning: 'Historical context must not become a new teacher label.' }, sourceRefs: [] };
  const control = { name: 'investor-firm-row-negative', candidate, negativeControl: true, item: 2, packet: { id: 'packet', passages: [{ id: 'E1', materialId: 'material', chunkIndex: 0, start: 0, end: text.length, text }] },
    memory: { entries: [], snapshotDigest: 'memory' }, requirements: { intent: 'create-independent-task', preserve: [], requiredChanges: ['Keep source actor ownership.'] }, originalObservation: { runId: 'retained', item: 2 } };
  return { controls: { sourceControls: [{ material: { _id: 'material', name: 'Source' }, pdfSha256: 'pdfhash', chunks: [{ index: 0, text }] }], bankHeads: [], bankVersions: [], probes: [control] }, outcomes: [] };
}
describe('retained negative validation control preparation', () => {
  it('preserves complete semantic input and immutable source/Bank/request controls without historical decision labels', () => {
    const input = retained(); const before = hashControl(input);
    const controls = selectRetainedValidationControls(JSON.stringify(input), ['investor-firm-row-negative']);
    const probe = controls.probes[0]!;
    expect(hashControl(input)).toBe(before); expect(probe.candidate.stem).toBe(input.controls.probes[0]!.candidate.stem);
    expect(probe.candidate.options).toEqual(input.controls.probes[0]!.candidate.options);
    expect(probe.memory).toEqual(input.controls.probes[0]!.memory); expect(probe.requirements).toEqual(input.controls.probes[0]!.requirements);
    expect(probe.teacherAcceptance).toBeNull(); expect(probe.saved).toBe(false); expect(probe.candidate).not.toHaveProperty('agentDecision');
    expect(controls.limitations.join(' ')).toContain('different model/cap/protocol');
  });
  it('fails before any provider import on unknown controls or altered source coordinates', () => {
    expect(() => selectRetainedValidationControls(JSON.stringify(retained()), ['missing'])).toThrow('control-missing');
    const input = retained(); input.controls.probes[0]!.packet.passages[0]!.start = 1;
    expect(() => selectRetainedValidationControls(JSON.stringify(input), ['investor-firm-row-negative'])).toThrow('source-coordinate');
  });
});
