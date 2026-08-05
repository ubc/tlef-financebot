import { Router, type NextFunction, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { ensureApiAuthenticated, ensureCapability } from '../components/auth';
import { flagsCol } from '../components/mongodb/collections';
import { validate } from '../middleware/validate';
import { getQuestionCourseId, reviewQueue } from '../services/bank.service';
import { listFlags } from '../services/flags.service';
import { toFlagResponse } from './flags.routes';
import { toBankItem, toQuestionResponse } from './questions.routes';
import { addQuestionInternalNote, transitionQuestion } from '../services/questions.service';
import {
  addTa,
  escalateFlag,
  listTas,
  proactivelyEscalateQuestion,
  reinviteTa,
  resolveQuestionSuggestion,
  setTaPermissions,
  suggestQuestionEdit,
} from '../services/tas.service';
import { CAPABILITIES } from '../services/capabilities.service';
import type { Capability } from '../types/domain';

export const tasRouter = Router();

const objectIdParam = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id.');
const courseParams = z.object({ courseId: objectIdParam });
const taParams = z.object({ courseId: objectIdParam, puid: z.string().trim().min(1) });
const questionParams = z.object({ questionId: objectIdParam });
const suggestionParams = z.object({ questionId: objectIdParam, suggestionId: objectIdParam });
const flagParams = z.object({ flagId: objectIdParam });
const inviteBody = z.object({ email: z.string().trim().email() });
const capabilityShape = Object.fromEntries(
  CAPABILITIES.map((capability) => [capability, z.boolean().optional()]),
) as Record<Capability, z.ZodOptional<z.ZodBoolean>>;
const permissionsBody = z.object({ permissions: z.object(capabilityShape).partial() });
const optionBody = z.object({
  key: z.string().min(1),
  text: z.string().min(1),
  role: z.enum(['correct', 'common-misconception', 'partially-correct', 'clearly-wrong']),
  explanation: z.string(),
});
const suggestionBody = z.object({
  stem: z.string().min(1).optional(),
  options: z.array(optionBody).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  loIds: z.array(objectIdParam).optional(),
  themeIds: z.array(objectIdParam).optional(),
}).refine((body) => Object.keys(body).length > 0, { message: 'Suggestion patch required.' });
const noteBody = z.object({ text: z.string().trim().min(1).max(2000) });
const escalateBody = z.object({
  recommendation: z.enum(['correct', 'archive', 'clear']),
  note: z.string().trim().max(2000).optional(),
});
const proactiveBody = z.object({
  reasonCategory: z.string().trim().min(1).max(100),
  note: z.string().trim().max(2000).optional(),
});

function stashQuestionCourse(): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    getQuestionCourseId(new ObjectId(String(req.params.questionId)))
      .then((courseId) => {
        if (!courseId) {
          res.status(404).json({ error: 'question-not-found' });
          return;
        }
        res.locals.courseId = courseId.toHexString();
        next();
      })
      .catch(next);
  };
}

function stashFlagCourse(): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    flagsCol().findOne(
      { _id: new ObjectId(String(req.params.flagId)) },
      { projection: { courseId: 1 } },
    ).then((flag) => {
      if (!flag) {
        res.status(404).json({ error: 'flag-not-found' });
        return;
      }
      res.locals.courseId = flag.courseId.toHexString();
      next();
    }).catch(next);
  };
}

tasRouter.get(
  '/courses/:courseId/tas',
  validate({ params: courseParams }),
  ensureCapability('course.manage-tas'),
  async (req, res) => res.json(await listTas(new ObjectId(String(req.params.courseId)))),
);

tasRouter.post(
  '/courses/:courseId/tas',
  validate({ params: courseParams }),
  ensureCapability('course.manage-tas'),
  validate({ body: inviteBody }),
  async (req, res) => {
    const { email } = req.body as z.infer<typeof inviteBody>;
    res.status(201).json(await addTa(new ObjectId(String(req.params.courseId)), email));
  },
);

tasRouter.put(
  '/courses/:courseId/tas/:puid/permissions',
  validate({ params: taParams }),
  ensureCapability('course.manage-tas'),
  validate({ body: permissionsBody }),
  async (req, res) => {
    const { permissions } = req.body as z.infer<typeof permissionsBody>;
    await setTaPermissions(
      new ObjectId(String(req.params.courseId)),
      String(req.params.puid),
      permissions,
      req.user!.puid,
    );
    res.status(204).end();
  },
);

tasRouter.post(
  '/courses/:courseId/tas/:puid/reinvite',
  validate({ params: taParams }),
  ensureCapability('course.manage-tas'),
  async (req, res) => res.json(await reinviteTa(
    new ObjectId(String(req.params.courseId)),
    String(req.params.puid),
  )),
);

tasRouter.get(
  '/courses/:courseId/ta/review-queue',
  validate({ params: courseParams }),
  ensureCapability('question.review'),
  async (req, res) => {
    const items = await reviewQueue(new ObjectId(String(req.params.courseId)));
    // Built from the SAME `toBankItem` the instructor queue uses, plus the two
    // TA-only fields. This route used to hand-roll its own projection and
    // omitted `loIds`/`themeIds` — fields `BankQuestion` declares as required,
    // so the client typed them as present while the wire never carried them.
    // Nothing noticed until the TA queue grew a Topic/LO column and
    // `topicLoLabel` threw on `undefined.includes(...)`, killing the row render
    // after the tabs had already painted their counts.
    res.json(items.map((item) => ({
      ...toBankItem(item),
      priority: item.priority,
      suggestions: item.suggestions ?? [],
      internalNotes: item.internalNotes,
    })));
  },
);

tasRouter.post(
  '/questions/:questionId/mark-reviewed',
  validate({ params: questionParams }),
  ensureApiAuthenticated(),
  stashQuestionCourse(),
  ensureCapability('question.mark-reviewed'),
  async (req, res) => res.json(toQuestionResponse(await transitionQuestion(
    new ObjectId(String(req.params.questionId)),
    'reviewed',
    req.user!.puid,
  ))),
);

tasRouter.post(
  '/questions/:questionId/suggestions',
  validate({ params: questionParams }),
  ensureApiAuthenticated(),
  stashQuestionCourse(),
  ensureCapability('question.suggest-edit'),
  validate({ body: suggestionBody }),
  async (req, res) => {
    const body = req.body as z.infer<typeof suggestionBody>;
    const patch = {
      ...body,
      ...(body.loIds ? { loIds: body.loIds.map((id) => new ObjectId(id)) } : {}),
      ...(body.themeIds ? { themeIds: body.themeIds.map((id) => new ObjectId(id)) } : {}),
    };
    res.status(201).json(await suggestQuestionEdit(
      new ObjectId(String(req.params.questionId)),
      req.user!.puid,
      patch,
    ));
  },
);

for (const action of ['accept', 'discard'] as const) {
  tasRouter.post(
    `/questions/:questionId/suggestions/:suggestionId/${action}`,
    validate({ params: suggestionParams }),
    ensureApiAuthenticated(),
    stashQuestionCourse(),
    ensureCapability('question.approve'),
    async (req, res) => {
      await resolveQuestionSuggestion(
        new ObjectId(String(req.params.questionId)),
        new ObjectId(String(req.params.suggestionId)),
        action,
        req.user!.puid,
      );
      res.status(204).end();
    },
  );
}

tasRouter.post(
  '/questions/:questionId/notes',
  validate({ params: questionParams }),
  ensureApiAuthenticated(),
  stashQuestionCourse(),
  ensureCapability('question.review'),
  validate({ body: noteBody }),
  async (req, res) => {
    const { text } = req.body as z.infer<typeof noteBody>;
    res.status(201).json(await addQuestionInternalNote(
      new ObjectId(String(req.params.questionId)), text, req.user!.puid,
    ));
  },
);

/** GET /courses/:courseId/ta/flags -> the same rows the instructor queue gets
 * from GET /courses/:courseId/flags, and serialized the SAME way.
 *
 * This route used to return `listFlags()` raw, so its rows carried Mongo's
 * `_id` while every other flag endpoint (and the client's `Flag` type) uses
 * `id`. The TA flag view therefore read `flag.id` as undefined and posted to
 * `/api/flags/undefined/escalate`, which the `flagId` param regex rejected
 * with a 400 "Invalid request." — i.e. TA escalation could never have worked.
 * It went unnoticed because exercising it needs a real `ta` courseRole; an
 * instructor's "View as TA" reaches the same button and fails identically. */
tasRouter.get(
  '/courses/:courseId/ta/flags',
  validate({ params: courseParams }),
  ensureCapability('flag.triage'),
  async (req, res) => {
    const flags = await listFlags(new ObjectId(String(req.params.courseId)));
    res.json(flags.map((flag) => toFlagResponse(flag)));
  },
);

tasRouter.post(
  '/flags/:flagId/escalate',
  validate({ params: flagParams }),
  ensureApiAuthenticated(),
  stashFlagCourse(),
  ensureCapability('flag.triage'),
  validate({ body: escalateBody }),
  async (req, res) => {
    const body = req.body as z.infer<typeof escalateBody>;
    res.json(toFlagResponse(await escalateFlag(
      new ObjectId(String(req.params.flagId)), req.user!.puid,
      body.recommendation, body.note,
    )));
  },
);

tasRouter.post(
  '/questions/:questionId/escalate',
  validate({ params: questionParams }),
  ensureApiAuthenticated(),
  stashQuestionCourse(),
  ensureCapability('flag.triage'),
  validate({ body: proactiveBody }),
  async (req, res) => {
    const body = req.body as z.infer<typeof proactiveBody>;
    res.status(201).json(toFlagResponse(await proactivelyEscalateQuestion(
      new ObjectId(String(req.params.questionId)), req.user!.puid,
      body.reasonCategory, body.note,
    )));
  },
);

const ERROR_STATUS: Record<string, number> = {
  'ta-invalid-ubc-email': 400,
  'ta-invite-duplicate': 409,
  'ta-invite-not-found': 404,
  'ta-not-active': 404,
  'question-not-found': 404,
  'flag-not-found': 404,
  'suggestion-not-found': 404,
  'suggestion-patch-required': 400,
  'suggestion-already-resolved': 409,
  'suggestion-conflict': 409,
  'invalid-flag-transition': 409,
};

tasRouter.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof Error && Object.hasOwn(ERROR_STATUS, err.message)) {
    res.status(ERROR_STATUS[err.message]).json({ error: err.message });
    return;
  }
  next(err);
});
