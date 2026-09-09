import { listTutorials, resetTutorialProgress, saveTutorialProgress, type TutorialState, type TutorialRole } from './api.js';
import { getSession } from './auth.js';
import { el } from './dom.js';
import { TUTORIAL_DEFINITIONS, type TutorialDefinition, type TutorialStep, type StudentTutorialId } from './tutorial-definitions.js';
export { TUTORIAL_DEFINITIONS, type StudentTutorialId } from './tutorial-definitions.js';

interface Context { puid: string; identity: string; role: TutorialRole; route: string; root?: HTMLElement }
export interface TutorialOptions { root?: HTMLElement; preview?: boolean }
const states = new Map<string, Promise<TutorialState[]>>();
const pending = new Map<string, string>();
let activeClose: (() => void) | undefined;
let scheduled: AbortController | undefined;
const cacheKey = (puid: string, role: TutorialRole): string => `${puid}:${role}`;
const replayKey = (context: Context): string => `financebot:tutorial-replay:${cacheKey(context.puid, context.role)}`;

/** Real session role in the current route. Impersonation and timed sittings are never tutorial contexts. */
export function tutorialRole(): TutorialRole | undefined {
  const session = getSession();
  const user = session.user;
  const route = window.location.hash.slice(1).split('?')[0] || '/';
  if (!session.authenticated || !user || route.startsWith('/preview/') || /\/exam-attempt\/[^/]+$/.test(route)) return undefined;
  if (route.startsWith('/admin/')) return user.isAdmin ? 'admin' : undefined;
  if (route.startsWith('/ta/')) {
    const course = /^\/ta\/course\/([^/]+)/.exec(route)?.[1];
    return course && user.courseRoles.some((item) => item.role === 'ta' && item.courseId === decodeURIComponent(course)) ? 'ta' : undefined;
  }
  if (route.startsWith('/instructor/')) return user.isAdmin || user.platformInstructor || user.courseRoles.some((item) => item.role === 'instructor') ? 'instructor' : undefined;
  if (user.isAdmin || user.platformInstructor || user.courseRoles.some((item) => item.role === 'instructor' || item.role === 'ta')) return undefined;
  return 'student';
}
function capture(role: TutorialRole, root?: HTMLElement): Context | undefined {
  const session = getSession();
  if (!session.user || tutorialRole() !== role || (root && !root.isConnected)) return undefined;
  return { puid: session.user.puid, identity: JSON.stringify(session.user), role, route: location.hash, root };
}
function valid(context: Context): boolean {
  return context.route === location.hash && context.identity === JSON.stringify(getSession().user)
    && tutorialRole() === context.role && (!context.root || context.root.isConnected);
}
function marker(context: Context, value?: string | null): string | undefined {
  const key = replayKey(context);
  try {
    if (value === null) { pending.delete(key); sessionStorage.removeItem(key); }
    else if (value !== undefined) { pending.set(key, value); sessionStorage.setItem(key, value); }
    return pending.get(key) ?? sessionStorage.getItem(key) ?? undefined;
  } catch { return pending.get(key); }
}
export function loadTutorials(role: TutorialRole, refresh = false): Promise<TutorialState[]> {
  const puid = getSession().user?.puid;
  if (!puid) return Promise.resolve([]);
  const key = cacheKey(puid, role);
  if (refresh || !states.has(key)) {
    const request = listTutorials(role).catch((error: unknown) => {
      if (states.get(key) === request) states.delete(key);
      throw error;
    });
    states.set(key, request);
  }
  return states.get(key)!;
}
function targetFor(selector: string, root?: HTMLElement): HTMLElement | undefined {
  const target = (root ?? document).querySelector<HTMLElement>(selector);
  if (!target?.isConnected || !target.getClientRects().length || getComputedStyle(target).visibility === 'hidden') return undefined;
  return target;
}
function availableSteps(definition: TutorialDefinition, context: Context): Array<TutorialStep & { target: HTMLElement }> {
  const targets = definition.steps.map((step) => ({ ...step, target: targetFor(step.selector, context.root) }));
  return targets.every((step) => step.target) ? targets as Array<TutorialStep & { target: HTMLElement }> : [];
}
function waitForSteps(definition: TutorialDefinition, context: Context, signal: AbortSignal): Promise<Array<TutorialStep & { target: HTMLElement }>> {
  return new Promise((resolve) => {
    const finish = (steps: Array<TutorialStep & { target: HTMLElement }>): void => {
      observer.disconnect(); window.clearTimeout(timeout); signal.removeEventListener('abort', abort); resolve(steps);
    };
    const check = (): void => {
      if (!valid(context) || signal.aborted) { finish([]); return; }
      const steps = availableSteps(definition, context);
      if (steps.length) finish(steps);
    };
    const abort = (): void => finish([]);
    const observer = new MutationObserver(check);
    const timeout = window.setTimeout(() => finish([]), 4000);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    signal.addEventListener('abort', abort, { once: true }); check();
  });
}

function runTutorial(
  definition: TutorialDefinition,
  steps: Array<TutorialStep & { target: HTMLElement }>,
  context: Context,
): void {
  if (activeClose || !valid(context)) return;
  let index = 0;
  let previousFocus: HTMLElement | null = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  let currentTarget: HTMLElement | undefined;
  let settled = false;
  const background = Array.from(document.body.children).filter((node): node is HTMLElement => node instanceof HTMLElement).map((node) => ({ node, inert: node.inert }));

  const titleId = `tutorial-title-${definition.id}`;
  const bodyId = `tutorial-body-${definition.id}`;
  const progress = el('p', { class: 'tutorial-popover__progress' });
  const title = el('h2', { class: 'tutorial-popover__title', id: titleId });
  const body = el('p', { class: 'tutorial-popover__body', id: bodyId });
  const back = el('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, 'Back');
  const next = el('button', { class: 'btn btn--primary btn--sm', type: 'button' }, 'Next');
  const skip = el('button', { class: 'tutorial-popover__skip', type: 'button' }, 'Skip tutorial');
  const popover = el(
    'section',
    {
      class: 'tutorial-popover',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
      'aria-describedby': bodyId,
      tabindex: '-1',
    },
    progress,
    title,
    body,
    el('div', { class: 'tutorial-popover__footer' }, skip, el('div', { class: 'row' }, back, next)),
  );
  const layer = el('div', { class: 'tutorial-layer' }, popover);

  const position = (): void => {
    if (!currentTarget) return;
    const targetRect = currentTarget.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const margin = 18;
    const below = targetRect.bottom + margin + popoverRect.height <= window.innerHeight;
    const top = below
      ? targetRect.bottom + margin
      : Math.max(margin, targetRect.top - popoverRect.height - margin);
    const idealLeft = targetRect.left + (targetRect.width - popoverRect.width) / 2;
    const left = Math.max(margin, Math.min(idealLeft, window.innerWidth - popoverRect.width - margin));
    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
  };

  const close = (status?: 'completed' | 'dismissed'): void => {
    if (settled) return;
    settled = true;
    currentTarget?.classList.remove('tutorial-target');
    layer.remove();
    window.removeEventListener('resize', position);
    window.removeEventListener('scroll', position, true);
    window.removeEventListener('hashchange', dismissOnNavigation);
    activeClose = undefined;
    window.clearInterval(healthCheck);
    for (const { node, inert } of background) node.inert = inert;
    if (valid(context) && previousFocus?.isConnected) previousFocus.focus();
    if (status && valid(context)) {
      const key = cacheKey(context.puid, definition.role);
      const cached = states.get(key);
      if (cached) states.set(key, cached.then((items) => items.map((item) => item.id === definition.id ? { ...item, status } : item)));
      void saveTutorialProgress(definition.id, definition.role, status).catch(() => { states.delete(key); });
    }
  };

  const dismissOnNavigation = (): void => close();

  const draw = (): void => {
    currentTarget?.classList.remove('tutorial-target');
    const step = steps[index];
    const target = targetFor(step.selector, context.root);
    if (!valid(context) || !target) { close(); return; }
    step.target = target;
    currentTarget = target;
    currentTarget.classList.add('tutorial-target');
    currentTarget.scrollIntoView({ block: 'center', inline: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    progress.textContent = `${definition.label} · ${index + 1} of ${steps.length}`;
    title.textContent = step.title;
    body.textContent = step.body;
    back.hidden = index === 0;
    next.textContent = index === steps.length - 1 ? 'Done' : 'Next';
    window.requestAnimationFrame(() => {
      if (settled || !valid(context)) return;
      position();
      next.focus();
    });
  };

  back.addEventListener('click', () => {
    if (index > 0) {
      index -= 1;
      draw();
    }
  });
  next.addEventListener('click', () => {
    if (!valid(context) || currentTarget !== targetFor(steps[index].selector, context.root)) { close(); return; }
    if (index === steps.length - 1) close('completed');
    else {
      index += 1;
      draw();
    }
  });
  skip.addEventListener('click', () => close('dismissed'));
  popover.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Escape') close('dismissed');
    if (event.key === 'ArrowRight') next.click();
    if (event.key === 'ArrowLeft' && index > 0) back.click();
    if (event.key === 'Tab') {
      const controls = [skip, back, next].filter((control) => !control.hidden && !control.disabled);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  });

  document.body.append(layer);
  for (const { node } of background) node.inert = true;
  const healthCheck = window.setInterval(() => {
    if (!valid(context) || !currentTarget?.isConnected || currentTarget !== targetFor(steps[index].selector, context.root)) close();
    else for (const node of Array.from(document.body.children)) {
      if (node instanceof HTMLElement && node !== layer && !background.some((entry) => entry.node === node)) {
        background.push({ node, inert: node.inert }); node.inert = true;
      }
    }
  }, 100);
  window.addEventListener('resize', position);
  window.addEventListener('scroll', position, true);
  window.addEventListener('hashchange', dismissOnNavigation);
  activeClose = () => close();
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : previousFocus;
  draw();
}

async function startTutorial(definition: TutorialDefinition, context: Context, signal: AbortSignal, force: boolean): Promise<void> {
  if (!valid(context) || signal.aborted || activeClose) return;
  if (!force) {
    const items = await loadTutorials(definition.role);
    if (items.find((item) => item.id === definition.id)?.status !== 'not-viewed') return;
  }
  if (!valid(context) || signal.aborted) return;
  const steps = await waitForSteps(definition, context, signal);
  if (!valid(context) || signal.aborted || !steps.length || activeClose || document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return;
  runTutorial(definition, steps, context);
  if (activeClose && force) marker(context, null);
}
/** Optional first-use help; never blocks the workflow when state is unavailable. */
export function maybeStartTutorial(id: string, options: TutorialOptions = {}): void {
  const definition = TUTORIAL_DEFINITIONS.find((item) => item.id === id);
  if (!definition || options.preview || activeClose) return;
  const context = capture(definition.role, options.root);
  if (!context) return;
  scheduled?.abort();
  const controller = new AbortController(); scheduled = controller;
  const timeout = window.setTimeout(() => {
    void startTutorial(definition, context, controller.signal, marker(context) === id).catch(() => undefined);
  }, 350);
  controller.signal.addEventListener('abort', () => window.clearTimeout(timeout), { once: true });
}
export function replayTutorialAt(id: string, href: string): void {
  const definition = TUTORIAL_DEFINITIONS.find((item) => item.id === id);
  if (!definition) return;
  const context = capture(definition.role);
  if (!context) return;
  marker(context, id);
  if (location.hash === href) maybeStartTutorial(id);
  else location.hash = href.replace(/^#/, '');
}
export async function resetTutorials(role: TutorialRole): Promise<void> {
  const context = capture(role);
  if (!context) return;
  await resetTutorialProgress(role);
  states.delete(cacheKey(context.puid, role)); marker(context, null);
}
export const loadStudentTutorials = (refresh = false): Promise<TutorialState[]> => loadTutorials('student', refresh);
export const resetStudentTutorials = (): Promise<void> => resetTutorials('student');
export const maybeStartStudentTutorial = (id: StudentTutorialId, options: TutorialOptions = {}): void => maybeStartTutorial(id, options);
export const replayStudentTutorialAt = (id: StudentTutorialId, href: string): void => replayTutorialAt(id, href);
export const replayStudentTutorial = (id: StudentTutorialId): void => replayTutorialAt(id, location.hash);
if (typeof window !== 'undefined') window.addEventListener('hashchange', () => { scheduled?.abort(); activeClose?.(); });

/** Called by a rendered view, with targets belonging to that view. Missing controls
 * stay missing: the engine waits without recording an unseen tutorial. */
export function attachTutorial(root: HTMLElement, id: string, anchors: Record<string, string>, options: TutorialOptions = {}): void {
  if (!root.isConnected) return;
  for (const [name, selector] of Object.entries(anchors)) root.querySelector<HTMLElement>(selector)?.setAttribute('data-tutorial', name);
  maybeStartTutorial(id, { ...options, root });
}
