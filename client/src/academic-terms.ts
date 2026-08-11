/** UBC teaching-term helpers shared by course creation and launch setup. */

const UBC_TERMS = [
  {
    name: 'Winter Term 1',
    startMonth: 8,
    inNextCalendarYear: false,
    startMonthDay: '09-08',
    endMonthDay: '12-07',
  },
  {
    name: 'Winter Term 2',
    startMonth: 0,
    inNextCalendarYear: true,
    startMonthDay: '01-05',
    endMonthDay: '04-12',
  },
  {
    name: 'Summer Term 1',
    startMonth: 4,
    inNextCalendarYear: true,
    startMonthDay: '05-10',
    endMonthDay: '06-17',
  },
  {
    name: 'Summer Term 2',
    startMonth: 6,
    inNextCalendarYear: true,
    startMonthDay: '07-05',
    endMonthDay: '08-12',
  },
] as const;

export type UbcTermName = (typeof UBC_TERMS)[number]['name'];

/** The four term names alone, for the Term dropdown. */
export const UBC_TERM_NAMES: UbcTermName[] = UBC_TERMS.map((term) => term.name);

const FIRST_ACADEMIC_YEAR = 2026;
const ACADEMIC_YEARS_SHOWN = 4;

function academicYearLabel(startYear: number): string {
  return `${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`;
}

function academicYearStart(now: Date): number {
  return now.getMonth() >= UBC_TERMS[0].startMonth ? now.getFullYear() : now.getFullYear() - 1;
}

function termStart(startYear: number, term: (typeof UBC_TERMS)[number]): Date {
  return new Date(startYear + (term.inNextCalendarYear ? 1 : 0), term.startMonth, 1);
}

/** Four rolling academic years, never earlier than FinanceBot's 2026/27 launch. */
export function academicYearOptions(now: Date): string[] {
  const first = Math.max(FIRST_ACADEMIC_YEAR, academicYearStart(now));
  return Array.from({ length: ACADEMIC_YEARS_SHOWN }, (_, i) => academicYearLabel(first + i));
}

export function formatTerm(termName: string, academicYear: string): string {
  return `${termName}, ${academicYear}`;
}

/** Preselect the next teaching term to begin. */
export function defaultTermSelection(now: Date): { academicYear: string; termName: UbcTermName } {
  const years = academicYearOptions(now);
  for (const [index, academicYear] of years.entries()) {
    const startYear = Number(academicYear.slice(0, 4));
    for (const term of UBC_TERMS) {
      if (index > 0 || termStart(startYear, term) > now) {
        return { academicYear, termName: term.name };
      }
    }
  }
  return { academicYear: years[years.length - 1]!, termName: UBC_TERMS[0].name };
}

export interface SuggestedTermDates {
  termStart: string;
  termEnd: string;
  /** True only where the dates match the published 2026/27 UBC calendar. */
  official: boolean;
}

interface ParsedTerm {
  name: UbcTermName;
  academicYearStart: number;
}

/** Accept the current display format plus compact/legacy values already in data. */
function parseStoredTerm(value: string): ParsedTerm | undefined {
  const current = /^(Winter Term [12]|Summer Term [12]),\s*(\d{4})\/(\d{2})$/i.exec(value.trim());
  if (current) {
    const name = UBC_TERM_NAMES.find((candidate) => candidate.toLowerCase() === current[1]!.toLowerCase());
    return name ? { name, academicYearStart: Number(current[2]) } : undefined;
  }

  const legacy = /^(\d{4})(?:[-/]\d{2})?\s+(Winter Term [12]|Summer Term [12])$/i.exec(value.trim());
  if (legacy) {
    const name = UBC_TERM_NAMES.find((candidate) => candidate.toLowerCase() === legacy[2]!.toLowerCase());
    return name ? { name, academicYearStart: Number(legacy[1]) } : undefined;
  }

  const compactWinter = /^(\d{4})W([12])$/i.exec(value.trim());
  if (compactWinter) {
    return {
      name: `Winter Term ${compactWinter[2]}` as UbcTermName,
      academicYearStart: Number(compactWinter[1]),
    };
  }
  return undefined;
}

/**
 * Return useful date-picker anchors for a stored term. The 2026/27 anchors
 * match UBC's published standard term dates. Later years intentionally reuse
 * those month/day anchors only as a nearby starting point until their official
 * calendars are available.
 */
export function suggestedTermDates(storedTerm: string): SuggestedTermDates | undefined {
  const parsed = parseStoredTerm(storedTerm);
  if (!parsed) return undefined;
  const term = UBC_TERMS.find((candidate) => candidate.name === parsed.name);
  if (!term) return undefined;
  const calendarYear = parsed.academicYearStart + (term.inNextCalendarYear ? 1 : 0);
  return {
    termStart: `${calendarYear}-${term.startMonthDay}`,
    termEnd: `${calendarYear}-${term.endMonthDay}`,
    official: parsed.academicYearStart === 2026,
  };
}
