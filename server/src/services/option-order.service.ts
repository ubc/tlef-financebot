import { seededRandom } from './params.service';
import type { QuestionOption } from '../types/domain';

// -----------------------------------------------------------------------------
// Answer-option ordering (Phase 5 Task 7.2). One pure function, deliberately in
// its own module rather than in questions.service.ts: the generation pipeline
// needs it too, and questions.service is mocked wholesale by several test
// suites — a pure helper living there would be undefined under those mocks.
// Reuses params.service's mulberry32 rather than introducing a second PRNG.
// See server/src/services/AGENTS.md.
// -----------------------------------------------------------------------------

/**
 * Seeded Fisher-Yates over the options, then keys RELABELLED by new position.
 * Reordering the array while each key travelled with its own option would
 * render `C. … A. … D. … B.`, which reads as a bug; relabelling keeps the list
 * A, B, C, D top to bottom. `text`/`role`/`explanation` move together, and
 * grading resolves by key and then by role (attempts.service.ts), so nothing
 * about correctness depends on where an option landed.
 *
 * The new labels come from the option set's OWN keys, sorted — not a hardcoded
 * A–D — so an import that used some other alphabet keeps it.
 */
export function shuffleOptions<T extends QuestionOption>(options: T[], seed: number): T[] {
  const rand = seededRandom(seed);
  const keys = options.map((o) => o.key).sort();
  const shuffled = [...options];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rand() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  return shuffled.map((option, index) => ({ ...option, key: keys[index] }));
}
