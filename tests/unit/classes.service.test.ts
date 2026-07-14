// Unit test — the classes SERVICE with the academic-api component mocked (the
// same pattern as rag.service.test.ts): fast, deterministic, no FakeAcademicAPI.
jest.mock('../../server/src/components/academic-api', () => ({
  academicPeriods: jest.fn(),
  findPersonByPuid: jest.fn(),
  findPersonsByStudentIds: jest.fn(),
  registrationsByPeriod: jest.fn(),
  registrationsBySectionId: jest.fn(),
  sectionsByEmployeeId: jest.fn(),
  sectionsByIds: jest.fn(),
}));

import { getClassList, getMyClasses } from '../../server/src/services/classes.service';
import {
  academicPeriods,
  findPersonByPuid,
  findPersonsByStudentIds,
  registrationsByPeriod,
  registrationsBySectionId,
  sectionsByEmployeeId,
  sectionsByIds,
  type ApiPerson,
  type ApiRegistration,
  type ApiSection,
} from '../../server/src/components/academic-api';
import type { User } from '../../server/src/types/domain';

// --- Fixtures (shaped like FakeAcademicAPI/src/render.ts output) -------------

function domainUser(puid: string): User {
  return {
    puid,
    uid: 'u1',
    displayName: 'Test User',
    email: 'test@ubc.ca',
    isAdmin: false,
    affiliations: ['faculty'],
    courseRoles: [],
    createdAt: new Date(),
    lastLoginAt: new Date(),
  };
}

const user: User = domainUser('12345678');

const periods = [
  { academicPeriod: { academicPeriodId: 'P1', academicPeriodName: '2024 Winter Term 1' }, startDate: '2024-09-03', endDate: '2024-12-06' },
  { academicPeriod: { academicPeriodId: 'P2', academicPeriodName: '2024 Winter Term 2' }, startDate: '2025-01-06', endDate: '2025-04-11' },
];

function person(overrides: Partial<ApiPerson> = {}): ApiPerson {
  return {
    puid: '12345678',
    identifiers: [{ identifierType: 'PUID', identifier: '12345678' }],
    personNames: [{ nameType: 'Legal Name', givenName: 'Pat', familyName: 'Prof' }],
    communicationChannels: { emails: [{ channelType: 'Work', emailAddress: 'pat@ubc.ca' }] },
    ...overrides,
  };
}

function section(id: string, periodId: string, overrides: Partial<ApiSection> = {}): ApiSection {
  return {
    courseSectionId: id,
    sectionNumber: '101',
    academicPeriod: { academicPeriodId: periodId, academicPeriodName: `Period ${periodId}` },
    sectionStatus: { code: 'Open', description: 'Open' },
    course: { courseNumber: '110', title: 'Computation', courseSubject: { code: 'CPSC', description: 'CPSC' } },
    teachingAssignments: [
      { identifiers: [{ identifierType: 'Employee_ID', identifier: '4520000' }] },
    ],
    sectionComponents: [
      {
        startTime: '09:00:00',
        endTime: '10:00:00',
        location: { description: 'DMP 110' },
        meetingDayPattern: { description: 'Mon Wed Fri' },
      },
    ],
    ...overrides,
  };
}

function registration(studentId: string, sectionId: string, periodId: string): ApiRegistration {
  return {
    studentId,
    courseSectionId: sectionId,
    academicPeriod: { academicPeriodId: periodId, academicPeriodName: `Period ${periodId}` },
    registrationStatus: { code: 'REGISTERED', description: 'REGISTERED' },
  };
}

beforeEach(() => {
  jest.mocked(academicPeriods).mockResolvedValue(periods);
  jest.mocked(sectionsByEmployeeId).mockResolvedValue([]);
  jest.mocked(registrationsByPeriod).mockResolvedValue([]);
  jest.mocked(sectionsByIds).mockResolvedValue([]);
});

describe('getMyClasses', () => {
  it('returns personFound false (and queries nothing else) when the PUID has no person', async () => {
    jest.mocked(findPersonByPuid).mockResolvedValue(null);

    const result = await getMyClasses(user);

    expect(result).toEqual({ personFound: false, teaching: [], enrolled: [] });
    expect(sectionsByEmployeeId).not.toHaveBeenCalled();
    expect(registrationsByPeriod).not.toHaveBeenCalled();
  });

  it('throws 500 when the session user has no PUID', async () => {
    await expect(getMyClasses(domainUser(''))).rejects.toMatchObject({
      status: 500,
    });
  });

  it('builds teaching groups (ordered by period start) for an employee', async () => {
    jest.mocked(findPersonByPuid).mockResolvedValue(
      person({ identifiers: [{ identifierType: 'Employee_ID', identifier: '4520000' }] }),
    );
    jest.mocked(sectionsByEmployeeId).mockResolvedValue([
      section('SEC-B', 'P2'),
      section('SEC-A', 'P1'),
    ]);

    const result = await getMyClasses(user);

    expect(sectionsByEmployeeId).toHaveBeenCalledWith('4520000');
    expect(registrationsByPeriod).not.toHaveBeenCalled(); // no Student_ID
    expect(result.enrolled).toEqual([]);
    expect(result.teaching.map((g) => g.periodName)).toEqual([
      '2024 Winter Term 1',
      '2024 Winter Term 2',
    ]);
    expect(result.teaching[0].classes[0]).toMatchObject({
      sectionId: 'SEC-A',
      courseCode: 'CPSC 110 101',
      title: 'Computation',
      sectionStatus: 'Open',
      schedule: 'Mon Wed Fri · 09:00–10:00 · DMP 110',
    });
  });

  it('filters period registrations to this student and joins section details', async () => {
    jest.mocked(findPersonByPuid).mockResolvedValue(
      person({ identifiers: [{ identifierType: 'Student_ID', identifier: '55555555' }] }),
    );
    jest
      .mocked(registrationsByPeriod)
      .mockResolvedValueOnce([
        registration('55555555', 'SEC-A', 'P1'),
        registration('99999999', 'SEC-A', 'P1'), // someone else — filtered out
      ])
      .mockResolvedValueOnce([]);
    jest.mocked(sectionsByIds).mockResolvedValue([section('SEC-A', 'P1')]);

    const result = await getMyClasses(user);

    expect(sectionsByIds).toHaveBeenCalledWith(['SEC-A']);
    expect(result.teaching).toEqual([]);
    expect(result.enrolled).toHaveLength(1);
    expect(result.enrolled[0].classes[0]).toMatchObject({
      sectionId: 'SEC-A',
      registrationStatus: 'REGISTERED',
    });
  });

  it('returns both lists for a dual-role person (e.g. a TA)', async () => {
    jest.mocked(findPersonByPuid).mockResolvedValue(
      person({
        identifiers: [
          { identifierType: 'Employee_ID', identifier: '4540001' },
          { identifierType: 'Student_ID', identifier: '53310010' },
        ],
      }),
    );
    jest.mocked(sectionsByEmployeeId).mockResolvedValue([section('SEC-T', 'P1')]);
    jest
      .mocked(registrationsByPeriod)
      .mockResolvedValueOnce([registration('53310010', 'SEC-E', 'P1')])
      .mockResolvedValueOnce([]);
    jest.mocked(sectionsByIds).mockResolvedValue([section('SEC-E', 'P1')]);

    const result = await getMyClasses(user);

    expect(result.teaching[0].classes[0].sectionId).toBe('SEC-T');
    expect(result.enrolled[0].classes[0].sectionId).toBe('SEC-E');
  });
});

describe('getClassList', () => {
  const instructor = person({
    identifiers: [{ identifierType: 'Employee_ID', identifier: '4520000' }],
  });

  it('404s for an unknown section', async () => {
    jest.mocked(findPersonByPuid).mockResolvedValue(instructor);
    jest.mocked(sectionsByIds).mockResolvedValue([]);

    await expect(getClassList(user, 'SEC-NOPE')).rejects.toMatchObject({ status: 404 });
  });

  it('403s when the caller does not teach the section', async () => {
    jest.mocked(findPersonByPuid).mockResolvedValue(
      person({ identifiers: [{ identifierType: 'Employee_ID', identifier: 'OTHER' }] }),
    );
    jest.mocked(sectionsByIds).mockResolvedValue([section('SEC-A', 'P1')]);

    await expect(getClassList(user, 'SEC-A')).rejects.toMatchObject({ status: 403 });
    expect(registrationsBySectionId).not.toHaveBeenCalled();
  });

  it('returns the roster with names, emails, statuses, and the raw records', async () => {
    jest.mocked(findPersonByPuid).mockResolvedValue(instructor);
    jest.mocked(sectionsByIds).mockResolvedValue([section('SEC-A', 'P1')]);
    jest
      .mocked(registrationsBySectionId)
      .mockResolvedValue([registration('S2', 'SEC-A', 'P1'), registration('S1', 'SEC-A', 'P1')]);
    jest.mocked(findPersonsByStudentIds).mockResolvedValue([
      person({
        puid: 'p-s1',
        identifiers: [{ identifierType: 'Student_ID', identifier: 'S1' }],
        personNames: [
          { nameType: 'Preferred Name', givenName: 'Al', familyName: 'Apple' },
          { nameType: 'Legal Name', givenName: 'Albert', familyName: 'Apple' },
        ],
        communicationChannels: { emails: [{ channelType: 'Work', emailAddress: 'al@ubc.ca' }] },
      }),
      person({
        puid: 'p-s2',
        identifiers: [{ identifierType: 'Student_ID', identifier: 'S2' }],
        personNames: [{ nameType: 'Legal Name', givenName: 'Zoe', familyName: 'Zed' }],
        communicationChannels: { emails: [] },
      }),
    ]);

    const roster = await getClassList(user, 'SEC-A');

    expect(roster.courseCode).toBe('CPSC 110 101');
    expect(findPersonsByStudentIds).toHaveBeenCalledWith(['S2', 'S1']);
    // Sorted by name; preferred name wins; missing email renders ''.
    expect(roster.students.map((s) => [s.name, s.email])).toEqual([
      ['Al Apple', 'al@ubc.ca'],
      ['Zoe Zed', ''],
    ]);
    // The raw API records ride along ("everything the API returns").
    expect(roster.students[0].person?.puid).toBe('p-s1');
    expect(roster.students[0].registration.courseSectionId).toBe('SEC-A');
  });

  it('falls back to the student number when a person record is missing', async () => {
    jest.mocked(findPersonByPuid).mockResolvedValue(instructor);
    jest.mocked(sectionsByIds).mockResolvedValue([section('SEC-A', 'P1')]);
    jest.mocked(registrationsBySectionId).mockResolvedValue([registration('S9', 'SEC-A', 'P1')]);
    jest.mocked(findPersonsByStudentIds).mockResolvedValue([]);

    const roster = await getClassList(user, 'SEC-A');

    expect(roster.students[0]).toMatchObject({ studentId: 'S9', name: 'S9', email: '', person: null });
  });
});
