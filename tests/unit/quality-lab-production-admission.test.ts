import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { GeneratorOutput } from '../../server/src/services/generation.service';
import { loadPrivateAdmissionGates, structuralAdmissionIssues } from '../../scripts/quality-lab/production-admission';
import { parseLabCandidate } from '../../scripts/quality-lab/candidate';

const source = readFileSync(path.join(__dirname, '../../server/src/services/generation.service.ts'), 'utf8');
const { gates, identities } = loadPrivateAdmissionGates(source);
const candidate: GeneratorOutput = { stem: 'What remains after diversification?', difficulty: 'easy', numericKind: 'conceptual', paramSlots: [], derivedValues: [],
  options: [{ key: 'A', text: 'Market risk', role: 'correct', explanation: 'The source says market risk remains.' },
    { key: 'B', text: 'No risk', role: 'common-misconception', explanation: 'Market risk remains.' },
    { key: 'C', text: 'Only one firm’s risk', role: 'partially-correct', explanation: 'Firm-specific risk is diversified.' },
    { key: 'D', text: 'All firm-specific risk', role: 'clearly-wrong', explanation: 'The reduction concerns firm-specific risk.' }],
  taskDescriptor: { concepts: ['Risk'], requiredInference: 'Identify remaining risk.', solutionPath: ['Apply the source.'], misconception: 'No risk remains.', targetDifficulty: 'easy', passageIds: ['E1'], intent: 'create-independent-task' } };
describe('offline reconciliation against exact private production gate source', () => {
  it('extracts and hashes only the five private gates plus their trusted role constant', () => {
    expect(identities.map(identity => identity.name).sort()).toEqual(['OPTION_ROLES', 'optionShapeValid', 'errorModelsNameMistakes', 'hardnessMoveDeclared', 'trueFalseShapeValid', 'kindContractMet'].sort());
    expect(identities.every(identity => /^[a-f0-9]{64}$/.test(identity.sha256))).toBe(true);
    expect(() => loadPrivateAdmissionGates('function unrelated() { return true; }')).toThrow('source-missing');
  });
  it('checks requested kind and hard-move declaration independently of semantic eligibility', () => {
    expect(structuralAdmissionIssues(gates, { type: 'mcq', kind: 'conceptual', difficulty: 'easy' }, candidate)).toEqual([]);
    expect(structuralAdmissionIssues(gates, { type: 'mcq', kind: 'calculation', difficulty: 'hard' }, candidate)).toEqual(['requested-hardness-move-not-declared', 'requested-question-kind-not-met']);
  });
  it('distinguishes the lab’s stricter misconception count from production shape validity', () => {
    const extra = structuredClone(candidate); extra.options[2]!.role = 'common-misconception';
    expect(gates.optionShapeValid('mcq', extra.options)).toBe(true);
    expect(() => parseLabCandidate(extra, 'mcq')).toThrow('option-contract');
  });
  it('detects role-only error models and malformed numerical definitions without dropping other slots', () => {
    const wrong = { ...candidate, derivedValues: [{ name: 'WRONG', formula: '1', errorModel: 'common-misconception' }] };
    expect(structuralAdmissionIssues(gates, { type: 'mcq', kind: 'conceptual', difficulty: 'easy' }, wrong)).toContain('error-model-is-only-an-option-role');
    const malformed = { ...candidate, derivedValues: 123 } as unknown as GeneratorOutput;
    expect(structuralAdmissionIssues(gates, { type: 'mcq', kind: 'conceptual', difficulty: 'easy' }, malformed)).toContain('error-model-is-only-an-option-role:production-check-threw');
  });
});
