import { env } from '../../config/env';

// Client for UBC's Academic API (or the local FakeAcademicAPI stand-in, see the
// sibling academic_api_fake project). Read-only: given a signed-in user's CWL
// PUID we look up their person record and the course sections they teach / are
// enrolled in. Auth is HTTP Basic (clientId:secret). A single Authorization
// header is reused for every request. Configuration lives in config/env.
//
// The API returns every collection wrapped in a pagination envelope
// `{ page, pageSize, hasNextPage, pageItems }`; `fetchAll` unwraps it and walks
// `hasNextPage` so callers get a flat array.

/** Whether the feature is configured (base URL set). Blank disables it. */
export function isAcademicApiConfigured(): boolean {
  return env.academicApiBaseUrl.trim().length > 0;
}

function authHeader(): string {
  const raw = `${env.academicApiClientId}:${env.academicApiClientSecret}`;
  return `Basic ${Buffer.from(raw, 'utf8').toString('base64')}`;
}

interface Envelope<T> {
  page: number;
  pageSize: number;
  hasNextPage: boolean;
  pageItems: T[];
}

/**
 * GET a paginated endpoint and return every item across all pages. `params` are
 * the query filters (e.g. { puid: '123' }); undefined values are dropped.
 */
async function fetchAll<T>(path: string, params: Record<string, string | undefined>): Promise<T[]> {
  if (!isAcademicApiConfigured()) {
    throw Object.assign(new Error('Academic API is not configured (ACADEMIC_API_BASE_URL is blank).'), {
      status: 503,
    });
  }

  const base = env.academicApiBaseUrl.replace(/\/$/, '');
  const items: T[] = [];
  let page = 1;
  // Bound the walk so a misbehaving upstream can never loop forever.
  for (let guard = 0; guard < 100; guard++) {
    const url = new URL(`${base}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, value);
    }
    url.searchParams.set('page', String(page));

    let response: Response;
    try {
      response = await fetch(url, { headers: { Authorization: authHeader() } });
    } catch (cause) {
      throw Object.assign(new Error(`Academic API is unreachable at ${base}.`), { status: 502, cause });
    }
    if (!response.ok) {
      throw Object.assign(new Error(`Academic API returned ${response.status} for ${path}.`), {
        status: response.status === 401 ? 502 : 502,
      });
    }

    const body = (await response.json()) as Envelope<T>;
    items.push(...(body.pageItems ?? []));
    if (!body.hasNextPage) break;
    page += 1;
  }
  return items;
}

// --- Response shapes (only the fields we consume; the API returns much more) --

export interface ApiPerson {
  puid: string;
  identifiers: { identifier: string; identifierType: string; status?: string }[];
  personNames: { nameType: string; givenName: string; familyName: string }[];
  communicationChannels: { emails: { channelType: string; emailAddress: string }[] };
}

export interface ApiSection {
  courseSectionId: string;
  sectionNumber: string;
  abbreviatedTitle?: string;
  description?: string;
  sectionStatus?: { code: string; description: string };
  academicPeriod?: { academicPeriodName?: string };
  course?: {
    courseNumber?: string;
    title?: string;
    courseSubject?: { code: string; description: string };
  };
  teachingAssignments?: {
    worker?: { personNames?: { nameType: string; givenName: string; familyName: string }[] };
  }[];
}

interface ApiRegistration {
  studentId: string;
  courseSectionId: string;
  registrationStatus?: { code: string; description: string };
}

/** Look up a single person by their PUID. Returns null when not found. */
export async function getPersonByPuid(puid: string): Promise<ApiPerson | null> {
  const [person] = await fetchAll<ApiPerson>('/person/v2/persons', { puid });
  return person ?? null;
}

/** Sections the given employee is assigned to teach. */
export async function getSectionsTaughtBy(employeeId: string): Promise<ApiSection[]> {
  return fetchAll<ApiSection>('/academic-exp/v2/course-section-details', { employeeId });
}

/**
 * Sections the given student is registered in. The API has no "registrations by
 * student" filter, so we pull all registrations, keep this student's, then fetch
 * the matching section details. Fine for the fake's small dataset; the real API
 * would use a narrower query.
 */
export async function getSectionsEnrolledBy(studentId: string): Promise<ApiSection[]> {
  const registrations = await fetchAll<ApiRegistration>('/academic/v4/course-registrations', {});
  const sectionIds = [
    ...new Set(registrations.filter((r) => r.studentId === studentId).map((r) => r.courseSectionId)),
  ];
  if (sectionIds.length === 0) return [];

  const sections = await fetchAll<ApiSection>('/academic-exp/v2/course-section-details', {});
  return sections.filter((s) => sectionIds.includes(s.courseSectionId));
}

/** Lightweight reachability check used by GET /api/health. Never throws. */
export async function pingAcademicApi(): Promise<boolean> {
  if (!isAcademicApiConfigured()) return false;
  const base = env.academicApiBaseUrl.replace(/\/$/, '');
  try {
    const response = await fetch(`${base}/health`);
    return response.ok;
  } catch {
    return false;
  }
}
