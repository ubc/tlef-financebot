import {
  DocumentParsingModule,
  type SupportedOutputFormat,
} from 'ubc-genai-toolkit-document-parsing';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { createGenaiLogger } from '../logger';

// Turn files (PDF, DOCX, PPTX, HTML, Markdown) into text via
// ubc-genai-toolkit-document-parsing. First stage of the ingestion pipeline;
// its output feeds chunking.
const logger = createGenaiLogger('genai:document-parsing');

const parser = new DocumentParsingModule({ logger });

// @opendocsg/pdf2md (used by the toolkit for PDFs) can leave its parse promise
// pending forever for otherwise valid files. Bound that primary attempt so an
// Agenda ingest job cannot remain locked indefinitely, then fall back to
// Poppler's mature `pdftotext` executable. The upload route already caps files
// at 50 MiB; keep the fallback output bounded to the same order of magnitude.
const PDF_TOOLKIT_TIMEOUT_MS = 15_000;
const PDFTOTEXT_TIMEOUT_MS = 60_000;
const PDFTOTEXT_MAX_BUFFER_BYTES = 50 * 1024 * 1024;

function parseWithToolkit(filePath: string, format: SupportedOutputFormat): Promise<string> {
  return parser.parse({ filePath }, format).then(({ content }) => content);
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function parsePdfWithPdftotext(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'pdftotext',
      ['-layout', filePath, '-'],
      {
        encoding: 'utf8',
        timeout: PDFTOTEXT_TIMEOUT_MS,
        maxBuffer: PDFTOTEXT_MAX_BUFFER_BYTES,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`pdftotext failed: ${stderr.trim() || error.message}`));
          return;
        }
        if (!stdout.trim()) {
          reject(new Error('pdftotext found no extractable text in the PDF'));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

/**
 * Parse a document on disk into text. The underlying module only accepts a file
 * path (not a Buffer), so callers with an upload/stream must write it to a temp
 * file first (see routes/rag.routes.ts). Supported: .pdf .docx .pptx .html .md.
 */
export async function parseFile(
  filePath: string,
  format: SupportedOutputFormat = 'text',
): Promise<string> {
  if (path.extname(filePath).toLowerCase() !== '.pdf') {
    return parseWithToolkit(filePath, format);
  }

  try {
    return await withTimeout(
      parseWithToolkit(filePath, format),
      PDF_TOOLKIT_TIMEOUT_MS,
      `PDF toolkit parser timed out after ${PDF_TOOLKIT_TIMEOUT_MS}ms`,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn('Primary PDF parser failed; falling back to pdftotext', { filePath, reason });
    const text = await parsePdfWithPdftotext(filePath);
    // pdftotext emits plain text. Returning it for a markdown request is still
    // preferable to leaving the ingest stuck, and plain text is valid markdown.
    return text;
  }
}

export { parser };
export type { SupportedOutputFormat };
