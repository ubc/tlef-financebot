// Tiny DOM helpers. No framework — just enough to build elements declaratively
// and keep the view code readable. See client/AGENTS.md.
import { isButtonBusy, runButtonAction, setButtonBusy } from './action-state.js';

type Child = Node | string | null | undefined | false;

/** Attributes accepted by `el`. `class`/`text`/`html` are special-cased; keys
 *  starting with `on` bind events; everything else becomes an attribute. */
interface Attrs {
  class?: string;
  text?: string;
  html?: string;
  [key: string]: unknown;
}

/**
 * Create an element: `el('button', { class: 'btn', onclick: fn }, 'Save')`.
 * Children may be nodes or strings; falsy children are skipped so you can write
 * `el('div', {}, condition && el('span', ...))`.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const busy = attrs.busy;
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = String(value);
    else if (key === 'busy') {
      continue;
    } else if (key.startsWith('on') && typeof value === 'function') {
      const listener = value as (event: Event) => unknown;
      node.addEventListener(key.slice(2), (event) => {
        if (!(node instanceof HTMLButtonElement)) {
          const submitter = event instanceof SubmitEvent && event.submitter instanceof HTMLButtonElement
            ? event.submitter
            : undefined;
          if (submitter && isButtonBusy(submitter)) {
            event.preventDefault();
            return;
          }
          const result = listener(event);
          if (submitter && result instanceof Promise && !isButtonBusy(submitter)) {
            void runButtonAction(submitter, () => result);
          }
          return;
        }
        if (isButtonBusy(node)) return;
        const result = listener(event);
        if (result instanceof Promise) void runButtonAction(node, () => result);
      });
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  if (node instanceof HTMLButtonElement && busy !== undefined) setButtonBusy(node, Boolean(busy));
  return node;
}

/** Replace all children of `parent` with `nodes`. */
export function mount(parent: HTMLElement, ...nodes: Child[]): void {
  parent.replaceChildren(...nodes.filter((n): n is Node | string => Boolean(n)));
}

/** getElementById with a clear error if the element is missing. */
export function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Expected an element with id "${id}"`);
  return node as T;
}
