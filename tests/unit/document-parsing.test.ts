import type { ChildProcess } from 'node:child_process';
import { execFile } from 'node:child_process';
import { parseFile, parser } from '../../server/src/components/genai/document-parsing';

jest.mock('node:child_process', () => ({ execFile: jest.fn() }));

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void;

const execFileMock = jest.mocked(execFile);

function mockPdftotext(stdout = 'fallback text'): void {
  execFileMock.mockImplementation(((...args: unknown[]) => {
    const callback = args.at(-1) as ExecCallback;
    callback(null, stdout, '');
    return {} as ChildProcess;
  }) as never);
}

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  execFileMock.mockReset();
});

describe('parseFile PDF fallback', () => {
  it('keeps using the toolkit parser for non-PDF files', async () => {
    jest.spyOn(parser, 'parse').mockResolvedValue({ content: 'docx text', metadata: {} });

    await expect(parseFile('/tmp/notes.docx', 'text')).resolves.toBe('docx text');

    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('falls back to pdftotext when the toolkit parser rejects', async () => {
    jest.spyOn(parser, 'parse').mockRejectedValue(new Error('pdf2md failed'));
    mockPdftotext('text extracted by Poppler');

    await expect(parseFile('/tmp/notes.pdf', 'text')).resolves.toBe('text extracted by Poppler');

    expect(execFileMock).toHaveBeenCalledWith(
      'pdftotext',
      ['-layout', '/tmp/notes.pdf', '-'],
      expect.objectContaining({ encoding: 'utf8', timeout: 60_000 }),
      expect.any(Function),
    );
  });

  it('falls back when the toolkit parser never settles', async () => {
    jest.useFakeTimers();
    jest.spyOn(parser, 'parse').mockReturnValue(new Promise(() => undefined));
    mockPdftotext('timeout fallback text');

    const result = parseFile('/tmp/hung.pdf', 'text');
    await jest.advanceTimersByTimeAsync(15_000);

    await expect(result).resolves.toBe('timeout fallback text');
  });

  it('rejects an image-only PDF when the fallback extracts no text', async () => {
    jest.spyOn(parser, 'parse').mockRejectedValue(new Error('pdf2md failed'));
    mockPdftotext('  \n');

    await expect(parseFile('/tmp/scanned.pdf', 'text')).rejects.toThrow(
      'pdftotext found no extractable text',
    );
  });
});
