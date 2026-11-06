/** Real-provider acceptance over already ingested originals in a local test DB.
 * This script never uploads, fabricates indexing manifests, applies an outline,
 * changes model settings or deletes sources. Calls incur configured provider usage. */
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { env } from '../server/src/config/env';
import { connectMongo, closeMongo } from '../server/src/components/mongodb';
import { coursesCol, sourceEvidenceExtractionsCol } from '../server/src/components/mongodb/collections';
import { createStructureGenerationRun, getContentRun } from '../server/src/services/content-runs.service';
import { runStructureGeneration } from '../server/src/services/structure-generation.service';
import { summarizeModelUsage } from '../server/src/services/model-usage.service';
import type { StructureOptions } from '../server/src/types/structure';
import { initializeAuthoringCommitSupport } from '../server/src/services/authoring-commit.service';

const id = z.string().regex(/^[0-9a-f]{24}$/);
const manifestSchema = z.object({ courseId: id, baseMaterialIds: z.array(id).length(10), appendMaterialId: id,
  replacedMaterialId: id, replacementMaterialId: id, guidance: z.string().max(2000).optional(), sourceBatchId: id.optional(),
  database: z.string().optional() }).strip();
const phaseNames = ['cold', 'warm', 'addition', 'replacement'] as const;
type Phase = typeof phaseNames[number];

async function priorAttemptCosts(outputPath: string): Promise<Array<Record<string, unknown>>> {
  const directory = dirname(resolve(outputPath));
  const files = (await readdir(directory).catch(() => [])).filter(file => /^source-cache-attempt-\d+\.json$/.test(file)).sort();
  const seen = new Set<string>(); const rows: Array<Record<string, unknown>> = [];
  for (const file of files) {
    const report = JSON.parse(await readFile(resolve(directory, file), 'utf8'));
    for (const row of Array.isArray(report.rows) ? report.rows : []) {
      if (typeof row.runId !== 'string' || seen.has(row.runId)) continue;
      seen.add(row.runId);
      const current = ObjectId.isValid(row.runId) ? await getContentRun(new ObjectId(row.runId)) : null;
      rows.push({ file, runId: row.runId, phase: row.phase, status: current?.status ?? row.status, snapshotStatus: row.status, durationMs: row.durationMs,
        observedCalls: row.usage?.observedCalls ?? null, inputTokens: row.usage?.inputTokens ?? null,
        outputTokens: row.usage?.outputTokens ?? null, usageCompleteness: row.usage?.status ?? 'unavailable' });
    }
  }
  return rows;
}

async function main(): Promise<void> {
  const argumentsMap = new Map<string, string>();
  for (let index = 2; index < process.argv.length; index += 2) argumentsMap.set(process.argv[index], process.argv[index + 1] ?? '');
  const manifestPath = argumentsMap.get('--manifest');
  const outputPath = argumentsMap.get('--output');
  if (!manifestPath || !outputPath) throw new Error('Pass --manifest <ingested-local-corpus.json> --output <receipt.json> [--phase cold|warm|addition|replacement|all].');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(env.mongodbUri).hostname), 'A local MongoDB is required.');
  assert.match(env.mongodbDbName, /quality|acceptance|test/i, 'Use a dedicated local quality/acceptance/test database.');
  const manifest = manifestSchema.parse(JSON.parse(await readFile(resolve(manifestPath), 'utf8')));
  if (manifest.database) assert.equal(manifest.database, env.mongodbDbName, 'The manifest database must match the configured local database.');
  assert.equal(new Set(manifest.baseMaterialIds).size, 10, 'Base chapters must be ten different materials.');
  assert.ok(manifest.baseMaterialIds.includes(manifest.replacedMaterialId), 'The replacement must name an existing base chapter.');
  assert.ok(!manifest.baseMaterialIds.includes(manifest.appendMaterialId) && !manifest.baseMaterialIds.includes(manifest.replacementMaterialId), 'Additions/replacements are distinct snapshots.');
  const selectedPhase = argumentsMap.get('--phase') ?? 'all';
  assert.ok(selectedPhase === 'all' || phaseNames.includes(selectedPhase as Phase), 'Unknown phase.');
  await connectMongo();
  const commitSupport = await initializeAuthoringCommitSupport();
  const courseId = new ObjectId(manifest.courseId);
  const course = await coursesCol().findOne({ _id: courseId });
  assert.ok(course, 'The local corpus course must already exist.');
  await sourceEvidenceExtractionsCol().createIndex({ courseId: 1, cacheKey: 1 }, { unique: true });
  const preexistingCacheUnits = await sourceEvidenceExtractionsCol().countDocuments({ courseId });
  if (selectedPhase === 'all' || selectedPhase === 'cold') {
    assert.ok(preexistingCacheUnits === 0 || argumentsMap.get('--allow-existing-cache') === 'true', 'Cold measurement needs an unused cache, or explicit --allow-existing-cache true with reuse disclosed.');
  }
  const phases = selectedPhase === 'all' ? [...phaseNames] : [selectedPhase as Phase];
  const rows: Array<Record<string, unknown>> = [];
  const optionsFor = (phase: Phase): StructureOptions & { materialIds: string[] } => ({
    materialIds: phase === 'addition' || phase === 'replacement' ? [...manifest.baseMaterialIds, manifest.appendMaterialId] : manifest.baseMaterialIds,
    guidance: manifest.guidance ?? 'Preserve source notation and explicit learning outcomes. Merge repeated topics across chapters without adding outside knowledge.',
    ...(phase === 'replacement' ? { sourceReplacements: [{ previousMaterialId: manifest.replacedMaterialId, replacementMaterialId: manifest.replacementMaterialId }] } : {}),
  });
  let failed = false;
  try {
    for (const phase of phases) {
      const started = Date.now();
      const run = await createStructureGenerationRun({ courseId, requestedBy: course.ownerPuid, options: optionsFor(phase) });
      await runStructureGeneration(run._id);
      const finished = await getContentRun(run._id);
      assert.equal(finished?.kind, 'structure-generation');
      if (finished?.kind !== 'structure-generation') throw new Error('Missing structure run.');
      const usage = await summarizeModelUsage({ courseId: manifest.courseId, runId: run._id.toHexString() });
      const coverage = finished.structureResult?.coverage;
      const diagnostic = finished.structureDiagnostics;
      const row = { phase, runId: run._id.toHexString(), status: finished.status, durationMs: Date.now() - started,
        cacheState: coverage ? coverage.cache.hits === 0 ? 'cold-under-current-identity' : coverage.cache.misses === 0 ? 'warm' : 'partial-reuse' : 'incomplete',
        ...(finished.error ? { error: finished.error } : {}), sourceSelection: coverage?.sourceSelection ?? diagnostic?.sourceSelection,
        cache: coverage?.cache ?? diagnostic?.cache, budget: coverage?.budget ?? diagnostic?.budget,
        synthesisInput: coverage?.synthesisInput ?? diagnostic?.synthesisInput,
        synthesisState: (coverage?.synthesisInput ?? diagnostic?.synthesisInput)?.newPacks === 0 ? 'validated-pack-replay' :
          (coverage?.synthesisInput ?? diagnostic?.synthesisInput)?.reusedPacks ? 'partial-pack-replay' : 'priming-or-uncached-synthesis',
        unprocessedSections: diagnostic?.unprocessedSections ?? [], usage,
        ...(coverage ? { analyzedSections: coverage.analyzedSections, extractedObjectives: coverage.extractedObjectives,
          mappedObjectives: coverage.mappedObjectives, unmappedEvidenceIds: coverage.unmappedEvidenceIds, excludedSections: coverage.excludedSections,
          warnings: coverage.warnings, topics: finished.structureResult!.themes.length,
          learningObjectives: finished.structureResult!.themes.reduce((sum, theme) => sum + theme.los.length, 0) } : {}) };
      rows.push(row);
      if (finished.status !== 'completed') { failed = true; break; }
      const expectedSources = phase === 'cold' || phase === 'warm' ? 10 : 11;
      assert.equal(coverage?.materials.length, expectedSources, `${phase} source accounting`);
      if (phase === 'warm') { assert.equal(coverage?.cache.misses, 0); assert.equal(coverage?.cache.extractedSections, 0); }
      if (phase === 'addition') assert.equal(coverage?.materials.filter(source => source.materialId === manifest.appendMaterialId).length, 1);
      if (phase === 'replacement') {
        assert.ok(coverage?.materials.every(source => source.materialId !== manifest.replacedMaterialId));
        assert.ok(coverage?.materials.some(source => source.materialId === manifest.replacementMaterialId));
      }
      await mkdir(dirname(resolve(outputPath)), { recursive: true });
      await writeFile(resolve(outputPath), JSON.stringify({ outcome: 'running', courseId: manifest.courseId, rows }, null, 2));
    }
    await mkdir(dirname(resolve(outputPath)), { recursive: true });
    await writeFile(resolve(outputPath), JSON.stringify({ outcome: failed ? 'incomplete' : 'passed', courseId: manifest.courseId, preexistingCacheUnits,
      provider: env.llmProvider, commitSupport, rows, priorTuningAttempts: await priorAttemptCosts(outputPath), limitations: [
        'Original sources were already parsed/chunked/indexed; admission and ingestion cost is measured separately.',
        'Per-phase measurements are one run, not p50/p95 performance estimates.',
        'Source traversal and citation validity do not prove complete instructional coverage or semantic grounding.',
        'Configured SDK hidden retries, embeddings and parsing costs are outside these observed LLM receipts.',
        'No professor acceptance labels or active review minutes were collected by this script.',
      ] }, null, 2));
    console.log(JSON.stringify({ outcome: failed ? 'incomplete' : 'passed', output: resolve(outputPath), phases: rows.map(row => ({ phase: row.phase, status: row.status, durationMs: row.durationMs, cache: row.cache })) }, null, 2));
    if (failed) process.exitCode = 1;
  } finally { await closeMongo(); }
}
main().catch(error => {
  console.error(JSON.stringify({ outcome: 'failed', errorType: error instanceof Error ? error.name : 'UnknownError',
    code: error instanceof z.ZodError ? 'invalid-manifest' : error instanceof Error && /^[a-z0-9-]+$/.test(error.message) ? error.message : 'acceptance-failed' }));
  process.exitCode = 1;
}).finally(() => closeMongo());
