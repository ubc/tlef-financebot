import { Router } from 'express';
import type { Response } from 'express';
import { ObjectId, type WithId } from 'mongodb';
import { z } from 'zod';
import { ensureCourseInstructor } from '../components/auth/course-guards';
import { validate } from '../middleware/validate';
import {
  getCourseContentRun,
  listCourseContentRuns,
  subscribeToCourseContentRuns,
} from '../services/content-runs.service';
import type { ContentRun } from '../types/domain';

export const contentRunsRouter = Router();

const objectIdParam = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id.');
const courseIdParams = z.object({ courseId: objectIdParam });
const runParams = z.object({ courseId: objectIdParam, runId: objectIdParam });
const listQuery = z.object({
  kind: z.enum(['material-ingest', 'question-generation']).optional(),
  status: z.enum(['queued', 'running', 'completed', 'partial', 'failed']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

type ContentRunSummary = Omit<WithId<ContentRun>, 'events'>;

function toSummary(run: WithId<ContentRun>): ContentRunSummary {
  const { events, ...summary } = run;
  void events;
  return summary;
}

function writeEvent(
  res: Response,
  event: string,
  data: unknown,
  id?: string,
): void {
  if (id) res.write(`id: ${id}\n`);
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/** GET /api/courses/:courseId/content-runs -> recent compact run history. */
contentRunsRouter.get(
  '/courses/:courseId/content-runs',
  validate({ params: courseIdParams, query: listQuery }),
  ensureCourseInstructor(),
  async (req, res) => {
    const courseId = new ObjectId(String(req.params.courseId));
    const query = req.query as unknown as z.infer<typeof listQuery>;
    const runs = await listCourseContentRuns(courseId, query);
    res.json(runs.map(toSummary));
  },
);

/** One authenticated EventSource per course, covering all active content runs. */
contentRunsRouter.get(
  '/courses/:courseId/content-runs/events',
  validate({ params: courseIdParams }),
  ensureCourseInstructor(),
  async (req, res, next) => {
    const courseId = new ObjectId(String(req.params.courseId));
    const buffered: Array<WithId<ContentRun>> = [];
    let streaming = false;
    let closed = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;

    const unsubscribe = subscribeToCourseContentRuns(courseId, (run) => {
      if (!streaming) {
        buffered.push(run);
        return;
      }
      writeEvent(res, 'run', toSummary(run), `${run._id.toHexString()}:${run.revision}`);
    });

    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = undefined;
    };
    req.on('close', cleanup);

    try {
      // Include terminal history as well as active work. A run can finish while
      // EventSource is disconnected; active-only replay would leave the
      // browser's last `running` snapshot stuck forever after reconnect.
      const recent = await listCourseContentRuns(courseId, { limit: 100 });
      if (closed) return;
      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      writeEvent(res, 'snapshot', { runs: recent.map(toSummary) });
      streaming = true;
      for (const run of buffered) {
        writeEvent(res, 'run', toSummary(run), `${run._id.toHexString()}:${run.revision}`);
      }
      buffered.length = 0;
      heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20_000);
    } catch (error) {
      cleanup();
      next(error);
    }
  },
);

/** GET /api/courses/:courseId/content-runs/:runId -> full persisted snapshot. */
contentRunsRouter.get(
  '/courses/:courseId/content-runs/:runId',
  validate({ params: runParams }),
  ensureCourseInstructor(),
  async (req, res) => {
    const run = await getCourseContentRun(
      new ObjectId(String(req.params.courseId)),
      new ObjectId(String(req.params.runId)),
    );
    if (!run) {
      res.status(404).json({ error: 'content-run-not-found' });
      return;
    }
    res.json(run);
  },
);
