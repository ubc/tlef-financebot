jest.mock('../../server/src/components/mongodb/collections', () => ({ sourceEvidenceExtractionsCol: jest.fn(), coursesCol: jest.fn(() => ({ findOne: async () => ({}) })) }));
import { ObjectId } from 'mongodb';
import { sourceExtractionIdentity, storeSourceExtraction } from '../../server/src/services/source-evidence-cache.service';
import { sourceEvidenceExtractionsCol } from '../../server/src/components/mongodb/collections';

it('keys by course, ordered original text, parsing versions, title, normalized guidance and effective model options', () => {
  const input = { courseId: new ObjectId(), materialId: new ObjectId(), sourceTextHash: 'actual-ordered-hash', parserVersion: 'parser-v1', chunkerVersion: 'chunk-v1',
    sourceTitle: 'Chapter 4', guidance: ' Keep notation ', promptText: 'Exact extraction schema and source template', modelConfiguration: { provider: 'synthetic', model: 'model-a', temperature: 0, maxTokens: 12000 },
    sections: [{ id: 'C1.S1', chunkIndex: 0, text: 'Original formula and conditions.' }, { id: 'C2.S1', chunkIndex: 1, text: 'Later original definition.' }] };
  const key = sourceExtractionIdentity(input).cacheKey;
  expect(sourceExtractionIdentity({ ...input, guidance: 'Keep notation' }).cacheKey).toBe(key);
  for (const change of [ { courseId: new ObjectId() }, { sourceTextHash: 'changed-hash' }, { parserVersion: 'parser-v2' }, { chunkerVersion: 'chunk-v2' },
    { sourceTitle: 'Chapter four' }, { guidance: 'Use different notation' }, { promptText: 'Changed extraction schema or source template' }, { modelConfiguration: { ...input.modelConfiguration, model: 'model-b' } },
    { modelConfiguration: { ...input.modelConfiguration, temperature: 0.2 } }, { sections: [...input.sections].reverse() },
    { sections: [{ ...input.sections[0], text: 'Changed original.' }, input.sections[1]] } ]) {
    expect(sourceExtractionIdentity({ ...input, ...change }).cacheKey).not.toBe(key);
  }
  // Material assignment/classification revisions are deliberately absent.
  expect(sourceExtractionIdentity({ ...input, materialId: new ObjectId() }).cacheKey).toBe(key);
});

it('removes an orphan cache write when standalone source eligibility changes after publication', async () => {
  const updateOne = jest.fn(async () => ({ matchedCount: 1 })); const deleteOne = jest.fn(async () => ({ deletedCount: 1 }));
  jest.mocked(sourceEvidenceExtractionsCol).mockReturnValue({ updateOne, deleteOne } as never);
  const identity = sourceExtractionIdentity({ courseId: new ObjectId(), materialId: new ObjectId(), sourceTextHash: 'original', parserVersion: 'v1', chunkerVersion: 'v1',
    sourceTitle: 'Chapter', guidance: '', promptText: 'Exact source prompt', modelConfiguration: { model: 'test' }, sections: [{ id: 'C1.S1', chunkIndex: 0, text: 'Original.' }] });
  const eligible = jest.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('structure-material-changed'));
  await expect(storeSourceExtraction(identity, [{ sectionId: 'C1.S1', objectives: [], knowledge: [], skipReason: 'Title only' }], eligible)).rejects.toThrow('structure-material-changed');
  expect(updateOne).toHaveBeenCalledTimes(1);
  expect(deleteOne).toHaveBeenCalledWith({ courseId: identity.courseId, cacheKey: identity.cacheKey });
});
