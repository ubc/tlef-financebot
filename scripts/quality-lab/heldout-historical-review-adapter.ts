/** Pure prompt compatibility guard. No provider, environment or archived code execution. */
import assert from 'node:assert/strict';
import ts from 'typescript';
import { sha256, type JsonCompletion } from './protocol';

interface Issue { path: string; code: string }
export interface FrozenCorrectionContract { version: 1; prefix: string; suffix: string; prefixSha256: string; suffixSha256: string;
  historicalTemplateSha256: string; currentTemplateSha256: string; historicalAssessorSha256: string; currentAssessorSha256: string;
  historicalModuleStatementsSha256: string; restoredModuleStatementsSha256: string; statementCount: number }
/** Inspect trusted repository syntax; never execute historical/model text. */
export function extractFrozenCorrectionContract(historical: string, current: string): FrozenCorrectionContract {
  const extract = (source: string) => {
    const ast = ts.createSourceFile('trusted-quality.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const f = ast.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'assessGenerationQuality'); assert(f);
    const templates: ts.TemplateExpression[] = [];
    const walk = (node: ts.Node) => { if (ts.isTemplateExpression(node) && node.getText(ast).includes('SAME-CANDIDATE REVIEW CORRECTION:')) templates.push(node); ts.forEachChild(node, walk); };
    walk(f); assert.equal(templates.length, 1); return { ast, f, template: templates[0] };
  };
  const a = extract(historical), b = extract(current); const old = a.f.getText(a.ast), now = b.f.getText(b.ast);
  const extra = '\\n${reviewCorrectionInstructions(finalIssues)}';
  assert.equal(now.split(extra).length, 2); assert.equal(now.replace(extra, ''), old, 'Any other assessor change needs a separate cohort.');
  const oldStatements = a.ast.statements.map(node => node.getText(a.ast));
  const helper = b.ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === 'reviewCorrectionInstructions');
  assert.equal(helper.length, 1, 'Exactly one named current-only helper is allowed.');
  const restoredStatements = b.ast.statements.filter(node => node !== helper[0]).map(node => node === b.f ? old : node.getText(b.ast));
  assert.deepEqual(restoredStatements, oldStatements, 'Constants, imports, other helpers or module statements changed; use a separate cohort.');
  assert.equal(a.template.head.text, ''); assert.equal(b.template.head.text, '');
  assert.equal(a.template.templateSpans.length, 2); assert.equal(b.template.templateSpans.length, 3);
  const expressions = (row: typeof a) => row.template.templateSpans.map(span => span.expression.getText(row.ast));
  assert.deepEqual(expressions(a), ['prompt', 'JSON.stringify(finalIssues)']);
  assert.deepEqual(expressions(b), ['prompt', 'JSON.stringify(finalIssues)', 'reviewCorrectionInstructions(finalIssues)']);
  const prefix = a.template.templateSpans[0].literal.text, suffix = a.template.templateSpans[1].literal.text;
  assert.equal(b.template.templateSpans[0].literal.text, prefix); assert.equal(b.template.templateSpans[1].literal.text, suffix + '\n');
  assert.equal(b.template.templateSpans[2].literal.text, ''); assert(prefix && suffix);
  return { version: 1, prefix, suffix, prefixSha256: sha256(prefix), suffixSha256: sha256(suffix), historicalTemplateSha256: sha256(a.template.getText(a.ast)),
    currentTemplateSha256: sha256(b.template.getText(b.ast)), historicalAssessorSha256: sha256(old), currentAssessorSha256: sha256(now),
    historicalModuleStatementsSha256: sha256(JSON.stringify(oldStatements)), restoredModuleStatementsSha256: sha256(JSON.stringify(restoredStatements)), statementCount: oldStatements.length };
}
/** Reconstruct the exact archived prompt; no broad replace or verdict changes.
 * The caller must hash-guard both source files and the initial renderer/helpers. */
export function restoreHistoricalReviewPrompt(prompt: string, initial: string, contract: FrozenCorrectionContract,
  guidance: (issues: Issue[]) => string): { prompt: string; restored: boolean; currentSha256: string; historicalSha256: string } {
  assert.equal(contract.version, 1); assert.equal(sha256(contract.prefix), contract.prefixSha256); assert.equal(sha256(contract.suffix), contract.suffixSha256);
  assert.equal(contract.historicalModuleStatementsSha256, contract.restoredModuleStatementsSha256);
  const result = (value: string, restored: boolean) => ({ prompt: value, restored, currentSha256: sha256(prompt), historicalSha256: sha256(value) });
  if (prompt === initial) return result(prompt, false);
  const start = initial + contract.prefix; assert(prompt.startsWith(start), 'Initial prompt or correction prefix drift.');
  const tail = prompt.slice(start.length); const split = tail.indexOf(contract.suffix); assert(split > 0);
  assert.equal(tail.lastIndexOf(contract.suffix), split, 'Ambiguous correction boundary.');
  const raw = tail.slice(0, split); const issues: unknown = JSON.parse(raw); assert(Array.isArray(issues) && issues.length > 0 && issues.length <= 30);
  assert(issues.every(issue => issue && typeof issue === 'object' && Object.keys(issue).sort().join(',') === 'code,path' &&
    typeof issue.path === 'string' && typeof issue.code === 'string' && issue.path.length <= 300 && issue.code.length <= 150));
  assert.equal(JSON.stringify(issues), raw, 'Issue payload was transformed.');
  const appended = guidance(issues as Issue[]); assert.equal(prompt, start + raw + contract.suffix + '\n' + appended, 'Unexpected guidance suffix.');
  return result(start + raw + contract.suffix, true);
}
export function frozenReviewCompletion(complete: JsonCompletion, initial: string, contract: FrozenCorrectionContract,
  guidance: (issues: Issue[]) => string, record: (mapping: ReturnType<typeof restoreHistoricalReviewPrompt>) => void = () => undefined): JsonCompletion {
  let calls = 0;
  return <T>(prompt: string, options?: Parameters<JsonCompletion>[1]): Promise<T> => {
    assert(calls < 2, 'Frozen same-candidate protocol permits at most two logical completions.');
    if (calls === 0) assert.equal(prompt, initial); else assert.notEqual(prompt, initial, 'Do not repeat initial review.');
    const mapping = restoreHistoricalReviewPrompt(prompt, initial, contract, guidance); calls++; record(mapping);
    return complete<T>(mapping.prompt, options); // Native model/options/transport hooks remain untouched.
  };
}
