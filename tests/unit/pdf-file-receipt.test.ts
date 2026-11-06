import { execFile, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parsePdfFileWithReceipt } from '../../server/src/components/genai/document-parsing/pdf-file-receipt';

jest.mock('node:child_process', () => ({ execFile: jest.fn() }));
jest.mock('../../server/src/config/env', () => { throw new Error('Receipt units must not initialize runtime configuration.'); });
jest.mock('../../server/src/components/mongodb', () => { throw new Error('Receipt units must not initialize Mongo.'); });
jest.mock('../../server/src/components/genai/llm', () => { throw new Error('Receipt units must not initialize a provider.'); });

const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const originalBytes = Buffer.from('%PDF-synthetic-original-bytes\n');
let directory: string; let original: string; let metadata = 'Pages:          2\n'; let metadataError: Error | null = null;
const snapshots: string[] = [];
function dependencies() {
  return { parseNative: jest.fn(async (file: string) => { snapshots.push(file); expect(await readFile(file)).toEqual(originalBytes); return '  Exact 😀 row\r\n\fNext row\f'; }),
    parseToolkit: jest.fn(async (_file: string, _format: 'text' | 'markdown') => 'toolkit text'),
    parseUnbound: jest.fn(async (_file: string, _format: 'text' | 'markdown') => 'unbound valid text'), toolkitVersion: '0.2.0', logger: { warn: jest.fn() } };
}
beforeEach(async () => {
  metadata = 'Pages:          2\n'; metadataError = null; snapshots.length = 0;
  directory = await mkdtemp(path.join(os.tmpdir(), 'financebot-receipt-test-'));
  original = path.join(directory, 'original.pdf'); await writeFile(original, originalBytes);
  jest.mocked(execFile).mockImplementation(((command: string, args: string[], bounds: { timeout: number; maxBuffer: number }, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
    expect(bounds).toMatchObject({ timeout: 5000, maxBuffer: 64 * 1024 });
    if (args[0] === '-v') callback(null, '', `${command} version 25.0.0\nCopyright notice\n`);
    else { expect(command).toBe('pdfinfo'); expect(args[0]).not.toBe(original); callback(metadataError, metadata, ''); }
    return {} as ChildProcess;
  }) as never);
});
afterEach(async () => { jest.mocked(execFile).mockReset(); await rm(directory, { recursive: true, force: true }); jest.useRealTimers(); });

it('binds exact immutable PDF/native bytes and independent page metadata without repeating parsing', async () => {
  const deps = dependencies();
  const result = await parsePdfFileWithReceipt(original, 'text', deps);
  expect(result.text).toBe('  Exact 😀 row\r\n\fNext row\f');
  expect(result.receipt).toMatchObject({ version: 'pdf-parse-receipt-v1', pdfSha256: sha(originalBytes), pdfBytes: originalBytes.length,
    rawTextSha256: sha(result.text), rawTextBytes: Buffer.byteLength(result.text), rawTextUtf16Length: result.text.length,
    routingPolicy: 'text-poppler-first-v2', successfulEngine: 'poppler-pdftotext', actualFormat: 'text', engineVersion: 'pdftotext version 25.0.0',
    attempts: [{ engine: 'poppler-pdftotext', outcome: 'succeeded', elapsedMs: expect.any(Number) }],
    pageCount: { status: 'verified', count: 2, engine: 'pdfinfo', engineVersion: 'pdfinfo version 25.0.0' }, pageMap: { status: 'verified' } });
  expect(deps.parseNative).toHaveBeenCalledTimes(1); expect(deps.parseToolkit).not.toHaveBeenCalled(); expect(deps.parseUnbound).not.toHaveBeenCalled();
  expect(execFile).toHaveBeenCalledTimes(3);
  await expect(access(snapshots[0])).rejects.toThrow();
});

it('keeps the tools bound to snapshot bytes even if the original path changes', async () => {
  const deps = dependencies();
  deps.parseNative.mockImplementation(async file => { snapshots.push(file); await writeFile(original, 'changed original path'); expect(await readFile(file)).toEqual(originalBytes); return 'First\fSecond\f'; });
  const result = await parsePdfFileWithReceipt(original, 'text', deps);
  expect(result.receipt?.pdfSha256).toBe(sha(originalBytes)); expect(result.receipt?.pageMap.status).toBe('verified');
});

it.each(['', 'Pages: 0\n', 'Pages: 1.5\n', 'Pages: 100001\n', 'Pages: 2\nPages: 2\n', 'Pages: 2 extra\n'])('retains valid text when independent page metadata is invalid: %j', async output => {
  metadata = output; const deps = dependencies(); const result = await parsePdfFileWithReceipt(original, 'text', deps);
  expect(result.text).toContain('Exact 😀 row'); expect(result.receipt?.pageCount.status).toBe('unavailable'); expect(result.receipt?.pageMap.status).toBe('unavailable');
  expect(deps.parseNative).toHaveBeenCalledTimes(1); expect(deps.parseToolkit).not.toHaveBeenCalled();
});

it('keeps metadata command failure optional and reports a count mismatch separately', async () => {
  metadataError = new Error('pdfinfo unavailable');
  const deps = dependencies(); const absent = await parsePdfFileWithReceipt(original, 'text', deps);
  expect(absent.receipt?.pageCount).toMatchObject({ status: 'unavailable', reason: 'pdfinfo unavailable' });
  metadataError = null; metadata = 'Pages: 3\n';
  const mismatch = await parsePdfFileWithReceipt(original, 'text', deps);
  expect(mismatch.receipt?.pageCount).toMatchObject({ status: 'verified', count: 3 });
  expect(mismatch.receipt?.pageMap).toMatchObject({ status: 'unavailable', reason: 'native-page-marker-count-mismatch' });
});

it('records actual toolkit fallback and never upgrades its form feeds into verified native pages', async () => {
  const deps = dependencies(); deps.parseNative.mockRejectedValue(new Error('native failed')); deps.parseToolkit.mockResolvedValue('Toolkit\fOther page\f');
  const result = await parsePdfFileWithReceipt(original, 'text', deps);
  expect(result.receipt).toMatchObject({ successfulEngine: 'toolkit', engineVersion: '0.2.0', actualFormat: 'text', attempts: [
    { engine: 'poppler-pdftotext', outcome: 'failed', reason: 'native failed' }, { engine: 'toolkit', outcome: 'succeeded' }],
  pageCount: { status: 'unavailable', reason: 'successful-parser-is-toolkit' }, pageMap: { status: 'unavailable', reason: 'actual-parser-is-not-native-pdftotext' } });
  expect(execFile).not.toHaveBeenCalled();
});

it('preserves Markdown toolkit-first and records native fallback as actual text', async () => {
  const deps = dependencies(); deps.parseToolkit.mockResolvedValue('# Exact markdown');
  const primary = await parsePdfFileWithReceipt(original, 'markdown', deps);
  expect(primary.text).toBe('# Exact markdown'); expect(primary.receipt).toMatchObject({ successfulEngine: 'toolkit', actualFormat: 'markdown', routingPolicy: 'markdown-toolkit-first-v1' });
  expect(deps.parseNative).not.toHaveBeenCalled(); expect(execFile).not.toHaveBeenCalled();
  deps.parseToolkit.mockRejectedValue(new Error('markdown failed'));
  const fallback = await parsePdfFileWithReceipt(original, 'markdown', deps);
  expect(fallback.receipt).toMatchObject({ requestedFormat: 'markdown', actualFormat: 'text', successfulEngine: 'poppler-pdftotext', attempts: [
    { engine: 'toolkit', outcome: 'failed' }, { engine: 'poppler-pdftotext', outcome: 'succeeded' }], pageMap: { status: 'verified' } });
});

it('uses valid unbound output without an invented receipt if an immutable snapshot cannot be created', async () => {
  const deps = dependencies(); const missing = path.join(directory, 'missing.pdf');
  await expect(parsePdfFileWithReceipt(missing, 'text', deps)).resolves.toEqual({ text: 'unbound valid text' });
  expect(deps.parseUnbound).toHaveBeenCalledWith(missing, 'text'); expect(deps.parseNative).not.toHaveBeenCalled(); expect(execFile).not.toHaveBeenCalled();
});

it('cleans up the private snapshot when both parsers fail without claiming a successful receipt', async () => {
  const deps = dependencies();
  deps.parseNative.mockImplementation(async file => { snapshots.push(file); throw new Error('native failed'); });
  deps.parseToolkit.mockRejectedValue(new Error('toolkit failed'));
  await expect(parsePdfFileWithReceipt(original, 'text', deps)).rejects.toMatchObject({ code: 'pdf-text-extraction-failed' });
  await expect(access(snapshots[0])).rejects.toThrow(); expect(execFile).not.toHaveBeenCalled();
});
