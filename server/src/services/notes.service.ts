import type { Collection, WithId } from 'mongodb';
import { getDb } from '../components/mongodb';

// -----------------------------------------------------------------------------
// EXAMPLE component usage. This "notes" feature exists only to demonstrate how a
// service uses the mongodb component (components/mongodb) to read and write
// data. It is safe to delete once you have your own features. See
// server/src/services/AGENTS.md and components/mongodb/AGENTS.md.
// -----------------------------------------------------------------------------

export interface Note {
  text: string;
  createdAt: Date;
}

/** Typed handle to the `notes` collection. */
function notesCollection(): Collection<Note> {
  return getDb().collection<Note>('notes');
}

/** Insert a note and return the stored document (including its generated _id). */
export async function createNote(text: string): Promise<WithId<Note>> {
  const note: Note = { text, createdAt: new Date() };
  const result = await notesCollection().insertOne(note);
  return { _id: result.insertedId, ...note };
}

/** Return the 50 most recent notes, newest first. */
export async function listNotes(): Promise<WithId<Note>[]> {
  return notesCollection().find().sort({ createdAt: -1 }).limit(50).toArray();
}
