// Markdown runs before KaTeX in renderRichText. These run the real `marked`
// (the version vendored for the browser) and KaTeX, in Node.
import katex from 'katex';
import { marked } from 'marked';
import { mathSpanRanges, protectMath } from '../../client/src/render';

/** renderRichText's string pipeline, minus DOMPurify and the DOM. */
function markdownThenRestore(markdown: string): string {
  const math = protectMath(markdown);
  return math.restore(marked.parse(math.text) as string);
}

const unescape = (html: string) => html.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

/** The math KaTeX's auto-render would find in the rendered HTML's text. */
function renderedMath(html: string): string[] {
  const text = unescape(html.replace(/<[^>]+>/g, ''));
  return mathSpanRanges(text).map(([start, end]) => text.slice(start, end));
}

// Option C of question …08fd6463, as served 2026-09-14.
const optionC = String.raw`Using those incorrect rates gives:

$$\mathrm{PV}_{A,n}=\mathrm{PMT}(r_{A,n},48,24000)\times\frac{1-(1+i_n)^{- 48 }}{i_n}=23087.80$$

$$\mathrm{PV}_{B,n}=\mathrm{PMT}(r_{B,n},60,22000)\times\frac{1-(1+i_n)^{- 60 }}{i_n}=22522.93$$`;

describe('markdown before KaTeX', () => {
  it('replicates: plain marked turns underscore pairs inside math into <em>', () => {
    expect(marked.parse(optionC)).toContain(String.raw`\mathrm{PV}<em>{A,n}=\mathrm{PMT}(r</em>{A,n}`);
  });

  it('keeps every math span intact, so KaTeX renders it', () => {
    const math = renderedMath(markdownThenRestore(optionC));
    expect(math).toEqual([
      String.raw`$$\mathrm{PV}_{A,n}=\mathrm{PMT}(r_{A,n},48,24000)\times\frac{1-(1+i_n)^{- 48 }}{i_n}=23087.80$$`,
      String.raw`$$\mathrm{PV}_{B,n}=\mathrm{PMT}(r_{B,n},60,22000)\times\frac{1-(1+i_n)^{- 60 }}{i_n}=22522.93$$`,
    ]);
    for (const span of math) {
      expect(() => katex.renderToString(span.slice(2, -2), { throwOnError: true })).not.toThrow();
    }
  });

  it('keeps the backslash escapes markdown would consume', () => {
    // `\%` -> `%` would start a KaTeX comment and drop the rest of the formula.
    const markdown = String.raw`The IRR is $100r_I=12\%$, the set is $\{a,b\}$ and $$a \\ b$$`;
    expect(marked.parse(markdown)).toContain('$100r_I=12%$');
    expect(renderedMath(markdownThenRestore(markdown))).toEqual([
      String.raw`$100r_I=12\%$`,
      String.raw`$\{a,b\}$`,
      String.raw`$$a \\ b$$`,
    ]);
  });

  it('keeps markdown working around the math, and escapes math as text', () => {
    const html = markdownThenRestore(String.raw`**Note:** use $|x| < y$ here.

| Year | Value |
| --- | --- |
| 1 | $r_{1}$ |`);
    expect(html).toContain('<strong>Note:</strong>');
    expect(html).toContain('<table>');
    expect(html).toContain('$|x| &lt; y$');
    expect(html).toContain('<td>$r_{1}$</td>');
  });

  it('does not treat currency or an escaped dollar as math', () => {
    expect(mathSpanRanges('Invest $10,000 now and another $10,000 later.')).toEqual([]);
    expect(mathSpanRanges(String.raw`It costs \$5 or \$6.`)).toEqual([]);
    const text = 'A deposit of $750 grows to $r_q$ per quarter.';
    expect(mathSpanRanges(text).map(([s, e]) => text.slice(s, e))).toEqual(['$r_q$']);
  });

  it('never joins math across a blank line', () => {
    expect(mathSpanRanges('A lone $ sign.\n\nAnother $ sign.')).toEqual([]);
  });
});
