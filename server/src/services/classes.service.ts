import type { User } from '../types/domain';
import {
  academicPeriods,
  findPersonByPuid,
  findPersonsByStudentIds,
  registrationsByPeriod,
  registrationsBySectionId,
  sectionsByEmployeeId,
  sectionsByIds,
  type ApiPerson,
  type ApiPeriod,
  type ApiRegistration,
  type ApiSection,
} from '../components/academic-api';

// EXAMPLE (Academic API demo): the classes feature. Resolves the signed-in
// user's PUID to an Academic API person, then builds "classes I teach" /
// "classes I'm enrolled in" (getMyClasses) and an instructor's class list for
// one section (getClassList). Composes only the academic-api component. Safe
// to delete along with routes/classes.routes.ts and the client classes view.

/** One class in a list: enough to render a row. */
export interface ClassSummary {
  sectionId: string;
  /** e.g. "CPSC 110 101" — subject, course number, section number. */
  courseCode: string;
  title: string;
  /** Section status code: Open | Closed | Waitlist | Canceled. */
  sectionStatus: string;
  /** e.g. "Mon Wed Fri · 09:00–10:00 · DMP 110". Empty when unscheduled. */
  schedule: string;
  /** Enrolled rows only: the caller's registration status (e.g. REGISTERED). */
  registrationStatus?: string;
}

/** Classes grouped under one academic period (term). */
export interface PeriodGroup {
  periodId: string;
  periodName: string;
  classes: ClassSummary[];
}

export interface MyClasses {
  /** False when the PUID has no Academic API person record. */
  personFound: boolean;
  teaching: PeriodGroup[];
  enrolled: PeriodGroup[];
}

/** One student on a class list. `person`/`registration` are raw API records. */
export interface RosterStudent {
  studentId: string;
  name: string;
  email: string;
  registrationStatus: string;
  person: ApiPerson | null;
  registration: ApiRegistration;
}

export interface ClassList {
  sectionId: string;
  courseCode: string;
  title: string;
  periodName: string;
  students: RosterStudent[];
}

/** A class row tagged with its period, before grouping. */
interface Row {
  periodId: string;
  summary: ClassSummary;
}

/** An Error carrying the HTTP status the central error handler should send. */
function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

/** The signed-in user's PUID — the join key into the Academic API. */
function puidOf(user: User): string {
  if (!user.puid) {
    throw httpError(500, 'The session user has no PUID — check the IdP attribute release.');
  }
  return user.puid;
}

/** A person's identifier of one type (Student_ID / Employee_ID), if any. */
function identifierOf(person: ApiPerson, type: string): string | undefined {
  return person.identifiers.find((entry) => entry.identifierType === type)?.identifier;
}

/** Display name: the preferred name when present, else the legal name. */
function personName(person: ApiPerson): string {
  const names = person.personNames;
  const name =
    names.find((n) => n.nameType === 'Preferred Name') ??
    names.find((n) => n.nameType === 'Legal Name') ??
    names[0];
  return name ? `${name.givenName} ${name.familyName}` : person.puid;
}

/** First listed email address ('' when the person has none). */
function personEmail(person: ApiPerson): string {
  return person.communicationChannels?.emails?.[0]?.emailAddress ?? '';
}

function courseCodeOf(section: ApiSection): string {
  return `${section.course.courseSubject.code} ${section.course.courseNumber} ${section.sectionNumber}`;
}

/** Flatten a section into a display row. */
function summarize(section: ApiSection): ClassSummary {
  const component = section.sectionComponents?.[0];
  const time =
    component?.startTime && component?.endTime
      ? `${component.startTime.slice(0, 5)}–${component.endTime.slice(0, 5)}`
      : undefined;
  const schedule = [component?.meetingDayPattern?.description, time, component?.location?.description]
    .filter(Boolean)
    .join(' · ');
  return {
    sectionId: section.courseSectionId,
    courseCode: courseCodeOf(section),
    title: section.course.title,
    sectionStatus: section.sectionStatus.code,
    schedule,
  };
}

/** Group class rows by academic period, ordered by period start date. */
function groupByPeriod(rows: Row[], periods: ApiPeriod[]): PeriodGroup[] {
  const ordered = [...periods].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const groups: PeriodGroup[] = [];
  for (const period of ordered) {
    const classes = rows
      .filter((row) => row.periodId === period.academicPeriod.academicPeriodId)
      .map((row) => row.summary)
      .sort((a, b) => a.courseCode.localeCompare(b.courseCode));
    if (classes.length) {
      groups.push({
        periodId: period.academicPeriod.academicPeriodId,
        periodName: period.academicPeriod.academicPeriodName,
        classes,
      });
    }
  }
  return groups;
}

async function teachingClasses(employeeId: string): Promise<Row[]> {
  const sections = await sectionsByEmployeeId(employeeId);
  return sections.map((section) => ({
    periodId: section.academicPeriod.academicPeriodId,
    summary: summarize(section),
  }));
}

/**
 * The API has no "registrations by student" query (rosters are per-section),
 * so fetch each period's registrations and filter to this student app-side.
 * Fine against FakeAcademicAPI; see components/academic-api/AGENTS.md if the
 * real API rejects period-wide queries.
 */
async function enrolledClasses(studentId: string, periods: ApiPeriod[]): Promise<Row[]> {
  const perPeriod = await Promise.all(
    periods.map((period) => registrationsByPeriod(period.academicPeriod.academicPeriodId)),
  );
  const mine = perPeriod.flat().filter((registration) => registration.studentId === studentId);
  const sections = await sectionsByIds([...new Set(mine.map((r) => r.courseSectionId))]);
  const sectionById = new Map(sections.map((s) => [s.courseSectionId, s]));
  return mine.flatMap((registration) => {
    const section = sectionById.get(registration.courseSectionId);
    if (!section) return [];
    return [
      {
        periodId: registration.academicPeriod.academicPeriodId,
        summary: {
          ...summarize(section),
          registrationStatus: registration.registrationStatus.code,
        },
      },
    ];
  });
}

/**
 * Everything the signed-in user teaches and is enrolled in, grouped by term.
 * Dual-role people (a TA, an instructor also taking a course) get both lists.
 */
export async function getMyClasses(user: User): Promise<MyClasses> {
  const person = await findPersonByPuid(puidOf(user));
  if (!person) return { personFound: false, teaching: [], enrolled: [] };

  const employeeId = identifierOf(person, 'Employee_ID');
  const studentId = identifierOf(person, 'Student_ID');
  const periods = await academicPeriods();

  const [teachingRows, enrolledRows] = await Promise.all([
    employeeId ? teachingClasses(employeeId) : Promise.resolve<Row[]>([]),
    studentId ? enrolledClasses(studentId, periods) : Promise.resolve<Row[]>([]),
  ]);

  return {
    personFound: true,
    teaching: groupByPeriod(teachingRows, periods),
    enrolled: groupByPeriod(enrolledRows, periods),
  };
}

/** The class list (roster) of one section, for an instructor who teaches it. */
export async function getClassList(user: User, sectionId: string): Promise<ClassList> {
  const person = await findPersonByPuid(puidOf(user));
  const employeeId = person ? identifierOf(person, 'Employee_ID') : undefined;

  const [section] = await sectionsByIds([sectionId]);
  if (!section) throw httpError(404, 'That class was not found.');

  // The authorization that matters: only instructors ON THIS SECTION may see
  // its roster. The route's ensureRole('faculty') alone would let any faculty
  // member read any roster.
  const teachesIt =
    employeeId !== undefined &&
    section.teachingAssignments.some((assignment) =>
      assignment.identifiers.some(
        (id) => id.identifierType === 'Employee_ID' && id.identifier === employeeId,
      ),
    );
  if (!teachesIt) {
    throw httpError(403, 'You can only view the class list of a section you teach.');
  }

  const registrations = await registrationsBySectionId(sectionId);
  const persons = await findPersonsByStudentIds(registrations.map((r) => r.studentId));
  const personByStudentId = new Map<string, ApiPerson>();
  for (const candidate of persons) {
    const sid = identifierOf(candidate, 'Student_ID');
    if (sid) personByStudentId.set(sid, candidate);
  }

  const students = registrations
    .map((registration) => {
      const match = personByStudentId.get(registration.studentId) ?? null;
      return {
        studentId: registration.studentId,
        name: match ? personName(match) : registration.studentId,
        email: match ? personEmail(match) : '',
        registrationStatus: registration.registrationStatus.code,
        person: match,
        registration,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    sectionId,
    courseCode: courseCodeOf(section),
    title: section.course.title,
    periodName: section.academicPeriod.academicPeriodName,
    students,
  };
}
