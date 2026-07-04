import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { ensureApiAuthenticated } from '../components/auth';
import { ingestText, ingestFile, query } from '../services/rag.service';

// EXAMPLE route demonstrating the genai + qdrant components end-to-end (RAG).
// Safe to delete along with rag.service.ts and the client RAG panel.
export const ragRouter = Router();

// Auth-gated: ensureApiAuthenticated() is applied per route below (as the first
// handler, before multer) so only signed-in users can ingest/query — 401 JSON
// otherwise. Remove the guard argument from a route to make it public.

// Uploaded files are streamed to a temp file (the document-parsing module reads
// from a path, not a Buffer). We MUST preserve the original extension: the
// parser detects the file type from it, so a random name with no extension is
// rejected as "unknown". 20 MB cap keeps the demo from exhausting memory.
const upload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});

/** POST /api/rag/ingest { text, sourceId? } -> { sourceId, chunks }. Auth-gated. */
ragRouter.post('/rag/ingest', ensureApiAuthenticated(), async (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  const sourceId =
    typeof req.body?.sourceId === 'string' && req.body.sourceId.trim()
      ? req.body.sourceId.trim()
      : 'pasted-text';
  if (!text) {
    res.status(400).json({ error: 'Field "text" is required.' });
    return;
  }
  res.status(201).json(await ingestText(text, sourceId));
});

/** POST /api/rag/ingest-file (multipart, field "file") -> { sourceId, chunks }. Auth-gated. */
ragRouter.post('/rag/ingest-file', ensureApiAuthenticated(), upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: 'Field "file" is required.' });
    return;
  }
  try {
    res.status(201).json(await ingestFile(file.path, file.originalname));
  } finally {
    // Always remove the temp upload, whether parsing succeeded or threw.
    await fs.rm(file.path, { force: true });
  }
});

/** POST /api/rag/query { question, topK? } -> { answer, sources }. Auth-gated. */
ragRouter.post('/rag/query', ensureApiAuthenticated(), async (req, res) => {
  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  if (!question) {
    res.status(400).json({ error: 'Field "question" is required.' });
    return;
  }
  const topK = Number.isInteger(req.body?.topK) ? req.body.topK : undefined;
  res.json(await query(question, topK));
});
