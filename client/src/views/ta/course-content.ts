import {
  browseBank,
  getCourseContentMap,
  getCourseOutline,
  getMaterialWorkspaceDetail,
  listMaterials,
  materialSourceUrl,
  type BankQuestion,
  type CourseContentMap,
  type CourseOutline,
  type Material,
} from '../../api.js';
import { el, mount } from '../../dom.js';
import { pageHeader } from '../../instructor-ui.js';
import type { RouteParams } from '../../router.js';
import { errorState, loadingState } from '../../ui.js';

type Section = 'overview' | 'materials' | 'structure' | 'coverage' | 'bank';

const sections: Array<{ id: Section; label: string }> = [
  { id: 'overview', label: 'Course Home' },
  { id: 'materials', label: 'Materials' },
  { id: 'structure', label: 'Course Structure' },
  { id: 'coverage', label: 'Coverage Map' },
  { id: 'bank', label: 'Question Bank' },
];

const message = (error: unknown): string => error instanceof Error ? error.message : 'Unable to load course content.';

function sectionLink(courseId: string, section: Section, label: string): HTMLAnchorElement {
  return el('a', { class: 'btn btn--secondary btn--sm', href: `#/ta/course/${encodeURIComponent(courseId)}/${section}`, text: label });
}

function courseHeading(outline: CourseOutline, section: Section): HTMLElement {
  const name = sections.find(item => item.id === section)!.label;
  return el('div', { class: 'stack stack--sm' },
    pageHeader(name, `${outline.course.courseCode} · ${outline.course.name}`),
    el('p', { class: 'muted', text: 'Browse course content here. Final approval, publication and course settings remain with the Instructor.' }),
  );
}

function drawOverview(outline: CourseOutline, map: CourseContentMap, courseId: string): HTMLElement {
  const objectives = map.themes.flatMap(theme => theme.los);
  const materials = new Set([
    ...map.unassignedMaterials.map(item => item.materialId),
    ...objectives.flatMap(lo => lo.materials.map(item => item.materialId)),
  ]);
  const gaps = objectives.filter(lo => lo.gaps.length > 0).length;
  return el('div', { class: 'stack' },
    el('div', { class: 'analytics-metrics' },
      ...[
        [String(outline.themes.length), 'Topics'],
        [String(outline.themes.reduce((total, theme) => total + theme.los.length, 0)), 'Learning objectives'],
        [String(materials.size), 'Active materials'],
        [String(gaps), 'Objectives with coverage gaps'],
      ].map(([value, label]) => el('div', { class: 'analytics-metric' }, el('strong', { text: value }), el('span', { text: label })))),
    el('section', { class: 'card stack' }, el('h2', { text: 'Explore this course' }),
      el('p', { text: 'Inspect sources, learning objectives, coverage and questions before suggesting changes to the teaching team.' }),
      el('div', { class: 'cluster' },
        sectionLink(courseId, 'materials', 'View materials'),
        sectionLink(courseId, 'structure', 'View structure'),
        sectionLink(courseId, 'coverage', 'Review coverage'),
        sectionLink(courseId, 'bank', 'Browse questions'))),
  );
}

function drawStructure(outline: CourseOutline): HTMLElement {
  if (!outline.themes.length) return el('p', { class: 'card', text: 'No topics have been added to this course.' });
  return el('div', { class: 'stack' }, ...outline.themes.map(theme => el('section', { class: 'card stack' },
    el('h2', { text: theme.name }),
    theme.los.length
      ? el('ol', {}, ...theme.los.map(lo => el('li', { text: lo.name })))
      : el('p', { class: 'muted', text: 'No learning objectives yet.' }),
  )));
}

function drawCoverage(map: CourseContentMap, courseId: string): HTMLElement {
  const rows = map.themes.flatMap(theme => theme.los.map(lo => ({ theme, lo })));
  if (!rows.length) return el('p', { class: 'card', text: 'Coverage will appear after learning objectives are added.' });
  return el('div', { class: 'stack' },
    el('p', { class: 'muted', text: 'Counts are per learning objective. One question or material can support more than one objective.' }),
    el('div', { class: 'card analytics-table-wrap', tabindex: '0', role: 'region', 'aria-label': 'Course coverage table' },
      el('table', { class: 'analytics-table' },
        el('thead', {}, el('tr', {}, ...['Topic / objective', 'Sources', 'Approved questions', 'Coverage gaps'].map(text => el('th', { scope: 'col', text })))),
        el('tbody', {}, ...rows.map(({ theme, lo }) => el('tr', {},
          el('td', {}, el('strong', { text: lo.name }), el('small', { text: theme.name })),
          el('td', {}, ...lo.materials.map(material => el('div', {}, sectionLink(courseId, 'materials', material.name))),
            ...(!lo.materials.length ? [el('span', { text: 'No linked material' })] : [])),
          el('td', { text: String(lo.questionCounts.approved) }),
          el('td', { text: lo.gaps.length ? lo.gaps.map(gap => gap.replace(/-/g, ' ')).join(', ') : 'No coverage gap' }),
        )))),
    ),
  );
}

function drawMaterials(root: HTMLElement, courseId: string, materials: Material[]): HTMLElement {
  const detail = el('div', { class: 'card stack', 'aria-live': 'polite' });
  let selected = 0;
  async function inspect(material: Material): Promise<void> {
    const version = ++selected;
    detail.replaceChildren(loadingState(`Loading ${material.name}…`));
    try {
      const result = await getMaterialWorkspaceDetail(courseId, material._id);
      if (!root.isConnected || version !== selected) return;
      detail.replaceChildren(el('h2', { text: material.name }),
        el('p', { class: 'muted', text: `${material.kind ?? 'other'} · ${material.status} · ${result.chunks.length} stored sections` }),
        el('a', { class: 'btn btn--secondary btn--sm', href: materialSourceUrl(courseId, material._id), target: '_blank', rel: 'noopener noreferrer', text: 'Open original source' }),
        ...(result.chunks.length
          ? result.chunks.map(chunk => el('section', { class: 'stack stack--sm' }, el('h3', { text: `Section ${chunk.index + 1}` }), el('p', { text: chunk.text })))
          : [el('p', { text: 'No stored sections are available yet.' })]));
    } catch (error) {
      if (root.isConnected && version === selected) detail.replaceChildren(errorState(message(error), () => void inspect(material)));
    }
  }
  if (!materials.length) return el('p', { class: 'card', text: 'No active materials have been added to this course.' });
  return el('div', { class: 'stack' },
    el('section', { class: 'card stack' }, el('h2', { text: 'Active sources' }),
      ...materials.map(material => el('div', { class: 'cluster' },
        el('button', { type: 'button', class: 'btn btn--ghost', onclick: () => void inspect(material), text: material.name }),
        el('span', { class: 'muted', text: `${material.kind ?? 'other'} · ${material.status}` })))),
    detail,
  );
}

function drawBank(courseId: string, questions: BankQuestion[], total: number): HTMLElement {
  const search = el('input', { class: 'input', type: 'search', placeholder: 'Search question text', 'aria-label': 'Search questions' }) as HTMLInputElement;
  const results = el('div', { class: 'stack' });
  function refresh(): void {
    const query = search.value.trim().toLowerCase();
    const filtered = questions.filter(question => `${question.sample?.stem ?? question.current.stem}`.toLowerCase().includes(query));
    results.replaceChildren(el('p', { class: 'muted', text: `${filtered.length} of ${total} questions shown` }),
      ...filtered.map(question => el('article', { class: 'card stack stack--sm' },
        el('div', { class: 'cluster' }, el('strong', { text: question.state.replace(/-/g, ' ') }), el('span', { class: 'muted', text: question.current.difficulty })),
        el('p', { text: question.sample?.stem ?? question.current.stem }),
        el('a', { href: `#/ta/course/${encodeURIComponent(courseId)}/question/${encodeURIComponent(question.id)}`, text: 'Read question and notes →' }),
      )));
    if (!filtered.length) results.append(el('p', { text: query ? 'No matching questions.' : 'No questions in this course yet.' }));
  }
  search.addEventListener('input', refresh);
  refresh();
  return el('div', { class: 'stack' }, search, results);
}

async function renderSection(outlet: HTMLElement, courseId: string, section: Section): Promise<void> {
  const root = el('div', { class: 'view stack ta-content-view' }, loadingState('Loading course content…'));
  mount(outlet, root);
  const route = location.hash;
  try {
    const outline = await getCourseOutline(courseId);
    if (!root.isConnected || location.hash !== route) return;
    let content: HTMLElement;
    if (section === 'overview') content = drawOverview(outline, await getCourseContentMap(courseId), courseId);
    else if (section === 'materials') content = drawMaterials(root, courseId, await listMaterials(courseId));
    else if (section === 'structure') content = drawStructure(outline);
    else if (section === 'coverage') content = drawCoverage(await getCourseContentMap(courseId), courseId);
    else {
      const result = await browseBank(courseId);
      content = drawBank(courseId, result.questions, result.total);
    }
    if (!root.isConnected || location.hash !== route) return;
    root.replaceChildren(courseHeading(outline, section), content);
  } catch (error) {
    if (root.isConnected && location.hash === route) root.replaceChildren(errorState(message(error), () => void renderSection(outlet, courseId, section)));
  }
}

export const renderTaCourseHome = (outlet: HTMLElement, params: RouteParams): void => { void renderSection(outlet, params.id, 'overview'); };
export const renderTaMaterials = (outlet: HTMLElement, params: RouteParams): void => { void renderSection(outlet, params.id, 'materials'); };
export const renderTaStructure = (outlet: HTMLElement, params: RouteParams): void => { void renderSection(outlet, params.id, 'structure'); };
export const renderTaCoverage = (outlet: HTMLElement, params: RouteParams): void => { void renderSection(outlet, params.id, 'coverage'); };
export const renderTaBank = (outlet: HTMLElement, params: RouteParams): void => { void renderSection(outlet, params.id, 'bank'); };
