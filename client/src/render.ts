// Rich-text rendering for question stems, options, and explanations (ST-P03):
// markdown (tables, emphasis, code) + KaTeX math, sanitized with DOMPurify.
// The libraries are vendored globals loaded from index.html — see
// scripts/vendor-client-libs.mjs.

declare const marked: { parse(src: string): string };
declare const DOMPurify: { sanitize(html: string): string };
declare function renderMathInElement(
  el: HTMLElement,
  options: {
    delimiters: Array<{ left: string; right: string; display: boolean }>;
    ignoredClasses?: string[];
    throwOnError: boolean;
  },
): void;

/** Finance prose commonly contains `$10,000 ... $10,000`. KaTeX's permissive
 * `$...$` delimiter otherwise treats the entire sentence between those two
 * currency symbols as math. A dollar is considered currency when it starts a
 * plain numeric amount that is not immediately closed by another `$`.
 *
 * `%` is in the terminator set because a rate written `$16%` is currency-shaped
 * prose, not math: leaving it unprotected made it an OPENING delimiter, and
 * since a neighbouring `$12000 ` in the same sentence IS protected, the live
 * `$` count went odd and KaTeX swallowed the prose between it and the next
 * delimiter. Observed in real generated content, 2026-08-13. Note `$50\%$` is
 * unaffected — a LaTeX percent is escaped, so the character after the digits is
 * a backslash. */
export function currencyDollarIndices(text: string): number[] {
  const indices: number[] = [];
  for (let index = text.indexOf('$'); index >= 0; index = text.indexOf('$', index + 1)) {
    const amount = text.slice(index + 1).match(/^\d[\d,]*(?:\.\d{1,2})?/);
    if (!amount) continue;
    const next = text[index + 1 + amount[0].length];
    if (next === undefined || /[\s.,;:!?)/%]/.test(next)) {
      indices.push(index);
    }
  }
  return indices;
}

function protectCurrencyDollars(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Text && currencyDollarIndices(node.data).length > 0) {
      textNodes.push(node);
    }
  }

  for (const node of textNodes) {
    const indices = currencyDollarIndices(node.data);
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const index of indices) {
      fragment.append(node.data.slice(cursor, index));
      const currency = document.createElement('span');
      currency.className = 'currency-symbol';
      currency.textContent = '$';
      fragment.append(currency);
      cursor = index + 1;
    }
    fragment.append(node.data.slice(cursor));
    node.replaceWith(fragment);
  }
}

/** Render sanitized markdown + KaTeX into `target` (replaces its content). */
export function renderRichText(target: HTMLElement, markdown: string): void {
  const html = DOMPurify.sanitize(marked.parse(markdown));
  target.innerHTML = html;
  protectCurrencyDollars(target);
  renderMathInElement(target, {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '$', right: '$', display: false },
    ],
    ignoredClasses: ['currency-symbol'],
    throwOnError: false,
  });
}
