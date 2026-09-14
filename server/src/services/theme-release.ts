// Progressive release of Topics (Themes) — the one place the "released"
// rule lives, so practice selection, the per-LO counts behind the student
// course home, Student Preview and exam assembly cannot drift apart.
//
// A Theme is RELEASED once its `availableFrom` is set and has passed. No
// date means "Not released": the default for Themes created from 2026-09-05
// on. Themes that existed before that were stamped released on migration day
// (scripts/migrate-theme-release.ts) so no live course went dark. Until
// 2026-09-05 a missing date meant "always open" and only a future date hid a
// Theme; instructors asked for the opposite default — release Topics as the
// class moves ahead — plus a manual "Release now" and "Withdraw release" in
// the Structure editor, which stamp today's date or clear it.
//
// The holdback rule (multi-LO questions, IN-Q13): a question tagged to any
// unreleased Theme is held back from EVERY serving path, even under an LO
// whose own Theme is open. A combination question chaining Topic 2 into
// Topic 5 must not reach students practising Topic 2 before Topic 5 is
// taught. It stays Approved in the bank and becomes servable the moment the
// last of its Themes is released.
import type { ObjectId } from 'mongodb';
import { themesCol } from '../components/mongodb/collections';
import type { Question, Theme } from '../types/domain';

export function isThemeReleased(theme: Pick<Theme, 'availableFrom'>, now: Date = new Date()): boolean {
  return theme.availableFrom !== undefined && theme.availableFrom <= now;
}

/** Ids (hex) of the course's active Themes that are not released. */
export async function unreleasedThemeIds(courseId: ObjectId, now: Date = new Date()): Promise<Set<string>> {
  const themes = await themesCol().find({ courseId, archivedAt: { $exists: false } }).toArray();
  return new Set(themes.filter((theme) => !isThemeReleased(theme, now)).map((theme) => theme._id.toHexString()));
}

/** True when none of the question's Theme tags is unreleased. */
export function releasedForServing(
  question: Pick<Question, 'themeIds'>,
  unreleased: ReadonlySet<string>,
): boolean {
  return !question.themeIds.some((id) => unreleased.has(id.toHexString()));
}
