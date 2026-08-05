// Pure-logic tests for the Create Course Academic Year / Term dropdowns (UBC's
// four teaching terms across a rolling academic-year window). No DOM needed —
// the helpers are plain date arithmetic; importing courses.ts also pulls in
// dom.ts/api.ts, but merely importing doesn't execute any document access, so
// this is safe under jest's node test environment. See
// client/src/views/instructor/courses.ts.
import {
  UBC_TERM_NAMES,
  academicYearOptions,
  defaultTermSelection,
  formatTerm,
} from '../../client/src/views/instructor/courses';

// September 2026 — inside the 2026/27 academic year.
const inWinter1 = new Date(2026, 8, 15);
// August 2026 — before September, so still the 2025/26 academic year even
// though the calendar year is 2026. This is the case that catches an
// off-by-one in academicYearStart.
const beforeSeptember = new Date(2026, 7, 5);

describe('UBC_TERM_NAMES', () => {
  it('lists the four terms in the order they occur within an academic year', () => {
    expect(UBC_TERM_NAMES).toEqual(['Winter Term 1', 'Winter Term 2', 'Summer Term 1', 'Summer Term 2']);
  });
});

describe('academicYearOptions', () => {
  it('never offers a year before 2026/27, even when the clock is earlier', () => {
    expect(academicYearOptions(beforeSeptember)[0]).toBe('2026/27');
    expect(academicYearOptions(new Date(2024, 0, 1))[0]).toBe('2026/27');
  });

  it('offers four consecutive academic years', () => {
    expect(academicYearOptions(inWinter1)).toEqual(['2026/27', '2027/28', '2028/29', '2029/30']);
  });

  it('rolls forward once the calendar passes the floor', () => {
    expect(academicYearOptions(new Date(2030, 9, 1))).toEqual(['2030/31', '2031/32', '2032/33', '2033/34']);
  });

  it('rolls the century over without losing the leading zero', () => {
    expect(academicYearOptions(new Date(2099, 8, 1))).toEqual(['2099/00', '2100/01', '2101/02', '2102/03']);
  });
});

describe('formatTerm', () => {
  it('combines the two dropdowns into the single stored term string', () => {
    expect(formatTerm('Winter Term 1', '2026/27')).toBe('Winter Term 1, 2026/27');
  });

  it('produces values the duplicate callout can compare without normalising', () => {
    // findDuplicateCourse lowercases and trims; the generated values must
    // already be clean so a selected term equals a stored one exactly.
    for (const academicYear of academicYearOptions(inWinter1)) {
      for (const termName of UBC_TERM_NAMES) {
        const value = formatTerm(termName, academicYear);
        expect(value).toBe(value.trim());
      }
    }
  });
});

describe('defaultTermSelection', () => {
  it('preselects the next term to begin, not the one in progress', () => {
    // Mid-September 2026: Winter Term 1 has already started, so the next
    // term to begin is Winter Term 2.
    expect(defaultTermSelection(inWinter1)).toEqual({ academicYear: '2026/27', termName: 'Winter Term 2' });
  });

  it('preselects the first offered term when the clock is still before it', () => {
    // August 2026 is before 2026/27 starts, so nothing in the window has
    // begun yet and the earliest option wins.
    expect(defaultTermSelection(beforeSeptember)).toEqual({ academicYear: '2026/27', termName: 'Winter Term 1' });
  });

  it('rolls into the next academic year once the current one is spent', () => {
    // Mid-August 2028: every 2027/28 term has started, so the next to begin
    // is 2028/29's Winter Term 1.
    expect(defaultTermSelection(new Date(2028, 7, 15))).toEqual({
      academicYear: '2028/29',
      termName: 'Winter Term 1',
    });
  });

  it('always returns a selection that exists in both dropdowns', () => {
    for (const now of [inWinter1, beforeSeptember, new Date(2027, 0, 2), new Date(2031, 4, 20)]) {
      const { academicYear, termName } = defaultTermSelection(now);
      expect(academicYearOptions(now)).toContain(academicYear);
      expect(UBC_TERM_NAMES).toContain(termName);
    }
  });
});
