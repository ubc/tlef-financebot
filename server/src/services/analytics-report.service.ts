import { buffer } from 'node:stream/consumers';
import PDFDocument from 'pdfkit';
import type { ObjectId } from 'mongodb';
import { coursesCol } from '../components/mongodb/collections';
import type { Course } from '../types/domain';
import { analyticsReportData, type AnalyticsMode } from './analytics.service';

type Scope = { from: Date; to: Date; mode: AnalyticsMode };
type CourseLabel = Pick<Course, 'courseCode' | 'name' | 'section' | 'term'>;
type ReportData = Awaited<ReturnType<typeof analyticsReportData>>;
type Topic = ReportData['topics'][number];
type Objective = Topic['objectiveRows'][number];

const MIN_STUDENTS = 5;
const WEEK_MS = 7 * 86_400_000;
const LEFT = 44;
const WIDTH = 524;
const ink = '#182D26';
const muted = '#466156';
const green = '#174E3C';
const light = '#EDF5F0';
const number = new Intl.NumberFormat('en-CA');
const utc = (date: Date): string => `${date.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
const percent = (rate: number): string => `${Math.round(rate * 100)}%`;
const accuracy = (correct: number | undefined, attempts: number): string =>
  correct === undefined ? '-' : percent(correct / attempts);
const reportText = (value: string): string => value.replace(/\s+/g, ' ').replace(/[^\x20-\x7e\xa0-\xff]/g, '').trim();

function isPublishableSplit(count: number, total: number): boolean {
  return total >= MIN_STUDENTS && [count, total - count].every(size => size === 0 || size >= MIN_STUDENTS);
}

function withheldRows<T extends { activeStudents: number; attempts: number }>(rows: T[]): Set<T> {
  const hidden = new Set(rows.filter(row => row.activeStudents > 0 && row.activeStudents < MIN_STUDENTS));
  if (hidden.size === 1) {
    const companion = rows.reduce<T | undefined>((smallest, row) =>
      row.activeStudents >= MIN_STUDENTS && (!smallest || row.attempts < smallest.attempts) ? row : smallest, undefined);
    if (companion) hidden.add(companion);
  }
  return hidden;
}

export async function generateAnalyticsReport(courseId: ObjectId, scope: Scope): Promise<Buffer | undefined> {
  const course = await coursesCol().findOne<CourseLabel>(
    { _id: courseId }, { projection: { _id: 0, courseCode: 1, name: 1, section: 1, term: 1 } },
  );
  if (!course) return undefined;
  return renderAnalyticsReport(course, scope, await analyticsReportData(courseId, scope));
}

export function renderAnalyticsReport(course: CourseLabel, scope: Scope, { totals, weeks, topics, repeatStudents, nextWeek }: ReportData): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'LETTER', margin: 0, autoFirstPage: false,
    info: { Title: 'FinanceBot | Student Analytics', Author: 'FinanceBot', Subject: course.name },
  });
  const mode = scope.mode === 'exam-prep' ? 'Exam Prep' : 'Topic Practice';
  const period = `${scope.from.getTime() === 0 ? 'First recorded activity' : utc(scope.from)} to ${utc(scope.to)}`;
  // Keep the compact heading on one line in the PDF's standard Latin font.
  const courseLine = [course.courseCode, course.name, course.section && `Section ${course.section}`, course.term]
    .map(part => part && reportText(part))
    .filter(Boolean).join('  /  ');
  const withheld = new Set(weeks.filter(row => row.activeStudents > 0 && row.activeStudents < MIN_STUDENTS).map(row => row.week));
  if (withheld.size === 1) {
    // A second hidden row prevents subtraction from the report total from revealing one small week.
    const companion = weeks.reduce<ReportData['weeks'][number] | undefined>((smallest, row) =>
      row.activeStudents >= MIN_STUDENTS && (!smallest || row.questionsAttempted < smallest.questionsAttempted) ? row : smallest, undefined);
    if (companion) withheld.add(companion.week);
  }
  const showTotals = totals.activeStudents >= MIN_STUDENTS;
  const empty = totals.questionsAttempted === 0;
  const busiestWeek = weeks.reduce<ReportData['weeks'][number] | undefined>((busiest, row) =>
    !withheld.has(row.week) && row.questionsAttempted > (busiest?.questionsAttempted ?? 0) ? row : busiest, undefined);
  const maxAttempts = busiestWeek?.questionsAttempted ?? 1;
  const withheldTopics = withheldRows(topics);
  const visibleTopics = topics.filter(topic => topic.attempts > 0 && !withheldTopics.has(topic));
  const mostPracticed = visibleTopics.reduce<Topic | undefined>((most, topic) => !most || topic.attempts > most.attempts ? topic : most, undefined);
  const reviewTopic = visibleTopics.filter(topic => topic.attempts >= 20 && topic.correctAttempts / topic.attempts < 0.8)
    .sort((a, b) => a.correctAttempts / a.attempts - b.correctAttempts / b.attempts || b.attempts - a.attempts)[0];
  const objectives = reviewTopic?.objectiveRows ?? [];
  const withheldObjectives = withheldRows(objectives);
  const canShowRepeat = isPublishableSplit(repeatStudents, totals.activeStudents);
  const canShowNextWeek = nextWeek && !withheld.has(nextWeek.baseWeek) && !withheld.has(nextWeek.followUpWeek)
    && isPublishableSplit(nextWeek.returned, nextWeek.eligible);
  const overviewWeeks = 6;
  const overviewRows = 7;
  const weeklyPages = Math.ceil(Math.max(0, weeks.length - overviewWeeks) / 21);
  const topicPages = Math.ceil(Math.max(0, topics.length - overviewRows) / 16);
  const objectivePages = Math.ceil(Math.max(0, objectives.length - overviewRows) / 15);
  const pages = 1 + weeklyPages + topicPages + objectivePages;

  function print(value: string, x: number, y: number, width: number, options: {
    size?: number; font?: string; color?: string; align?: 'left' | 'right'; height?: number;
  } = {}): void {
    const { size = 10, font = 'Helvetica', color = ink, align = 'left', height = size * 1.6 } = options;
    doc.font(font).fontSize(size).fillColor(color).text(value, x, y, { width, align, height, ellipsis: '...' });
  }

  function header(title: string, overview = false): void {
    doc.addPage();
    doc.rect(0, 0, 612, overview ? 104 : 136).fill(green);
    print('FINANCEBOT  /  FACULTY BRIEF', LEFT, overview ? 14 : 26, WIDTH, { font: 'Helvetica-Bold', color: '#CDE7D7' });
    print(title, LEFT, overview ? 30 : 44, WIDTH,
      { size: overview ? 26 : 32, font: 'Times-Bold', color: '#FFFFFF' });
    print(courseLine, LEFT, overview ? 64 : 86, WIDTH, { size: 11, color: '#FFFFFF' });
    print(`${mode}  |  ${period}`, LEFT, overview ? 81 : 108, WIDTH, { size: 9, color: '#E3F1E8' });
  }

  function executiveSummary(): void {
    print('Executive summary', LEFT, 115, WIDTH, { font: 'Times-Bold', size: 17 });
    const lines = [
      ['Repeat practice', canShowRepeat
        ? `${repeatStudents} of ${totals.activeStudents} active students practiced in at least two weeks (${percent(repeatStudents / totals.activeStudents)}).`
        : 'A rate is unavailable for this window.'],
      ['Course coverage', topics.length
        ? `${visibleTopics.length} of ${topics.length} topics had ${withheldTopics.size ? 'reportable ' : ''}practice.`
        : 'No active topics in the course outline.'],
      ['Classroom review', reviewTopic
        ? `${accuracy(reviewTopic.correctAttempts, reviewTopic.attempts)} correct across ${number.format(reviewTopic.attempts)} attempts in ${reportText(reviewTopic.name)}.`
        : 'No topic met the review criteria in this window.'],
    ];
    lines.forEach(([label, line], index) => {
      const y = 139 + index * 13;
      print(label, LEFT, y, 98, { font: 'Helvetica-Bold', size: 9 });
      print(line, LEFT + 101, y, WIDTH - 101, { size: 9 });
    });
  }

  function summary(): void {
    const metrics = [
      ['Recorded attempts', empty ? '0' : number.format(totals.questionsAttempted)],
      ['Attempt accuracy', accuracy(totals.correctAttempts, totals.questionsAttempted)],
      ['Active objectives attempted', percent(totals.loCoverageRate)],
      ['Active students', empty ? '0' : number.format(totals.activeStudents)],
      ['Sessions / active student', empty ? '-' : totals.sessionsPerStudent.toFixed(1)],
      ['Observed min / session', empty ? '-' : totals.avgSessionMinutes.toFixed(1)],
    ];
    metrics.forEach(([label, value], index) => {
      const gap = 5;
      const width = (WIDTH - gap * 5) / 6;
      const x = LEFT + index * (width + gap);
      const y = 184;
      const display = showTotals || empty ? value : 'Withheld';
      doc.roundedRect(x, y, width, 49, 5).fill(light);
      print(display, x + 6, y + 5, width - 12, { size: 17, font: 'Times-Bold', color: green });
      print(label, x + 6, y + 26, width - 12, { size: 7.5, height: 19, font: 'Helvetica-Bold' });
    });
  }

  const columns = [
    { x: 54, width: 78, label: 'Week of (UTC)' },
    { x: 140, width: 66, label: 'Attempts' },
    { x: 305, width: 56, label: 'Accuracy' },
    { x: 369, width: 60, label: 'Active students' },
    { x: 438, width: 45, label: 'Sessions' },
    { x: 489, width: 69, label: 'Min / session' },
  ];

  function weeklyTable(rows: ReportData['weeks'], top: number, rowHeight = 22): void {
    doc.roundedRect(LEFT, top, WIDTH, 23, 4).fill(green);
    columns.forEach(({ x, width, label }, index) =>
      print(label, x, top + 7, width, { size: 8, font: 'Helvetica-Bold', color: '#FFFFFF', align: index < 2 ? 'left' : 'right' }));
    rows.forEach((row, index) => {
      const y = top + 23 + index * rowHeight;
      const textTop = y + (rowHeight - 10) / 2;
      if (index % 2 === 0) doc.rect(LEFT, y, WIDTH, rowHeight).fill('#F3F7F4');
      const start = Date.parse(row.week);
      const partial = (scope.from.getTime() > start || scope.to.getTime() < start + WEEK_MS - 1) ? '*' : '';
      print(row.week + partial, columns[0].x, textTop, columns[0].width, { size: 9 });
      if (withheld.has(row.week)) {
        print('Withheld to protect small groups', columns[1].x, textTop, 250, { size: 9, color: muted });
        return;
      }
      const values = [
        number.format(row.questionsAttempted), accuracy(row.correctAttempts, row.questionsAttempted),
        number.format(row.activeStudents), number.format(row.sessions),
        row.sessions ? row.avgSessionMinutes.toFixed(1) : '-',
      ];
      values.forEach((value, i) => print(value, columns[i + 1].x, textTop, columns[i + 1].width, { size: 9, align: i === 0 ? 'left' : 'right' }));
      if (row.questionsAttempted > 0) {
        doc.roundedRect(206, textTop + 2, Math.max(2, 88 * row.questionsAttempted / maxAttempts), 6, 2).fill('#5A9875');
      }
    });
  }

  const panelWidth = 255;
  const reviewLeft = LEFT + WIDTH - panelWidth;

  function topicTable(rows: Topic[], top: number, compact = false): void {
    if (!rows.length) return;
    const fields = compact ? [
      { x: 50, width: 107, label: 'Course topic' },
      { x: 161, width: 27, label: 'LOs' },
      { x: 191, width: 34, label: 'Attempts' },
      { x: 229, width: 29, label: 'Correct' },
      { x: 261, width: 32, label: 'Students' },
    ] : [
      { x: 54, width: 214, label: 'Course topic' },
      { x: 275, width: 88, label: 'Objectives tried' },
      { x: 369, width: 58, label: 'Attempts' },
      { x: 435, width: 58, label: 'Accuracy' },
      { x: 500, width: 58, label: 'Students' },
    ];
    const width = compact ? panelWidth : WIDTH;
    const rowHeight = compact ? 25 : 28;
    doc.roundedRect(LEFT, top, width, 23, 4).fill(green);
    fields.forEach(({ x, width, label }, index) =>
      print(label, x, top + 7, width, { size: compact ? 7 : 8, font: 'Helvetica-Bold', color: '#FFFFFF', align: index ? 'right' : 'left' }));
    rows.forEach((topic, index) => {
      const y = top + 23 + index * rowHeight;
      if (index % 2 === 0) doc.rect(LEFT, y, width, rowHeight).fill('#F3F7F4');
      const size = compact ? 8.5 : 10;
      print(reportText(topic.name) || 'Course topic', fields[0].x, y + 4, fields[0].width, { size, height: rowHeight - 4 });
      if (withheldTopics.has(topic)) {
        print('Activity details withheld', fields[1].x, y + 8, LEFT + width - 6 - fields[1].x, { size, color: muted, align: 'right' });
        return;
      }
      const values = [`${topic.coveredObjectives} / ${topic.objectives}`, number.format(topic.attempts),
        accuracy(topic.attempts ? topic.correctAttempts : undefined, topic.attempts), number.format(topic.activeStudents)];
      values.forEach((value, i) => print(value, fields[i + 1].x, y + 8, fields[i + 1].width, { size, align: 'right' }));
    });
  }

  function objectiveTable(rows: Objective[], top: number, compact = false): void {
    const fields = compact ? [
      { x: reviewLeft + 6, width: 135, label: 'Learning objective' },
      { x: reviewLeft + 144, width: 34, label: 'Attempts' },
      { x: reviewLeft + 182, width: 30, label: 'Correct' },
      { x: reviewLeft + 216, width: 33, label: 'Students' },
    ] : [
      { x: 54, width: 304, label: 'Learning objective' },
      { x: 365, width: 62, label: 'Attempts' },
      { x: 435, width: 58, label: 'Accuracy' },
      { x: 500, width: 58, label: 'Students' },
    ];
    const left = compact ? reviewLeft : LEFT;
    const width = compact ? panelWidth : WIDTH;
    const rowHeight = compact ? 25 : 28;
    doc.roundedRect(left, top, width, 23, 4).fill(green);
    fields.forEach(({ x, width, label }, index) =>
      print(label, x, top + 7, width, { size: compact ? 7 : 8, font: 'Helvetica-Bold', color: '#FFFFFF', align: index ? 'right' : 'left' }));
    rows.forEach((row, index) => {
      const y = top + 23 + index * rowHeight;
      if (index % 2 === 0) doc.rect(left, y, width, rowHeight).fill('#F3F7F4');
      const size = compact ? 8.5 : 10;
      print(reportText(row.name) || 'Learning objective', fields[0].x, y + 4, fields[0].width, { size, height: rowHeight - 4 });
      if (withheldObjectives.has(row)) {
        print('Details withheld', fields[1].x, y + 8, left + width - 6 - fields[1].x, { size, color: muted, align: 'right' });
        return;
      }
      const values = [number.format(row.attempts), accuracy(row.attempts ? row.correctAttempts : undefined, row.attempts),
        number.format(row.activeStudents)];
      values.forEach((value, i) => print(value, fields[i + 1].x, y + 8, fields[i + 1].width, { size, align: 'right' }));
    });
  }

  function footer(page: number, notesTop: number, section: 'overview' | 'weekly' | 'topics' | 'objectives'): void {
    print('How to read this report', LEFT, notesTop, WIDTH, { font: 'Helvetica-Bold' });
    const notes = section === 'overview' ? [
      '* Partial week. Weeks start Sunday UTC. Next-week return compares the two latest complete weeks.',
      'LOs shows active learning objectives tried / listed. Accuracy includes retries. Small groups may be withheld.',
      'Sessions split after gaps over 30 minutes. Duration spans the first to last submission in a session.',
      'Review focus is the lowest reportable topic accuracy below 80%, with at least 20 attempts.',
    ] : section === 'objectives' ? [
      'Accuracy describes submitted attempts, including retries. A blank rate means no attempts were recorded.',
      'Objective details require five active students. An additional row may be withheld to protect a small group.',
      'Use the results to choose a review topic. Changes in accuracy alone cannot establish learning gains.',
    ] : section === 'topics' ? [
      'Objectives tried counts active learning objectives with at least one submission during the selected period.',
      'Attempts are attributed to the recorded objective. Historical attempts may appear only in course and weekly totals.',
      'Topic details require five active students. An additional row may be withheld to protect a small group.',
      'The review card shows the lowest observed accuracy below 80% among visible topics with at least 20 attempts.',
    ] : [
      '* Partial week. Weeks start Sunday UTC. Weekly sessions are grouped separately in each week.',
      'Accuracy is correct submissions divided by all submissions, including retries. At least five attempts are required.',
      'Sessions split after gaps over 30 minutes. Observed duration spans the first to last submission in a session.',
      'Totals and weekly rows may be withheld to protect groups with fewer than five active students.',
      'Next-week return uses the two latest complete weeks. Small groups may be withheld.',
    ];
    notes.forEach((note, index) => print(note, LEFT, notesTop + 17 + index * 12, WIDTH, { size: 8.5, color: muted }));
    doc.rect(LEFT, 754, WIDTH, 1).fill('#D5E2DA');
    print('Source  /  FinanceBot Student Analytics', LEFT, 765, WIDTH, { size: 9, color: green });
    print(`${page} / ${pages}`, LEFT, 765, WIDTH, { size: 9, color: muted, align: 'right' });
  }

  header('Student Analytics', true);
  executiveSummary();
  summary();
  print('Weekly engagement', LEFT, 245, WIDTH, { size: 17, font: 'Times-Bold' });
  if (weeklyPages) print('Latest six weeks shown. Earlier weeks follow.', LEFT, 250, WIDTH, { size: 8, align: 'right', color: muted });
  if (canShowNextWeek && nextWeek) {
    const rate = percent(nextWeek.returned / nextWeek.eligible);
    print(`Next-week return   ${nextWeek.returned} of ${nextWeek.eligible} (${rate}) from ${nextWeek.baseWeek} returned the week of ${nextWeek.followUpWeek}.`,
      LEFT, 268, WIDTH, { size: 9, color: muted });
  } else {
    const description = empty ? 'No recorded attempts in this window.' : 'Next-week return is unavailable for this window.';
    print(description, LEFT, 268, WIDTH, { size: 9, color: muted });
  }
  const recentWeeks = weeks.slice(-overviewWeeks);
  weeklyTable(recentWeeks, 284, 17);
  const panelsTop = 284 + 23 + recentWeeks.length * 17 + 16;
  print('Topic coverage', LEFT, panelsTop, panelWidth, { font: 'Times-Bold', size: 17 });
  print(mostPracticed ? `Most practiced  /  ${reportText(mostPracticed.name)}` : 'No reportable topic activity.',
    LEFT, panelsTop + 23, panelWidth, { color: muted, size: 8.5 });
  print('Classroom review', reviewLeft, panelsTop, panelWidth, { font: 'Times-Bold', size: 17 });
  print(reviewTopic ? reportText(reviewTopic.name) : 'No topic met the review criteria.',
    reviewLeft, panelsTop + 23, panelWidth, { color: muted, size: 8.5 });
  const tableTop = panelsTop + 38;
  topicTable(topics.slice(0, overviewRows), tableTop, true);
  if (objectives.length) objectiveTable(objectives.slice(0, overviewRows), tableTop, true);
  const panelsBottom = tableTop + 23 + Math.min(overviewRows, Math.max(topics.length, objectives.length)) * 25;
  if (topicPages || objectivePages) print('Remaining rows follow.', LEFT, panelsBottom + 4, WIDTH, { size: 8, color: muted });
  footer(1, Math.min(695, panelsBottom + (topicPages || objectivePages ? 18 : 14)), 'overview');

  const earlierWeeks = weeks.slice(0, Math.max(0, weeks.length - overviewWeeks));
  for (let page = 1, start = 0; page <= weeklyPages; page++, start += 21) {
    header('Earlier weekly engagement');
    const rows = earlierWeeks.slice(start, start + 21);
    weeklyTable(rows, 156);
    footer(1 + page, 156 + 23 + rows.length * 22 + 19, 'weekly');
  }
  for (let page = 1, start = overviewRows; page <= topicPages; page++, start += 16) {
    header('Topic coverage continued');
    const rows = topics.slice(start, start + 16);
    topicTable(rows, 156);
    footer(1 + weeklyPages + page, 156 + 23 + rows.length * 28 + 17, 'topics');
  }
  for (let page = 1, start = overviewRows; reviewTopic && page <= objectivePages; page++, start += 15) {
    header('Classroom review continued');
    print(reportText(reviewTopic.name) || 'Course topic', LEFT, 153, WIDTH, { size: 21, font: 'Times-Bold' });
    print(`${accuracy(reviewTopic.correctAttempts, reviewTopic.attempts)} correct across ${number.format(reviewTopic.attempts)} attempts from ${reviewTopic.activeStudents} students.`, LEFT, 185, WIDTH);
    print('Use the objective breakdown to choose a worked example or a short check for understanding.', LEFT, 202, WIDTH, { color: muted });
    const rows = objectives.slice(start, start + 15);
    objectiveTable(rows, 227);
    footer(1 + weeklyPages + topicPages + page, 227 + 23 + rows.length * 28 + 17, 'objectives');
  }

  const output = buffer(doc);
  doc.end();
  return output;
}
