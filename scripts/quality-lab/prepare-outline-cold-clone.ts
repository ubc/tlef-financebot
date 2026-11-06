import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { fixtureSections, validateDeclaredColdFixture, type OutlineCorpusFixture } from './outline-controls';
import { hashControl, safeError, sha256 } from './protocol';
import { readDeclaredOutlinePhase } from './phase-declaration';

interface ClonePlan {
  version: 1; id: string; createdAt: string; phaseFile: string; phaseSha256: string; ledger: string; scope: string;
  origin: { file: string; sha256: string; courseId: string; actor: string; database: string };
  fixture: OutlineCorpusFixture & { files: string[]; coldClone: { planFile: string; executionReceipt: string; id: string; mode: string } };
  mappings: Array<{ originMaterialId: string; materialId: string; chunks: string[]; storagePath: string }>;
}
const argument = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
export function validateClonePlan(plan: ClonePlan, origin: OutlineCorpusFixture): void {
  validateDeclaredColdFixture(plan.fixture, origin);
  const newIds = [plan.fixture.courseId, ...plan.mappings.map(mapping => mapping.materialId), ...plan.mappings.flatMap(mapping => mapping.chunks)];
  if (plan.version !== 1 || plan.fixture.fixtureKind !== 'recorded-index-cold-clone' || plan.origin.courseId !== origin.courseId || plan.origin.actor !== origin.actor ||
      plan.fixture.actor !== origin.actor || plan.origin.database !== origin.database || plan.mappings.length !== 10 ||
      plan.mappings.some((mapping, index) => mapping.originMaterialId !== origin.sources[index]?.materialId || mapping.materialId !== plan.fixture.sources[index]?.materialId ||
        mapping.chunks.length !== origin.sources[index]?.chunks.length || mapping.chunks.some(id => !/^[a-f0-9]{24}$/.test(id)) ||
        path.dirname(mapping.storagePath) !== path.resolve('uploads') || !/^[a-f0-9-]{36}\.pdf$/.test(path.basename(mapping.storagePath))) ||
      new Set(newIds).size !== newIds.length || newIds.some(id => id === origin.courseId || origin.sources.some(source => source.materialId === id))) throw new Error('quality-lab-outline-clone-plan-invalid');
  for (const [index, source] of plan.fixture.sources.entries()) {
    const old = origin.sources[index]!;
    if (hashControl(source.chunks) !== hashControl(old.chunks) || source.manifest.sourceTextHash !== old.manifest.sourceTextHash || source.manifest.parserVersion !== old.manifest.parserVersion || source.manifest.chunkerVersion !== old.manifest.chunkerVersion) throw new Error('quality-lab-outline-clone-source-changed');
  }
}
async function main() {
  const planPath = argument('--plan'); const apply = argument('--apply');
  if (apply !== undefined && apply !== 'once') throw new Error('quality-lab-outline-clone-apply-must-be-once');
  if (!planPath) {
    if (apply) throw new Error('quality-lab-outline-clone-existing-plan-required');
    const phaseFile = argument('--phase-declaration'); const phaseSha256 = argument('--phase-sha256'); const output = argument('--output');
    if (!phaseFile || !phaseSha256 || !output) throw new Error('Supply --phase-declaration, --phase-sha256 and NEW --output for a file-only clone plan. Root may later execute --plan/--plan-sha256/--apply once.');
    const declaration = JSON.parse(await readFile(phaseFile, 'utf8')) as { ledger: string; scope: string };
    const phase = await readDeclaredOutlinePhase(phaseFile, phaseSha256, declaration.ledger, declaration.scope, true);
    const originRaw = await readFile(phase.declaration.sourceFixtureOrigin.path, 'utf8'); const origin = JSON.parse(originRaw) as OutlineCorpusFixture; fixtureSections(origin);
    const id = randomUUID(); const createdAt = new Date().toISOString(); const courseId = new ObjectId().toHexString();
    const mappings = origin.sources.map(source => ({ originMaterialId: source.materialId, materialId: new ObjectId().toHexString(), chunks: source.chunks.map(() => new ObjectId().toHexString()), storagePath: path.resolve('uploads', `${randomUUID()}.pdf`) }));
    const sources = origin.sources.map((source, index) => {
      const manifest = { ...source.manifest } as typeof source.manifest & { ingestRunId?: string }; delete manifest.ingestRunId;
      const snapshot = { ...source.readiness.snapshot!, materialId: mappings[index]!.materialId, revision: 0 }; delete snapshot.ingestRunId;
      return { ...source, materialId: mappings[index]!.materialId, manifest, readiness: { ...source.readiness, materialId: mappings[index]!.materialId, classification: 'unknown' as const, snapshot } };
    });
    const fixture: ClonePlan['fixture'] = { version: 1, courseId, actor: origin.actor, database: origin.database, createdAt, fixtureKind: 'recorded-index-cold-clone', copiedCacheRows: 0, sources, files: mappings.map(mapping => mapping.storagePath),
      coldClone: { id, planFile: path.resolve(output, 'plan.json'), executionReceipt: path.resolve(output, 'clone-execution.json'), mode: 'Copies exact recorded Mongo originals and PDF bytes; no new HTTP upload, parsing, embedding, vector indexing, advisory classification or material-ingest run is claimed. No old caches/contentRuns/batches/assignments are copied.' } };
    const plan: ClonePlan = { version: 1, id, createdAt, phaseFile: path.resolve(phaseFile), phaseSha256, ledger: declaration.ledger, scope: declaration.scope,
      origin: { file: phase.declaration.sourceFixtureOrigin.path, sha256: sha256(originRaw), courseId: origin.courseId, actor: origin.actor, database: origin.database }, fixture, mappings };
    validateClonePlan(plan, origin);
    for (const source of origin.sources) if (sha256(await readFile(source.publicPdf)) !== source.pdfSha256) throw new Error('quality-lab-outline-clone-original-pdf-changed');
    await mkdir(output, { recursive: false }); const raw = JSON.stringify(plan, null, 2) + '\n'; await writeFile(fixture.coldClone.planFile, raw, { flag: 'wx' });
    await writeFile(path.join(output, 'corpus-fixture.json'), JSON.stringify(fixture, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ planned: true, plan: fixture.coldClone.planFile, sha256: sha256(raw), fixture: path.resolve(output, 'corpus-fixture.json'), providerCalls: 0, databaseCalls: 0, liveClonePerformed: false })); return;
  }
  const expected = argument('--plan-sha256'); const raw = await readFile(planPath, 'utf8');
  if (!expected || sha256(raw) !== expected) throw new Error('quality-lab-outline-clone-plan-hash-mismatch');
  const plan = JSON.parse(raw) as ClonePlan;
  const phase = await readDeclaredOutlinePhase(plan.phaseFile, plan.phaseSha256, plan.ledger, plan.scope, true);
  const originRaw = await readFile(plan.origin.file, 'utf8'); if (sha256(originRaw) !== plan.origin.sha256 || plan.origin.sha256 !== phase.declaration.sourceFixtureOrigin.sha256) throw new Error('quality-lab-outline-clone-origin-changed');
  const origin = JSON.parse(originRaw) as OutlineCorpusFixture; validateClonePlan(plan, origin);
  for (const source of origin.sources) if (sha256(await readFile(source.publicPdf)) !== source.pdfSha256) throw new Error('quality-lab-outline-clone-original-pdf-changed');
  if (!apply) { console.log(JSON.stringify({ preflight: true, providerCalls: 0, databaseCalls: 0, plan: path.resolve(planPath), courseId: plan.fixture.courseId, sources: 10 })); return; }
  try { await readFile(plan.fixture.coldClone.executionReceipt); throw new Error('quality-lab-outline-clone-receipt-exists'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const [{ env }, mongo] = await Promise.all([import('../../server/src/config/env'), import('../../server/src/components/mongodb')]);
  const address = new URL(env.mongodbUri);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(address.hostname) || address.port !== '27029' || env.mongodbDbName !== plan.origin.database) throw new Error('quality-lab-outline-clone-owned-27029-required');
  const copiedFiles: string[] = []; let committed = false; let error: ReturnType<typeof safeError> | null = null;
  try {
    const db = await mongo.connectMongo(); const hello = await db.admin().command({ hello: 1 }); if (!hello.setName && hello.msg !== 'isdbgrid') throw new Error('quality-lab-outline-clone-replica-required');
    const courseId = new ObjectId(plan.fixture.courseId); const originCourseId = new ObjectId(plan.origin.courseId);
    const oldCourse = await db.collection('courses').findOne({ _id: originCourseId, ownerPuid: plan.origin.actor });
    if (!oldCourse || await db.collection('courses').findOne({ _id: courseId })) throw new Error('quality-lab-outline-clone-course-ownership-or-target-conflict');
    await mkdir(path.resolve('uploads'), { recursive: true });
    for (const [index, mapping] of plan.mappings.entries()) { await copyFile(origin.sources[index]!.publicPdf, mapping.storagePath, constants.COPYFILE_EXCL); copiedFiles.push(mapping.storagePath); }
    const session = mongo.getMongoClient().startSession();
    try { await session.withTransaction(async () => {
      if (!await db.collection('courses').findOne({ _id: originCourseId, ownerPuid: plan.origin.actor }, { session })) throw new Error('quality-lab-outline-clone-owner-changed');
      await db.collection('courses').insertOne({ _id: courseId, name: 'Recorded indexed originals · cold-outline control', courseCode: `QC${plan.fixture.courseId.slice(-8)}`, term: oldCourse.term ?? '2026W1', ownerPuid: plan.fixture.actor, registrationCode: randomUUID(), published: false, lifecycle: 'draft', feedbackStrategy: 'adaptive', autoPause: { minAttempts: 5, flagPercent: 30, flagCount: 15 }, redirectFailureThreshold: 3, reviewBacklogThreshold: 10, createdAt: new Date(), fixtureClone: { planId: plan.id, planSha256: expected, originCourseId } }, { session });
      for (const [index, mapping] of plan.mappings.entries()) {
        const source = origin.sources[index]!; const oldId = new ObjectId(mapping.originMaterialId); const materialId = new ObjectId(mapping.materialId);
        const material = await db.collection('materials').findOne({ _id: oldId, courseId: originCourseId, status: 'ready', deletedAt: { $exists: false } }, { session });
        const chunks = await db.collection('materialChunks').find({ courseId: originCourseId, materialId: oldId }, { session }).sort({ index: 1 }).toArray();
        if (!material || material.name !== source.name || material.sourceManifest?.sourceTextHash !== source.manifest.sourceTextHash || material.sourceManifest?.parserVersion !== source.manifest.parserVersion || material.sourceManifest?.chunkerVersion !== source.manifest.chunkerVersion || hashControl(chunks.map(({ index, text, characterCount }) => ({ index, text, characterCount }))) !== hashControl(source.chunks)) throw new Error('quality-lab-outline-clone-live-original-drift');
        const manifest = { ...material.sourceManifest }; delete manifest.ingestRunId;
        await db.collection('materials').insertOne({ _id: materialId, courseId, name: source.name, format: 'pdf', status: 'ready', revision: 0, sourceManifest: manifest, storagePath: mapping.storagePath, assignments: [], uploadedAt: new Date(), fixtureClone: { planId: plan.id, originMaterialId: oldId, originIngestRunId: material.activeRunId ?? null, indexingReused: true, vectorsCloned: false } }, { session });
        await db.collection('materialChunks').insertMany(source.chunks.map((chunk, chunkIndex) => ({ _id: new ObjectId(mapping.chunks[chunkIndex]), courseId, materialId, ...chunk, createdAt: new Date() })), { session });
      }
    }); committed = true; } finally { await session.endSession(); }
    await readDeclaredOutlinePhase(plan.phaseFile, plan.phaseSha256, plan.ledger, plan.scope, true);
    for (const [index, file] of copiedFiles.entries()) if (sha256(await readFile(file)) !== origin.sources[index]!.pdfSha256) throw new Error('quality-lab-outline-clone-copy-hash-mismatch');
  } catch (caught) { error = safeError(caught); process.exitCode = 1; }
  finally {
    if (!committed) for (const file of copiedFiles) await rm(file);
    await mongo.closeMongo(); await writeFile(plan.fixture.coldClone.executionReceipt, JSON.stringify({ version: 1, status: committed && !error ? 'cloned' : 'stopped', committed, planSha256: expected, courseId: plan.fixture.courseId, actor: plan.fixture.actor, database: plan.fixture.database, providerCalls: 0, originalSourcesModified: false, copiedCacheRows: 0, vectorIndexRebuilt: false, httpAdmissionPerformed: false, sourceFiles: copiedFiles, provenance: plan.fixture.coldClone.mode, error }, null, 2) + '\n', { flag: 'wx' });
  }
  console.log(JSON.stringify({ status: committed && !error ? 'cloned' : 'stopped', receipt: plan.fixture.coldClone.executionReceipt, providerCalls: 0 }));
}
if (require.main === module) void main().catch(error => { console.error(safeError(error).message); process.exitCode = 1; });
