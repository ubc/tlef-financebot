import { Router } from 'express';
import { ensureApiAuthenticated } from '../components/auth';
import { createNote, listNotes } from '../services/notes.service';

// EXAMPLE route demonstrating the mongodb component end-to-end. Safe to delete.
export const notesRouter = Router();

// Auth-gated: ensureApiAuthenticated() is applied per route below so only
// signed-in users can read/write notes (401 JSON otherwise). Remove the guard
// argument from a route to make it public. See components/auth/AGENTS.md.

/** GET /api/notes -> recent notes (newest first). Auth-gated. */
notesRouter.get('/notes', ensureApiAuthenticated(), async (_req, res) => {
  res.json(await listNotes());
});

/** POST /api/notes { text } -> the created note. Auth-gated. */
notesRouter.post('/notes', ensureApiAuthenticated(), async (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) {
    res.status(400).json({ error: 'Field "text" is required.' });
    return;
  }
  res.status(201).json(await createNote(text));
});
