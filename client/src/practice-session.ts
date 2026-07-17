// In-memory practice-session state (client/AGENTS.md prefers small focused
// files over a framework state manager). A "session" here is purely a client-
// side concept for the practice view: the served-question ids to exclude on
// the next `practice/next` call (server contract: `sessionServedIds`), a
// scrollable transcript of prior Q&A for the current LO/theme practice run,
// and the session start time used for the "defer to next session" action
// (ST-P10) on the session-summary view.
//
// Not persisted across page reloads or navigations away from practice — a
// fresh PracticeSession is created each time practice.ts's render() runs.

import type { AttemptResult, PracticeQuestion } from './api.js';

export interface TranscriptEntry {
  question: PracticeQuestion;
  selectedKey: string;
  result: AttemptResult;
}

export class PracticeSession {
  readonly startedAt: Date = new Date();
  private servedIds = new Set<string>();
  private transcriptEntries: TranscriptEntry[] = [];
  /** Whether at least one attempt has been submitted on the current LO this
   * session — feeds the skip endpoint's `attempted` flag (ST-P06). */
  private attemptedThisLo = false;

  /** Ids to exclude from the next `practice/next` call. */
  get sessionServedIds(): string[] {
    return [...this.servedIds];
  }

  get transcript(): readonly TranscriptEntry[] {
    return this.transcriptEntries;
  }

  get hasAttemptedCurrentLo(): boolean {
    return this.attemptedThisLo;
  }

  recordServed(question: PracticeQuestion): void {
    this.servedIds.add(question.questionId);
  }

  recordAttempt(entry: TranscriptEntry): void {
    this.transcriptEntries.push(entry);
    this.attemptedThisLo = true;
  }

  /** Reset the per-LO "attempted" flag when the student moves to a new LO
   * (e.g. via theme practice advancing to the next LO), without losing the
   * served-ids exclusion list or the transcript. */
  resetAttemptedFlag(): void {
    this.attemptedThisLo = false;
  }
}
