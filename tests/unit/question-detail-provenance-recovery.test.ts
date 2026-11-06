import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

/** Exercise the actual editor functions with synthetic retained state, without
 * importing the browser app, mounting a DOM or issuing an HTTP request. */
function declarations(relative: string, names: string[]): string {
  const file = ts.createSourceFile(relative, readFileSync(path.resolve(__dirname, '../..', relative), 'utf8'), ts.ScriptTarget.Latest, true);
  return names.map(name => {
    const found: ts.Node[] = [];
    const visit = (node: ts.Node) => {
      if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name?.text === name) found.push(node);
      ts.forEachChild(node, visit);
    };
    visit(file);
    if (found.length !== 1) throw new Error(`Expected one actual production declaration: ${name}`);
    return found[0].getText(file);
  }).join('\n');
}
const production = declarations('client/src/api.ts', ['ApiError']) + '\n' + declarations('client/src/views/instructor/question-detail.ts',
  ['regenerationPrerequisiteFailure', 'clearRegenerationRecovery', 'replaceWithVariant']);

function harness() {
  const key = 'financebot:regeneration:actor:course:question';
  const storage = new Map([[key, 'candidate'], [`${key}:pending`, 'request'], ['another-question', 'preserve']]);
  const variant = { stem: 'Retained candidate text', difficulty: 'easy', options: [{ key: 'A', text: 'True' }] };
  const candidate = { candidateId: 'candidate', quality: { citations: [{ quote: 'Exact retained source', sourceLocation: { status: 'verified' } }] } };
  const editor = { stem: 'Retained editor text' };
  const adopt = jest.fn(); const applySaved = jest.fn(() => { editor.stem = 'Changed by adoption'; });
  const exports: {
    apiError: (message: string, status: number) => Error;
    classify: (error: unknown) => string | undefined;
    replace: () => Promise<void>;
    state: () => { variant: typeof variant; candidate: typeof candidate; request: unknown; block: string | null; error: string | null; busy: boolean };
  } = {} as never;
  const source = production + `
    let regenerationVariant = seedVariant, regenerationCandidate = seedCandidate;
    let regenerationRequest = { key: 'retained-request', id: 'same-uuid' };
    let regenerationReplacementBlock = null, regenerationError = null, regenerationMessage = null;
    let regenerationBusy = false, regenerationBusyAction = null;
    const courseId = 'course', questionId = 'question', expectedVersionId = 'version';
    const regenerationStorageKey = storageKey;
    const saveButton = { disabled: true };
    exports.apiError = (message, status) => new ApiError(message, status);
    exports.classify = regenerationPrerequisiteFailure;
    exports.replace = replaceWithVariant;
    exports.state = () => ({ variant: regenerationVariant, candidate: regenerationCandidate, request: regenerationRequest,
      block: regenerationReplacementBlock, error: regenerationError, busy: regenerationBusy });
  `;
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, seedVariant: variant, seedCandidate: candidate, storageKey: key,
      sessionStorage: { removeItem: (name: string) => storage.delete(name) }, adoptRegenerationCandidate: adopt,
      editQuestion: jest.fn(() => { throw new Error('Checked candidates must use explicit adoption.'); }), applySavedVersion: applySaved,
      renderRegenerationPanel: jest.fn() });
  return { ...exports, adopt, applySaved, storage, key, variant, candidate, editor };
}

describe('retained PDF provenance candidate recovery in the actual editor control flow', () => {
  it.each([
    ['generation-evidence-provenance-changed', 409, 'PDF source and page evidence'],
    ['generation-evidence-schema-invalid', 422, 'source evidence format'],
    ['authoring-exact-bank-duplicate', 409, 'same question content'],
    ['generation-exact-bank-receipt-invalid', 422, 'no longer eligible'],
  ])('blocks stale replacement but retains previews, evidence and editor after %s', async (code, status, wording) => {
    const view = harness(); view.adopt.mockRejectedValue(view.apiError(String(code), Number(status)));
    await view.replace();
    expect(view.state()).toMatchObject({ block: expect.stringContaining(wording), error: expect.stringContaining(wording), busy: false });
    expect(view.state().variant).toBe(view.variant); expect(view.state().candidate).toBe(view.candidate);
    expect(view.candidate.quality.citations[0].quote).toBe('Exact retained source');
    expect(view.editor.stem).toBe('Retained editor text'); expect(view.applySaved).not.toHaveBeenCalled();
    expect(view.state().request).toBeUndefined();
    expect(view.storage.has(view.key)).toBe(false); expect(view.storage.has(`${view.key}:pending`)).toBe(false);
    expect(view.storage.get('another-question')).toBe('preserve');
    await view.replace(); expect(view.adopt).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['generation-evidence-provenance-changed', 500], ['generation-evidence-schema-invalid', 500],
    ['generation-evidence-provenance-changed-unrecognized-suffix', 409], ['generation-evidence-schema-invalid-unrecognized-suffix', 422],
    ['unexpected-storage-failure', 500],
  ])('retains same-candidate replay for an uncertain response %s/%s', async (code, status) => {
    const view = harness(); view.adopt.mockRejectedValue(view.apiError(code, status));
    await view.replace();
    expect(view.state().block).toBeNull(); expect(view.state().request).toEqual({ key: 'retained-request', id: 'same-uuid' });
    expect(view.storage.has(view.key)).toBe(true); expect(view.storage.has(`${view.key}:pending`)).toBe(true);
    expect(view.state().candidate).toBe(view.candidate); expect(view.state().variant).toBe(view.variant);
    expect(view.applySaved).not.toHaveBeenCalled();
    await view.replace(); expect(view.adopt).toHaveBeenCalledTimes(2);
    expect(view.adopt.mock.calls[0]).toEqual(view.adopt.mock.calls[1]);
  });

  it('retains same-candidate retry when the exact Bank scan is temporarily incomplete', async () => {
    const view = harness(); view.adopt.mockRejectedValue(view.apiError('authoring-exact-bank-incomplete', 503));
    await view.replace();
    expect(view.state()).toMatchObject({ block: null, error: expect.stringContaining('Your candidate is retained') });
    expect(view.storage.has(view.key)).toBe(true); expect(view.state().request).toBeDefined();
    await view.replace(); expect(view.adopt).toHaveBeenCalledTimes(2);
    expect(view.adopt.mock.calls[0]).toEqual(view.adopt.mock.calls[1]);
  });

  it('does not classify a network error as a confirmed unusable candidate', async () => {
    const view = harness(); view.adopt.mockRejectedValue(new Error('Network unavailable'));
    await view.replace(); expect(view.state().block).toBeNull(); expect(view.state().request).toBeDefined();
    expect(view.storage.has(view.key)).toBe(true); expect(view.applySaved).not.toHaveBeenCalled();
    expect(view.classify(new Error('generation-evidence-provenance-changed'))).toBeUndefined();
  });
});
