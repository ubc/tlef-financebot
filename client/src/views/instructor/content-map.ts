import {
  ApiError,
  getCourseContentMap,
  type ContentMapLo,
  type ContentMapMaterial,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { pageHeader, statusBadge } from '../../instructor-ui.js';
import { emptyState, errorState, loadingState } from '../../ui.js';
import type { RouteParams } from '../../router.js';

const GAP_LABEL: Record<ContentMapLo['gaps'][number], string> = {
  'no-material': 'No assigned material',
  'no-approved-questions': 'No approved questions',
  'thin-approved-set': 'Fewer than 3 approved',
};

function materialLabel(material: ContentMapMaterial): HTMLElement {
  const run = material.latestRun
    ? ` · ingest ${material.latestRun.status}/${material.latestRun.stage}`
    : '';
  return el(
    'span',
    { class: 'chip' },
    `${material.name} · ${material.kind}${material.assessmentLike ? ' · assessment-like' : ''}${run}`,
  );
}

function loCard(lo: ContentMapLo): HTMLElement {
  const latest = lo.latestGenerationRun;
  return el(
    'article',
    { class: 'card' },
    el(
      'div',
      { class: 'card__body stack' },
      el(
        'div',
        { class: 'row row--between' },
        el('h3', { text: lo.name }),
        statusBadge(
          `${lo.questionCounts.approved} approved`,
          lo.questionCounts.approved >= 3 ? 'approved' : 'pending',
        ),
      ),
      lo.materials.length
        ? el('div', { class: 'row row--wrap' }, ...lo.materials.map(materialLabel))
        : el('p', { class: 'view__lead', text: 'No materials assigned.' }),
      el('p', {
        class: 'mono',
        text:
          `Questions · Draft ${lo.questionCounts.draft} · Pending ${lo.questionCounts['pending-review']} · ` +
          `Reviewed ${lo.questionCounts.reviewed} · Approved ${lo.questionCounts.approved}`,
      }),
      latest
        ? el('p', {
            class: 'view__lead',
            text: `Latest generation ${latest.status} · ${latest.stage} · run ${latest.runId.slice(-8)}`,
          })
        : false,
      lo.gaps.length
        ? el(
            'div',
            { class: 'row row--wrap' },
            ...lo.gaps.map((gap) => statusBadge(GAP_LABEL[gap], 'pending')),
          )
        : statusBadge('Coverage ready', 'approved'),
    ),
  );
}

async function renderContentMapInner(outlet: HTMLElement, courseId: string): Promise<void> {
  const body = el('div', {}, loadingState('Building content map…'));
  mount(
    outlet,
    el(
      'div',
      { class: 'view' },
      pageHeader(
        'Content Map',
        'Course materials, assessment-like sources, question coverage, and recent generation status by LO.',
      ),
      body,
    ),
  );
  try {
    const map = await getCourseContentMap(courseId);
    const sections = map.themes.map((theme) =>
      el(
        'section',
        { class: 'stack' },
        el('h2', { class: 'section-title', text: theme.name }),
        theme.los.length
          ? el('div', { class: 'content-map-grid' }, ...theme.los.map(loCard))
          : emptyState('This Topic has no active learning objectives.'),
      ),
    );
    if (map.unassignedMaterials.length) {
      sections.push(
        el(
          'section',
          { class: 'card' },
          el(
            'div',
            { class: 'card__body stack' },
            el('h2', { text: 'Unassigned materials' }),
            el('div', { class: 'row row--wrap' }, ...map.unassignedMaterials.map(materialLabel)),
          ),
        ),
      );
    }
    body.replaceChildren(
      sections.length
        ? el('div', { class: 'stack' }, ...sections)
        : emptyState('Add Topics, learning objectives, or materials to build the content map.'),
    );
  } catch (error) {
    body.replaceChildren(
      errorState(
        error instanceof ApiError ? error.message : (error as Error).message,
        () => void renderContentMapInner(outlet, courseId),
      ),
    );
  }
}

export function renderContentMap(outlet: HTMLElement, params: RouteParams): void {
  void renderContentMapInner(outlet, params.id);
}
