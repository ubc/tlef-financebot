import type { ObjectId } from 'mongodb';
import {
  losCol,
  materialsCol,
  questionsCol,
  themesCol,
} from '../components/mongodb/collections';
import type {
  ContentRunStatus,
  MaterialKind,
  PublicationState,
} from '../types/domain';
import { listCourseContentRuns } from './content-runs.service';

const STATES: PublicationState[] = [
  'draft',
  'pending-review',
  'reviewed',
  'approved',
  'paused',
  'archived',
];

export interface ContentMapMaterial {
  materialId: ObjectId;
  name: string;
  kind: MaterialKind;
  status: 'processing' | 'ready' | 'failed';
  assessmentLike: boolean;
  latestRun?: { runId: ObjectId; status: ContentRunStatus; stage: string };
}

export interface ContentMapLo {
  loId: ObjectId;
  name: string;
  order: number;
  materials: ContentMapMaterial[];
  materialCounts: Partial<Record<MaterialKind, number>>;
  questionCounts: Record<PublicationState, number>;
  latestGenerationRun?: { runId: ObjectId; status: ContentRunStatus; stage: string };
  gaps: Array<'no-material' | 'no-approved-questions' | 'thin-approved-set'>;
}

export interface CourseContentMap {
  themes: Array<{
    themeId: ObjectId;
    name: string;
    order: number;
    los: ContentMapLo[];
  }>;
  unassignedMaterials: ContentMapMaterial[];
}

export async function getCourseContentMap(courseId: ObjectId): Promise<CourseContentMap> {
  const [themes, los, materials, questions, runs] = await Promise.all([
    themesCol().find({ courseId, archivedAt: { $exists: false } }).sort({ order: 1 }).toArray(),
    losCol().find({ courseId, archivedAt: { $exists: false } }).sort({ order: 1 }).toArray(),
    materialsCol().find({ courseId }).sort({ uploadedAt: -1 }).toArray(),
    questionsCol().find({ courseId }).toArray(),
    listCourseContentRuns(courseId, { limit: 100 }),
  ]);

  const runById = new Map(runs.map((run) => [run._id.toHexString(), run]));
  const latestGenerationByLo = new Map<string, (typeof runs)[number]>();
  for (const run of runs) {
    if (run.kind !== 'question-generation') continue;
    const key = run.input.loId.toHexString();
    if (!latestGenerationByLo.has(key)) latestGenerationByLo.set(key, run);
  }

  const materialSummary = (material: (typeof materials)[number]): ContentMapMaterial => {
    const run = material.activeRunId ? runById.get(material.activeRunId.toHexString()) : undefined;
    const kind = material.kind ?? 'other';
    return {
      materialId: material._id,
      name: material.name,
      kind,
      status: material.status,
      assessmentLike: ['assignment', 'assessment', 'solution'].includes(kind),
      ...(run
        ? { latestRun: { runId: run._id, status: run.status, stage: run.stage } }
        : {}),
    };
  };

  const resultThemes = themes.map((theme) => ({
    themeId: theme._id,
    name: theme.name,
    order: theme.order,
    los: los
      .filter((lo) => lo.themeId.equals(theme._id))
      .map((lo): ContentMapLo => {
        const assigned = materials.filter((material) =>
          material.assignments.some(
            (assignment) =>
              assignment.themeId.equals(theme._id) &&
              (!assignment.loId || assignment.loId.equals(lo._id)),
          ),
        );
        const summaries = assigned.map(materialSummary);
        const materialCounts: Partial<Record<MaterialKind, number>> = {};
        for (const material of summaries) {
          materialCounts[material.kind] = (materialCounts[material.kind] ?? 0) + 1;
        }
        const questionCounts = Object.fromEntries(STATES.map((state) => [state, 0])) as Record<
          PublicationState,
          number
        >;
        for (const question of questions) {
          if (question.loIds.some((id) => id.equals(lo._id))) questionCounts[question.state] += 1;
        }
        const gaps: ContentMapLo['gaps'] = [];
        if (summaries.length === 0) gaps.push('no-material');
        if (questionCounts.approved === 0) gaps.push('no-approved-questions');
        else if (questionCounts.approved < 3) gaps.push('thin-approved-set');
        const latest = latestGenerationByLo.get(lo._id.toHexString());
        return {
          loId: lo._id,
          name: lo.name,
          order: lo.order,
          materials: summaries,
          materialCounts,
          questionCounts,
          ...(latest
            ? {
                latestGenerationRun: {
                  runId: latest._id,
                  status: latest.status,
                  stage: latest.stage,
                },
              }
            : {}),
          gaps,
        };
      }),
  }));

  return {
    themes: resultThemes,
    unassignedMaterials: materials
      .filter((material) => material.assignments.length === 0)
      .map(materialSummary),
  };
}
