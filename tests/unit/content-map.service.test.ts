jest.mock('../../server/src/components/mongodb/collections', () => ({
  themesCol: jest.fn(),
  losCol: jest.fn(),
  materialsCol: jest.fn(),
  materialChunksCol: jest.fn(),
  questionsCol: jest.fn(),
  questionVersionsCol: jest.fn(),
}));
jest.mock('../../server/src/services/content-runs.service', () => ({
  listCourseContentRuns: jest.fn(),
}));

import { ObjectId } from 'mongodb';
import {
  losCol,
  materialsCol,
  materialChunksCol,
  questionVersionsCol,
  questionsCol,
  themesCol,
} from '../../server/src/components/mongodb/collections';
import { listCourseContentRuns } from '../../server/src/services/content-runs.service';
import { getCourseContentMap, getCourseKnowledgeGraph } from '../../server/src/services/content-map.service';

function cursor(rows: unknown[]) {
  const value = {
    sort: jest.fn(),
    toArray: jest.fn(async () => rows),
  };
  value.sort.mockReturnValue(value);
  return value;
}

describe('course content map', () => {
  it('joins hierarchy, material kinds, question states, run status, and actionable gaps', async () => {
    const courseId = new ObjectId();
    const themeId = new ObjectId();
    const firstLoId = new ObjectId();
    const secondLoId = new ObjectId();
    const assignedMaterialId = new ObjectId();
    const unassignedMaterialId = new ObjectId();
    const ingestRunId = new ObjectId();
    const generationRunId = new ObjectId();

    jest.mocked(themesCol).mockReturnValue({
      find: jest.fn(() => cursor([{ _id: themeId, courseId, name: 'Valuation', order: 1 }])),
    } as never);
    jest.mocked(losCol).mockReturnValue({
      find: jest.fn(() =>
        cursor([
          { _id: firstLoId, courseId, themeId, name: 'Discount cash flows', order: 1 },
          { _id: secondLoId, courseId, themeId, name: 'Estimate terminal value', order: 2 },
        ]),
      ),
    } as never);
    jest.mocked(materialsCol).mockReturnValue({
      find: jest.fn(() =>
        cursor([
          {
            _id: assignedMaterialId,
            courseId,
            name: 'Week 3 assignment.pdf',
            format: 'pdf',
            kind: 'assignment',
            status: 'ready',
            activeRunId: ingestRunId,
            assignments: [{ themeId, loId: firstLoId }],
            uploadedAt: new Date(),
          },
          {
            _id: unassignedMaterialId,
            courseId,
            name: 'Reference.pdf',
            format: 'pdf',
            status: 'processing',
            assignments: [],
            uploadedAt: new Date(),
          },
        ]),
      ),
    } as never);
    jest.mocked(questionsCol).mockReturnValue({
      find: jest.fn(() => ({
        toArray: jest.fn(async () => [
          { loIds: [firstLoId], state: 'approved' },
          { loIds: [firstLoId], state: 'approved' },
          { loIds: [firstLoId], state: 'draft' },
        ]),
      })),
    } as never);
    jest.mocked(listCourseContentRuns).mockResolvedValue([
      {
        _id: generationRunId,
        courseId,
        kind: 'question-generation',
        status: 'partial',
        stage: 'reviewing',
        input: { loId: firstLoId },
      },
      {
        _id: ingestRunId,
        courseId,
        kind: 'material-ingest',
        status: 'completed',
        stage: 'classifying',
        input: { materialId: assignedMaterialId },
      },
    ] as never);

    const map = await getCourseContentMap(courseId);

    expect(map.themes).toHaveLength(1);
    expect(map.themes[0]!.los[0]).toMatchObject({
      loId: firstLoId,
      materialCounts: { assignment: 1 },
      questionCounts: { approved: 2, draft: 1 },
      gaps: ['thin-approved-set'],
      latestGenerationRun: { runId: generationRunId, status: 'partial', stage: 'reviewing' },
    });
    expect(map.themes[0]!.los[0]!.materials[0]).toMatchObject({
      materialId: assignedMaterialId,
      assessmentLike: true,
      latestRun: { runId: ingestRunId, status: 'completed' },
    });
    expect(map.themes[0]!.los[1]).toMatchObject({
      loId: secondLoId,
      gaps: ['no-material', 'no-approved-questions'],
    });
    expect(map.unassignedMaterials).toEqual([
      expect.objectContaining({
        materialId: unassignedMaterialId,
        kind: 'other',
        assessmentLike: false,
      }),
    ]);
  });
});

describe('course knowledge graph', () => {
  it('traces material evidence and concepts through LOs to sourced questions', async () => {
    const courseId = new ObjectId();
    const themeId = new ObjectId();
    const loId = new ObjectId();
    const materialId = new ObjectId();
    const questionId = new ObjectId();
    const versionId = new ObjectId();
    jest.mocked(themesCol).mockReturnValue({ find: jest.fn(() => cursor([{ _id: themeId, name: 'Valuation', order: 1 }])) } as never);
    jest.mocked(losCol).mockReturnValue({ find: jest.fn(() => cursor([{ _id: loId, themeId, name: 'Compute NPV', order: 1 }])) } as never);
    jest.mocked(materialsCol).mockReturnValue({
      find: jest.fn(() => cursor([{
        _id: materialId,
        name: 'Week 3.pdf',
        kind: 'lecture',
        status: 'ready',
        assignments: [{ themeId, loId }],
        knowledgeConcepts: [{ name: 'Discount rate', confidence: 0.9, evidence: 'discount rate' }],
        uploadedAt: new Date(),
      }])),
    } as never);
    jest.mocked(materialChunksCol).mockReturnValue({
      find: jest.fn(() => cursor([{ _id: new ObjectId(), materialId, index: 0, text: 'Choose the discount rate.' }])),
    } as never);
    jest.mocked(questionsCol).mockReturnValue({
      find: jest.fn(() => ({ toArray: jest.fn(async () => [{ _id: questionId, currentVersionId: versionId, currentVersion: 1, state: 'approved', loIds: [loId] }]) })),
    } as never);
    jest.mocked(questionVersionsCol).mockReturnValue({
      find: jest.fn(() => ({ toArray: jest.fn(async () => [{ _id: versionId, stem: 'What is NPV?', sourceRefs: [{ materialId }] }]) })),
    } as never);

    const graph = await getCourseKnowledgeGraph(courseId);

    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: `material:${materialId.toHexString()}`, type: 'material' }),
      expect.objectContaining({ id: `concept:${materialId.toHexString()}:0`, label: 'Discount rate' }),
      expect.objectContaining({ id: `question:${questionId.toHexString()}`, label: 'What is NPV?' }),
    ]));
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: `concept:${materialId.toHexString()}:0`, target: `lo:${loId.toHexString()}`, type: 'covers' }),
      expect.objectContaining({ source: `lo:${loId.toHexString()}`, target: `question:${questionId.toHexString()}`, type: 'assesses' }),
      expect.objectContaining({ source: `question:${questionId.toHexString()}`, target: `material:${materialId.toHexString()}`, type: 'sourced-from' }),
    ]));
  });
});
