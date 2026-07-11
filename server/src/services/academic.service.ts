import type { AppUser } from '../components/auth';
import {
  getPersonByPuid,
  getSectionsEnrolledBy,
  getSectionsTaughtBy,
  isAcademicApiConfigured,
  type ApiPerson,
  type ApiSection,
} from '../components/academic-api';

// Assembles the signed-in user's "academic record" from the Academic API. The
// only input is the user's CWL PUID (from the SAML session); we resolve that to
// a person, read their student/employee numbers off the returned identifiers,
// and fetch the sections they teach and/or are enrolled in. Pair with the
// ensureApiAuthenticated() guard on its route so it is only reachable signed in.

/** Pick the first value from a SAML attribute (they arrive as string | string[]). */
function firstValue(value: unknown): string {
  if (Array.isArray(value)) return value.length ? String(value[0]) : '';
  return value == null ? '' : String(value);
}

/** The user's CWL PUID from the mapped SAML attributes, or '' if absent. */
export function puidOf(user: AppUser): string {
  return firstValue(user.attributes.ubcEduCwlPuid);
}

function fullName(names: { nameType: string; givenName: string; familyName: string }[] = []): string {
  const preferred = names.find((n) => n.nameType === 'Preferred Name');
  const legal = names.find((n) => n.nameType === 'Legal Name');
  const chosen = preferred ?? legal ?? names[0];
  return chosen ? [chosen.givenName, chosen.familyName].filter(Boolean).join(' ') : '';
}

function identifierValue(person: ApiPerson, type: string): string | undefined {
  return person.identifiers.find((id) => id.identifierType === type)?.identifier;
}

export interface CourseSummary {
  courseSectionId: string;
  subject: string;
  courseNumber: string;
  sectionNumber: string;
  title: string;
  period: string;
  status: string;
  instructors: string[];
}

function toCourseSummary(section: ApiSection): CourseSummary {
  const instructors = (section.teachingAssignments ?? [])
    .map((ta) => fullName(ta.worker?.personNames))
    .filter(Boolean);
  return {
    courseSectionId: section.courseSectionId,
    subject: section.course?.courseSubject?.code ?? '',
    courseNumber: section.course?.courseNumber ?? '',
    sectionNumber: section.sectionNumber,
    title: section.course?.title ?? section.abbreviatedTitle ?? section.description ?? '',
    period: section.academicPeriod?.academicPeriodName ?? '',
    status: section.sectionStatus?.description ?? section.sectionStatus?.code ?? '',
    instructors,
  };
}

export interface AcademicProfile {
  /** False when the API is not configured or the PUID could not be resolved. */
  found: boolean;
  /** Human-readable note when found is false (why there is no record). */
  note?: string;
  puid: string;
  displayName: string;
  identifiers: { type: string; value: string }[];
  emails: { type: string; address: string }[];
  teaching: CourseSummary[];
  enrolled: CourseSummary[];
  serverTime: string;
}

function empty(puid: string, note: string): AcademicProfile {
  return {
    found: false,
    note,
    puid,
    displayName: '',
    identifiers: [],
    emails: [],
    teaching: [],
    enrolled: [],
    serverTime: new Date().toISOString(),
  };
}

/** Build the academic record for a signed-in user from their CWL PUID. */
export async function buildAcademicProfile(user: AppUser): Promise<AcademicProfile> {
  const puid = puidOf(user);

  if (!isAcademicApiConfigured()) {
    return empty(puid, 'The Academic API is not configured (set ACADEMIC_API_BASE_URL).');
  }
  if (!puid) {
    return empty(puid, 'Your login did not include a CWL PUID, so no academic record can be looked up.');
  }

  const person = await getPersonByPuid(puid);
  if (!person) {
    return empty(puid, `No person was found in the Academic API for PUID ${puid}.`);
  }

  const studentId = identifierValue(person, 'Student_ID');
  const employeeId = identifierValue(person, 'Employee_ID');

  // Only query the collections that apply to this person.
  const [teaching, enrolled] = await Promise.all([
    employeeId ? getSectionsTaughtBy(employeeId) : Promise.resolve<ApiSection[]>([]),
    studentId ? getSectionsEnrolledBy(studentId) : Promise.resolve<ApiSection[]>([]),
  ]);

  return {
    found: true,
    puid: person.puid,
    displayName: fullName(person.personNames),
    identifiers: person.identifiers.map((id) => ({ type: id.identifierType, value: id.identifier })),
    emails: person.communicationChannels.emails.map((e) => ({
      type: e.channelType,
      address: e.emailAddress,
    })),
    teaching: teaching.map(toCourseSummary),
    enrolled: enrolled.map(toCourseSummary),
    serverTime: new Date().toISOString(),
  };
}
