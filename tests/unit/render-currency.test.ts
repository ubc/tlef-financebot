import { currencyDollarIndices } from '../../client/src/render';

describe('rich-text currency detection', () => {
  it('protects repeated currency symbols from becoming one KaTeX expression', () => {
    const text = 'Invest $10,000 now and another $10,000 one year later.';
    expect(currencyDollarIndices(text)).toEqual([
      text.indexOf('$'),
      text.lastIndexOf('$'),
    ]);
  });

  it('leaves explicit inline math delimiters alone', () => {
    expect(currencyDollarIndices('Use $x^2$ and $10,000$ as math.')).toEqual([]);
  });

  it('recognizes a currency amount at the end of a sentence', () => {
    expect(currencyDollarIndices('The balance is $42.50.')).toEqual([15]);
  });

  // The shapes GENERATOR_PROMPT tells the model to use. Math that opens with a
  // symbol or a LaTeX command is never mistaken for currency, so KaTeX sees a
  // matched delimiter pair and renders the span.
  it.each([
    ['a symbolic span', String.raw`Pay $P \times 1.05$ next year.`],
    ['a command span', String.raw`Use $\frac{D_1}{r-g}$ today.`],
    ['digits behind a command', String.raw`So $\text{FV} = 500 \times 1.05$ holds.`],
    ['an amount closed by the delimiter', String.raw`Pay $\$500$ next year.`],
    ['display math', String.raw`$$PV = \sum_{t=1}^{n} \frac{C_t}{(1+r)^t}$$`],
  ])('leaves %s alone', (_label, text) => {
    expect(currencyDollarIndices(text)).toEqual([]);
  });

  // KNOWN LIMIT, pinned rather than fixed. A `$` followed by digits and then
  // whitespace is exactly the shape of the repeated-currency case above, so it
  // cannot be told apart from prose currency without more context.
  // Disambiguating it would break `Invest $10,000 now and another $10,000
  // later.`, which is the case this function exists for. GENERATOR_PROMPT
  // instead steers the model away from these shapes — if that guidance is ever
  // relaxed, these are the spans that will silently render as source text.
  it.each([
    ['opens with a digit', String.raw`Pay $500 \times 1.05$ next year.`, 4],
    ['an escaped amount followed by more math', String.raw`Pay $\$500 \times 1.05$ next year.`, 6],
    ['display math opening with a digit', String.raw`$$500 \times 1.05$$`, 1],
  ])('KNOWN LIMIT: %s is read as currency and the math does not render', (_label, text, index) => {
    expect(currencyDollarIndices(text)).toEqual([index]);
  });
});
