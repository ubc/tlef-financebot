import { assertColdMultipartCounts, assertIntendedReadiness, assertMultipartTarget, MULTIPART_FILE_LIMIT, validateMultipartSourceList } from '../../scripts/quality-lab/run-multipart-admission';
import type { SourceSelectionReport } from '../../server/src/types/material-upload';

const target = { mongodbUri: 'mongodb://127.0.0.1:27029/?replicaSet=quality', mongodbDbName: 'financebot_quality_smoke_retest_multipart',
  qdrantUrl: 'http://127.0.0.1:6333', embeddingsProvider: 'fastembed' };
const sources = () => Array.from({ length: 10 }, (_, index) => ({ chapter: index + 1, pages: 50, name: `Chapter ${index + 1}.pdf`, size: 1024,
  pdfSha256: index.toString(16).padStart(64, '0') }));
const receipt = (readyCount: number): SourceSelectionReport => ({ requested: sources().map((source, index) => ({ name: source.name, materialId: String(index),
  ready: index < readyCount, state: index < readyCount ? 'indexed' : 'processing', classification: 'unknown' })),
included: Array.from({ length: readyCount }, (_, index) => ({ materialId: String(index), name: `Chapter ${index + 1}.pdf`, sourceTextHash: 'original',
  chunkCount: 1, characterCount: 10, parserVersion: 'parser', chunkerVersion: 'chunker' })), excluded: [], ready: readyCount === 10 });

it('permits only the explicit local disposable Mongo target before connecting', () => {
  expect(assertMultipartTarget(target, target.mongodbDbName, 'boundary-only')).toEqual({ database: target.mongodbDbName, mongoHost: '127.0.0.1', mongoPort: '27029' });
  for (const mongodbUri of ['mongodb://localhost:27017', 'mongodb://example.org:27029', 'mongodb+srv://example.org/']) {
    expect(() => assertMultipartTarget({ ...target, mongodbUri }, target.mongodbDbName, 'boundary-only')).toThrow('owned-mongo-required');
  }
  expect(() => assertMultipartTarget(target, 'financebot', 'boundary-only')).toThrow('owned-mongo-required');
  expect(() => assertMultipartTarget(target, `${target.mongodbDbName}_other`, 'boundary-only')).toThrow('owned-mongo-required');
});

it('requires local fastembed and explicit local Qdrant only for the opt-in real-index mode', () => {
  expect(assertMultipartTarget(target, target.mongodbDbName, 'real-index')).toMatchObject({ qdrantHost: '127.0.0.1', qdrantPort: '6333' });
  for (const change of [{ embeddingsProvider: 'openai' }, { qdrantUrl: 'https://remote.example:6333' }, { qdrantUrl: 'http://localhost' }, { qdrantUrl: 'http://localhost:6118' }]) {
    expect(() => assertMultipartTarget({ ...target, ...change }, target.mongodbDbName, 'real-index')).toThrow('local-index-required');
  }
  expect(() => assertMultipartTarget({ ...target, embeddingsProvider: 'openai', qdrantUrl: 'https://remote.example' }, target.mongodbDbName, 'boundary-only')).not.toThrow();
});

it('requires exactly ten distinct original PDF identities within the real Multer file limit', () => {
  expect(() => validateMultipartSourceList(sources())).not.toThrow();
  expect(() => validateMultipartSourceList(sources().slice(0, 9))).toThrow('ten-exact-pdfs-required');
  for (const change of [{ size: MULTIPART_FILE_LIMIT + 1 }, { size: 0 }, { pdfSha256: 'unverified' }, { name: 'source.txt' }, { pages: 0 }]) {
    expect(() => validateMultipartSourceList(sources().map((source, index) => index ? source : { ...source, ...change }))).toThrow('ten-exact-pdfs-required');
  }
  expect(() => validateMultipartSourceList(sources().map((source, index) => index ? source : { ...source, pdfSha256: sources()[1].pdfSha256 }))).toThrow('ten-exact-pdfs-required');
});

it('keeps every intended source in the receipt until all ten independently become indexed', () => {
  for (const count of [0, 2, 9, 10]) expect(() => assertIntendedReadiness(receipt(count), sources(), count)).not.toThrow();
  expect(() => assertIntendedReadiness({ ...receipt(2), requested: receipt(2).requested.slice(0, 2) }, sources(), 2)).toThrow('Every intended source');
  expect(() => assertIntendedReadiness({ ...receipt(9), ready: true }, sources(), 9)).toThrow();
  expect(() => assertIntendedReadiness({ ...receipt(2), included: receipt(10).included }, sources(), 2)).toThrow();
});

it('requires both source extraction and synthesis history to be absent for a cold course', () => {
  expect(() => assertColdMultipartCounts({ sourceExtractions: 0, structureRuns: 0 })).not.toThrow();
  expect(() => assertColdMultipartCounts({ sourceExtractions: 1, structureRuns: 0 })).toThrow('course-not-cold');
  expect(() => assertColdMultipartCounts({ sourceExtractions: 0, structureRuns: 1 })).toThrow('course-not-cold');
});
