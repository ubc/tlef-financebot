import { createApp } from './app';
import { env, assertConfig } from './config/env';
import { connectMongo, closeMongo } from './components/mongodb';
import { ensureIndexes } from './components/mongodb/collections';
import { verifyIdpCertificatePresent } from './components/auth';
import { pingQdrant } from './components/qdrant';
import { startJobs } from './components/jobs';

async function main(): Promise<void> {
  // Refuse to boot with insecure/incomplete production configuration. No-op in
  // development. Do this before anything else so misconfig fails immediately.
  assertConfig();

  // Fail fast (with guidance) if the SAML IdP certificate is missing; log it
  // when present. This is a local file check, so do it before anything else.
  verifyIdpCertificatePresent();

  // Connect to MongoDB before accepting traffic so a bad URI / unreachable
  // database fails fast at startup rather than on the first request.
  await connectMongo();
  console.log('[server] connected to MongoDB');

  await ensureIndexes();
  console.log('[server] MongoDB indexes ensured');

  await startJobs();
  console.log('[server] job queue started');

  // Registers the material.ingest job handler — its module-level defineJob()
  // call requires startJobs() to have already run, so this import must happen
  // here (dynamic, not a static top-of-file import) rather than at module
  // load time. See services/materials.service.ts and components/jobs/AGENTS.md.
  await import('./services/materials.service.js');

  // Qdrant powers the (deletable) RAG example. It is not required for the app to
  // boot, so log a warning with guidance rather than failing fast.
  if (await pingQdrant()) {
    console.log(`[server] Qdrant reachable at ${env.qdrantUrl}`);
  } else {
    console.warn(
      `[server] WARNING: Qdrant not reachable at ${env.qdrantUrl}. The RAG ` +
        'example (/api/rag/*) will not work until it is running. See the README ' +
        '"Qdrant" section to start a local instance.',
    );
  }

  // Summarize the GenAI config up front. The embeddings module is created
  // lazily (on first ingest/query), so its own init log — and the toolkit's
  // separate chat-LLM log line, which shows `embeddingModel: undefined` because
  // that client only does text generation — otherwise make the startup output
  // confusing. This one line is the source of truth for what RAG will use.
  console.log(
    `[server] GenAI: LLM=${env.llmProvider}/${env.llmDefaultModel}, ` +
      `embeddings=${env.embeddingsProvider}/${env.embeddingsModel} ` +
      '(embeddings module initializes on first use)',
  );

  const app = createApp();
  const server = app.listen(env.port, () => {
    console.log(`[server] listening on http://localhost:${env.port} (${env.nodeEnv})`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n[server] ${signal} received, shutting down...`);
    server.close();
    await closeMongo();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('[server] failed to start:', error);
  process.exit(1);
});
