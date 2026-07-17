// Unit test — materials.service with its components MOCKED (collections,
// jobs, genai chunking/embeddings/document-parsing, qdrant), following
// rag.service.test.ts's pattern of isolating a service from the real
// toolkit/Qdrant clients. Exercises the five IN-S04/S05 cases from
// .superpowers/sdd/task-6-brief.md Step 1:
//   1. unsupported extension rejected, naming the format
//   2. three files -> three processing docs + three independent enqueues
//   3. ingest job success: parse -> chunk -> embed -> upsert (course-<id>), ready
//   4. ingest job failure: sets failed + error message, never throws
//   5. URL material stores sourceUrl
jest.mock('../../server/src/components/mongodb/collections', () => ({ materialsCol: jest.fn() }));
jest.mock('../../server/src/components/jobs', () => ({ defineJob: jest.fn(), enqueueJob: jest.fn() }));
jest.mock('../../server/src/components/genai/chunking', () => ({ chunkText: jest.fn() }));
jest.mock('../../server/src/components/genai/embeddings', () => ({
  embed: jest.fn(),
  getEmbeddingDimension: jest.fn(),
}));
jest.mock('../../server/src/components/genai/document-parsing', () => ({ parseFile: jest.fn() }));
jest.mock('../../server/src/components/qdrant', () => ({
  ensureCollection: jest.fn(),
  upsertPoints: jest.fn(),
}));

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import type { UploadedFile } from '../../server/src/services/materials.service';
import {
  createMaterials,
  createUrlMaterial,
  ingestMaterial,
  assignMaterial,
  retryMaterial,
  listMaterials,
  getMaterialCourseId,
} from '../../server/src/services/materials.service';
import { materialsCol } from '../../server/src/components/mongodb/collections';
import { enqueueJob } from '../../server/src/components/jobs';
import { chunkText } from '../../server/src/components/genai/chunking';
import { embed, getEmbeddingDimension } from '../../server/src/components/genai/embeddings';
import { parseFile } from '../../server/src/components/genai/document-parsing';
import { ensureCollection, upsertPoints } from '../../server/src/components/qdrant';

const insertOne = jest.fn();
const findOne = jest.fn();
const updateOne = jest.fn();

function uploadedFile(originalname: string, filePath = `/uploads/${originalname}`): UploadedFile {
  return { originalname, path: filePath };
}

/** A minimal `processing` Material doc, as `materialsCol().findOne()` would
 * return it, for the ingestMaterial tests below. */
function materialFixture(id: ObjectId, courseId: ObjectId, name: string, overrides: Record<string, unknown> = {}) {
  return {
    _id: id,
    courseId,
    name,
    format: 'pdf',
    status: 'processing',
    storagePath: `/uploads/${name}`,
    assignments: [],
    uploadedAt: new Date(),
    ...overrides,
  };
}

const findOneAndUpdate = jest.fn();
const sortToArray = jest.fn();
const find = jest.fn(() => ({ sort: jest.fn(() => ({ toArray: sortToArray })) }));
// IN-S05: assignMaterial must REPLACE assignments via $set and never delete
// the material. Giving the mocked collection explicit delete methods (rather
// than omitting them, which would make a stray call fail as "not a
// function") lets the IN-S05 test below assert they were never called and
// actually pin the guarantee, instead of accidentally passing for the wrong
// reason.
const deleteOne = jest.fn();
const deleteMany = jest.fn();
const findOneAndDelete = jest.fn();

beforeEach(() => {
  insertOne.mockReset();
  findOne.mockReset();
  updateOne.mockReset();
  findOneAndUpdate.mockReset();
  sortToArray.mockReset();
  find.mockClear();
  deleteOne.mockReset();
  deleteMany.mockReset();
  findOneAndDelete.mockReset();
  jest.mocked(materialsCol).mockReturnValue({
    insertOne,
    findOne,
    updateOne,
    findOneAndUpdate,
    find,
    deleteOne,
    deleteMany,
    findOneAndDelete,
  } as never);
  insertOne.mockImplementation(async () => ({ insertedId: new ObjectId() }));
  jest.mocked(getEmbeddingDimension).mockResolvedValue(3);
});

describe('createMaterials — format validation (IN-S04)', () => {
  it('rejects an unsupported extension, naming the format, and creates nothing', async () => {
    const courseId = new ObjectId();
    const files = [uploadedFile('notes.pdf'), uploadedFile('malware.exe')];

    await expect(createMaterials(courseId, files)).rejects.toThrow('unsupported-format:exe');

    expect(insertOne).not.toHaveBeenCalled();
    expect(enqueueJob).not.toHaveBeenCalled();
  });
});

describe('createMaterials — independent processing (IN-S04)', () => {
  it('inserts one processing doc and enqueues one ingest job per file', async () => {
    const courseId = new ObjectId();
    const ids = [new ObjectId(), new ObjectId(), new ObjectId()];
    insertOne
      .mockResolvedValueOnce({ insertedId: ids[0] })
      .mockResolvedValueOnce({ insertedId: ids[1] })
      .mockResolvedValueOnce({ insertedId: ids[2] });

    const files = [uploadedFile('a.pdf'), uploadedFile('b.docx'), uploadedFile('c.md')];
    const materials = await createMaterials(courseId, files);

    expect(materials).toHaveLength(3);
    expect(insertOne).toHaveBeenCalledTimes(3);
    for (const [doc] of insertOne.mock.calls) {
      expect(doc.status).toBe('processing');
      expect(doc.courseId).toEqual(courseId);
    }
    expect(enqueueJob).toHaveBeenCalledTimes(3);
    expect(enqueueJob).toHaveBeenNthCalledWith(1, 'material.ingest', { materialId: ids[0].toString() });
    expect(enqueueJob).toHaveBeenNthCalledWith(2, 'material.ingest', { materialId: ids[1].toString() });
    expect(enqueueJob).toHaveBeenNthCalledWith(3, 'material.ingest', { materialId: ids[2].toString() });
  });
});

describe('createUrlMaterial (IN-S04)', () => {
  it('stores the sourceUrl, format "url", and enqueues one ingest job', async () => {
    const courseId = new ObjectId();
    const insertedId = new ObjectId();
    insertOne.mockResolvedValue({ insertedId });

    const material = await createUrlMaterial(courseId, 'https://example.com/notes');

    expect(material.sourceUrl).toBe('https://example.com/notes');
    expect(material.format).toBe('url');
    expect(material.status).toBe('processing');
    const [doc] = insertOne.mock.calls[0];
    expect(doc.sourceUrl).toBe('https://example.com/notes');
    expect(enqueueJob).toHaveBeenCalledWith('material.ingest', { materialId: insertedId.toString() });
  });
});

describe('ingestMaterial — success path (IN-S04)', () => {
  it('parses, chunks, embeds, and upserts into the per-course collection, then marks ready', async () => {
    const courseId = new ObjectId();
    const materialId = new ObjectId();
    findOne.mockResolvedValue({
      _id: materialId,
      courseId,
      name: 'notes.pdf',
      format: 'pdf',
      status: 'processing',
      storagePath: '/uploads/notes.pdf',
      assignments: [],
      uploadedAt: new Date(),
    });
    jest.mocked(parseFile).mockResolvedValue('parsed text');
    jest.mocked(chunkText).mockResolvedValue([
      { text: 'chunk a', metadata: { chunkNumber: 0 } },
      { text: 'chunk b', metadata: { chunkNumber: 1 } },
    ] as never);
    jest.mocked(embed).mockResolvedValue([
      [1, 1, 1],
      [2, 2, 2],
    ]);

    await ingestMaterial(materialId.toString());

    expect(parseFile).toHaveBeenCalledWith('/uploads/notes.pdf', 'text');
    expect(chunkText).toHaveBeenCalledWith('parsed text', 'notes.pdf');
    expect(embed).toHaveBeenCalledWith(['chunk a', 'chunk b']);
    expect(ensureCollection).toHaveBeenCalledWith(`course-${courseId.toHexString()}`, 3);

    const [collectionName, points] = jest.mocked(upsertPoints).mock.calls[0];
    expect(collectionName).toBe(`course-${courseId.toHexString()}`);
    expect(points).toHaveLength(2);
    expect(points[0].payload).toMatchObject({ materialId: materialId.toString(), chunk: 'chunk a' });
    expect(points[1].payload).toMatchObject({ materialId: materialId.toString(), chunk: 'chunk b' });

    const [filter, update] = updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: materialId });
    expect(update.$set.status).toBe('ready');
  });
});

describe('ingestMaterial — failure isolation (IN-S04)', () => {
  it('marks the material failed with the error message and does not throw', async () => {
    const materialId = new ObjectId();
    findOne.mockResolvedValue({
      _id: materialId,
      courseId: new ObjectId(),
      name: 'broken.pdf',
      format: 'pdf',
      status: 'processing',
      storagePath: '/uploads/broken.pdf',
      assignments: [],
      uploadedAt: new Date(),
    });
    jest.mocked(parseFile).mockRejectedValue(new Error('corrupt pdf'));

    await expect(ingestMaterial(materialId.toString())).resolves.toBeUndefined();

    const [filter, update] = updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: materialId });
    expect(update.$set.status).toBe('failed');
    expect(update.$set.error).toBe('corrupt pdf');
    expect(upsertPoints).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// I1: the collection-readiness cache must be keyed PER collection name (not a
// single boolean, rag.service.ts's trap) AND must dedup concurrent in-flight
// ensures (not just completed ones) — Agenda's default concurrency is 5, so
// three files uploaded at once to a brand-new course is this feature's most
// common path, and it must not spuriously fail two of the three siblings.
// -----------------------------------------------------------------------------

describe('ensureMaterialsCollection cache — per-collection-name, not a single flag (trap regression)', () => {
  it('calls ensureCollection twice, once per distinct course collection', async () => {
    const courseA = new ObjectId();
    const courseB = new ObjectId();
    const materialA = new ObjectId();
    const materialB = new ObjectId();

    jest.mocked(parseFile).mockResolvedValue('text');
    jest.mocked(chunkText).mockResolvedValue([{ text: 'chunk', metadata: {} }] as never);
    jest.mocked(embed).mockResolvedValue([[1, 2, 3]]);

    findOne.mockResolvedValueOnce(materialFixture(materialA, courseA, 'a.pdf'));
    await ingestMaterial(materialA.toString());

    findOne.mockResolvedValueOnce(materialFixture(materialB, courseB, 'b.pdf'));
    await ingestMaterial(materialB.toString());

    expect(ensureCollection).toHaveBeenCalledTimes(2);
    expect(ensureCollection).toHaveBeenCalledWith(`course-${courseA.toHexString()}`, 3);
    expect(ensureCollection).toHaveBeenCalledWith(`course-${courseB.toHexString()}`, 3);
  });
});

describe('ensureMaterialsCollection — concurrent ingests for the SAME new course (I1)', () => {
  it('dedups concurrent ensureCollection calls to one; neither material fails', async () => {
    const courseId = new ObjectId();
    const materialA = new ObjectId();
    const materialB = new ObjectId();

    findOne.mockImplementation(async ({ _id }: { _id: ObjectId }) => {
      if (_id.equals(materialA)) return materialFixture(materialA, courseId, 'a.pdf');
      if (_id.equals(materialB)) return materialFixture(materialB, courseId, 'b.pdf');
      return null;
    });
    jest.mocked(parseFile).mockResolvedValue('text');
    jest.mocked(chunkText).mockResolvedValue([{ text: 'chunk', metadata: {} }] as never);
    jest.mocked(embed).mockResolvedValue([[1, 2, 3]]);

    await Promise.all([ingestMaterial(materialA.toString()), ingestMaterial(materialB.toString())]);

    expect(ensureCollection).toHaveBeenCalledTimes(1);
    expect(ensureCollection).toHaveBeenCalledWith(`course-${courseId.toHexString()}`, 3);

    const statuses = updateOne.mock.calls.map(([, update]) => update.$set.status);
    expect(statuses).toEqual(['ready', 'ready']);
  });
});

describe('ensureMaterialsCollection — tolerates a 409 "already exists" conflict (I1 belt-and-braces)', () => {
  it('treats a 409 from ensureCollection as success rather than failing the material', async () => {
    const courseId = new ObjectId();
    const materialId = new ObjectId();
    findOne.mockResolvedValue(materialFixture(materialId, courseId, 'a.pdf'));
    jest.mocked(parseFile).mockResolvedValue('text');
    jest.mocked(chunkText).mockResolvedValue([{ text: 'chunk', metadata: {} }] as never);
    jest.mocked(embed).mockResolvedValue([[1, 2, 3]]);
    const conflict = Object.assign(new Error('Conflict'), { status: 409 });
    jest.mocked(ensureCollection).mockRejectedValueOnce(conflict);

    await ingestMaterial(materialId.toString());

    const [, update] = updateOne.mock.calls[0];
    expect(update.$set.status).toBe('ready');
    expect(upsertPoints).toHaveBeenCalled();
  });
});

describe('ensureMaterialsCollection — a genuine failure is not cached forever', () => {
  it('fails the material, then retries ensureCollection on the next ingest for the same collection', async () => {
    const courseId = new ObjectId();
    const materialId = new ObjectId();
    findOne.mockResolvedValue(materialFixture(materialId, courseId, 'a.pdf'));
    jest.mocked(parseFile).mockResolvedValue('text');
    jest.mocked(chunkText).mockResolvedValue([{ text: 'chunk', metadata: {} }] as never);
    jest.mocked(embed).mockResolvedValue([[1, 2, 3]]);
    jest.mocked(ensureCollection).mockRejectedValueOnce(new Error('connection refused'));

    await ingestMaterial(materialId.toString());
    expect(updateOne.mock.calls[0]?.[1].$set.status).toBe('failed');

    updateOne.mockClear();
    jest.mocked(ensureCollection).mockResolvedValueOnce(undefined);
    await ingestMaterial(materialId.toString());

    expect(ensureCollection).toHaveBeenCalledTimes(2);
    expect(updateOne.mock.calls[0]?.[1].$set.status).toBe('ready');
  });
});

// -----------------------------------------------------------------------------
// I2: point ids must be deterministic (materialId + chunk index) so a retry —
// or any re-ingest of the same material — overwrites instead of duplicating
// every vector in the shared per-course collection.
// -----------------------------------------------------------------------------

describe('ingestMaterial — deterministic point ids so re-ingest overwrites (I2)', () => {
  it('produces the same point ids across two separate ingests of the same material', async () => {
    const courseId = new ObjectId();
    const materialId = new ObjectId();
    findOne.mockResolvedValue(materialFixture(materialId, courseId, 'notes.pdf'));
    jest.mocked(parseFile).mockResolvedValue('text');
    jest.mocked(chunkText).mockResolvedValue([
      { text: 'chunk a', metadata: { chunkNumber: 0 } },
      { text: 'chunk b', metadata: { chunkNumber: 1 } },
    ] as never);
    jest.mocked(embed).mockResolvedValue([
      [1, 1, 1],
      [2, 2, 2],
    ]);

    await ingestMaterial(materialId.toString());
    const firstIds = jest.mocked(upsertPoints).mock.calls[0]![1].map((p) => p.id);

    jest.mocked(upsertPoints).mockClear();
    await ingestMaterial(materialId.toString());
    const secondIds = jest.mocked(upsertPoints).mock.calls[0]![1].map((p) => p.id);

    expect(secondIds).toEqual(firstIds);
    expect(firstIds[0]).not.toBe(firstIds[1]); // distinct per chunk within the material
    // Qdrant requires string point ids to be valid UUIDs — assert the shape,
    // including the version (5) and variant nibbles, not just "looks stringy".
    expect(firstIds[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});

// -----------------------------------------------------------------------------
// I3: URL ingest hardening — content-type allowlist and SSRF host-blocking.
// Both must fail the material cleanly (status: 'failed'), never throw out of
// the job handler.
// -----------------------------------------------------------------------------

describe('ingestMaterial — URL material, success path (uncovered branch)', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('fetches the URL, writes a temp .html file, parses it, and marks ready', async () => {
    const materialId = new ObjectId();
    findOne.mockResolvedValue({
      _id: materialId,
      courseId: new ObjectId(),
      name: 'https://example.com/notes',
      format: 'url',
      status: 'processing',
      sourceUrl: 'https://example.com/notes',
      assignments: [],
      uploadedAt: new Date(),
    });
    const fetchMock = jest.fn().mockResolvedValue(
      new Response('<html><body>hi</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    jest.mocked(parseFile).mockResolvedValue('hi');
    jest.mocked(chunkText).mockResolvedValue([{ text: 'hi', metadata: {} }] as never);
    jest.mocked(embed).mockResolvedValue([[1, 2, 3]]);

    await ingestMaterial(materialId.toString());

    expect(fetchMock).toHaveBeenCalled();
    expect(parseFile).toHaveBeenCalledWith(expect.stringMatching(/\.html$/), 'text');
    expect(updateOne.mock.calls[0]?.[1].$set.status).toBe('ready');
  });
});

describe('ingestMaterial — URL content-type allowlist (I3)', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('fails cleanly, naming the content-type, when the URL serves a non-HTML response', async () => {
    const materialId = new ObjectId();
    findOne.mockResolvedValue({
      _id: materialId,
      courseId: new ObjectId(),
      name: 'https://example.com/handout.pdf',
      format: 'url',
      status: 'processing',
      sourceUrl: 'https://example.com/handout.pdf',
      assignments: [],
      uploadedAt: new Date(),
    });
    const fetchMock = jest.fn().mockResolvedValue(
      new Response('%PDF-1.4 binary garbage', { status: 200, headers: { 'content-type': 'application/pdf' } }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await ingestMaterial(materialId.toString());

    expect(parseFile).not.toHaveBeenCalled();
    const [, update] = updateOne.mock.calls[0]!;
    expect(update.$set.status).toBe('failed');
    expect(update.$set.error).toMatch(/^unsupported-content-type:/);
  });
});

describe('ingestMaterial — URL SSRF guard (I3)', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('fails cleanly, without ever fetching, when the URL targets a blocked (link-local) host', async () => {
    const materialId = new ObjectId();
    findOne.mockResolvedValue({
      _id: materialId,
      courseId: new ObjectId(),
      name: 'http://169.254.169.254/latest/meta-data',
      format: 'url',
      status: 'processing',
      sourceUrl: 'http://169.254.169.254/latest/meta-data',
      assignments: [],
      uploadedAt: new Date(),
    });
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await ingestMaterial(materialId.toString());

    expect(fetchMock).not.toHaveBeenCalled();
    const [, update] = updateOne.mock.calls[0]!;
    expect(update.$set.status).toBe('failed');
    expect(update.$set.error).toMatch(/^blocked-url:/);
  });

  it('also blocks a loopback host', async () => {
    const materialId = new ObjectId();
    findOne.mockResolvedValue({
      _id: materialId,
      courseId: new ObjectId(),
      name: 'http://localhost:6333/collections',
      format: 'url',
      status: 'processing',
      sourceUrl: 'http://localhost:6333/collections',
      assignments: [],
      uploadedAt: new Date(),
    });
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await ingestMaterial(materialId.toString());

    expect(fetchMock).not.toHaveBeenCalled();
    const [, update] = updateOne.mock.calls[0]!;
    expect(update.$set.status).toBe('failed');
    expect(update.$set.error).toMatch(/^blocked-url:/);
  });
});

// -----------------------------------------------------------------------------
// isBlockedHost table (re-review findings): IPv4-mapped IPv6 literal-form
// SSRF bypass (both dotted and hex forms), and the fc*/fd* prefix check
// wrongly matching ordinary DNS hostnames (fdic.gov, fcbarcelona.com) instead
// of only IPv6 unique-local literals. isBlockedHost() isn't exported, so this
// drives it the same way every other SSRF case in this file does: through
// ingestMaterial with a mocked global.fetch, asserting on whether fetch was
// ever called and on the final material status.
// -----------------------------------------------------------------------------

describe('ingestMaterial — URL host allow/block table (re-review: IPv4-mapped IPv6, fc*/fd* prefix)', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  async function runWithUrl(url: string): Promise<{ fetchMock: jest.Mock; status: string; error?: string }> {
    const materialId = new ObjectId();
    findOne.mockResolvedValueOnce({
      _id: materialId,
      courseId: new ObjectId(),
      name: url,
      format: 'url',
      status: 'processing',
      sourceUrl: url,
      assignments: [],
      uploadedAt: new Date(),
    });
    const fetchMock = jest.fn().mockResolvedValue(
      new Response('<html><body>hi</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    updateOne.mockClear();
    // Only exercised by the "allowed" cases (the "blocked" cases never reach
    // fetch/parse/chunk at all), but harmless to set unconditionally.
    jest.mocked(parseFile).mockResolvedValue('hi');
    jest.mocked(chunkText).mockResolvedValue([{ text: 'hi', metadata: {} }] as never);
    jest.mocked(embed).mockResolvedValue([[1, 2, 3]]);

    await ingestMaterial(materialId.toString());

    const [, update] = updateOne.mock.calls[0]!;
    return { fetchMock, status: update.$set.status, error: update.$set.error };
  }

  const blockedHosts = [
    '[::ffff:169.254.169.254]', // IPv4-mapped IPv6, dotted form -> cloud metadata
    '[::ffff:127.0.0.1]', // IPv4-mapped IPv6, dotted form -> loopback
    '[::1]',
    '[fe80::1]',
    '[fd00::1]',
    '169.254.169.254',
    '127.0.0.1',
    '10.0.0.1',
    '192.168.1.1',
  ];

  it.each(blockedHosts)('blocks http://%s/ without ever fetching', async (host) => {
    const { fetchMock, status, error } = await runWithUrl(`http://${host}/`);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(status).toBe('failed');
    expect(error).toMatch(/^blocked-url:/);
  });

  // The WHATWG URL parser normalizes a literal IPv6 address's dotted-decimal
  // IPv4-mapped suffix to hex (`[::ffff:169.254.169.254]` -> hostname
  // `::ffff:a9fe:a9fe`), so that's the form isBlockedHost() actually sees in
  // practice via any real fetch call. Assert the hex form directly too,
  // rather than relying on the dotted-form test above to exercise it only
  // indirectly through URL normalization.
  it('blocks the hex form of an IPv4-mapped IPv6 metadata address (::ffff:a9fe:a9fe)', async () => {
    const { fetchMock, status, error } = await runWithUrl('http://[::ffff:a9fe:a9fe]/');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(status).toBe('failed');
    expect(error).toMatch(/^blocked-url:/);
  });

  const allowedHosts = ['fdic.gov', 'fcbarcelona.com'];

  it.each(allowedHosts)('allows https://%s/ (must not be blocked as an fc*/fd* IPv6 literal)', async (host) => {
    const { fetchMock, status } = await runWithUrl(`https://${host}/`);
    expect(fetchMock).toHaveBeenCalled();
    expect(status).toBe('ready');
  });
});

// -----------------------------------------------------------------------------
// I3 test coverage gap (re-review): response-size cap and redirect
// re-validation had no tests, though the code paths existed and "enforced
// across redirects" was the specific thing the original ruling called out.
// -----------------------------------------------------------------------------

describe('ingestMaterial — URL response byte cap (I3)', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('fails the material cleanly, without throwing, when the response exceeds the byte cap', async () => {
    const materialId = new ObjectId();
    findOne.mockResolvedValue({
      _id: materialId,
      courseId: new ObjectId(),
      name: 'https://example.com/huge',
      format: 'url',
      status: 'processing',
      sourceUrl: 'https://example.com/huge',
      assignments: [],
      uploadedAt: new Date(),
    });

    // A single chunk bigger than URL_MAX_RESPONSE_BYTES (10 MiB) — a plain
    // zero-filled typed array, not a real 11 MiB string, so this stays cheap
    // to allocate in a unit test while still tripping the cap on the first
    // `reader.read()`.
    let delivered = false;
    const fakeReader = {
      read: async () => {
        if (!delivered) {
          delivered = true;
          return { done: false, value: new Uint8Array(11 * 1024 * 1024) };
        }
        return { done: true, value: undefined };
      },
      cancel: jest.fn().mockResolvedValue(undefined),
    };
    const fakeResponse = {
      ok: true,
      status: 200,
      headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'text/html' : null) },
      body: { getReader: () => fakeReader },
    } as unknown as Response;
    const fetchMock = jest.fn().mockResolvedValue(fakeResponse);
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(ingestMaterial(materialId.toString())).resolves.toBeUndefined();

    expect(fakeReader.cancel).toHaveBeenCalled();
    const [, update] = updateOne.mock.calls[0]!;
    expect(update.$set.status).toBe('failed');
    expect(update.$set.error).toMatch(/^url-response-too-large:/);
    expect(parseFile).not.toHaveBeenCalled();
  });
});

describe('ingestMaterial — redirect re-validation (I3)', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('rejects a redirect whose Location targets a blocked host, and never follows it', async () => {
    const materialId = new ObjectId();
    findOne.mockResolvedValue({
      _id: materialId,
      courseId: new ObjectId(),
      name: 'https://example.com/redirect-to-metadata',
      format: 'url',
      status: 'processing',
      sourceUrl: 'https://example.com/redirect-to-metadata',
      assignments: [],
      uploadedAt: new Date(),
    });
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data' },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(ingestMaterial(materialId.toString())).resolves.toBeUndefined();

    // Exactly one fetch: the initial (public, allowed) URL. The redirect
    // target is checked and rejected BEFORE a second fetch would ever be
    // issued to it.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, update] = updateOne.mock.calls[0]!;
    expect(update.$set.status).toBe('failed');
    expect(update.$set.error).toMatch(/^blocked-url:/);
  });
});

// -----------------------------------------------------------------------------
// Other uncovered ingest branches (review's "Test coverage" item 4).
// -----------------------------------------------------------------------------

describe('ingestMaterial — .txt direct read (ruled decision, uncovered branch)', () => {
  it('reads the file directly rather than going through parseFile', async () => {
    const tmpPath = path.join(os.tmpdir(), `${randomUUID()}.txt`);
    await fs.writeFile(tmpPath, 'plain text content', 'utf-8');
    try {
      const materialId = new ObjectId();
      findOne.mockResolvedValue({
        _id: materialId,
        courseId: new ObjectId(),
        name: 'notes.txt',
        format: 'txt',
        status: 'processing',
        storagePath: tmpPath,
        assignments: [],
        uploadedAt: new Date(),
      });
      jest.mocked(chunkText).mockResolvedValue([{ text: 'plain text content', metadata: {} }] as never);
      jest.mocked(embed).mockResolvedValue([[1, 2, 3]]);

      await ingestMaterial(materialId.toString());

      expect(parseFile).not.toHaveBeenCalled();
      expect(chunkText).toHaveBeenCalledWith('plain text content', 'notes.txt');
      expect(updateOne.mock.calls[0]?.[1].$set.status).toBe('ready');
    } finally {
      await fs.rm(tmpPath, { force: true });
    }
  });
});

describe('ingestMaterial — zero chunks (uncovered branch)', () => {
  it('skips embed/ensureCollection/upsert and still marks ready when chunking produces no chunks', async () => {
    const materialId = new ObjectId();
    findOne.mockResolvedValue(materialFixture(materialId, new ObjectId(), 'empty.pdf'));
    jest.mocked(parseFile).mockResolvedValue('');
    jest.mocked(chunkText).mockResolvedValue([] as never);

    await ingestMaterial(materialId.toString());

    expect(embed).not.toHaveBeenCalled();
    expect(ensureCollection).not.toHaveBeenCalled();
    expect(upsertPoints).not.toHaveBeenCalled();
    expect(updateOne.mock.calls[0]?.[1].$set.status).toBe('ready');
  });
});

describe('ingestMaterial — material not found (uncovered branch)', () => {
  it('resolves without throwing and without touching qdrant when the material no longer exists', async () => {
    findOne.mockResolvedValue(null);

    await expect(ingestMaterial(new ObjectId().toString())).resolves.toBeUndefined();

    expect(updateOne).not.toHaveBeenCalled();
    expect(chunkText).not.toHaveBeenCalled();
    expect(upsertPoints).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// Mixed valid+invalid batch (review's "Test coverage" item 5): Saurav ruled
// batch rejection stays — it's contract-conformant and IN-S04 governs
// background *processing* independence, not upload *validation*. This test
// pins that as deliberate, and specifically checks that validation happens as
// a pre-pass over the WHOLE batch (a good file ordered BEFORE the bad one
// must not already have been inserted by the time the bad one is hit).
// -----------------------------------------------------------------------------

describe('createMaterials — mixed valid+invalid batch (Saurav ruling: reject whole batch)', () => {
  it('rejects the whole batch and persists nothing, even when a valid file precedes the invalid one', async () => {
    const courseId = new ObjectId();
    const files = [uploadedFile('good.pdf'), uploadedFile('bad.exe'), uploadedFile('also-good.docx')];

    await expect(createMaterials(courseId, files)).rejects.toThrow('unsupported-format:exe');

    expect(insertOne).not.toHaveBeenCalled();
    expect(enqueueJob).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// assignMaterial / retryMaterial / listMaterials / getMaterialCourseId (review's
// "Test coverage" item 3) — previously zero coverage. IN-S05's binding
// constraint is that assignMaterial REPLACES assignments and never deletes
// the material or its questions (there is no delete path in this service at
// all — the assertion here is that assignMaterial only ever calls
// findOneAndUpdate, never a delete of any kind).
// -----------------------------------------------------------------------------

describe('assignMaterial (IN-S05)', () => {
  it('replaces the assignments array via $set and returns the updated material', async () => {
    const materialId = new ObjectId();
    const themeId = new ObjectId();
    const loId = new ObjectId();
    const updated = materialFixture(materialId, new ObjectId(), 'notes.pdf', {
      assignments: [{ themeId, loId }],
    });
    findOneAndUpdate.mockResolvedValue(updated);

    const result = await assignMaterial(materialId, [{ themeId, loId }]);

    expect(result).toBe(updated);
    const [filter, update, options] = findOneAndUpdate.mock.calls[0]!;
    expect(filter).toEqual({ _id: materialId });
    expect(update).toEqual({ $set: { assignments: [{ themeId, loId }] } });
    expect(options).toEqual({ returnDocument: 'after' });
    expect(deleteOne).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
    expect(findOneAndDelete).not.toHaveBeenCalled();
  });

  it('throws material-not-found when the material does not exist, without touching any delete API', async () => {
    findOneAndUpdate.mockResolvedValue(null);

    await expect(assignMaterial(new ObjectId(), [])).rejects.toThrow('material-not-found');
    expect(deleteOne).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
    expect(findOneAndDelete).not.toHaveBeenCalled();
  });
});

describe('retryMaterial', () => {
  it('resets status to processing, clears any prior error, and re-enqueues the ingest job', async () => {
    const materialId = new ObjectId();
    const updated = materialFixture(materialId, new ObjectId(), 'broken.pdf', { status: 'processing' });
    findOneAndUpdate.mockResolvedValue(updated);

    const result = await retryMaterial(materialId);

    expect(result).toBe(updated);
    const [filter, update, options] = findOneAndUpdate.mock.calls[0]!;
    expect(filter).toEqual({ _id: materialId });
    expect(update).toEqual({ $set: { status: 'processing' }, $unset: { error: '' } });
    expect(options).toEqual({ returnDocument: 'after' });
    expect(enqueueJob).toHaveBeenCalledWith('material.ingest', { materialId: materialId.toString() });
  });

  it('throws material-not-found and does not enqueue when the material does not exist', async () => {
    findOneAndUpdate.mockResolvedValue(null);

    await expect(retryMaterial(new ObjectId())).rejects.toThrow('material-not-found');
    expect(enqueueJob).not.toHaveBeenCalled();
  });
});

describe('listMaterials', () => {
  it('queries by courseId and returns the materials array', async () => {
    const courseId = new ObjectId();
    const materials = [materialFixture(new ObjectId(), courseId, 'a.pdf')];
    sortToArray.mockResolvedValue(materials);

    const result = await listMaterials(courseId);

    expect(find).toHaveBeenCalledWith({ courseId });
    expect(result).toBe(materials);
  });
});

describe('getMaterialCourseId', () => {
  it('returns the courseId of the material', async () => {
    const courseId = new ObjectId();
    const materialId = new ObjectId();
    findOne.mockResolvedValue({ courseId });

    const result = await getMaterialCourseId(materialId);

    expect(result).toBe(courseId);
    const [filter, options] = findOne.mock.calls[0]!;
    expect(filter).toEqual({ _id: materialId });
    expect(options).toEqual({ projection: { courseId: 1 } });
  });

  it('returns null when the material does not exist', async () => {
    findOne.mockResolvedValue(null);

    await expect(getMaterialCourseId(new ObjectId())).resolves.toBeNull();
  });
});
