import PDFDocument from 'pdfkit';
jest.mock('../../server/src/components/mongodb/collections', () => ({ coursesCol: jest.fn() }));
jest.mock('../../server/src/services/analytics.service', () => ({ analyticsReportData: jest.fn() }));
import { renderAnalyticsReport } from '../../server/src/services/analytics-report.service';

// A course with only two active students: every figure is printed, nothing is withheld.
it('prints small-group totals, weeks, topics and objectives instead of withholding them', async () => {
  const printed: string[] = [];
  const text = jest.spyOn(PDFDocument.prototype, 'text').mockImplementation(function (this: PDFKit.PDFDocument, value: unknown) {
    printed.push(String(value));
    return this;
  } as never);
  const objectiveRows = [{ name: 'Value at Risk', attempts: 24, correctAttempts: 12, activeStudents: 2 }];
  const pdf = await renderAnalyticsReport(
    { courseCode: 'COMM 298', name: 'Finance', section: '101', term: '2026W1' },
    { from: new Date('2026-09-06T00:00:00Z'), to: new Date('2026-09-19T23:59:59Z'), mode: 'topic-practice' },
    {
      totals: { questionsAttempted: 24, correctAttempts: 12, activeStudents: 2, avgSessionMinutes: 4, sessionsPerStudent: 1.5, loCoverageRate: 1, reviewBookActivityRate: 0 },
      weeks: [
        { week: '2026-09-06', questionsAttempted: 20, correctAttempts: 10, sessions: 2, activeStudents: 2, avgSessionMinutes: 4, loCoverageRate: 1, reviewBookActivityRate: 0 },
        { week: '2026-09-13', questionsAttempted: 4, correctAttempts: 2, sessions: 1, activeStudents: 1, avgSessionMinutes: 4, loCoverageRate: 1, reviewBookActivityRate: 0 },
      ],
      topics: [{ name: 'Risk', objectives: 1, attempts: 24, correctAttempts: 12, coveredObjectives: 1, activeStudents: 2, objectiveRows }],
      repeatStudents: 1,
      nextWeek: { baseWeek: '2026-09-06', followUpWeek: '2026-09-13', eligible: 2, returned: 1 },
    } as never,
  );
  text.mockRestore();
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  const all = printed.join('\n');
  expect(all).not.toMatch(/withheld|unavailable for this window/i);
  expect(printed).toContain('24'); // total attempts
  expect(printed).toContain('2'); // active students
  expect(all).toContain('1 of 2 active students practiced in at least two weeks (50%).');
  expect(all).toMatch(/Next-week return {3}1 of 2 \(50%\)/);
  expect(all).toContain('50% correct across 24 attempts in Risk.');
});
