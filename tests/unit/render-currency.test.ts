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
});
