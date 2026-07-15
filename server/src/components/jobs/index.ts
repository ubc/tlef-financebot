import { Agenda, type Job } from 'agenda';
import { env } from '../../config/env';

// MongoDB-backed background jobs (PRD §2): generation pipeline runs, batch
// mastery evaluation, term-expiry sweeps, daily summaries. One Agenda instance
// per process, started after Mongo connects (see server.ts).

let agenda: Agenda | undefined;

// agenda@4 expects mongodb@4 driver result shapes (e.g. findOneAndUpdate ->
// { value }). The repo's top-level driver is mongodb@7, which returns the doc
// directly and would silently break job locking (jobs enqueue but never run).
// So we do NOT share our MongoClient here; instead we hand agenda a connection
// string and let it use its OWN bundled mongodb@4 driver. The URI/db name still
// come only from `env`.
function agendaAddress(uri: string, dbName: string): string {
  const url = new URL(uri);
  url.pathname = `/${dbName}`;
  return url.toString();
}

export async function startJobs(): Promise<void> {
  if (agenda) return;
  agenda = new Agenda({
    db: { address: agendaAddress(env.mongodbUri, env.mongodbDbName), collection: 'agendaJobs' },
    processEvery: '5 seconds',
  });
  await agenda.start();
}

function requireAgenda(): Agenda {
  if (!agenda) throw new Error('Jobs not started. Call startJobs() during startup first.');
  return agenda;
}

export function defineJob<T>(name: string, handler: (data: T) => Promise<void>): void {
  requireAgenda().define(name, async (job: Job) => {
    await handler(job.attrs.data as T);
  });
}

export async function enqueueJob<T>(name: string, data: T): Promise<void> {
  await requireAgenda().now(name, data as never);
}

export async function scheduleRecurring(name: string, interval: string): Promise<void> {
  await requireAgenda().every(interval, name);
}

export async function stopJobs(): Promise<void> {
  await agenda?.stop();
  agenda = undefined;
}
