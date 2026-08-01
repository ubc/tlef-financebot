import { INDEX_SPECS } from '../../server/src/components/mongodb/collections';

describe('collection index specs (PRD §2 data model)', () => {
  const byCollection = Object.fromEntries(INDEX_SPECS.map((s) => [s.collection + ':' + JSON.stringify(s.keys), s]));

  it('enforces identity and enrollment uniqueness', () => {
    expect(byCollection['users:{"puid":1}'].options?.unique).toBe(true);
    expect(byCollection['platformInstructorPuidGrants:{"puid":1}'].options?.unique).toBe(true);
    expect(byCollection['courses:{"registrationCode":1}'].options?.unique).toBe(true);
    expect(byCollection['rosterEntries:{"courseId":1,"identifier":1}'].options?.unique).toBe(true);
  });

  it('enforces one version number per question and one review-book entry per question', () => {
    expect(byCollection['questionVersions:{"questionId":1,"version":1}'].options?.unique).toBe(true);
    expect(byCollection['reviewBookEntries:{"puid":1,"courseId":1,"questionId":1}'].options?.unique).toBe(true);
    expect(byCollection['masteryProfiles:{"puid":1,"courseId":1,"loId":1}'].options?.unique).toBe(true);
  });

  it('enforces one saved generation blueprint name per course', () => {
    expect(byCollection['generationBlueprints:{"courseId":1,"name":1}'].options?.unique).toBe(true);
    expect(byCollection['generationBlueprints:{"courseId":1,"updatedAt":-1}']).toBeDefined();
  });

  it('indexes the hot attempt-record and serving paths', () => {
    expect(byCollection['attemptRecords:{"puid":1,"courseId":1,"loId":1,"createdAt":-1}']).toBeDefined();
    expect(byCollection['attemptRecords:{"questionVersionId":1}']).toBeDefined();
    expect(byCollection['previewAttemptRecords:{"instructorPuid":1,"courseId":1,"previewSessionId":1,"createdAt":-1}']).toBeDefined();
    expect(byCollection['previewAttemptRecords:{"questionVersionId":1}']).toBeDefined();
    expect(byCollection['previewAttemptRecords:{"createdAt":1}'].options?.expireAfterSeconds).toBe(86_400);
    expect(
      byCollection['previewStudentSessions:{"instructorPuid":1,"courseId":1,"previewSessionId":1}']
        .options?.unique,
    ).toBe(true);
    expect(
      byCollection['previewStudentSessions:{"updatedAt":1}'].options?.expireAfterSeconds,
    ).toBe(86_400);
    expect(byCollection['questions:{"courseId":1,"state":1}']).toBeDefined();
    expect(byCollection['questions:{"loIds":1}']).toBeDefined();
    expect(byCollection['notifications:{"recipientPuid":1,"createdAt":-1}']).toBeDefined();
    expect(byCollection['flags:{"questionVersionId":1,"state":1}']).toBeDefined();
    expect(byCollection['contentRuns:{"courseId":1,"createdAt":-1}']).toBeDefined();
    expect(byCollection['contentRuns:{"courseId":1,"kind":1,"status":1,"createdAt":-1}']).toBeDefined();
    const openExam = byCollection['examAttempts:{"puid":1,"courseId":1,"templateId":1,"open":1}'];
    expect(openExam.options?.unique).toBe(true);
    expect(openExam.options?.partialFilterExpression).toEqual({ open: true });
  });
});
