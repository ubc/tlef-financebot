// Unit test — classification.service (IN-S06) with its components MOCKED
// (materials/themes/los collections + the genai llm component), following
// materials.service.test.ts's pattern of isolating a service from the real
// toolkit/Mongo clients. Exercises Task 7 Step 1:
//   1. classifyMaterial stores a suggestion with RESOLVED ObjectIds (theme+lo)
//   2. low confidence (< 0.5) stores NOTHING
//   3. a themeName the LLM invents that matches no theme stores nothing
//   4. no excerpt / no themes → never calls the LLM, stores nothing
//   5. suggestHierarchy shapes the LLM JSON into the return type and NEVER
//      writes the DB
//   6. resolveClassification accept applies the suggestion to assignments and
//      clears it; reject clears it and leaves assignments untouched
jest.mock('../../server/src/components/mongodb/collections', () => ({
  materialsCol: jest.fn(),
  themesCol: jest.fn(),
  losCol: jest.fn(),
}));
jest.mock('../../server/src/components/genai/llm', () => ({ completeJson: jest.fn() }));

import { ObjectId } from 'mongodb';
import {
  classifyMaterial,
  suggestHierarchy,
  resolveClassification,
} from '../../server/src/services/classification.service';
import { materialsCol, themesCol, losCol } from '../../server/src/components/mongodb/collections';
import { completeJson } from '../../server/src/components/genai/llm';

const materialFindOne = jest.fn();
const materialUpdateOne = jest.fn();
const materialFindOneAndUpdate = jest.fn();
const materialToArray = jest.fn();
const themeToArray = jest.fn();
const loToArray = jest.fn();

function collectionWithFind(toArray: jest.Mock, extra: Record<string, unknown> = {}) {
  return { find: jest.fn(() => ({ toArray })), ...extra } as never;
}

beforeEach(() => {
  materialFindOne.mockReset();
  materialUpdateOne.mockReset();
  materialFindOneAndUpdate.mockReset();
  materialToArray.mockReset();
  themeToArray.mockReset();
  loToArray.mockReset();
  jest.mocked(completeJson).mockReset();

  // A real `find(...).toArray()` always resolves to an array; default the mocks
  // to [] so tests only set the ones they care about (individual tests override).
  materialToArray.mockResolvedValue([]);
  themeToArray.mockResolvedValue([]);
  loToArray.mockResolvedValue([]);

  jest.mocked(materialsCol).mockReturnValue(
    collectionWithFind(materialToArray, {
      findOne: materialFindOne,
      updateOne: materialUpdateOne,
      findOneAndUpdate: materialFindOneAndUpdate,
    }),
  );
  jest.mocked(themesCol).mockReturnValue(collectionWithFind(themeToArray));
  jest.mocked(losCol).mockReturnValue(collectionWithFind(loToArray));
});

describe('classifyMaterial (IN-S06)', () => {
  it('stores a suggestion with resolved theme+lo ObjectIds when confident', async () => {
    const materialId = new ObjectId();
    const courseId = new ObjectId();
    const themeId = new ObjectId();
    const loId = new ObjectId();

    materialFindOne.mockResolvedValue({ _id: materialId, courseId, excerpt: 'NPV and discounting…' });
    themeToArray.mockResolvedValue([{ _id: themeId, courseId, name: 'Time Value of Money' }]);
    loToArray.mockResolvedValue([{ _id: loId, courseId, themeId, name: 'Compute NPV' }]);
    jest
      .mocked(completeJson)
      .mockResolvedValue({ themeName: 'Time Value of Money', loName: 'Compute NPV', confidence: 0.9 });

    await classifyMaterial(materialId);

    expect(completeJson).toHaveBeenCalledTimes(1);
    expect(materialUpdateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = materialUpdateOne.mock.calls[0];
    expect(filter).toEqual({ _id: materialId });
    expect(update.$set.classificationSuggestion.themeId).toEqual(themeId);
    expect(update.$set.classificationSuggestion.loId).toEqual(loId);
    expect(update.$set.classificationSuggestion.confidence).toBe(0.9);
  });

  it('stores a theme-only suggestion (no loId) when the LLM omits loName', async () => {
    const materialId = new ObjectId();
    const courseId = new ObjectId();
    const themeId = new ObjectId();
    materialFindOne.mockResolvedValue({ _id: materialId, courseId, excerpt: 'text' });
    themeToArray.mockResolvedValue([{ _id: themeId, courseId, name: 'Bonds' }]);
    loToArray.mockResolvedValue([]);
    jest.mocked(completeJson).mockResolvedValue({ themeName: 'Bonds', confidence: 0.8 });

    await classifyMaterial(materialId);

    const update = materialUpdateOne.mock.calls[0][1];
    expect(update.$set.classificationSuggestion.themeId).toEqual(themeId);
    expect(update.$set.classificationSuggestion).not.toHaveProperty('loId');
  });

  it('stores NOTHING when confidence is below 0.5', async () => {
    const materialId = new ObjectId();
    const courseId = new ObjectId();
    materialFindOne.mockResolvedValue({ _id: materialId, courseId, excerpt: 'text' });
    themeToArray.mockResolvedValue([{ _id: new ObjectId(), courseId, name: 'Bonds' }]);
    loToArray.mockResolvedValue([]);
    jest.mocked(completeJson).mockResolvedValue({ themeName: 'Bonds', confidence: 0.4 });

    await classifyMaterial(materialId);

    expect(materialUpdateOne).not.toHaveBeenCalled();
  });

  it('stores NOTHING when the suggested themeName matches no existing theme', async () => {
    const materialId = new ObjectId();
    const courseId = new ObjectId();
    materialFindOne.mockResolvedValue({ _id: materialId, courseId, excerpt: 'text' });
    themeToArray.mockResolvedValue([{ _id: new ObjectId(), courseId, name: 'Bonds' }]);
    loToArray.mockResolvedValue([]);
    jest.mocked(completeJson).mockResolvedValue({ themeName: 'Derivatives', confidence: 0.95 });

    await classifyMaterial(materialId);

    expect(materialUpdateOne).not.toHaveBeenCalled();
  });

  it('never calls the LLM when the material has no excerpt', async () => {
    const materialId = new ObjectId();
    materialFindOne.mockResolvedValue({ _id: materialId, courseId: new ObjectId() });

    await classifyMaterial(materialId);

    expect(completeJson).not.toHaveBeenCalled();
    expect(materialUpdateOne).not.toHaveBeenCalled();
  });

  it('never calls the LLM when the course has no themes to classify into', async () => {
    const materialId = new ObjectId();
    materialFindOne.mockResolvedValue({ _id: materialId, courseId: new ObjectId(), excerpt: 'text' });
    themeToArray.mockResolvedValue([]);
    loToArray.mockResolvedValue([]);

    await classifyMaterial(materialId);

    expect(completeJson).not.toHaveBeenCalled();
    expect(materialUpdateOne).not.toHaveBeenCalled();
  });
});

describe('suggestHierarchy (IN-S06, slip candidate #3)', () => {
  it('shapes the LLM JSON into the return type and never writes the DB', async () => {
    const courseId = new ObjectId();
    materialToArray.mockResolvedValue([
      { _id: new ObjectId(), courseId, status: 'ready', excerpt: 'Chapter 1: discounting…' },
      { _id: new ObjectId(), courseId, status: 'ready', excerpt: 'Chapter 2: bonds…' },
    ]);
    jest.mocked(completeJson).mockResolvedValue({
      themes: [
        { name: 'Time Value of Money', los: ['Compute NPV', 'Compute IRR'] },
        { name: 'Bonds', los: ['Price a bond'] },
      ],
    });

    const result = await suggestHierarchy(courseId);

    expect(result).toEqual({
      themes: [
        { name: 'Time Value of Money', los: ['Compute NPV', 'Compute IRR'] },
        { name: 'Bonds', los: ['Price a bond'] },
      ],
    });
    // Never writes: no insert/update on any collection.
    expect(materialUpdateOne).not.toHaveBeenCalled();
    expect(materialFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('returns an empty hierarchy without calling the LLM when no material is ready', async () => {
    materialToArray.mockResolvedValue([]);

    const result = await suggestHierarchy(new ObjectId());

    expect(result).toEqual({ themes: [] });
    expect(completeJson).not.toHaveBeenCalled();
  });

  it('drops malformed entries from the LLM (missing/blank names, non-array los)', async () => {
    materialToArray.mockResolvedValue([{ _id: new ObjectId(), status: 'ready', excerpt: 'text' }]);
    jest.mocked(completeJson).mockResolvedValue({
      themes: [
        { name: 'Valid', los: ['A', '', 123, 'B'] },
        { name: '', los: ['x'] },
        { los: ['y'] },
        { name: 'NoLos' },
      ],
    });

    const result = await suggestHierarchy(new ObjectId());

    expect(result).toEqual({
      themes: [
        { name: 'Valid', los: ['A', 'B'] },
        { name: 'NoLos', los: [] },
      ],
    });
  });
});

describe('resolveClassification accept/reject (IN-S06)', () => {
  it('accept merges the suggestion into assignments and clears the suggestion', async () => {
    const materialId = new ObjectId();
    const themeId = new ObjectId();
    const loId = new ObjectId();
    materialFindOne.mockResolvedValue({
      _id: materialId,
      assignments: [],
      classificationSuggestion: { themeId, loId, confidence: 0.9 },
    });
    materialFindOneAndUpdate.mockResolvedValue({ _id: materialId, assignments: [{ themeId, loId }] });

    await resolveClassification(materialId, 'accept');

    const [filter, update] = materialFindOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ _id: materialId });
    expect(update.$set.assignments).toEqual([{ themeId, loId }]);
    expect(update.$unset).toEqual({ classificationSuggestion: '' });
  });

  it('reject clears the suggestion and leaves assignments untouched', async () => {
    const materialId = new ObjectId();
    const existing = { themeId: new ObjectId() };
    materialFindOne.mockResolvedValue({
      _id: materialId,
      assignments: [existing],
      classificationSuggestion: { themeId: new ObjectId(), confidence: 0.9 },
    });
    materialFindOneAndUpdate.mockResolvedValue({ _id: materialId, assignments: [existing] });

    await resolveClassification(materialId, 'reject');

    const update = materialFindOneAndUpdate.mock.calls[0][1];
    expect(update.$unset).toEqual({ classificationSuggestion: '' });
    expect(update.$set ?? {}).not.toHaveProperty('assignments');
  });

  it('accept throws when there is no suggestion to accept', async () => {
    const materialId = new ObjectId();
    materialFindOne.mockResolvedValue({ _id: materialId, assignments: [] });

    await expect(resolveClassification(materialId, 'accept')).rejects.toThrow('no-classification-suggestion');
    expect(materialFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('throws material-not-found when the material does not exist', async () => {
    materialFindOne.mockResolvedValue(null);
    await expect(resolveClassification(new ObjectId(), 'reject')).rejects.toThrow('material-not-found');
  });
});
