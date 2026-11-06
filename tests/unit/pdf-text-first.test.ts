jest.mock('../../server/src/components/genai/document-parsing', () => { throw new Error('The pure PDF helper test must not import the configured parser.'); });

import { parsePdfTextNativeFirst, PdfTextExtractionError, PDF_TEXT_MAX_OUTPUT_BYTES, PDF_TEXT_NATIVE_TIMEOUT_MS,
  PDF_TEXT_TOOLKIT_TIMEOUT_MS } from '../../server/src/components/genai/document-parsing/pdf-text-first';

const file = '/synthetic/original lecture.pdf';
const dependencies = () => ({ parseNative: jest.fn(async (_path: string) => 'Exact native text'),
  parseToolkit: jest.fn(async (_path: string) => 'Exact toolkit text'), logger: { warn: jest.fn() } });
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const observe = (promise: Promise<string>) => promise.then(value => ({ value, error: null }), error => ({ value: null, error: error as unknown }));

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

it('returns successful native text byte-for-byte without starting the toolkit or leaving a timeout', async () => {
  const deps = dependencies(); const text = '\ufeff  First row\tvalue\r\nSecond row\u00a0β = 1.20\n\f\n  ';
  deps.parseNative.mockResolvedValue(text);
  await expect(parsePdfTextNativeFirst(file, deps)).resolves.toBe(text);
  expect(deps.parseNative).toHaveBeenCalledWith(file); expect(deps.parseToolkit).not.toHaveBeenCalled();
  expect(deps.logger.warn).not.toHaveBeenCalled(); expect(jest.getTimerCount()).toBe(0);
});

it.each(['ENOENT: pdftotext absent', 'Corrupt PDF: pdftotext exited 1', 'Native process terminated'])('uses the toolkit after an explicit native failure: %s', async reason => {
  const deps = dependencies(); deps.parseNative.mockRejectedValue(new Error(reason));
  await expect(parsePdfTextNativeFirst(file, deps)).resolves.toBe('Exact toolkit text');
  expect(deps.parseToolkit).toHaveBeenCalledTimes(1); expect(deps.parseToolkit).toHaveBeenCalledWith(file);
  expect(deps.logger.warn).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
});

it('falls back on whitespace-only native output rather than treating an image-only PDF as extracted text', async () => {
  const deps = dependencies(); deps.parseNative.mockResolvedValue(' \r\n\t\f\u00a0 ');
  await expect(parsePdfTextNativeFirst(file, deps)).resolves.toBe('Exact toolkit text');
  expect(deps.parseToolkit).toHaveBeenCalledTimes(1); expect(deps.logger.warn).toHaveBeenCalledTimes(1);
});

it('bounds a hung native stage at 60 seconds and then starts the independent toolkit fallback', async () => {
  const deps = dependencies(); deps.parseNative.mockReturnValue(new Promise(() => undefined));
  let settled = false; const outcome = observe(parsePdfTextNativeFirst(file, deps)).then(value => { settled = true; return value; });
  expect(PDF_TEXT_NATIVE_TIMEOUT_MS).toBe(60000);
  await jest.advanceTimersByTimeAsync(PDF_TEXT_NATIVE_TIMEOUT_MS - 1);
  expect(settled).toBe(false); expect(deps.parseToolkit).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1);
  expect(await outcome).toEqual({ value: 'Exact toolkit text', error: null });
  expect(deps.parseToolkit).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
});

it('bounds a hung toolkit fallback at 15 seconds and retains both failure reasons', async () => {
  const deps = dependencies(); deps.parseNative.mockRejectedValue(new Error('Native executable unavailable'));
  deps.parseToolkit.mockReturnValue(new Promise(() => undefined));
  let settled = false; const outcome = observe(parsePdfTextNativeFirst(file, deps)).then(value => { settled = true; return value; });
  await jest.advanceTimersByTimeAsync(0); expect(deps.parseToolkit).toHaveBeenCalledTimes(1);
  expect(PDF_TEXT_TOOLKIT_TIMEOUT_MS).toBe(15000);
  await jest.advanceTimersByTimeAsync(PDF_TEXT_TOOLKIT_TIMEOUT_MS - 1); expect(settled).toBe(false);
  await jest.advanceTimersByTimeAsync(1); const result = await outcome;
  expect(result.value).toBeNull(); expect(result.error).toBeInstanceOf(PdfTextExtractionError);
  expect(result.error).toMatchObject({ code: 'pdf-text-extraction-failed', nativeReason: expect.stringContaining('Native executable unavailable'),
    toolkitReason: expect.stringMatching(/timed?\s*out|timeout/i) });
  expect(jest.getTimerCount()).toBe(0);
});

it('rejects two adapters that never settle within the combined 75-second bound', async () => {
  const deps = dependencies(); deps.parseNative.mockReturnValue(new Promise(() => undefined));
  deps.parseToolkit.mockReturnValue(new Promise(() => undefined));
  let settled = false; const outcome = observe(parsePdfTextNativeFirst(file, deps)).then(value => { settled = true; return value; });
  await jest.advanceTimersByTimeAsync(PDF_TEXT_NATIVE_TIMEOUT_MS);
  expect(deps.parseToolkit).toHaveBeenCalledTimes(1); expect(settled).toBe(false);
  await jest.advanceTimersByTimeAsync(PDF_TEXT_TOOLKIT_TIMEOUT_MS - 1); expect(settled).toBe(false);
  await jest.advanceTimersByTimeAsync(1); const result = await outcome;
  expect(result.value).toBeNull(); expect(result.error).toBeInstanceOf(PdfTextExtractionError);
  expect(result.error).toMatchObject({ code: 'pdf-text-extraction-failed', nativeReason: expect.stringMatching(/timed?\s*out.*60000|timeout.*60000/i),
    toolkitReason: expect.stringMatching(/timed?\s*out.*15000|timeout.*15000/i) });
  expect(deps.parseNative).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
});

it('continues to a valid toolkit fallback when the injected warning logger throws', async () => {
  const deps = dependencies(); deps.parseNative.mockRejectedValue(new Error('Native executable unavailable'));
  deps.logger.warn.mockImplementation(() => { throw new Error('Warning sink unavailable'); });
  await expect(parsePdfTextNativeFirst(file, deps)).resolves.toBe('Exact toolkit text');
  expect(deps.logger.warn).toHaveBeenCalledTimes(1); expect(deps.parseToolkit).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

it('reports both failed stages explicitly instead of returning a successful empty source', async () => {
  const deps = dependencies(); deps.parseNative.mockRejectedValue(new Error('Native rejected corrupt input'));
  deps.parseToolkit.mockRejectedValue(new Error('Toolkit could not parse the PDF'));
  const result = await observe(parsePdfTextNativeFirst(file, deps));
  expect(result.error).toBeInstanceOf(PdfTextExtractionError);
  expect(result.error).toMatchObject({ code: 'pdf-text-extraction-failed', nativeReason: expect.stringContaining('Native rejected corrupt input'),
    toolkitReason: expect.stringContaining('Toolkit could not parse the PDF') });
  expect(result.value).toBeNull(); expect(jest.getTimerCount()).toBe(0);
});

it('rejects empty output from both stages with distinct native and toolkit diagnostics', async () => {
  const deps = dependencies(); deps.parseNative.mockResolvedValue(' \n'); deps.parseToolkit.mockResolvedValue('\t\r\n');
  const result = await observe(parsePdfTextNativeFirst(file, deps));
  expect(result.error).toBeInstanceOf(PdfTextExtractionError);
  expect(result.error).toMatchObject({ code: 'pdf-text-extraction-failed', nativeReason: expect.stringMatching(/empty|blank|no.*text/i),
    toolkitReason: expect.stringMatching(/empty|blank|no.*text/i) });
});

it('treats unexpected non-string adapter results as failures at either stage', async () => {
  const native = dependencies(); native.parseNative.mockResolvedValue(42 as unknown as string);
  await expect(parsePdfTextNativeFirst(file, native)).resolves.toBe('Exact toolkit text');
  expect(native.parseToolkit).toHaveBeenCalledTimes(1);
  const toolkit = dependencies(); toolkit.parseNative.mockRejectedValue(new Error('Native unavailable'));
  toolkit.parseToolkit.mockResolvedValue(undefined as unknown as string);
  const result = await observe(parsePdfTextNativeFirst(file, toolkit));
  expect(result.error).toBeInstanceOf(PdfTextExtractionError);
  expect(result.error).toMatchObject({ nativeReason: expect.stringContaining('Native unavailable'), toolkitReason: expect.stringMatching(/empty|blank|no.*text/i) });
  expect(jest.getTimerCount()).toBe(0);
});

it('preserves successful fallback whitespace, Unicode, row boundaries and trailing bytes', async () => {
  const deps = dependencies(); const text = '  Actor\tFormula\r\nInvestor\tR = α + β × M\n\f\n\u00a0';
  deps.parseNative.mockRejectedValue(new Error('Native cannot read this file')); deps.parseToolkit.mockResolvedValue(text);
  const parsed = await parsePdfTextNativeFirst(file, deps);
  expect(parsed).toBe(text); expect(Buffer.from(parsed, 'utf8')).toEqual(Buffer.from(text, 'utf8'));
  expect(jest.getTimerCount()).toBe(0);
});

it('accepts the exact 50 MiB UTF-8 output boundary without truncation', async () => {
  const deps = dependencies(); expect(PDF_TEXT_MAX_OUTPUT_BYTES).toBe(50 * 1024 * 1024);
  const text = 'x'.repeat(PDF_TEXT_MAX_OUTPUT_BYTES); deps.parseNative.mockResolvedValue(text);
  const parsed = await parsePdfTextNativeFirst(file, deps);
  expect(parsed === text).toBe(true); expect(Buffer.byteLength(parsed, 'utf8')).toBe(PDF_TEXT_MAX_OUTPUT_BYTES);
  expect(deps.parseToolkit).not.toHaveBeenCalled(); expect(jest.getTimerCount()).toBe(0);
});

it('measures the native cap in UTF-8 bytes and falls back instead of clipping oversized Unicode text', async () => {
  const deps = dependencies(); const text = 'é'.repeat(PDF_TEXT_MAX_OUTPUT_BYTES / 2) + 'x';
  expect(text.length).toBeLessThan(PDF_TEXT_MAX_OUTPUT_BYTES); expect(Buffer.byteLength(text, 'utf8')).toBe(PDF_TEXT_MAX_OUTPUT_BYTES + 1);
  deps.parseNative.mockResolvedValue(text);
  await expect(parsePdfTextNativeFirst(file, deps)).resolves.toBe('Exact toolkit text');
  expect(deps.parseToolkit).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
});

it('enforces the same byte cap on fallback output and preserves the native failure reason', async () => {
  const deps = dependencies(); deps.parseNative.mockRejectedValue(new Error('Native failed before fallback'));
  deps.parseToolkit.mockResolvedValue('x'.repeat(PDF_TEXT_MAX_OUTPUT_BYTES + 1));
  const result = await observe(parsePdfTextNativeFirst(file, deps));
  expect(result.error).toBeInstanceOf(PdfTextExtractionError);
  expect(result.error).toMatchObject({ code: 'pdf-text-extraction-failed', nativeReason: expect.stringContaining('Native failed before fallback'),
    toolkitReason: expect.stringMatching(/large|limit|bytes|cap/i) });
  expect(jest.getTimerCount()).toBe(0);
});

it('handles a synchronously throwing injected native parser and clears its timer before fallback', async () => {
  const deps = dependencies(); deps.parseNative.mockImplementation(() => { throw new Error('Synchronous native failure'); });
  await expect(parsePdfTextNativeFirst(file, deps)).resolves.toBe('Exact toolkit text');
  expect(deps.parseToolkit).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
});

it('keeps the selected fallback result when the timed-out native promise rejects late', async () => {
  const deps = dependencies(); const native = deferred<string>(); deps.parseNative.mockReturnValue(native.promise);
  const outcome = observe(parsePdfTextNativeFirst(file, deps));
  await jest.advanceTimersByTimeAsync(PDF_TEXT_NATIVE_TIMEOUT_MS);
  expect(await outcome).toEqual({ value: 'Exact toolkit text', error: null });
  native.reject(new Error('Late native rejection after timeout')); await jest.advanceTimersByTimeAsync(0);
  expect(await outcome).toEqual({ value: 'Exact toolkit text', error: null });
  expect(deps.parseToolkit).toHaveBeenCalledTimes(1); expect(deps.logger.warn).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
});

it('records selected attempts after bounded settlement and ignores a late native success', async () => {
  const deps = dependencies(); const native = deferred<string>(); const onAttempt = jest.fn();
  deps.parseNative.mockReturnValue(native.promise);
  const outcome = parsePdfTextNativeFirst(file, { ...deps, onAttempt });
  await jest.advanceTimersByTimeAsync(PDF_TEXT_NATIVE_TIMEOUT_MS);
  await expect(outcome).resolves.toBe('Exact toolkit text');
  expect(onAttempt.mock.calls.map(([attempt]) => [attempt.engine, attempt.outcome])).toEqual([['poppler-pdftotext', 'failed'], ['toolkit', 'succeeded']]);
  native.resolve('Late native text'); await jest.advanceTimersByTimeAsync(0);
  expect(onAttempt).toHaveBeenCalledTimes(2);
});

it('keeps valid native text when an advisory attempt observer throws', async () => {
  const deps = dependencies();
  await expect(parsePdfTextNativeFirst(file, { ...deps, onAttempt: () => { throw new Error('Receipt observer failed'); } })).resolves.toBe('Exact native text');
  expect(deps.parseToolkit).not.toHaveBeenCalled(); expect(jest.getTimerCount()).toBe(0);
});
