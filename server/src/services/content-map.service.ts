import type { ObjectId } from 'mongodb';
import {
  losCol,
  materialChunksCol,
  materialsCol,
  questionVersionsCol,
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
    materialsCol().find({ courseId, deletedAt: { $exists: false } }).sort({ uploadedAt: -1 }).toArray(),
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

export type KnowledgeNodeType = 'material' | 'evidence' | 'concept' | 'topic' | 'lo' | 'question';

export interface KnowledgeGraphNode {
  id: string;
  type: KnowledgeNodeType;
  label: string;
  subtitle?: string;
  materialId?: ObjectId;
  confidence?: number;
  trashed?: boolean;
}

export interface KnowledgeGraphEdge {
  id: string;
  source: string;
  target: string;
  type: 'contains' | 'supports' | 'covers' | 'defines' | 'assesses' | 'sourced-from' | 'related-to';
  label?: string;
}

export interface CourseKnowledgeGraph {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  truncated: boolean;
}

/** An inspectable evidence graph assembled from durable application records.
 * Chunks are capped per material for an initial readable view; selecting a
 * material loads its complete chunk list through the workspace-detail API. */
export async function getCourseKnowledgeGraph(courseId: ObjectId): Promise<CourseKnowledgeGraph> {
  const [themes, los, materials, questions] = await Promise.all([
    themesCol().find({ courseId, archivedAt: { $exists: false } }).sort({ order: 1 }).toArray(),
    losCol().find({ courseId, archivedAt: { $exists: false } }).sort({ order: 1 }).toArray(),
    materialsCol().find({ courseId }).sort({ uploadedAt: -1 }).toArray(),
    questionsCol().find({ courseId }).toArray(),
  ]);
  const chunks = await materialChunksCol()
    .find({ courseId })
    .sort({ materialId: 1, index: 1 })
    .toArray();
  const versions = questions.length
    ? await questionVersionsCol().find({ _id: { $in: questions.map((question) => question.currentVersionId) } }).toArray()
    : [];
  const versionById = new Map(versions.map((version) => [version._id.toHexString(), version]));
  const nodes: KnowledgeGraphNode[] = [];
  const edges: KnowledgeGraphEdge[] = [];
  const edgeKeys = new Set<string>();
  const addEdge = (edge: KnowledgeGraphEdge): void => {
    const key = `${edge.source}:${edge.target}:${edge.type}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push(edge);
  };

  for (const theme of themes) {
    const topicId = `topic:${theme._id.toHexString()}`;
    nodes.push({ id: topicId, type: 'topic', label: theme.name, subtitle: 'Topic' });
  }
  for (const lo of los) {
    const loId = `lo:${lo._id.toHexString()}`;
    nodes.push({ id: loId, type: 'lo', label: lo.name, subtitle: 'Learning objective' });
    addEdge({
      id: `edge:topic-lo:${lo._id.toHexString()}`,
      source: `topic:${lo.themeId.toHexString()}`,
      target: loId,
      type: 'defines',
    });
  }

  let truncated = false;
  for (const material of materials) {
    const materialHex = material._id.toHexString();
    const materialNodeId = `material:${materialHex}`;
    nodes.push({
      id: materialNodeId,
      type: 'material',
      label: material.name,
      subtitle: material.deletedAt ? 'Source deleted · retained provenance' : `${material.kind ?? 'other'} · ${material.status}`,
      materialId: material._id,
      ...(material.deletedAt ? { trashed: true } : {}),
    });
    const materialChunks = chunks
      .filter((chunk) => chunk.materialId.equals(material._id))
      .map((chunk) => ({ index: chunk.index, text: chunk.text }));
    if (materialChunks.length === 0 && material.excerpt) {
      materialChunks.push({ index: 0, text: material.excerpt });
    }
    if (materialChunks.length > 4) truncated = true;
    const visibleChunks = materialChunks.slice(0, 4);
    for (const chunk of visibleChunks) {
      const chunkNodeId = `evidence:${materialHex}:${chunk.index}`;
      nodes.push({
        id: chunkNodeId,
        type: 'evidence',
        label: `Chunk ${chunk.index + 1}`,
        subtitle: chunk.text.slice(0, 140),
        materialId: material._id,
      });
      addEdge({ id: `edge:material-chunk:${materialHex}:${chunk.index}`, source: materialNodeId, target: chunkNodeId, type: 'contains' });
    }
    for (const [conceptIndex, concept] of (material.knowledgeConcepts ?? []).entries()) {
      const conceptNodeId = `concept:${materialHex}:${conceptIndex}`;
      nodes.push({
        id: conceptNodeId,
        type: 'concept',
        label: concept.name,
        subtitle: concept.description,
        materialId: material._id,
        confidence: concept.confidence,
      });
      const supporting = visibleChunks.find(
        (chunk) =>
          (concept.evidence && chunk.text.toLowerCase().includes(concept.evidence.slice(0, 60).toLowerCase())) ||
          chunk.text.toLowerCase().includes(concept.name.toLowerCase()),
      );
      addEdge({
        id: `edge:evidence-concept:${materialHex}:${conceptIndex}`,
        source: supporting ? `evidence:${materialHex}:${supporting.index}` : materialNodeId,
        target: conceptNodeId,
        type: 'supports',
      });
      for (const assignment of material.assignments) {
        if (!assignment.loId) continue;
        addEdge({
          id: `edge:concept-lo:${materialHex}:${conceptIndex}:${assignment.loId.toHexString()}`,
          source: conceptNodeId,
          target: `lo:${assignment.loId.toHexString()}`,
          type: 'covers',
        });
      }
    }
  }

  for (const question of questions) {
    const questionHex = question._id.toHexString();
    const version = versionById.get(question.currentVersionId.toHexString());
    const questionNodeId = `question:${questionHex}`;
    nodes.push({
      id: questionNodeId,
      type: 'question',
      label: version?.stem.slice(0, 120) || `Question ${questionHex.slice(-6)}`,
      subtitle: `${question.state} · v${question.currentVersion}`,
    });
    for (const loId of question.loIds) {
      addEdge({ id: `edge:lo-question:${loId.toHexString()}:${questionHex}`, source: `lo:${loId.toHexString()}`, target: questionNodeId, type: 'assesses' });
    }
    for (const source of version?.sourceRefs ?? []) {
      addEdge({
        id: `edge:question-source:${questionHex}:${source.materialId.toHexString()}`,
        source: questionNodeId,
        target: `material:${source.materialId.toHexString()}`,
        type: 'sourced-from',
      });
    }
  }

  return { nodes, edges, truncated };
}
