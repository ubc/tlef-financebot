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

import { ObjectId } from 'mongodb';
import type { UploadedFile } from '../../server/src/services/materials.service';
import {
  createMaterials,
  createUrlMaterial,
  ingestMaterial,
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

beforeEach(() => {
  insertOne.mockReset();
  findOne.mockReset();
  updateOne.mockReset();
  jest.mocked(materialsCol).mockReturnValue({ insertOne, findOne, updateOne } as never);
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
