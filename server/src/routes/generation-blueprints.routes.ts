import { Router, type NextFunction, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { ensureCourseInstructor } from '../components/auth/course-guards';
import { validate } from '../middleware/validate';
import {
  createGenerationBlueprint,
  enqueueBlueprintRun,
  listGenerationBlueprints,
  updateGenerationBlueprint,
  type GenerationBlueprintInput,
} from '../services/generation-blueprints.service';

export const generationBlueprintsRouter = Router();

const objectIdParam = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id.');
const courseParams = z.object({ courseId: objectIdParam });
const blueprintParams = z.object({ courseId: objectIdParam, blueprintId: objectIdParam });
const blueprintBody = z.object({
  name: z.string().trim().min(1).max(120),
  loId: objectIdParam,
  count: z.number().int().min(1).max(20),
  type: z.enum(['mcq', 'true-false']),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  prompt: z.string().max(2000).optional(),
  materialIds: z.array(objectIdParam).max(100).optional(),
});
const blueprintPatch = blueprintBody.partial();

generationBlueprintsRouter.get(
  '/courses/:courseId/generation-blueprints',
  validate({ params: courseParams }),
  ensureCourseInstructor(),
  async (req, res) => {
    res.json(await listGenerationBlueprints(new ObjectId(String(req.params.courseId))));
  },
);

generationBlueprintsRouter.post(
  '/courses/:courseId/generation-blueprints',
  validate({ params: courseParams }),
  ensureCourseInstructor(),
  validate({ body: blueprintBody }),
  async (req, res) => {
    const body = req.body as z.infer<typeof blueprintBody>;
    const input: GenerationBlueprintInput = {
      name: body.name,
      loId: new ObjectId(body.loId),
      count: body.count,
      type: body.type,
      ...(body.difficulty ? { difficulty: body.difficulty } : {}),
      ...(body.prompt !== undefined ? { prompt: body.prompt } : {}),
      ...(body.materialIds
        ? { materialIds: body.materialIds.map((id) => new ObjectId(id)) }
        : {}),
    };
    const blueprint = await createGenerationBlueprint(
      new ObjectId(String(req.params.courseId)),
      req.user!.puid,
      input,
    );
    res.status(201).json(blueprint);
  },
);

generationBlueprintsRouter.patch(
  '/courses/:courseId/generation-blueprints/:blueprintId',
  validate({ params: blueprintParams }),
  ensureCourseInstructor(),
  validate({ body: blueprintPatch }),
  async (req, res) => {
    const body = req.body as z.infer<typeof blueprintPatch>;
    const patch: Partial<GenerationBlueprintInput> = {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.loId ? { loId: new ObjectId(body.loId) } : {}),
      ...(body.count !== undefined ? { count: body.count } : {}),
      ...(body.type ? { type: body.type } : {}),
      ...(body.difficulty ? { difficulty: body.difficulty } : {}),
      ...(body.prompt !== undefined ? { prompt: body.prompt } : {}),
      ...(body.materialIds
        ? { materialIds: body.materialIds.map((id) => new ObjectId(id)) }
        : {}),
    };
    res.json(
      await updateGenerationBlueprint(
        new ObjectId(String(req.params.courseId)),
        new ObjectId(String(req.params.blueprintId)),
        patch,
      ),
    );
  },
);

generationBlueprintsRouter.post(
  '/courses/:courseId/generation-blueprints/:blueprintId/run',
  validate({ params: blueprintParams }),
  ensureCourseInstructor(),
  async (req, res) => {
    const runId = await enqueueBlueprintRun(
      new ObjectId(String(req.params.courseId)),
      new ObjectId(String(req.params.blueprintId)),
      req.user!.puid,
    );
    res.status(202).json({ runId: runId.toHexString() });
  },
);

const ERROR_STATUS: Record<string, number> = {
  'generation-blueprint-not-found': 404,
  'generation-blueprint-name-conflict': 409,
  'lo-not-in-course': 400,
  'blueprint-material-not-ready': 400,
  'content-run-enqueue-failed': 503,
};

generationBlueprintsRouter.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof Error && ERROR_STATUS[err.message]) {
    res.status(ERROR_STATUS[err.message]).json({ error: err.message });
    return;
  }
  next(err);
});
