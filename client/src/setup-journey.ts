import { browseBank, getCourseTree, getInstructorWorkflow, type InstructorWorkflowSummary } from './api.js';
import { getSession } from './auth.js';
import { el, mount } from './dom.js';
import { startAnonymousPreview } from './preview-session.js';

const routes = ['materials', 'structure', 'preseeding', 'queue', 'bank'];
const labels = ['Materials', 'Objectives', 'Generate', 'Review', 'Question Bank', 'Student Preview'];
const tasks = ['Upload course materials', 'Define your learning objectives', 'Generate your first questions', 'Review your questions', 'Release an approved topic', 'Try the student experience'];
interface Journey { courseId: string; step: number; collapsed: boolean }
let journey: Journey | undefined;
let owner = '';
let host: HTMLElement | undefined;
let guideResize: ResizeObserver | undefined;
function measureGuide(): void {
  const island = host?.firstElementChild;
  const height = island ? Math.ceil(island.getBoundingClientRect().height) + 40 : 0;
  document.body.style.setProperty('--setup-guide-space', `${height}px`);
}
let summary: InstructorWorkflowSummary | undefined;
let released = false;
let error = '';
let expanded = false;
let installed = false;
let revision = 0;
let pending = false;
let rendered = '';
let refreshAgain = false;
const key = () => `financebot-setup-journey:${owner}`;
function save(): void { try { if (journey) sessionStorage.setItem(key(), JSON.stringify(journey)); else sessionStorage.removeItem(key()); } catch { /* In-memory navigation still works. */ } }
function path(): string { return location.hash.replace(/^#/, '').split('?')[0]; }
function base(): string { return `/instructor/course/${encodeURIComponent(journey!.courseId)}`; }
function visible(): boolean { return !!journey && getSession().authenticated && getSession().user?.puid === owner && (path() === base() || path().startsWith(`${base()}/`)); }
function clearSidebar(): void {
  document.querySelectorAll<HTMLElement>('[data-journey-step]').forEach(node => {
    const glyph = node.querySelector('.nav__glyph'); if (glyph) glyph.textContent = String(Number(node.dataset.journeyStep) + 1);
    node.classList.remove('journey-current', 'journey-complete', 'journey-upcoming');
    node.removeAttribute('data-journey-step'); node.querySelector('.journey-nav-label')?.remove();
  });
}
function completions(): boolean[] {
  if (!summary) return Array(6).fill(false) as boolean[];
  const c = summary.counts;
  return [c.readyMaterials > 0 && c.processingMaterials === 0, c.learningObjectives > 0,
    c.totalQuestions > 0 && c.activeGenerationRuns === 0,
    c.approvedQuestions > 0 && c.reviewQueue === 0 && c.activeGenerationRuns === 0,
    released, summary.setup.steps.some(s => s.id === 'student-preview' && s.status === 'complete')];
}
function details(): string[] {
  if (!summary) return Array(6).fill('Checking course progress…') as string[];
  const c = summary.counts;
  return [ `${c.readyMaterials} ready · ${c.processingMaterials} processing${c.failedMaterials ? ` · ${c.failedMaterials} need attention` : ''}. Upload files on this page.`,
    `${c.learningObjectives} objectives. Add or refine the topics students should learn.`,
    `${c.totalQuestions} questions · ${c.activeGenerationRuns} active runs. Start generation on this page.`,
    `${c.reviewQueue} awaiting review · ${c.approvedQuestions} approved. Review answers before approving.`,
    released ? 'Approved, checked questions are ready for preview. Live access also requires a published course.' : 'Approve a question, then release its topics in Manage topic releases. Content checks must pass.',
    'Use the isolated Student Preview, then return through the role menu. No live student records are affected.' ];
}
function go(step: number): void {
  if (!journey) return;
  const nextStep = Math.max(0, Math.min(5, step));
  if (nextStep === 5) {
    if (!released) { location.hash = `${base()}/bank`; return; }
    startAnonymousPreview(journey.courseId);
    location.hash = `/preview/course/${encodeURIComponent(journey.courseId)}`;
  } else location.hash = `${base()}/${routes[nextStep]}`;
  // Persist the new step only after the router accepts navigation.
  // Cancelling an unsaved-edit prompt must leave the guide on this page.
}
function stop(): void { journey = undefined; revision++; pending = false; save(); draw(); }
function draw(): void {
  clearSidebar();
  document.body.classList.toggle('has-setup-journey', visible());
  if (!host?.isConnected) {
    rendered = '';
    host = el('div', { id: 'setup-journey' });
    document.body.append(host);
    guideResize ??= new ResizeObserver(measureGuide);
    new MutationObserver(() => {
      guideResize?.disconnect();
      if (host?.firstElementChild) guideResize?.observe(host.firstElementChild);
      measureGuide();
    }).observe(host, { childList: true });
  }
  if (!visible()) { guideResize?.disconnect(); document.body.style.removeProperty('--setup-guide-space'); host.replaceChildren(); rendered = ''; return; }
  const j = journey!;
  const done = completions();
  routes.forEach((route, index) => {
    const link = Array.from(document.querySelectorAll<HTMLAnchorElement>('.nav a')).find(a => a.getAttribute('href') === `#${base()}/${route}`);
    if (!link) return;
    link.dataset.journeyStep = String(index);
    link.classList.toggle('journey-current', index === j.step);
    link.classList.toggle('journey-complete', done[index]);
    link.classList.toggle('journey-upcoming', index === j.step + 1);
    const glyph = link.querySelector('.nav__glyph'); if (glyph && done[index]) glyph.textContent = '✓';
    if (index === j.step) link.append(el('span', { class: 'journey-nav-label', text: 'HERE' }));
  });
  const signature = JSON.stringify([j, done, details(), error, expanded]);
  if (signature === rendered) return;
  rendered = signature;
  const button = (text: string, action: () => void, cls = '', disabled = false) => el('button', { type: 'button', class: cls, text, disabled, onclick: action });
  const next = j.step < 5 ? `Next: ${labels[j.step + 1]} →` : 'Finish guide ✓';
  const allowed = !!summary && !error && done[j.step];
  const setCollapsed = (value: boolean) => {
    j.collapsed = value; expanded = false; save(); draw();
    host?.querySelector<HTMLButtonElement>(value ? '.setup-island__expand' : '.setup-island__minimize')?.focus({ preventScroll: true });
  };
  const nextButton = () => el('button', {
    type: 'button', class: 'setup-island__next', 'aria-label': next, disabled: !allowed,
    onclick: () => j.step === 5 ? stop() : go(j.step + 1),
  }, el('span', { class: 'setup-island__next-label', text: next }),
  el('span', { class: 'setup-island__next-short', 'aria-hidden': 'true', text: j.step === 5 ? 'Finish ✓' : 'Next →' }));
  if (j.collapsed) {
    mount(host, el('section', { class: 'setup-island setup-island--small', 'aria-label': 'Setup guide' },
      el('span', { class: 'setup-island__number', text: done[j.step] ? '✓' : String(j.step + 1), 'aria-hidden': 'true' }),
      el('div', { class: 'setup-island__summary' }, el('strong', { text: labels[j.step] }),
        el('span', { role: 'status', text: `${j.step + 1} of 6 · ${error ? 'Check progress' : !summary ? 'Checking…' : done[j.step] ? 'Complete' : 'In progress'}` })),
      error ? button('Retry', () => void refresh()) : false,
      nextButton(),
      el('button', { type: 'button', class: 'setup-island__expand', text: '⌃', 'aria-label': 'Expand setup guide', 'aria-expanded': 'false', title: 'Show guide details', onclick: () => setCollapsed(false) })));
    return;
  }
  mount(host, el('section', { class: 'setup-island', 'aria-label': 'Course setup navigation' },
    el('div', { class: 'setup-island__top' }, el('strong', { text: `GUIDED SETUP · ${j.step + 1} OF 6` }),
      el('button', { type: 'button', text: 'All steps', 'aria-expanded': String(expanded), onclick: () => { expanded = !expanded; draw(); } }),
      button('Minimize', () => setCollapsed(true), 'setup-island__minimize'), button('Exit guide', stop)),
    expanded ? el('nav', { class: 'setup-island__map', 'aria-label': 'Setup steps' }, ...labels.map((label, index) => button(`${done[index] ? '✓' : index + 1} ${label}`, () => go(index), index === j.step ? 'is-current' : '', index === 5 && !released))) : false,
    el('div', { class: 'setup-island__main' }, el('span', { class: 'setup-island__number', text: done[j.step] ? '✓' : String(j.step + 1), 'aria-hidden': 'true' }),
      el('div', { class: 'setup-island__copy' }, el('strong', { text: done[j.step] ? `${labels[j.step]} · Complete` : tasks[j.step] }),
        el('p', { role: 'status', text: error || details()[j.step] })),
      j.step > 0 ? button('← Back', () => go(j.step - 1)) : false,
      error ? button('Retry', () => void refresh()) : false,
      nextButton()),
    j.step === 0 && !done[0] ? el('div', { class: 'setup-island__alternative' }, button('I already have objectives →', () => go(1))) : false,
    j.step === 3 && (summary?.counts.approvedQuestions ?? 0) > 0 && !done[3] ? el('div', { class: 'setup-island__alternative' }, button('Manage approved questions →', () => go(4))) : false,
    j.step === 5 && !done[5] ? el('div', { class: 'setup-island__alternative' }, button('Open Student Preview →', () => go(5), '', !released)) : false,
    el('div', { class: 'setup-island__track', 'aria-hidden': 'true' }, ...done.map((value, i) => el('span', { class: value ? 'is-complete' : i === j.step ? 'is-current' : '' })))));
}
async function refresh(): Promise<void> {
  if (!visible() || document.hidden) return;
  if (pending) { refreshAgain = true; return; }
  const token = revision; const courseId = journey!.courseId; pending = true;
  try {
    const [data, tree, bank] = await Promise.all([getInstructorWorkflow(courseId), getCourseTree(courseId), browseBank(courseId, { state: 'approved' })]);
    if (revision !== token || !visible()) return;
    summary = data;
    released = bank.questions.some(q => q.contentReady === true && q.themeIds.length > 0 && q.themeIds.every(id => {
      const topic = tree.themes.find(t => t._id === id);
      return !!topic?.availableFrom && Date.parse(topic.availableFrom) <= Date.now();
    }));
    error = '';
  } catch { if (revision === token) error = 'Progress could not be refreshed. Retry to check before continuing.'; }
  finally { if (revision === token) { pending = false; draw(); if (refreshAgain) { refreshAgain = false; void refresh(); } } }
}
function onRoute(): void {
  if (journey && path() === `/preview/course/${encodeURIComponent(journey.courseId)}`) { journey.step = 5; save(); }
  if (journey && visible()) {
    const suffix = path().slice(base().length + 1).split('/')[0]; const index = routes.indexOf(suffix);
    if (index >= 0) journey.step = index;
    save();
  }
  draw(); void refresh();
}
/** Restore navigation preference only; completion always comes from current server data. */
export function syncSetupJourney(): void {
  const user = getSession().user?.puid ?? '';
  if (user !== owner) {
    owner = user; journey = undefined; summary = undefined; released = false; error = ''; revision++; pending = false;
    try { const stored = JSON.parse(sessionStorage.getItem(key()) ?? 'null') as Journey | null;
      // Reopening the app starts compact; navigating between pages keeps the current preference.
      if (user && stored && typeof stored.courseId === 'string' && Number.isInteger(stored.step) && stored.step >= 0 && stored.step <= 5) journey = { ...stored, collapsed: true };
    } catch { /* Missing/invalid stored preference. */ }
  }
  if (!installed) {
    installed = true;
    window.addEventListener('hashchange', () => setTimeout(onRoute, 0));
    window.addEventListener('focus', () => void refresh());
    document.addEventListener('visibilitychange', () => void refresh());
    window.setInterval(() => { if (visible()) void refresh(); }, 5000);
  }
  setTimeout(onRoute, 0);
}
export function startSetupJourney(courseId: string, action = 'upload-sources'): void {
  syncSetupJourney();
  const index = ['build-structure', 'choose-authoring-path'].includes(action) ? 1 : ['seed-thin-los', 'monitor-generation'].includes(action) ? 2 : action === 'review-questions' ? 3 : action === 'preview-course' ? 4 : 0;
  journey = { courseId, step: index, collapsed: true }; summary = undefined; released = false; error = ''; revision++; pending = false; expanded = false; save(); go(index); void refresh();
}
