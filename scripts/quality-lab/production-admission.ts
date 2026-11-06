import ts from 'typescript';
import vm from 'node:vm';
import type { GeneratorOutput } from '../../server/src/services/generation.service';
import type { Difficulty, QuestionKind, QuestionType } from '../../server/src/types/domain';
import { sha256 } from './protocol';

const PRIVATE_GATES = ['optionShapeValid', 'errorModelsNameMistakes', 'hardnessMoveDeclared', 'trueFalseShapeValid', 'kindContractMet'] as const;
export interface PrivateAdmissionGates {
  optionShapeValid(type: QuestionType, options: unknown): boolean;
  errorModelsNameMistakes(candidate: GeneratorOutput): boolean;
  hardnessMoveDeclared(difficulty: Difficulty | undefined, candidate: GeneratorOutput): boolean;
  trueFalseShapeValid(type: QuestionType, candidate: GeneratorOutput): boolean;
  kindContractMet(kind: QuestionKind | undefined, candidate: GeneratorOutput): boolean;
}
/** Execute ONLY named, trusted repository gate declarations, never model code.
 * Extracting the frozen production source avoids copying five private policies
 * or editing a service while a paid comparison is live. */
export function loadPrivateAdmissionGates(source: string): { gates: PrivateAdmissionGates; identities: Array<{ name: string; sha256: string }> } {
  const parsed = ts.createSourceFile('generation.service.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declarations = new Map<string, string>();
  for (const statement of parsed.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && (PRIVATE_GATES as readonly string[]).includes(statement.name.text)) declarations.set(statement.name.text, statement.getText(parsed));
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === 'OPTION_ROLES') declarations.set('OPTION_ROLES', `const ${declaration.getText(parsed)};`);
    }
  }
  for (const name of ['OPTION_ROLES', ...PRIVATE_GATES]) if (!declarations.has(name)) throw new Error(`quality-lab-production-gate-source-missing:${name}`);
  const text = `${[...declarations.values()].join('\n')}\n({${PRIVATE_GATES.join(',')}});`;
  const compiled = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, strict: true } }).outputText;
  const gates = vm.runInNewContext(compiled, Object.create(null), { timeout: 1000 }) as PrivateAdmissionGates;
  for (const name of PRIVATE_GATES) if (typeof gates[name] !== 'function') throw new Error('quality-lab-production-gate-extraction-invalid');
  return { gates, identities: [...declarations].map(([name, declaration]) => ({ name, sha256: sha256(declaration) })) };
}

export function structuralAdmissionIssues(gates: PrivateAdmissionGates, request: { type: QuestionType; kind: QuestionKind; difficulty: Difficulty }, candidate: GeneratorOutput): string[] {
  const issues: string[] = [];
  const check = (code: string, work: () => boolean) => { try { if (!work()) issues.push(code); } catch { issues.push(`${code}:production-check-threw`); } };
  check('option-shape-invalid', () => gates.optionShapeValid(request.type, candidate.options));
  check('error-model-is-only-an-option-role', () => gates.errorModelsNameMistakes(candidate));
  check('requested-hardness-move-not-declared', () => gates.hardnessMoveDeclared(request.difficulty, candidate));
  check('true-false-shape-invalid', () => gates.trueFalseShapeValid(request.type, candidate));
  check('requested-question-kind-not-met', () => gates.kindContractMet(request.kind, candidate));
  return issues;
}
