import { parse } from 'csv-parse/sync';
import type { CourseRole } from '../types/domain';
import type { PeopleImportPreview } from '../types/people-import';

const normalizeHeader = (value: string): string => value.trim().toLowerCase().replace(/[_\s-]+/g, ' ');
const ROLES: Record<string, CourseRole> = {
  student: 'student', studentenrollment: 'student',
  teacher: 'instructor', teacherenrollment: 'instructor', instructor: 'instructor', professor: 'instructor',
  ta: 'ta', taenrollment: 'ta', 'teaching assistant': 'ta',
};

export function peopleImportError(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

/** UBC Canvas Login ID is the exact CWL PUID, not a Canvas ID or student number. */
export function parsePeopleImport(text: string): PeopleImportPreview {
  let rows: Array<{ record: string[]; info: { lines: number } }>;
  try {
    rows = parse(text, { bom: true, trim: true, skip_empty_lines: true, info: true,
      relax_column_count: true, max_record_size: 64 * 1024 }) as unknown as typeof rows;
  } catch { return peopleImportError('Invalid CSV. Export the spreadsheet as a UTF-8 CSV file.'); }
  const columns = rows.shift()?.record ?? [];
  const headers = columns.map(normalizeHeader);
  const find = (names: string[]): number => headers.findIndex(h => names.includes(h));
  const identity = find(['sis login id', 'login id', 'puid', 'cwl puid']);
  if (identity < 0) peopleImportError('Missing Login ID column. Use SIS Login ID, login_id, Login ID or PUID. Canvas ID, SIS User ID, student numbers and names cannot identify a CWL account.');
  const role = find(['role', 'enrollment role', 'enrollment type', 'type']);
  const name = find(['name', 'student', 'student name', 'full name']);
  const state = find(['enrollment state', 'enrollment status', 'state', 'status']);
  const restricted = find(['limit privileges to course section', 'section limited', 'section restricted']);
  // Ambiguous duplicate headers must not silently select the wrong identity/role.
  for (const index of [identity, role, state, restricted]) {
    if (index >= 0 && headers.filter(h => h === headers[index]).length > 1) peopleImportError('Duplicate identity or enrollment headers. Keep one column for each field.');
  }
  if (rows.length > 10000) peopleImportError('A people import supports at most 10,000 rows.');
  const identityIndices = headers.flatMap((h, i) => ['sis login id', 'login id', 'puid', 'cwl puid'].includes(h) ? [i] : []);
  const roleIndices = headers.flatMap((h, i) => ['role', 'enrollment role', 'enrollment type', 'type'].includes(h) ? [i] : []);
  const stateIndices = headers.flatMap((h, i) => ['enrollment state', 'enrollment status', 'state', 'status'].includes(h) ? [i] : []);
  const result: PeopleImportPreview = { columns, identityColumn: columns[identity]!, roleColumn: role < 0 ? null : columns[role]!, members: [], rejects: [], totalRows: 0, ignoredRows: 0,
    warnings: state < 0 ? ['Enrollment status is not included. Import only current active members. Before exporting Canvas Grades, turn off Show Inactive Enrollments and Show Concluded Enrollments.'] : [] };
  const seen = new Set<string>();
  const gradebook = headers.includes('sis login id') && headers.includes('student') && headers.includes('id');
  for (const { record, info } of rows) {
    if (record.every(cell => !cell.trim())) { result.ignoredRows++; continue; }
    const value = (record[identity] ?? '').trim();
    // Canvas Gradebook inserts a Points Possible metadata row before students.
    if (gradebook && !value && !(record[headers.indexOf('id')] ?? '').trim()
      && /^(points possible|test student)$/i.test(record[name] ?? '')) { result.ignoredRows++; continue; }
    result.totalRows++;
    const reject = (reason: string): void => { result.rejects.push({ line: info.lines, value, reason }); };
    // Identity is determined by the explicit header and exact SAML match, not
    // by guessing from its shape. The local IdP legitimately uses numeric PUIDs.
    if (!value || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
      reject('Missing or invalid CWL PUID. Use the exact Canvas Login ID, not an email or name.'); continue;
    }
    if (new Set(identityIndices.map(i => (record[i] ?? '').trim()).filter(Boolean)).size > 1) {
      reject('Conflicting Login ID/PUID columns.'); continue;
    }
    const parsedRole = role < 0 ? 'student' : ROLES[(record[role] ?? '').trim().toLowerCase()];
    if (!parsedRole) { reject('Unsupported or missing role. Use Student, Teacher/Professor/Instructor or TA.'); continue; }
    if (roleIndices.some(i => ROLES[(record[i] ?? '').trim().toLowerCase()] !== parsedRole)) {
      reject('Conflicting or unsupported role columns.'); continue;
    }
    if (stateIndices.some(i => (record[i] ?? '').trim().toLowerCase() !== 'active')) {
      reject('Only active enrollments can grant access.'); continue;
    }
    if (parsedRole !== 'student' && restricted >= 0 && !['false', '0', 'no'].includes((record[restricted] ?? '').trim().toLowerCase())) {
      reject('Section-limited or unspecified teaching access cannot grant whole-course permissions.'); continue;
    }
    const key = `${value}:${parsedRole}`;
    if (seen.has(key)) { reject('Duplicate Login ID and role.'); continue; }
    seen.add(key);
    result.members.push({ puid: value, role: parsedRole, name: name < 0 ? '' : (record[name] ?? '').slice(0, 200) });
  }
  return result;
}
