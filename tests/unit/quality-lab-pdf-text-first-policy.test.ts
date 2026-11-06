jest.mock('../../server/src/config/env', () => { throw new Error('The offline PDF policy test must not load environment configuration.'); });
jest.mock('../../server/src/components/genai/document-parsing', () => { throw new Error('The offline PDF policy test must not import the configured parser.'); });
jest.mock('ubc-genai-toolkit-document-parsing', () => { throw new Error('The offline PDF policy test must not load real parsing dependencies.'); });
jest.mock('ubc-genai-toolkit-chunking', () => { throw new Error('The offline PDF policy test must not load real chunking dependencies.'); });

import type { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { assertPdfPolicyRouting, assertSafePdfAuditLog, recoverPdfPolicyFacade, type PdfPolicySources } from '../../scripts/quality-lab/audit-pdf-text-first-policy';

const root = path.resolve(__dirname, '../..');
const source = (file: string) => readFileSync(path.join(root, file), 'utf8');
const repositorySources: PdfPolicySources = {
  parser: source('server/src/components/genai/document-parsing/index.ts'),
  helper: source('server/src/components/genai/document-parsing/pdf-text-first.ts'),
  readiness: source('server/src/services/source-readiness.service.ts'),
  chunking: source('server/src/components/genai/chunking/index.ts'),
};
function containsHelperCall(node: ts.Node): boolean {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'parsePdfTextNativeFirst') return true;
  return ts.forEachChild(node, containsHelperCall) ?? false;
}
function unwired(sources: PdfPolicySources): PdfPolicySources {
  const file = ts.createSourceFile('public-parser.ts', sources.parser, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const removals: Array<{ start: number; end: number }> = [];
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === './pdf-text-first') {
      removals.push({ start: statement.getFullStart(), end: statement.end });
    }
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === 'parseFile') {
      for (const branch of statement.body?.statements ?? []) {
        if (ts.isIfStatement(branch) && containsHelperCall(branch)) {
          if (!/format\s*===\s*['"]text['"]/.test(branch.expression.getText(file))) throw new Error('Unexpected installed PDF helper route.');
          removals.push({ start: branch.getFullStart(), end: branch.end });
        }
      }
    }
  }
  let parser = sources.parser;
  for (const removal of removals.sort((a, b) => b.start - a.start)) parser = parser.slice(0, removal.start) + parser.slice(removal.end);
  return { ...sources, parser, readiness: sources.readiness.replace(/text-poppler-(?:fallback-v1|first-v2)/g, 'text-poppler-fallback-v1') };
}
const current = unwired(repositorySources);
const route = `  if (format === 'text') {
    return parsePdfTextNativeFirst(filePath, {
      parseNative: parsePdfWithPdftotext,
      parseToolkit: path => parseWithToolkit(path, 'text'),
      logger,
    });
  }

`;
const boundary = '    return parseWithToolkit(filePath, format);\n  }\n\n';
function planned(): PdfPolicySources {
  if (!current.parser.includes(boundary)) throw new Error('The planned test insertion no longer matches the public non-PDF boundary.');
  return { ...current,
    parser: `import { parsePdfTextNativeFirst } from './pdf-text-first';\n${current.parser.replace(boundary, boundary + route)}`,
    readiness: current.readiness.replace('text-poppler-fallback-v1', 'text-poppler-first-v2'),
  };
}

function harness(sources = planned(), options: { nativeText?: string; nativeError?: Error; toolkitText?: string; toolkitError?: Error } = {}) {
  const calls: Array<{ stage: string; file: string; format?: string }> = [];
  const native = jest.fn((command: string, args: string[], bounds: { encoding: string; timeout: number; maxBuffer: number },
    callback: (error: Error | null, stdout: string, stderr: string) => void) => {
    expect(command).toBe('pdftotext'); expect(Array.from(args)).toEqual(['-layout', args[1], '-']);
    expect(bounds).toMatchObject({ encoding: 'utf8', timeout: 60000, maxBuffer: 50 * 1024 * 1024 });
    calls.push({ stage: 'native', file: args[1]! });
    callback(options.nativeError ?? null, options.nativeText ?? '  Native β\trow\r\n\f\n', '');
  });
  class Toolkit {
    async parse(input: { filePath: string }, format: 'text' | 'markdown') {
      calls.push({ stage: 'toolkit', file: input.filePath, format });
      if (options.toolkitError) throw options.toolkitError;
      return { content: options.toolkitText ?? `toolkit:${format}:${input.filePath}` };
    }
  }
  class Chunking { async chunkDocuments() { return { chunks: [] }; } }
  const quiet = jest.fn();
  const recovered = recoverPdfPolicyFacade(sources, { DocumentParsingModule: Toolkit, ChunkingModule: Chunking,
    execFile: native as unknown as typeof execFile, logger: { debug: quiet, info: quiet, warn: quiet, error: quiet }, parserPackageVersion: '0.2.0' });
  return { ...recovered, native, calls, logger: quiet };
}

it('refuses a deliberately unwired public facade derived from either production policy without loading configured parsing modules', async () => {
  expect(() => harness(current)).toThrow('pdf-text-first-policy-not-wired');
  await expect(assertPdfPolicyRouting(current, '0.2.0')).rejects.toThrow('pdf-text-first-policy-not-wired');
  const afterWiring = unwired(planned());
  expect(afterWiring.readiness).toBe(current.readiness);
  expect(() => harness(afterWiring)).toThrow('pdf-text-first-policy-not-wired');
});

it('requires the source manifest parser version to identify the changed policy', () => {
  expect(() => harness({ ...planned(), readiness: current.readiness })).toThrow('pdf-policy-parser-version-bump-required');
});

it('recovers the complete helper and public facade and preserves native default/text output exactly', async () => {
  const text = '\ufeff  Native β\trow\r\n\f\n  '; const { facade, selected, native, calls } = harness(planned(), { nativeText: text });
  expect(selected.map(item => item.name)).toEqual(expect.arrayContaining(['parseFile', 'parsePdfTextNativeFirst', 'PdfTextExtractionError', 'boundedText', 'hashSourceChunks', 'chunkText']));
  expect(selected.find(item => item.name === 'parseFile')?.text).toContain(route.trim());
  expect(facade.MATERIAL_PARSER_VERSION).toBe('toolkit-0.2.0:text-poppler-first-v2');
  await expect(facade.parseFile('/synthetic/original.pdf')).resolves.toBe(text);
  await expect(facade.parseFile('/synthetic/original.PDF', 'text')).resolves.toBe(text);
  expect(native).toHaveBeenCalledTimes(2); expect(calls.every(call => call.stage === 'native')).toBe(true);
  await expect(assertPdfPolicyRouting(planned(), '0.2.0')).resolves.toBeUndefined();
});

it('keeps Markdown PDFs and all supported non-PDF formats on their original toolkit route', async () => {
  const { facade, calls, native } = harness();
  await expect(facade.parseFile('/synthetic/original.pdf', 'markdown')).resolves.toBe('toolkit:markdown:/synthetic/original.pdf');
  for (const extension of ['docx', 'pptx', 'html', 'md']) {
    for (const format of ['text', 'markdown'] as const) {
      const file = `/synthetic/original.${extension}`;
      await expect(facade.parseFile(file, format)).resolves.toBe(`toolkit:${format}:${file}`);
    }
  }
  expect(native).not.toHaveBeenCalled(); expect(calls).toHaveLength(9);
  expect(calls.every(call => call.stage === 'toolkit')).toBe(true);
});

it('preserves the existing Markdown native fallback after the toolkit fails', async () => {
  const { facade, calls, logger } = harness(planned(), { toolkitError: new Error('Synthetic Markdown failure') });
  await expect(facade.parseFile('/synthetic/original.pdf', 'markdown')).resolves.toBe('  Native β\trow\r\n\f\n');
  expect(calls).toEqual([{ stage: 'toolkit', file: '/synthetic/original.pdf', format: 'markdown' }, { stage: 'native', file: '/synthetic/original.pdf' }]);
  expect(logger).toHaveBeenCalledWith('Primary PDF parser failed; falling back to pdftotext', expect.objectContaining({ filePath: '/synthetic/original.pdf' }));
});

it('rejects comments, dead branches, wrong formats and wrong adapters that merely mention the helper', async () => {
  const wired = planned();
  const invalidRoutes = [
    '// parsePdfTextNativeFirst(\n',
    route.replace("format === 'text'", 'false'),
    route.replace("format === 'text'", "format === 'markdown'"),
    route.replace('parseNative: parsePdfWithPdftotext', "parseNative: path => parseWithToolkit(path, 'text')"),
  ];
  for (const replacement of invalidRoutes) {
    await expect(assertPdfPolicyRouting({ ...wired, parser: wired.parser.replace(route, replacement) }, '0.2.0')).rejects.toThrow();
  }
});

it('rejects a facade mutation that removes the existing Markdown native fallback', async () => {
  const wired = planned(); const originalFallback = 'const text = await parsePdfWithPdftotext(filePath);';
  expect(wired.parser).toContain(originalFallback);
  const parser = wired.parser.replace(originalFallback, "throw new Error('Synthetic removed Markdown native fallback');\n    const text = ''; ");
  await expect(assertPdfPolicyRouting({ ...wired, parser }, '0.2.0')).rejects.toThrow('Synthetic removed Markdown native fallback');
});

it('refuses incomplete helper recovery rather than silently replacing its error class', () => {
  const wired = planned();
  const missingClass = wired.helper.replace('export class PdfTextExtractionError', 'export class DifferentExtractionError');
  expect(() => harness({ ...wired, helper: missingClass })).toThrow('pdf-policy-missing-declaration:PdfTextExtractionError');
  expect(() => harness({ ...wired, helper: wired.helper + '\nconst PDF_TEXT_NATIVE_TIMEOUT_MS = 1;\n' })).toThrow('pdf-policy-duplicate-declaration:PDF_TEXT_NATIVE_TIMEOUT_MS');
});

it('retains an explicit typed failure when neither recovered adapter extracts nonempty text', async () => {
  const { facade, calls } = harness(planned(), { nativeText: ' \r\n\t\f', toolkitText: ' \t\r\n' });
  await expect(facade.parseFile('/synthetic/original.pdf', 'text')).rejects.toMatchObject({ name: 'PdfTextExtractionError', code: 'pdf-text-extraction-failed',
    nativeReason: expect.stringContaining('no extractable text'), toolkitReason: expect.stringContaining('no extractable text') });
  expect(calls.map(call => call.stage)).toEqual(['native', 'toolkit']);
});

it('rejects credential-like logs while allowing public-file route and aggregate timing messages', () => {
  for (const unsafe of ['Bearer synthetic-secret', 'api_key=synthetic-value', '{"authorization":"synthetic-value"}',
    "access-token: 'synthetic-value'", 'sk-synthetic_value_123', 'mongodb://fixture:synthetic@localhost:27029', 'https://fixture:synthetic@localhost/']) {
    expect(() => assertSafePdfAuditLog(unsafe)).toThrow('pdf-policy-credential-like-log-blocked');
  }
  expect(() => assertSafePdfAuditLog('Native PDF text parser failed; filePath=/public/chapter-02.pdf reason=No extractable text')).not.toThrow();
  expect(() => assertSafePdfAuditLog('{"completedFiles":10,"observedChunks":671,"parserOnlyMs":2311.66}')).not.toThrow();
});
