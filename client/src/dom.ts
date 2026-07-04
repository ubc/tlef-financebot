// Tiny DOM helpers. No framework — just enough to build elements declaratively
// and keep the view code readable. See client/AGENTS.md.

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
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = String(value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value as EventListener);
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
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
