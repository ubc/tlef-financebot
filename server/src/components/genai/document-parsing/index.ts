import {
  DocumentParsingModule,
  type SupportedOutputFormat,
} from 'ubc-genai-toolkit-document-parsing';
import { createGenaiLogger } from '../logger';

// Turn files (PDF, DOCX, PPTX, HTML, Markdown) into text via
// ubc-genai-toolkit-document-parsing. First stage of the ingestion pipeline;
// its output feeds chunking.
const logger = createGenaiLogger('genai:document-parsing');

const parser = new DocumentParsingModule({ logger });

/**
 * Parse a document on disk into text. The underlying module only accepts a file
 * path (not a Buffer), so callers with an upload/stream must write it to a temp
 * file first (see routes/rag.routes.ts). Supported: .pdf .docx .pptx .html .md.
 */
export async function parseFile(
  filePath: string,
  format: SupportedOutputFormat = 'text',
): Promise<string> {
  const { content } = await parser.parse({ filePath }, format);
  return content;
}

export { parser };
export type { SupportedOutputFormat };
