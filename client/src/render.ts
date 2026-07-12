// Rich-text rendering for question stems, options, and explanations (ST-P03):
// markdown (tables, emphasis, code) + KaTeX math, sanitized with DOMPurify.
// The libraries are vendored globals loaded from index.html — see
// scripts/vendor-client-libs.mjs.

declare const marked: { parse(src: string): string };
declare const DOMPurify: { sanitize(html: string): string };
declare function renderMathInElement(
  el: HTMLElement,
  options: { delimiters: Array<{ left: string; right: string; display: boolean }>; throwOnError: boolean },
): void;

/** Render sanitized markdown + KaTeX into `target` (replaces its content). */
export function renderRichText(target: HTMLElement, markdown: string): void {
  const html = DOMPurify.sanitize(marked.parse(markdown));
  target.innerHTML = html;
  renderMathInElement(target, {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '$', right: '$', display: false },
    ],
    throwOnError: false,
  });
}
