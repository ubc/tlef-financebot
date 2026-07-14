import { env } from '../../config/env';

// UBC Academic API integration. A thin, typed client over the global fetch:
// Basic-auth'd GETs against the paginated /academic + /person endpoints,
// following the { page, pageSize, hasNextPage, pageItems } envelope until every
// item is read. Locally this points at FakeAcademicAPI; on staging/production
// the SAME code points at the real API via env vars. See AGENTS.md.

/**
 * Thrown when the Academic API cannot be reached or answers non-2xx. `status`
 * is fixed at 502 so the central error handler (middleware/error-handler.ts)
 * answers "bad gateway" — an upstream problem, not a client mistake. The
 * upstream code is kept separately for logs and tests.
 */
export class AcademicApiError extends Error {
  readonly status = 502;
  constructor(
    message: string,
    readonly upstreamStatus?: number,
  ) {
    super(message);
    this.name = 'AcademicApiError';
  }
}

/** The pagination envelope every Academic API endpoint returns. */
interface Envelope<T> {
  page: number;
  pageSize: number;
  hasNextPage: boolean;
  pageItems: T[];
}

// Minimal typed views of the API records: just the fields this app reads. Each
// carries an index signature because the records are much larger than these
// types and callers may pass the full record through (the class-list example
// shows "everything the API returns").

export interface ApiIdentifier {
  identifierType: string;
  identifier: string;
  [key: string]: unknown;
}

export interface ApiPersonName {
  nameType: string;
  givenName: string;
  familyName: string;
  [key: string]: unknown;
}

export interface ApiPerson {
  puid: string;
  identifiers: ApiIdentifier[];
  personNames: ApiPersonName[];
  communicationChannels?: { emails?: { channelType?: string; emailAddress: string }[] };
  [key: string]: unknown;
}

export interface ApiPeriodRef {
  academicPeriodId: string;
  academicPeriodName: string;
  [key: string]: unknown;
}

export interface ApiSection {
  courseSectionId: string;
  sectionNumber: string;
  academicPeriod: ApiPeriodRef;
  sectionStatus: { code: string; description: string };
  course: {
    courseNumber: string;
    title: string;
    courseSubject: { code: string; description: string };
    [key: string]: unknown;
  };
  teachingAssignments: { identifiers: ApiIdentifier[]; [key: string]: unknown }[];
  sectionComponents?: {
    startTime?: string;
    endTime?: string;
    location?: { description?: string };
    meetingDayPattern?: { description?: string };
    [key: string]: unknown;
  }[];
  [key: string]: unknown;
}

export interface ApiRegistration {
  studentId: string;
  courseSectionId: string;
  academicPeriod: ApiPeriodRef;
  registrationStatus: { code: string; description: string };
  [key: string]: unknown;
}

export interface ApiPeriod {
  academicPeriod: ApiPeriodRef;
  startDate: string;
  endDate: string;
  [key: string]: unknown;
}

/** The API's page-size cap. */
const PAGE_SIZE = 500;
/** Ids per batched person lookup — keeps the query string a sane length. */
const BATCH_SIZE = 100;

function basicAuthHeader(): string {
  const credentials = `${env.academicApiClientId}:${env.academicApiClientSecret}`;
  return `Basic ${Buffer.from(credentials).toString('base64')}`;
}

/**
 * GET a paginated endpoint and follow `hasNextPage` until every item is read.
 * Array params repeat the key (?courseSectionId=a&courseSectionId=b), matching
 * the real API. Throws AcademicApiError when unreachable or non-2xx.
 */
async function fetchAllPages<T>(
  path: string,
  params: Record<string, string | string[]> = {},
): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; ; page++) {
    const url = new URL(path, env.academicApiUrl);
    for (const [key, value] of Object.entries(params)) {
      for (const entry of Array.isArray(value) ? value : [value]) {
        url.searchParams.append(key, entry);
      }
    }
    url.searchParams.set('pageSize', String(PAGE_SIZE));
    url.searchParams.set('page', String(page));

    let response: Response;
    try {
      response = await fetch(url, { headers: { authorization: basicAuthHeader() } });
    } catch {
      throw new AcademicApiError('The Academic API is unavailable.');
    }
    if (!response.ok) {
      if (response.status === 401) {
        // The user can't fix this; log the actionable hint for the developer.
        console.error(
          '[academic-api] The Academic API rejected our credentials (401) — ' +
            'check ACADEMIC_API_CLIENT_ID / ACADEMIC_API_CLIENT_SECRET.',
        );
      }
      throw new AcademicApiError('The Academic API is unavailable.', response.status);
    }
    const body = (await response.json()) as Envelope<T>;
    items.push(...body.pageItems);
    if (!body.hasNextPage) return items;
  }
}

/** Look up one person by PUID (how a SAML login maps to an API person). */
export async function findPersonByPuid(puid: string): Promise<ApiPerson | null> {
  const people = await fetchAllPages<ApiPerson>('/person/v2/persons', { puid });
  return people[0] ?? null;
}

/**
 * Batch person lookup by student number, chunked so a 500-student roster does
 * not put 500 repeats of student_id into one URL.
 */
export async function findPersonsByStudentIds(studentIds: string[]): Promise<ApiPerson[]> {
  const people: ApiPerson[] = [];
  for (let i = 0; i < studentIds.length; i += BATCH_SIZE) {
    const chunk = studentIds.slice(i, i + BATCH_SIZE);
    people.push(...(await fetchAllPages<ApiPerson>('/person/v2/persons', { student_id: chunk })));
  }
  return people;
}

/** All sections a person teaches, across every term. */
export function sectionsByEmployeeId(employeeId: string): Promise<ApiSection[]> {
  return fetchAllPages<ApiSection>('/academic-exp/v2/course-section-details', { employeeId });
}

/** Full section details for specific section ids (empty in → empty out). */
export async function sectionsByIds(sectionIds: string[]): Promise<ApiSection[]> {
  if (!sectionIds.length) return [];
  return fetchAllPages<ApiSection>('/academic-exp/v2/course-section-details', {
    courseSectionId: sectionIds,
  });
}

/** Every registration in one section (the class list). */
export function registrationsBySectionId(sectionId: string): Promise<ApiRegistration[]> {
  return fetchAllPages<ApiRegistration>('/academic/v4/course-registrations', {
    courseSectionId: sectionId,
  });
}

/**
 * Every registration in one academic period. The API has no "registrations by
 * student" query (rosters are per-section), so the classes example fetches
 * per-period registrations and filters app-side. If the real API rejects
 * queries this broad, this is the call to replace — see AGENTS.md
 * "Moving to staging / production".
 */
export function registrationsByPeriod(periodId: string): Promise<ApiRegistration[]> {
  return fetchAllPages<ApiRegistration>('/academic/v4/course-registrations', {
    academicPeriodId: periodId,
  });
}

/** All academic periods (terms), used for grouping and ordering. */
export function academicPeriods(): Promise<ApiPeriod[]> {
  return fetchAllPages<ApiPeriod>('/academic/v4/academic-periods');
}

/** Lightweight reachability check used by GET /api/health. Never throws. */
export async function pingAcademicApi(): Promise<boolean> {
  try {
    const url = new URL('/academic/v4/academic-periods', env.academicApiUrl);
    url.searchParams.set('pageSize', '1');
    const response = await fetch(url, { headers: { authorization: basicAuthHeader() } });
    return response.ok;
  } catch {
    return false;
  }
}
