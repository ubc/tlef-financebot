# AGENTS.md — components/genai/document-parsing

Turn uploaded files (PDF, DOCX, PPTX, HTML, Markdown) into text via
[`ubc-genai-toolkit-document-parsing`](https://github.com/ubc/ubc-genai-toolkit-document-parsing).
First stage of the ingestion pipeline; its output feeds `chunking`.

## Status

Implemented. `index.ts` exports a configured parser and a `parseFile` helper.

## Environment variables

None.

## Public API (`index.ts`)

| Export | Purpose |
| --- | --- |
| `parseFile(filePath, format?): Promise<string>` | Parse a file on disk to text (`format`: `'text'` default or `'markdown'`). |
| `parser: DocumentParsingModule` | The configured module, if you need `parse()` + metadata directly. |
| `SupportedOutputFormat` (type) | Re-exported from the toolkit. |

## Init pattern (real, installed API)

```ts
import { DocumentParsingModule } from 'ubc-genai-toolkit-document-parsing';
import { createGenaiLogger } from '../logger';

const parser = new DocumentParsingModule({ logger: createGenaiLogger('genai:document-parsing') });

// parse takes { filePath } (NOT a Buffer) + an output format, and returns
// { content, metadata }.
const { content } = await parser.parse({ filePath: '/tmp/lecture.pdf' }, 'text');
```

Supported input: `.pdf`, `.docx`, `.pptx`, `.html`/`.htm`, `.md`.

## How files arrive (uploads)

`parse` reads a **file path**, not a stream/Buffer. The RAG example's upload
route (`routes/rag.routes.ts`) uses `multer` (dependency added) to write the
upload to a temp file, calls `ingestFile(file.path, file.originalname)`, then
deletes the temp file in a `finally`.

## Implementation checklist

- [x] Export a `parseFile(...)` helper (and the configured module) from `index.ts`.
- [x] Decide how files arrive — `multer` upload → temp file → `parseFile` (see
      `routes/rag.routes.ts`).
- [x] Pass parsed text to `components/genai/chunking` (see `rag.service.ts`).

## Gotchas

- Input is a **path only**; buffered/streamed uploads must be written to disk
  first (and cleaned up afterward).
- PPTX image description is optional and only runs if you supply an
  `imageDescriber` (e.g. wired to the `llm` component's vision support); by
  default parsing is text-only and makes no external calls.
- Large files can be slow/memory-heavy; parse off the request path if needed.
