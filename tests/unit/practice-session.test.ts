import { PracticeSession } from '../../client/src/practice-session';
import type { AttemptResult, PracticeQuestion } from '../../client/src/api';

function question(id: string): PracticeQuestion {
  return {
    questionId: id,
    questionVersionId: `${id}-version`,
    type: 'mcq',
    stem: `Question ${id}`,
    difficulty: 'easy',
    degraded: 'none',
    options: [],
    watermark: 'student',
  };
}

const result: AttemptResult = {
  correct: true,
  feedback: { strategy: 'b', revealed: [] },
  mastery: { loStatus: 'in-progress' },
  reviewBook: { added: false },
};

describe('PracticeSession finite rounds', () => {
  it('detects the first repeated question and starts a clean second round', () => {
    const session = new PracticeSession();
    const first = question('q1');
    session.recordServed(first);
    session.recordAttempt({ question: first, selectedKey: 'A', result, loId: 'lo-1' });

    expect(session.hasServed('q1')).toBe(true);
    expect(session.roundNumber).toBe(1);
    expect(session.roundTranscript).toHaveLength(1);

    session.startNextRound();

    expect(session.hasServed('q1')).toBe(false);
    expect(session.roundNumber).toBe(2);
    expect(session.roundTranscript).toHaveLength(0);
    expect(session.transcript).toHaveLength(1);
  });

  it('resets LO-local state while retaining the whole-session transcript', () => {
    const session = new PracticeSession();
    const first = question('q1');
    session.recordServed(first);
    session.recordAttempt({ question: first, selectedKey: 'A', result, loId: 'lo-1' });

    session.startLo();

    expect(session.hasAttemptedCurrentLo).toBe(false);
    expect(session.sessionServedIds).toEqual([]);
    expect(session.roundNumber).toBe(1);
    expect(session.roundTranscript).toEqual([]);
    expect(session.transcript).toHaveLength(1);
  });
});
