import type { ChildProcess } from 'node:child_process';
import { execFile } from 'node:child_process';
import { parseFile, parser } from '../../server/src/components/genai/document-parsing';
import { PdfTextExtractionError } from '../../server/src/components/genai/document-parsing/pdf-text-first';

jest.mock('node:child_process', () => ({ execFile: jest.fn() }));
jest.mock('ubc-genai-toolkit-document-parsing', () => ({ DocumentParsingModule: jest.fn(() => ({ parse: jest.fn() })) }));
jest.mock('../../server/src/components/genai/logger', () => ({ createGenaiLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) }));
jest.mock('../../server/src/config/env', () => { throw new Error('Parser facade units must not initialize runtime configuration.'); });
jest.mock('../../server/src/components/mongodb', () => { throw new Error('Parser facade units must not initialize Mongo.'); });
jest.mock('../../server/src/components/genai/llm', () => { throw new Error('Parser facade units must not initialize a provider.'); });

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void;

const execFileMock = jest.mocked(execFile);

function mockPdftotext(stdout = 'native text', error: Error | null = null, stderr = ''): void {
  execFileMock.mockImplementation(((...args: unknown[]) => {
    const callback = args.at(-1) as ExecCallback;
    callback(error, stdout, stderr);
    return {} as ChildProcess;
  }) as never);
}

beforeEach(() => { jest.mocked(parser.parse).mockReset(); });
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  execFileMock.mockReset();
});

describe('parseFile PDF text-first routing', () => {
  it('returns exact native bytes for default and explicit PDF text, including uppercase extensions, without starting the toolkit', async () => {
    const text = '  Row\tβ = 1.20\r\nSecond row\n\f  '; mockPdftotext(text);
    await expect(parseFile('/tmp/notes.pdf')).resolves.toBe(text);
    await expect(parseFile('/tmp/notes.PDF', 'text')).resolves.toBe(text);
    expect(parser.parse).not.toHaveBeenCalled(); expect(execFileMock).toHaveBeenCalledTimes(2);
    expect(execFileMock).toHaveBeenCalledWith(
      'pdftotext',
      ['-layout', '/tmp/notes.pdf', '-'],
      { encoding: 'utf8', timeout: 60_000, maxBuffer: 50 * 1024 * 1024 },
      expect.any(Function),
    );
  });

  it.each(['spawn pdftotext ENOENT', 'corrupt PDF'])('uses bounded toolkit text fallback when native parsing fails: %s', async reason => {
    mockPdftotext('', new Error(reason)); jest.mocked(parser.parse).mockResolvedValue({ content: '  toolkit recovery\n', metadata: {} });
    await expect(parseFile('/tmp/notes.pdf', 'text')).resolves.toBe('  toolkit recovery\n');
    expect(parser.parse).toHaveBeenCalledTimes(1); expect(parser.parse).toHaveBeenCalledWith({ filePath: '/tmp/notes.pdf' }, 'text');
  });

  it('tries the toolkit when native text is empty and preserves its successful output', async () => {
    mockPdftotext(' \n\f'); jest.mocked(parser.parse).mockResolvedValue({ content: '\tToolkit β\r\n', metadata: {} });
    await expect(parseFile('/tmp/notes.pdf', 'text')).resolves.toBe('\tToolkit β\r\n');
    expect(parser.parse).toHaveBeenCalledTimes(1);
  });

  it('rejects an image-only PDF when neither parser yields text', async () => {
    mockPdftotext('  \n'); jest.mocked(parser.parse).mockResolvedValue({ content: '\t\f', metadata: {} });
    const result = parseFile('/tmp/scanned.pdf', 'text');
    await expect(result).rejects.toBeInstanceOf(PdfTextExtractionError);
    await expect(result).rejects.toMatchObject({ code: 'pdf-text-extraction-failed', nativeReason: 'pdftotext found no extractable text in the PDF',
      toolkitReason: 'Toolkit PDF text parser found no extractable text' });
  });

  it('retains both native and toolkit failure reasons rather than returning a successful empty source', async () => {
    mockPdftotext('', new Error('exit 1'), 'native rejected PDF'); jest.mocked(parser.parse).mockRejectedValue(new Error('toolkit rejected PDF'));
    await expect(parseFile('/tmp/notes.pdf', 'text')).rejects.toMatchObject({ code: 'pdf-text-extraction-failed',
      nativeReason: 'pdftotext failed: native rejected PDF', toolkitReason: 'toolkit rejected PDF' });
  });

  it('bounds a hanging toolkit text fallback after native failure', async () => {
    jest.useFakeTimers(); mockPdftotext('', new Error('native unavailable')); jest.mocked(parser.parse).mockReturnValue(new Promise(() => undefined));
    const outcome = parseFile('/tmp/notes.pdf', 'text').catch(error => error as Error);
    await jest.advanceTimersByTimeAsync(15_000);
    expect(await outcome).toMatchObject({ code: 'pdf-text-extraction-failed', toolkitReason: 'Toolkit PDF text parser timed out after 15000ms' });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('keeps successful PDF Markdown toolkit-first without invoking the native parser', async () => {
    jest.mocked(parser.parse).mockResolvedValue({ content: '# Original Markdown\n', metadata: {} });
    await expect(parseFile('/tmp/notes.pdf', 'markdown')).resolves.toBe('# Original Markdown\n');
    expect(parser.parse).toHaveBeenCalledWith({ filePath: '/tmp/notes.pdf' }, 'markdown'); expect(execFileMock).not.toHaveBeenCalled();
  });

  it('preserves PDF Markdown native fallback when the toolkit rejects', async () => {
    jest.mocked(parser.parse).mockRejectedValue(new Error('pdf2md failed')); mockPdftotext('existing plain-text Markdown fallback');
    await expect(parseFile('/tmp/notes.pdf', 'markdown')).resolves.toBe('existing plain-text Markdown fallback');
    expect(parser.parse).toHaveBeenCalledWith({ filePath: '/tmp/notes.pdf' }, 'markdown'); expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it('preserves PDF Markdown fallback after the existing toolkit timeout', async () => {
    jest.useFakeTimers();
    jest.mocked(parser.parse).mockReturnValue(new Promise(() => undefined));
    mockPdftotext('timeout fallback text');
    const result = parseFile('/tmp/hung.pdf', 'markdown');
    await jest.advanceTimersByTimeAsync(14_999); expect(execFileMock).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe('timeout fallback text'); expect(jest.getTimerCount()).toBe(0);
  });

  it('delegates non-PDF text and Markdown requests to the toolkit without native fallback', async () => {
    for (const extension of ['docx', 'pptx', 'html', 'md']) for (const format of ['text', 'markdown'] as const) {
      jest.mocked(parser.parse).mockResolvedValue({ content: `${extension}:${format}`, metadata: {} });
      await expect(parseFile(`/tmp/notes.${extension}`, format)).resolves.toBe(`${extension}:${format}`);
      expect(parser.parse).toHaveBeenLastCalledWith({ filePath: `/tmp/notes.${extension}` }, format);
    }
    jest.mocked(parser.parse).mockRejectedValue(new Error('non-PDF toolkit failure'));
    await expect(parseFile('/tmp/notes.docx', 'text')).rejects.toThrow('non-PDF toolkit failure');
    expect(execFileMock).not.toHaveBeenCalled();
  });
});
