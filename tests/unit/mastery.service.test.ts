import { ObjectId } from 'mongodb';
import type { AttemptRecord, MasteryProfile, OptionRole } from '../../server/src/types/domain';

jest.mock('../../server/src/components/mongodb/collections', () => ({
  masteryCol: jest.fn(),
  attemptsCol: jest.fn(),
  losCol: jest.fn(),
}));

import { masteryCol, attemptsCol, losCol } from '../../server/src/components/mongodb/collections';
import {
  recordAttemptInMastery,
  getMasteryTier,
  getLoStatuses,
  recordSkip,
  themeCoverage,
  computeProfile,
} from '../../server/src/services/mastery.service';

// -----------------------------------------------------------------------------
// Map-backed fake collections. The eight scripted cases (core doc, Task 9 Step
// 1) need a realistic sequence of attempts flowing through the service and
// observable state evolving between calls — jest.fn() call-assertion mocks
// make that awkward, so instead we fake the small slice of the Mongo driver
// surface the service actually calls: findOne / find().sort().limit().toArray()
// / updateOne (with upsert), all backed by a plain Map keyed by a composite
// string key built from the filter.
// -----------------------------------------------------------------------------

function matchesFilter(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && '$exists' in (expected as Record<string, unknown>)) {
      const wantExists = (expected as { $exists: boolean }).$exists;
      return wantExists ? key in doc : !(key in doc);
    }
    const actual = doc[key];
    if (expected instanceof ObjectId) return expected.equals(actual as ObjectId);
    if (actual instanceof ObjectId) return actual.equals(expected as ObjectId);
    return actual === expected;
  });
}

/** Fake `masteryCol()` / generic single-document-per-key collection. */
function makeMasteryFake() {
  const store = new Map<string, Record<string, unknown>>();
  const keyOf = (doc: Record<string, unknown>) =>
    `${doc.puid}|${(doc.courseId as ObjectId).toHexString()}|${(doc.loId as ObjectId).toHexString()}`;

  return {
    store,
    findOne: jest.fn(async (filter: Record<string, unknown>) => {
      for (const doc of store.values()) {
        if (matchesFilter(doc, filter)) return doc;
      }
      return null;
    }),
    find: jest.fn((filter: Record<string, unknown>) => ({
      toArray: async () => Array.from(store.values()).filter((doc) => matchesFilter(doc, filter)),
    })),
    updateOne: jest.fn(
      async (
        filter: Record<string, unknown>,
        update: { $set?: Record<string, unknown>; $unset?: Record<string, unknown>; $setOnInsert?: Record<string, unknown> },
        options?: { upsert?: boolean },
      ) => {
        let existing: Record<string, unknown> | undefined;
        let existingKey: string | undefined;
        for (const [k, doc] of store.entries()) {
          if (matchesFilter(doc, filter)) {
            existing = doc;
            existingKey = k;
            break;
          }
        }
        if (!existing) {
          if (!options?.upsert) return { matchedCount: 0, upsertedCount: 0 };
          existing = { ...filter, ...(update.$setOnInsert ?? {}) };
        }
        const next = { ...existing, ...(update.$set ?? {}) };
        if (update.$unset) {
          for (const key of Object.keys(update.$unset)) delete next[key];
        }
        const key = existingKey ?? keyOf(next);
        store.set(key, next);
        return { matchedCount: existing ? 1 : 0, upsertedCount: existing ? 0 : 1 };
      },
    ),
  };
}

/** Fake `attemptsCol()` — supports insertOne + find().sort().limit().toArray(). */
function makeAttemptsFake() {
  const docs: Record<string, unknown>[] = [];
  return {
    docs,
    insertOne: jest.fn(async (doc: Record<string, unknown>) => {
      docs.push(doc);
      return { insertedId: new ObjectId() };
    }),
    find: jest.fn((filter: Record<string, unknown>) => {
      let results = docs.filter((doc) => matchesFilter(doc, filter));
      let sorted = false;
      const chain = {
        sort: (spec: Record<string, 1 | -1>) => {
          const [field, dir] = Object.entries(spec)[0];
          results = [...results].sort((a, b) => {
            const av = (a[field] as Date).getTime();
            const bv = (b[field] as Date).getTime();
            return dir === -1 ? bv - av : av - bv;
          });
          sorted = true;
          return chain;
        },
        limit: (n: number) => {
          results = results.slice(0, n);
          return chain;
        },
        toArray: async () => {
          if (!sorted) results = [...results];
          return results;
        },
      };
      return chain;
    }),
  };
}

/** Fake `losCol()` — supports find().toArray(). */
function makeLosFake(docs: Record<string, unknown>[]) {
  return {
    find: jest.fn((filter: Record<string, unknown>) => ({
      toArray: async () => docs.filter((doc) => matchesFilter(doc, filter)),
    })),
  };
}

let masteryFake: ReturnType<typeof makeMasteryFake>;
let attemptsFake: ReturnType<typeof makeAttemptsFake>;
let losFake: ReturnType<typeof makeLosFake>;

beforeEach(() => {
  masteryFake = makeMasteryFake();
  attemptsFake = makeAttemptsFake();
  losFake = makeLosFake([]);
  jest.mocked(masteryCol).mockReturnValue(masteryFake as never);
  jest.mocked(attemptsCol).mockReturnValue(attemptsFake as never);
  jest.mocked(losCol).mockReturnValue(losFake as never);
});

// --- Fixtures -----------------------------------------------------------------

const puid = 'PUID-STUDENT-0001';
const courseId = new ObjectId();
const loId = new ObjectId();
const themeId = new ObjectId();
const questionId = new ObjectId();
const questionVersionId = new ObjectId();

let clock = Date.parse('2026-01-01T00:00:00Z');
function nextTime(): Date {
  clock += 1000;
  return new Date(clock);
}

function makeAttempt(over: Partial<AttemptRecord> & { correct: boolean }): AttemptRecord {
  return {
    puid,
    courseId,
    questionId,
    questionVersionId,
    loId,
    themeId,
    mode: 'topic-practice',
    strategy: 'a',
    selectedKey: over.correct ? 'A' : 'B',
    selectedRole: (over.selectedRole ?? (over.correct ? 'correct' : 'clearly-wrong')) as OptionRole,
    difficulty: 'easy',
    isRetry: false,
    createdAt: nextTime(),
    ...over,
  };
}

async function attempt(correct: boolean, over: Partial<AttemptRecord> = {}): Promise<MasteryProfile> {
  return recordAttemptInMastery(makeAttempt({ correct, ...over }));
}

// --- Case 1-3, 5: tier progression + coverage + regression + step-back --------

describe('recordAttemptInMastery: tier progression (§9.2)', () => {
  it('case 1: easy✓, medium✓, hard✓ -> tier walks easy→medium→hard; in-progress at 3 attempts', async () => {
    await attempt(true);
    await attempt(true);
    const profile = await attempt(true);
    expect(profile.currentTier).toBe('hard');
    expect(profile.attemptCount).toBe(3);
    expect(profile.status).toBe('in-progress');
  });

  it('case 2: a 4th correct hard attempt -> covered (4 attempts, 100%, tier hard)', async () => {
    await attempt(true);
    await attempt(true);
    await attempt(true);
    const profile = await attempt(true);
    expect(profile.status).toBe('covered');
    expect(profile.attemptCount).toBe(4);
    expect(profile.windowAccuracy).toBe(1);
    expect(profile.currentTier).toBe('hard');
  });

  it('case 3: covered, then a single hard miss -> regresses to in-progress, tier stays hard (repeated misses only)', async () => {
    await attempt(true);
    await attempt(true);
    await attempt(true);
    await attempt(true); // covered
    const profile = await attempt(false); // non-CM miss
    expect(profile.status).toBe('in-progress');
    expect(profile.currentTier).toBe('hard');
  });

  it('case 5: a second hard miss (2 of last 3) -> tier steps back to medium', async () => {
    await attempt(true);
    await attempt(true);
    await attempt(true);
    await attempt(true); // covered
    await attempt(false); // 1st miss, tier stays hard
    const profile = await attempt(false); // 2nd miss of last 3 -> step back
    expect(profile.currentTier).toBe('medium');
    expect(profile.status).toBe('in-progress');
  });
});

describe('recordAttemptInMastery: common-misconception misses hold tier', () => {
  it('case 4: CM miss at medium -> tier stays medium', async () => {
    await attempt(true); // easy -> medium
    const profile = await attempt(false, { selectedRole: 'common-misconception' });
    expect(profile.currentTier).toBe('medium');
  });
});

describe('recordAttemptInMastery: rolling 10-attempt window', () => {
  it('case 6: an 11th attempt evicts the 1st from the accuracy/count window', async () => {
    // 1st attempt is a miss (drags accuracy down if counted).
    await attempt(false);
    // Attempts 2-10: nine correct answers.
    for (let i = 0; i < 8; i += 1) await attempt(true);
    const before = await attempt(true); // 10th attempt
    expect(before.attemptCount).toBe(10);
    expect(before.windowAccuracy).toBeCloseTo(9 / 10);

    // 11th attempt: window should now be attempts 2-11 (first miss evicted).
    const after = await attempt(true);
    expect(after.attemptCount).toBe(10);
    expect(after.windowAccuracy).toBe(1);
  });
});

describe('recordSkip (ST-P06)', () => {
  it('case 7: skip then attempt -> skipped is cleared on the next attempt', async () => {
    await recordSkip(puid, courseId, loId, false);
    const skipped = await masteryFake.findOne({ puid, courseId, loId });
    expect(skipped?.skipped).toBe('without-attempting');

    const profile = await attempt(true);
    expect(profile.skipped).toBeUndefined();
  });
});

describe('themeCoverage', () => {
  it('case 8: LO-A covered, LO-B skipped -> covered:true, includesSkipped:true', async () => {
    const loA = new ObjectId();
    const loB = new ObjectId();
    losFake = makeLosFake([
      { _id: loA, courseId, themeId, name: 'LO A', order: 1 } as unknown as Record<string, unknown>,
      { _id: loB, courseId, themeId, name: 'LO B', order: 2 } as unknown as Record<string, unknown>,
    ]);
    jest.mocked(losCol).mockReturnValue(losFake as never);

    // Cover LO-A with 4 correct attempts.
    for (let i = 0; i < 4; i += 1) {
      await recordAttemptInMastery(makeAttempt({ correct: true, loId: loA }));
    }
    // Skip LO-B without attempting.
    await recordSkip(puid, courseId, loB, false);

    const result = await themeCoverage(puid, courseId, themeId);
    expect(result.covered).toBe(true);
    expect(result.includesSkipped).toBe(true);
  });

  it('is not covered while a non-skipped LO is still not-attempted', async () => {
    const loA = new ObjectId();
    const loB = new ObjectId();
    losFake = makeLosFake([
      { _id: loA, courseId, themeId, name: 'LO A', order: 1 } as unknown as Record<string, unknown>,
      { _id: loB, courseId, themeId, name: 'LO B', order: 2 } as unknown as Record<string, unknown>,
    ]);
    jest.mocked(losCol).mockReturnValue(losFake as never);

    for (let i = 0; i < 4; i += 1) {
      await recordAttemptInMastery(makeAttempt({ correct: true, loId: loA }));
    }
    const result = await themeCoverage(puid, courseId, themeId);
    expect(result.covered).toBe(false);
    expect(result.includesSkipped).toBe(false);
  });
});

describe('getMasteryTier', () => {
  it('defaults to easy when no profile exists', async () => {
    expect(await getMasteryTier(puid, courseId, loId)).toBe('easy');
  });

  it('returns the persisted currentTier', async () => {
    await attempt(true);
    expect(await getMasteryTier(puid, courseId, loId)).toBe('medium');
  });
});

describe('getLoStatuses', () => {
  it('maps loId hex -> status for every profile in the course', async () => {
    await attempt(true);
    const statuses = await getLoStatuses(puid, courseId);
    expect(statuses.get(loId.toHexString())).toBe('in-progress');
  });
});

// --- computeProfile: direct pure-function checks -------------------------------

describe('computeProfile (pure)', () => {
  it('returns not-attempted for an empty window', () => {
    const profile = computeProfile([], null);
    expect(profile.status).toBe('not-attempted');
    expect(profile.currentTier).toBe('easy');
    expect(profile.attemptCount).toBe(0);
  });

  it('caps tier at hard on repeated correct answers', () => {
    const prior: MasteryProfile = {
      puid,
      courseId,
      loId,
      status: 'covered',
      attemptCount: 4,
      windowAccuracy: 1,
      windowRoles: { correct: 4 },
      currentTier: 'hard',
      attemptsSinceEvaluation: 4,
      updatedAt: new Date(),
    };
    const window = [makeAttempt({ correct: true, difficulty: 'hard' })];
    const profile = computeProfile(window, prior);
    expect(profile.currentTier).toBe('hard');
  });

  it('increments attemptsSinceEvaluation from prior', () => {
    const prior: MasteryProfile = {
      puid,
      courseId,
      loId,
      status: 'in-progress',
      attemptCount: 2,
      windowAccuracy: 1,
      windowRoles: { correct: 2 },
      currentTier: 'medium',
      attemptsSinceEvaluation: 2,
      updatedAt: new Date(),
    };
    const window = [makeAttempt({ correct: true })];
    const profile = computeProfile(window, prior);
    expect(profile.attemptsSinceEvaluation).toBe(3);
  });
});
