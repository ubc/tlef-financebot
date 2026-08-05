// PATCH /api/questions/:questionId/params now carries derivedValues and runs
// verification on save. See
// docs/superpowers/specs/2026-08-05-numerical-question-correctness-design.md.
//
// The route delegates persistence to editQuestion, so that is what these
// assert against: which fields it was asked to write, and whether the
// verification proof went with them.
import { readFileSync } from 'node:fs';
import express, { type Express } from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { EVALUATOR_VERSION } from '../../server/src/components/formula';

// ensureApiAuthenticated and ensureCapability both live in components/auth
// (questions.routes.ts:5); stashCourseIdFromQuestion is module-private to the
// router, so it runs for real and only needs getQuestionCourseId mocked below.
jest.mock('../../server/src/components/auth', () => ({
  ensureApiAuthenticated: () => (req: { user?: unknown }, _res: unknown, next: () => void) => {
    (req as { user: unknown }).user = { puid: '12345678', uid: 'faculty-user', isAdmin: true, courseRoles: [] };
    next();
  },
  ensureCapability: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const editQuestion = jest.fn(async (_id: ObjectId, patch: Record<string, unknown>) => ({ _id: new ObjectId(), ...patch }));
const getQuestionDetail = jest.fn(async () => ({
  current: {
    stem: 'What is the present value of ${{PAYMENT}} at {{RATE_PCT}}%?',
    options: [
      { key: 'A', text: '${{PV}}', role: 'correct', explanation: '' },
      { key: 'B', text: '${{PV_WRONG}}', role: 'common-misconception', explanation: '' },
    ],
  },
}));

// getQuestionDetail and getQuestionCourseId live in bank.service
// (questions.routes.ts:8-15); only editQuestion comes from questions.service.
jest.mock('../../server/src/services/questions.service', () => ({
  editQuestion: (...args: unknown[]) => editQuestion(...(args as [ObjectId, Record<string, unknown>])),
  transitionQuestion: jest.fn(),
  bulkTransition: jest.fn(),
  addQuestionInternalNote: jest.fn(),
}));

jest.mock('../../server/src/services/bank.service', () => ({
  getQuestionDetail: () => getQuestionDetail(),
  getQuestionCourseId: async () => new ObjectId(),
  getDistinctQuestionCourseIds: jest.fn(),
  browseBank: jest.fn(),
  reviewQueue: jest.fn(),
}));

import { questionsRouter } from '../../server/src/routes/questions.routes';

const questionId = new ObjectId();

function app(): Express {
  const instance = express();
  instance.use(express.json());
  instance.use('/api', questionsRouter);
  return instance;
}

const soundBody = {
  paramSlots: [
    { name: 'PAYMENT', min: 100, max: 900, step: 100 },
    { name: 'RATE_PCT', min: 4, max: 12, step: 2 },
  ],
  derivedValues: [
    { name: 'PV', formula: 'PAYMENT/(1+RATE_PCT/100)^1' },
    { name: 'PV_WRONG', formula: 'PAYMENT*(1+RATE_PCT/100)^1', errorModel: 'compounded instead of discounting' },
  ],
  numericKind: 'numeric' as const,
};

function patchWith(body: object) {
  return request(app()).patch(`/api/questions/${questionId.toHexString()}/params`).send(body);
}

beforeEach(() => {
  editQuestion.mockClear();
});

describe('PATCH /api/questions/:questionId/params', () => {
  it('stores a verification proof when the formulas are sound', async () => {
    const res = await patchWith(soundBody);

    expect(res.status).toBe(200);
    expect(res.body.verificationError).toBeUndefined();
    const patch = editQuestion.mock.calls[0][1];
    expect((patch.verification as { evaluatorVersion: number }).evaluatorVersion).toBe(EVALUATOR_VERSION);
    expect(patch.derivedValues).toHaveLength(2);
  });

  it('returns verificationError and withholds the proof when a range divides by zero', async () => {
    const res = await patchWith({
      ...soundBody,
      paramSlots: [{ name: 'RATE_PCT', min: 0, max: 5, step: 5 }],
      derivedValues: [{ name: 'PV', formula: '100/RATE_PCT' }],
    });

    expect(res.status).toBe(200);
    expect(res.body.verificationError).toMatch(/division by zero/);
  });

  it('clears any existing proof when verification fails', async () => {
    // R4: a failed save must not leave a stale proof behind, or the gate would
    // keep serving numbers the current formulas never produced.
    await patchWith({
      ...soundBody,
      derivedValues: [{ name: 'PV', formula: 'PAYMENT +' }],
    });

    const patch = editQuestion.mock.calls[0][1];
    expect(patch.verification).toBeUndefined();
  });

  it('reports the colliding pair when two option values coincide', async () => {
    const res = await patchWith({
      ...soundBody,
      paramSlots: [{ name: 'PAYMENT', min: 100, max: 100, step: 100 }],
      derivedValues: [
        { name: 'PV', formula: 'PAYMENT' },
        { name: 'PV_WRONG', formula: 'PAYMENT*1', errorModel: 'no-op' },
      ],
    });

    expect(res.body.verificationError).toMatch(/identical/);
  });

  it('leaves a conceptual question alone', async () => {
    const res = await patchWith({ numericKind: 'conceptual' });

    expect(res.status).toBe(200);
    expect(res.body.verificationError).toBeUndefined();
    expect(editQuestion.mock.calls[0][1].verification).toBeUndefined();
  });

  it('rejects a derived value whose name is not a valid identifier', async () => {
    const res = await patchWith({
      ...soundBody,
      derivedValues: [{ name: '2bad name', formula: 'PAYMENT' }],
    });

    expect(res.status).toBe(400);
  });
});

describe('R4 — a proof never outlives the content it was computed over', () => {
  it('editQuestion drops a carried-forward verification unless one is supplied', () => {
    // editQuestion builds the new version by spreading the PREVIOUS one, so
    // without an explicit clear the old proof rides along through any edit —
    // letting the gate serve numbers the current formulas no longer produce.
    const source = readFileSync('server/src/services/questions.service.ts', 'utf8');
    expect(source).toContain('else delete next.verification;');
  });

  it('treats derivedValues and numericKind as versioned content keys', () => {
    const source = readFileSync('server/src/services/questions.service.ts', 'utf8');
    expect(source).toContain("editedFields.push('derivedValues')");
    expect(source).toContain("editedFields.push('numericKind')");
  });
});
