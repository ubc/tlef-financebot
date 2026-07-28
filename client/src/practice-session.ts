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
  /** The LO this entry was served/attempted under — feeds the transcript's
   * "practice this LO more" link (ST-P08), which starts a fresh practice
   * round on that specific LO regardless of which LO is currently active. */
  loId: string;
}

export class PracticeSession {
  readonly startedAt: Date = new Date();
  private servedIds = new Set<string>();
  private transcriptEntries: TranscriptEntry[] = [];
  private roundTranscriptStart = 0;
  private roundNumberValue = 1;
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

  get roundNumber(): number {
    return this.roundNumberValue;
  }

  get roundTranscript(): readonly TranscriptEntry[] {
    return this.transcriptEntries.slice(this.roundTranscriptStart);
  }

  hasServed(questionId: string): boolean {
    return this.servedIds.has(questionId);
  }

  recordServed(question: PracticeQuestion): void {
    this.servedIds.add(question.questionId);
  }

  recordAttempt(entry: TranscriptEntry): void {
    this.transcriptEntries.push(entry);
    this.attemptedThisLo = true;
  }

  /** Begin another finite pass through the current LO's Approved bank. */
  startNextRound(): void {
    this.servedIds.clear();
    this.roundTranscriptStart = this.transcriptEntries.length;
    this.roundNumberValue += 1;
  }

  /** Move to another LO without losing the whole-session transcript. */
  startLo(): void {
    this.servedIds.clear();
    this.attemptedThisLo = false;
    this.roundTranscriptStart = this.transcriptEntries.length;
    this.roundNumberValue = 1;
  }
}
