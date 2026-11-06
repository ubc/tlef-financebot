import { createHash } from 'node:crypto';
import path from 'node:path';
import { outlineOptionsForFixture, validateDeclaredColdFixture, type OutlineCorpusFixture } from '../../scripts/quality-lab/outline-controls';
import { validateClonePlan } from '../../scripts/quality-lab/prepare-outline-cold-clone';

const oid = (n: number) => n.toString(16).padStart(24, '0');
function fixtures() {
  const actor = 'QUALITY-RETEST-FIXTURE-synthetic';
  const sources = Array.from({ length: 10 }, (_, index) => {
    const text = `Synthetic complete original${index}.`; const materialId = oid(index + 2); const sourceTextHash = createHash('sha256').update(`0:${Buffer.byteLength(text)}:`).update(text).digest('hex');
    const snapshot = { materialId, name: `Chapter${index}`, sourceTextHash, chunkCount: 1, characterCount: text.length, parserVersion: 'fixture-parser', chunkerVersion: 'fixture-chunker' };
    return { chapter: index, pages: 20, publicPdf: '/synthetic.pdf', pdfSha256: 'a'.repeat(64), materialId, name: snapshot.name, manifest: { ...snapshot, indexedCount: 1 }, chunks: [{ index: 0, text, characterCount: text.length }], readiness: { materialId, name: snapshot.name, ready: true, state: 'indexed' as const, classification: 'unknown' as const, snapshot } };
  });
  const origin: OutlineCorpusFixture = { version: 1, courseId: oid(1), actor, database: 'financebot_quality_smoke_retest_synthetic', fixtureKind: 'original', copiedCacheRows: 0, createdAt: '2026-10-16', sources };
  const cold: OutlineCorpusFixture = { ...structuredClone(origin), courseId: oid(100), fixtureKind: 'http-upload-real-index', sourceBatchId: oid(200), sources: sources.map((source, index) => {
    const materialId = oid(index + 101); return { ...structuredClone(source), materialId, readiness: { ...source.readiness, materialId, snapshot: { ...source.readiness.snapshot, materialId } } };
  }) };
  return { origin, cold };
}
describe('fresh ten-source outline identity', () => {
  it('keeps the real intended HTTP batch and all ten source IDs in production options', () => {
    const { origin, cold } = fixtures(); expect(() => validateDeclaredColdFixture(cold, origin)).not.toThrow();
    const options = outlineOptionsForFixture(cold); expect(options.sourceBatchId).toBe(cold.sourceBatchId); expect(options.materialIds).toEqual(cold.sources.map(source => source.materialId));
  });
  it('rejects an oldcourse, reused materialID, missing batch, duplicate chapter or silently reduced source set', () => {
    for (const mutate of [
      (c: OutlineCorpusFixture, o: OutlineCorpusFixture) => { c.courseId = o.courseId; },
      (c: OutlineCorpusFixture, o: OutlineCorpusFixture) => { c.sources[0]!.materialId = o.sources[0]!.materialId; },
      (c: OutlineCorpusFixture) => { delete c.sourceBatchId; },
      (c: OutlineCorpusFixture) => { c.sources[0]!.chapter = c.sources[1]!.chapter; },
      (c: OutlineCorpusFixture) => { c.sources.pop(); },
    ]) { const { origin, cold } = fixtures(); mutate(cold, origin); expect(() => validateDeclaredColdFixture(cold, origin)).toThrow('cold-ten-fixture-required'); }
  });
  it('rejects stale readiness identities and source-byte substitutions', () => {
    const stale = fixtures(); stale.cold.sources[0]!.readiness.snapshot!.materialId = stale.origin.sources[0]!.materialId;
    expect(() => validateDeclaredColdFixture(stale.cold, stale.origin)).toThrow('readiness-identity');
    const wrong = fixtures(); wrong.cold.sources[0]!.pdfSha256 = 'b'.repeat(64); expect(() => validateDeclaredColdFixture(wrong.cold, wrong.origin)).toThrow('cold-ten-fixture-required');
  });
  it('labels a recorded-index clone separately and forbids copied chunk IDs colliding with any material/course ID', () => {
    const { origin, cold } = fixtures(); cold.fixtureKind = 'recorded-index-cold-clone'; delete cold.sourceBatchId;
    const plan: Parameters<typeof validateClonePlan>[0] = { version: 1, id: 'synthetic-plan', createdAt: '2026-10-16', phaseFile: '/phase.json', phaseSha256: 'a'.repeat(64), ledger: '/new-ledger.json', scope: 'new', origin: { file: '/origin.json', sha256: 'a'.repeat(64), courseId: origin.courseId, actor: origin.actor, database: origin.database },
      fixture: { ...cold, files: [], coldClone: { id: 'synthetic-plan', planFile: '/plan.json', executionReceipt: '/receipt.json', mode: 'Recorded originals; no HTTP or indexing claim.' } },
      mappings: origin.sources.map((source, index) => ({ originMaterialId: source.materialId, materialId: cold.sources[index]!.materialId, chunks: [oid(1000 + index)], storagePath: path.resolve('uploads', `${index.toString().padStart(8, '0')}-0000-4000-a000-000000000000.pdf`) })) };
    expect(() => validateClonePlan(plan, origin)).not.toThrow(); plan.mappings[0]!.chunks[0] = cold.courseId;
    expect(() => validateClonePlan(plan, origin)).toThrow('clone-plan-invalid');
  });
});
