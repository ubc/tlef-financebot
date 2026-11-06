// Integration test — generationRouter via supertest, mirroring
// materials.routes.test.ts's makeApp pattern (req.user carries courseRoles).
// The service is mocked; this file is only about the ROUTE
// layer: instructor guarding, body validation, enqueue + 202 shape, and the
// preseeding read.
import express, { type Express } from 'express';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import type { User } from '../../server/src/types/domain';

jest.mock('../../server/src/services/generation.service', () => ({
  enqueueGenerationRun: jest.fn(),
  preseedingProgress: jest.fn(),
  regenerateQuestion: jest.fn(),
  adoptRegenerationCandidate: jest.fn(),
  getRegenerationCandidate: jest.fn(),
  MAX_SECONDARY_LOS: 2,
  PRESET_PROMPTS: [
    { label: 'Calculation question', text: 'Write a calculation question.' },
    { label: 'Concept check', text: 'Write a concept check.' },
    { label: 'Common-misconception probe', text: 'Probe a misconception.' },
    { label: 'Applied scenario', text: 'Write an applied scenario.' },
  ],
}));
jest.mock('../../server/src/services/generation-plan.service', () => ({
  autoGenerationPlan: jest.fn(), enqueueGenerationPlan: jest.fn(), PLAN_MAX_CELLS: 120, PLAN_MAX_COUNT: 20,
}));
jest.mock('../../server/src/services/generation-blueprints.service', () => ({ enqueueBlueprintRun: jest.fn() }));

import { generationRouter } from '../../server/src/routes/generation.routes';
import { errorHandler } from '../../server/src/middleware/error-handler';
import {
  enqueueGenerationRun,
  preseedingProgress,
  regenerateQuestion,
  adoptRegenerationCandidate,
  getRegenerationCandidate,
} from '../../server/src/services/generation.service';
import { enqueueGenerationPlan } from '../../server/src/services/generation-plan.service';
import { enqueueBlueprintRun } from '../../server/src/services/generation-blueprints.service';

const courseId = new ObjectId();
const loId = new ObjectId();

function userFixture(courseRoles: User['courseRoles']): User {
  return {
    puid: 'PUID-INSTR-0001',
    uid: 'instr1',
    displayName: 'Instructor One',
    email: 'instr1@example.ubc.ca',
    affiliations: ['faculty'],
    isAdmin: false,
    courseRoles,
    createdAt: new Date(),
    lastLoginAt: new Date(),
  };
}
const instructor = userFixture([{ courseId, role: 'instructor' }]);
const student = userFixture([{ courseId, role: 'student' }]);

function makeApp(user?: User): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { isAuthenticated: () => boolean }).isAuthenticated = () => Boolean(user);
    (req as { user?: unknown }).user = user;
    next();
  });
  app.use('/api', generationRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  jest.mocked(enqueueGenerationRun).mockReset();
  jest.mocked(enqueueGenerationRun).mockResolvedValue(new ObjectId());
  jest.mocked(preseedingProgress).mockReset();
  jest.mocked(regenerateQuestion).mockReset();
  jest.mocked(adoptRegenerationCandidate).mockReset();
  jest.mocked(getRegenerationCandidate).mockReset();
  jest.mocked(enqueueGenerationPlan).mockReset();
  jest.mocked(enqueueGenerationPlan).mockResolvedValue({ runs: [] });
  jest.mocked(enqueueBlueprintRun).mockReset();
  jest.mocked(enqueueBlueprintRun).mockResolvedValue(new ObjectId());
});

describe('opt-in quality policy routes', () => {
  it('passes an explicitly chosen policy through the single-run endpoint', async () => {
    const res = await request(makeApp(instructor)).post(`/api/courses/${courseId.toHexString()}/generate`)
      .send({ loId: loId.toHexString(), qualityPolicy: 'grounded-memory-v1' });
    expect(res.status).toBe(202);
    expect(enqueueGenerationRun).toHaveBeenCalledWith(expect.objectContaining({ qualityPolicy: 'grounded-memory-v1' }));
  });

  it('passes a one-run blueprint policy override without changing the saved recipe', async () => {
    const blueprintId = new ObjectId();
    const res = await request(makeApp(instructor)).post(`/api/courses/${courseId.toHexString()}/generate`)
      .send({ blueprintId: blueprintId.toHexString(), qualityPolicy: 'baseline' });
    expect(res.status).toBe(202);
    expect(enqueueBlueprintRun).toHaveBeenCalledWith(courseId, blueprintId, instructor.puid, 'baseline');
    expect(enqueueGenerationRun).not.toHaveBeenCalled();
  });

  it('passes batch policy without requiring a prompt or submission identifier', async () => {
    const res = await request(makeApp(instructor)).post(`/api/courses/${courseId.toHexString()}/generation-plan`)
      .send({ cells: [{ loId: loId.toHexString(), difficulty: 'easy', kind: 'conceptual', count: 1 }], qualityPolicy: 'grounded-memory-v1' });
    expect(res.status).toBe(202);
    expect(enqueueGenerationPlan).toHaveBeenCalledWith(courseId, expect.any(Array), instructor.puid, expect.objectContaining({ qualityPolicy: 'grounded-memory-v1' }));
  });

  it('rejects unknown policies before either enqueue path', async () => {
    const single = await request(makeApp(instructor)).post(`/api/courses/${courseId.toHexString()}/generate`)
      .send({ loId: loId.toHexString(), qualityPolicy: 'auto-publish' });
    const batch = await request(makeApp(instructor)).post(`/api/courses/${courseId.toHexString()}/generation-plan`)
      .send({ cells: [{ loId: loId.toHexString(), difficulty: 'easy', kind: 'conceptual', count: 1 }], qualityPolicy: 'auto-publish' });
    expect(single.status).toBe(400);
    expect(batch.status).toBe(400);
    expect(enqueueGenerationRun).not.toHaveBeenCalled();
    expect(enqueueGenerationPlan).not.toHaveBeenCalled();
  });

  it('reports the reviewer-required conflict without accepting a pilot run', async () => {
    jest.mocked(enqueueGenerationRun).mockRejectedValue(new Error('generation-quality-reviewer-required'));
    const res = await request(makeApp(instructor)).post(`/api/courses/${courseId.toHexString()}/generate`)
      .send({ loId: loId.toHexString(), qualityPolicy: 'grounded-memory-v1' });
    expect(res.status).toBe(409);
  });
});

describe('Task 10 presets and regeneration', () => {
  it('returns presets only to an instructor', async () => {
    const denied = await request(makeApp(student)).get('/api/generation/presets');
    expect(denied.status).toBe(403);

    const allowed = await request(makeApp(instructor)).get('/api/generation/presets');
    expect(allowed.status).toBe(200);
    expect(allowed.body).toHaveLength(4);
  });

  it('regenerates through a course-scoped instructor route without saving', async () => {
    jest.mocked(regenerateQuestion).mockResolvedValue({
      variant: { stem: 'Alternative', options: [], difficulty: 'medium' },
    } as never);

    const res = await request(makeApp(instructor))
      .post(`/api/courses/${courseId.toHexString()}/questions/${loId.toHexString()}/regenerate`)
      .send({ prompt: 'Change the scenario.' });

    expect(res.status).toBe(200);
    expect(res.body.variant.stem).toBe('Alternative');
    expect(regenerateQuestion).toHaveBeenCalledWith(
      loId,
      'Change the scenario.',
      'PUID-INSTR-0001',
      courseId,
    );
  });

  it('rejects non-instructors and empty regeneration prompts', async () => {
    const denied = await request(makeApp(student))
      .post(`/api/courses/${courseId.toHexString()}/questions/${loId.toHexString()}/regenerate`)
      .send({ prompt: 'Change it.' });
    expect(denied.status).toBe(403);

    const invalid = await request(makeApp(instructor))
      .post(`/api/courses/${courseId.toHexString()}/questions/${loId.toHexString()}/regenerate`)
      .send({ prompt: '   ' });
    expect(invalid.status).toBe(400);
    expect(regenerateQuestion).not.toHaveBeenCalled();
  });
});

describe('POST /api/courses/:courseId/generate (IN-Q10)', () => {
  it('403s a non-instructor and does not enqueue', async () => {
    const res = await request(makeApp(student))
      .post(`/api/courses/${courseId.toHexString()}/generate`)
      .send({ loId: loId.toHexString() });
    expect(res.status).toBe(403);
    expect(enqueueGenerationRun).not.toHaveBeenCalled();
  });

  it('400s a missing loId', async () => {
    const res = await request(makeApp(instructor))
      .post(`/api/courses/${courseId.toHexString()}/generate`)
      .send({ count: 3 });
    expect(res.status).toBe(400);
    expect(enqueueGenerationRun).not.toHaveBeenCalled();
  });

  it('400s an out-of-range count', async () => {
    const res = await request(makeApp(instructor))
      .post(`/api/courses/${courseId.toHexString()}/generate`)
      .send({ loId: loId.toHexString(), count: 999 });
    expect(res.status).toBe(400);
    expect(enqueueGenerationRun).not.toHaveBeenCalled();
  });

  it('202s an instructor, creates a durable run with the resolved payload, and returns its runId', async () => {
    const runId = new ObjectId();
    jest.mocked(enqueueGenerationRun).mockResolvedValue(runId);
    const res = await request(makeApp(instructor))
      .post(`/api/courses/${courseId.toHexString()}/generate`)
      .send({ loId: loId.toHexString(), count: 2, type: 'mcq', prompt: 'focus on IRR' });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ runId: runId.toHexString() });
    expect(enqueueGenerationRun).toHaveBeenCalledWith({
      courseId,
      loId,
      count: 2,
      type: 'mcq',
      prompt: 'focus on IRR',
      byPuid: 'PUID-INSTR-0001',
    });
  });

  it('defaults count when omitted', async () => {
    await request(makeApp(instructor))
      .post(`/api/courses/${courseId.toHexString()}/generate`)
      .send({ loId: loId.toHexString() });
    expect(jest.mocked(enqueueGenerationRun).mock.calls[0]![0]).toMatchObject({ count: 3 });
  });

  it('returns a recoverable conflict before enqueue when the LO has no assigned material', async () => {
    jest.mocked(enqueueGenerationRun).mockRejectedValue(new Error('generation-no-assigned-materials'));

    const res = await request(makeApp(instructor))
      .post(`/api/courses/${courseId.toHexString()}/generate`)
      .send({ loId: loId.toHexString() });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'generation-no-assigned-materials' });
  });

  describe('multi-LO generation (secondaryLoIds)', () => {
    const secondA = new ObjectId();
    const secondB = new ObjectId();
    const post = (body: Record<string, unknown>) =>
      request(makeApp(instructor)).post(`/api/courses/${courseId.toHexString()}/generate`).send(body);

    it('passes up to two distinct secondary objectives through as ObjectIds', async () => {
      const res = await post({
        loId: loId.toHexString(),
        secondaryLoIds: [secondA.toHexString(), secondB.toHexString()],
      });
      expect(res.status).toBe(202);
      expect(jest.mocked(enqueueGenerationRun).mock.calls[0]![0]).toMatchObject({
        loId,
        secondaryLoIds: [secondA, secondB],
      });
    });

    it('omits the field entirely when the list is empty', async () => {
      await post({ loId: loId.toHexString(), secondaryLoIds: [] });
      expect(jest.mocked(enqueueGenerationRun).mock.calls[0]![0]).not.toHaveProperty('secondaryLoIds');
    });

    it('400s more than two, a repeat of the primary, a duplicate, and a mix with blueprintId', async () => {
      const third = new ObjectId();
      for (const body of [
        { loId: loId.toHexString(), secondaryLoIds: [secondA, secondB, third].map((id) => id.toHexString()) },
        { loId: loId.toHexString(), secondaryLoIds: [loId.toHexString()] },
        { loId: loId.toHexString(), secondaryLoIds: [secondA.toHexString(), secondA.toHexString()] },
        { blueprintId: new ObjectId().toHexString(), secondaryLoIds: [secondA.toHexString()] },
      ]) {
        const res = await post(body);
        expect(res.status).toBe(400);
      }
      expect(enqueueGenerationRun).not.toHaveBeenCalled();
    });

    it('maps the secondary-objective service errors to actionable statuses', async () => {
      for (const [code, status] of [
        ['generation-secondary-lo-no-materials', 409],
        ['generation-secondary-lo-duplicate', 400],
        ['generation-secondary-lo-no-grounding', 422],
      ] as const) {
        jest.mocked(enqueueGenerationRun).mockRejectedValueOnce(new Error(code));
        const res = await post({ loId: loId.toHexString(), secondaryLoIds: [secondA.toHexString()] });
        expect(res.status).toBe(status);
        expect(res.body).toEqual({ error: code });
      }
    });
  });
});

describe('GET /api/courses/:courseId/preseeding (IN-Q10)', () => {
  it('403s a non-instructor', async () => {
    const res = await request(makeApp(student)).get(`/api/courses/${courseId.toHexString()}/preseeding`);
    expect(res.status).toBe(403);
    expect(preseedingProgress).not.toHaveBeenCalled();
  });

  it('200s an instructor and returns the per-LO progress', async () => {
    jest
      .mocked(preseedingProgress)
      .mockResolvedValue([
        { loId, loName: 'Compute IRR', approved: 4, reviewed: 1, unapproved: 3, target: 5 },
      ] as never);

    const res = await request(makeApp(instructor)).get(`/api/courses/${courseId.toHexString()}/preseeding`);

    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      loName: 'Compute IRR',
      approved: 4,
      reviewed: 1,
      unapproved: 3,
      target: 5,
    });
    expect(preseedingProgress).toHaveBeenCalledWith(expect.any(ObjectId));
  });
});


describe('stored-candidate adoption prerequisite failures', () => {
  const questionId = new ObjectId();
  const candidateId = new ObjectId();
  const expectedVersionId = new ObjectId();
  const url = `/api/courses/${courseId}/questions/${questionId}/regeneration-candidates/${candidateId}/adopt`;
  const payload = { expectedVersionId: expectedVersionId.toHexString() };

  it.each([
    [undefined, 401], [student, 403], [userFixture([{ courseId: new ObjectId(), role: 'instructor' }]), 403],
  ] as const)('checks course access before inspecting a candidate (%s)', async (user, status) => {
    const response = await request(makeApp(user)).post(url).send(payload);
    expect(response.status).toBe(status);
    expect(adoptRegenerationCandidate).not.toHaveBeenCalled();
  });

  it('requires a version pin and rejects client-provided eligibility flags', async () => {
    for (const body of [{}, { ...payload, eligible: true }]) {
      const response = await request(makeApp(instructor)).post(url).send(body);
      expect(response.status).toBe(400);
    }
    expect(adoptRegenerationCandidate).not.toHaveBeenCalled();
  });

  it('binds adoption to the signed-in actor and parsed course/question/version IDs', async () => {
    jest.mocked(adoptRegenerationCandidate).mockResolvedValue({ version: { _id: new ObjectId() } } as never);
    const response = await request(makeApp(instructor)).post(url).send(payload);
    expect(response.status).toBe(200);
    expect(adoptRegenerationCandidate).toHaveBeenCalledWith({ courseId, questionId, candidateId,
      expectedVersionId, byPuid: instructor.puid });
  });

  it.each([
    'generation-evidence-source-changed', 'generation-evidence-provenance-changed', 'generation-evidence-material-unavailable',
    'generation-evidence-source-not-ready', 'generation-evidence-chunks-missing', 'generation-evidence-ingest-incomplete',
    'authoring-objective-changed', 'generation-memory-original-changed', 'generation-memory-original-version-unavailable',
    'authoring-memory-changed', 'question-changed-during-regeneration', 'authoring-exact-bank-duplicate', 'generation-task-retrieval-scope-changed',
  ])('returns an actionable conflict for %s', async code => {
    jest.mocked(adoptRegenerationCandidate).mockRejectedValue(new Error(code));
    const response = await request(makeApp(instructor)).post(url).send(payload);
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: code });
  });

  it.each([
    'regeneration-original-comparison-required', 'authoring-original-comparison-required',
    'authoring-original-comparison-invalid', 'generation-memory-original-scope-missing',
    'generation-memory-required-original-missing', 'generation-memory-required-original-too-large',
    'regeneration-candidate-not-eligible', 'generation-evidence-schema-invalid', 'generation-exact-bank-receipt-invalid',
    'generation-task-retrieval-receipt-invalid', 'generation-task-retrieval-assessment-invalid',
    'generation-task-retrieval-selection-invalid', 'generation-task-retrieval-query-invalid',
    'generation-task-retrieval-scope-invalid', 'generation-task-retrieval-policy-invalid',
    'generation-task-retrieval-protocol-invalid', 'generation-task-retrieval-vector-invalid', 'generation-task-retrieval-limits-invalid',
  ])('keeps an unusable retained candidate unprocessable for %s', async code => {
    jest.mocked(adoptRegenerationCandidate).mockRejectedValue(new Error(code));
    const response = await request(makeApp(instructor)).post(url).send(payload);
    expect(response.status).toBe(422);
    expect(response.body).toEqual({ error: code });
  });

  it('keeps incomplete task retrieval retryable without claiming stale retained content', async () => {
    jest.mocked(adoptRegenerationCandidate).mockRejectedValue(new Error('generation-task-retrieval-incomplete'));
    const response = await request(makeApp(instructor)).post(url).send(payload);
    expect(response.status).toBe(503); expect(response.body).toEqual({ error: 'generation-task-retrieval-incomplete' });
  });

  it('keeps incomplete Bank scanning retryable without claiming a stale candidate', async () => {
    jest.mocked(adoptRegenerationCandidate).mockRejectedValue(new Error('authoring-exact-bank-incomplete'));
    const response = await request(makeApp(instructor)).post(url).send(payload);
    expect(response.status).toBe(503); expect(response.body).toEqual({ error: 'authoring-exact-bank-incomplete' });
  });

  it.each(['unexpected-storage-failure', 'generation-evidence-invalid-scope', 'generation-evidence-source-changed-unrecognized-suffix',
    'generation-evidence-provenance-changed-unrecognized-suffix', 'generation-evidence-schema-invalid-unrecognized-suffix'])('keeps unexpected failures at 500: %s', async code => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      jest.mocked(adoptRegenerationCandidate).mockRejectedValue(new Error(code));
      const response = await request(makeApp(instructor)).post(url).send(payload);
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: code });
    } finally { errorLog.mockRestore(); }
  });
});
