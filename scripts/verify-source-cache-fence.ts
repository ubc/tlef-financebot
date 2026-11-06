/** Zero-provider transaction acceptance using freshly owned synthetic records.
 * This checks cache publication/deletion ordering, not extraction quality. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { ObjectId } from 'mongodb';
import { env } from '../server/src/config/env';
import { connectMongo, closeMongo } from '../server/src/components/mongodb';
import { coursesCol, materialsCol, sourceEvidenceExtractionsCol } from '../server/src/components/mongodb/collections';
import { authoringCollection, initializeAuthoringCommitSupport, withCourseAuthoringWrite } from '../server/src/services/authoring-commit.service';
import { sourceExtractionIdentity, storeSourceExtraction } from '../server/src/services/source-evidence-cache.service';

async function main(): Promise<void> {
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(env.mongodbUri).hostname));
  assert.match(env.mongodbDbName, /quality|acceptance|test/i);
  const db = await connectMongo();
  assert.equal((await initializeAuthoringCommitSupport()).available, true, 'A replica set is required for the transaction race.');
  const courseId = new ObjectId(); const materialId = new ObjectId();
  const identity = sourceExtractionIdentity({ courseId, materialId, sourceTextHash: 'synthetic-cache-fence-original', parserVersion: 'synthetic-v1', chunkerVersion: 'synthetic-v1',
    sourceTitle: 'Synthetic cache transaction fixture', guidance: '', promptText: 'Synthetic exact-source cache fixture. No provider call.',
    modelConfiguration: { model: 'no-provider-called' }, sections: [{ id: 'C1.S1', chunkIndex: 0, text: 'Synthetic original.' }] });
  const section = { sectionId: 'C1.S1', objectives: [], knowledge: [], skipReason: 'Synthetic cache transaction fixture' };
  const ready = async () => {
    if (!await authoringCollection(materialsCol()).findOne({ _id: materialId, courseId, deletedAt: { $exists: false } })) throw new Error('structure-material-changed');
  };
  const checks: string[] = [];
  try {
    await db.collection('courses').insertOne({ _id: courseId, name: 'Synthetic cache fence acceptance', lifecycle: 'draft', ownerPuid: 'SYNTHETIC-CACHE-FENCE', createdAt: new Date() });
    await db.collection('materials').insertOne({ _id: materialId, courseId, name: 'Synthetic original', status: 'ready', uploadedAt: new Date() });
    let enter!: () => void; let continuePublication!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const release = new Promise<void>(resolve => { continuePublication = resolve; });
    let held = false;
    const publication = storeSourceExtraction(identity, [section], async () => {
      await ready();
      if (!held) { held = true; enter(); await release; }
    });
    await entered;
    // Both operations share the course write fence. Deletion either waits for
    // publication and removes it, or wins and makes a later publication fail.
    const deletion = withCourseAuthoringWrite(courseId, async () => {
      await authoringCollection(coursesCol()).updateOne({ _id: courseId }, { $set: { authoringDeletionStartedAt: new Date() } });
      await authoringCollection(sourceEvidenceExtractionsCol()).deleteMany({ courseId });
      await authoringCollection(materialsCol()).deleteOne({ _id: materialId, courseId });
    });
    continuePublication();
    await Promise.all([publication, deletion]);
    assert.equal(await sourceEvidenceExtractionsCol().countDocuments({ courseId }), 0);
    checks.push('publication-vs-deletion leaves no surviving cache record');
    await assert.rejects(storeSourceExtraction(identity, [section], ready), /course-not-found/);
    assert.equal(await sourceEvidenceExtractionsCol().countDocuments({ courseId }), 0);
    checks.push('tombstoned course cannot recreate a cache record');
    await coursesCol().deleteOne({ _id: courseId });
    await assert.rejects(storeSourceExtraction(identity, [section], ready), /course-not-found/);
    assert.equal(await sourceEvidenceExtractionsCol().countDocuments({ courseId }), 0);
    checks.push('physically deleted course cannot recreate a cache record');
  } finally {
    await sourceEvidenceExtractionsCol().deleteMany({ courseId });
    await materialsCol().deleteMany({ courseId });
    await coursesCol().deleteOne({ _id: courseId });
    await closeMongo();
  }
  const receipt = { outcome: 'passed', providerCalls: 0, checks, fixture: 'owned synthetic cache transaction records', cleaned: true };
  const outputIndex = process.argv.indexOf('--output');
  if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
    const output = resolve(process.argv[outputIndex + 1]);
    await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(receipt, null, 2));
  }
  console.log(JSON.stringify(receipt, null, 2));
}
main().catch(error => { console.error(JSON.stringify({ outcome: 'failed', providerCalls: 0, reason: error instanceof Error ? error.message : 'Unknown error' })); process.exitCode = 1; }).finally(() => closeMongo());
