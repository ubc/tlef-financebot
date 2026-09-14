import { repairPlaceholderText } from '../../server/src/services/placeholder-repair';
import { substituteParams } from '../../server/src/services/params.service';

// Every "before" string is taken from a live question found on 2026-09-14.
describe('repairPlaceholderText', () => {
  it('restores a LaTeX command swallowed as a control character', () => {
    expect(repairPlaceholderText('$$FV={{CONTRIBUTION}}\times{{PERIODS}}.$$'.replace('\\t', '\t')))
      .toBe(String.raw`$$FV={{CONTRIBUTION}}\times{{PERIODS}}.$$`);
  });

  it('turns a merged exponent group back into a group around the placeholder', () => {
    const before = String.raw`$$r_q=\left(1+\frac{{{APR_PCT}}}{100\times{{COMPOUNDS}}}\right)^{{COMPOUNDS}/4}-1.$$`;
    const after = repairPlaceholderText(before);
    expect(after).toBe(String.raw`$$r_q=\left(1+\frac{{{APR_PCT}}}{100\times{{COMPOUNDS}}}\right)^{ {{COMPOUNDS}} /4}-1.$$`);
    expect(substituteParams(after, { APR_PCT: 8, COMPOUNDS: 12 })).toBe(String.raw`$$r_q=\left(1+\frac{8}{100\times12}\right)^{ 12 /4}-1.$$`);
  });

  it('moves a displaced closing brace back onto the placeholder', () => {
    expect(repairPlaceholderText(String.raw`$$V_1=-{{DOWN}+\operatorname{PV}(r_D,4,T)}={{ADJ_NPV}}.$$`))
      .toBe(String.raw`$$V_1=-{{DOWN}}+\operatorname{PV}(r_D,4,T)={{ADJ_NPV}}.$$`);
    expect(repairPlaceholderText(String.raw`$$V=-{{DOWN}+\operatorname{FV}(r_D,4,{{REINV_TERMINAL}})},$$`))
      .toBe(String.raw`$$V=-{{DOWN}}+\operatorname{FV}(r_D,4,{{REINV_TERMINAL}}),$$`);
  });

  it('gives a placeholder used as a LaTeX argument its own group', () => {
    expect(repairPlaceholderText(String.raw`$$\frac{\left(1+\frac{{{APR_PCT}}}{100}\right)^{{PERIODS}}-1}{x}$$`))
      .toBe(String.raw`$$\frac{\left(1+\frac{{{APR_PCT}}}{100}\right)^{ {{PERIODS}} }-1}{x}$$`);
    expect(repairPlaceholderText(String.raw`$r = \frac{{APR_PCT}}{100\cdot 12}$`)).toBe(String.raw`$r = \frac{ {{APR_PCT}} }{100\cdot 12}$`);
    // The placeholder is followed by the `}` closing the \frac denominator.
    expect(repairPlaceholderText(String.raw`$$PV_A=\frac{C_A A_p}{(1+r_p)^{{DEFER_MONTHS}}}.$$`))
      .toBe(String.raw`$$PV_A=\frac{C_A A_p}{(1+r_p)^{ {{DEFER_MONTHS}} }}.$$`);
  });

  it('leaves prose, currency, sound LaTeX and an unattributable break untouched', () => {
    const untouched = [
      'Deposit ${{CONTRIBUTION}} for {{YEARS}} years at {{APR_PCT}}% APR.',
      String.raw`$\frac{\text{NPV}}{C_0}$ and $(1+r)^{ {{N}} }$ and $\frac{{{A}}}{{{B}}}$`,
      String.raw`The coupon payment is $C={{FACE_DEBT}\times{{COUPON_PCT}}\%$`,
    ];
    for (const text of untouched) expect(repairPlaceholderText(text)).toBe(text);
  });
});
