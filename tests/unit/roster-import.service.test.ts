import {
  classifyIdentifier,
  classifyIdentifierList,
  parseRosterFile,
} from '../../server/src/services/roster-import.service';

// Roster import parsing + identifier validation (2026-08-06).
//
// The behaviour under test exists because a roster entry is matched at
// enrolment against `user.uid` and `user.email` only, and the SAML assertion
// releases no student number — so a student-number roster matches nobody. The
// old code accepted one silently. Everything below is really one question:
// does a wrong file get REJECTED LOUDLY instead of saved?

describe('classifyIdentifier', () => {
  it('accepts CWL usernames and emails, lower-casing and trimming them', () => {
    expect(classifyIdentifier('  JSmith22 ')).toEqual({ ok: true, identifier: 'jsmith22' });
    expect(classifyIdentifier('A.Student@student.ubc.ca')).toEqual({
      ok: true,
      identifier: 'a.student@student.ubc.ca',
    });
  });

  it('rejects an all-digit value as a student number, not as generic junk', () => {
    // The specific reason is the point: it is what lets the UI explain the
    // CWL-vs-student-number constraint instead of saying "invalid".
    expect(classifyIdentifier('12345678')).toEqual({ ok: false, reason: 'student-number' });
    expect(classifyIdentifier(' 87654321 ')).toEqual({ ok: false, reason: 'student-number' });
  });

  it('rejects malformed emails distinctly from other bad values', () => {
    expect(classifyIdentifier('nope@')).toEqual({ ok: false, reason: 'malformed-email' });
    expect(classifyIdentifier('a@b')).toEqual({ ok: false, reason: 'malformed-email' });
    expect(classifyIdentifier('a b@ubc.ca')).toEqual({ ok: false, reason: 'malformed-email' });
    expect(classifyIdentifier('Jane Smith')).toEqual({ ok: false, reason: 'invalid-characters' });
  });

  it('does not reject a username that merely contains digits', () => {
    // A false reject locks a real student out of the course, which is worse
    // than letting a typo through to the harmless "not on roster" path.
    expect(classifyIdentifier('a1b2c3')).toEqual({ ok: true, identifier: 'a1b2c3' });
    expect(classifyIdentifier('2smith')).toEqual({ ok: true, identifier: '2smith' });
  });
});

describe('parseRosterFile', () => {
  it('reads a headerless single-column list, which is what the old paste flow produced', () => {
    const result = parseRosterFile('jsmith22\nastudent@ubc.ca\nbjones\n');

    expect(result.columns).toEqual([]);
    expect(result.selectedColumn).toBeNull();
    expect(result.identifiers).toEqual(['jsmith22', 'astudent@ubc.ca', 'bjones']);
    expect(result.rejects).toEqual([]);
    expect(result.totalRows).toBe(3);
  });

  it('treats a single-column file with a recognised header as headed', () => {
    const result = parseRosterFile('CWL\njsmith22\nbjones\n');

    expect(result.columns).toEqual(['CWL']);
    expect(result.selectedColumn).toBe('CWL');
    expect(result.identifiers).toEqual(['jsmith22', 'bjones']);
  });

  it('prefers the email column over a student-number column in a Workday-shaped export', () => {
    const csv = [
      'Student Number,Name,Email',
      '12345678,Jane Smith,jsmith@student.ubc.ca',
      '87654321,Bo Jones,bjones@student.ubc.ca',
    ].join('\n');

    const result = parseRosterFile(csv);

    expect(result.selectedColumn).toBe('Email');
    expect(result.identifiers).toEqual(['jsmith@student.ubc.ca', 'bjones@student.ubc.ca']);
    expect(result.rejects).toEqual([]);
  });

  it('honours an explicit column override so a wrong guess is correctable without re-exporting', () => {
    const csv = ['Student Number,CWL', '12345678,jsmith22', '87654321,bjones'].join('\n');

    expect(parseRosterFile(csv).selectedColumn).toBe('CWL');

    const forced = parseRosterFile(csv, 'Student Number');
    expect(forced.selectedColumn).toBe('Student Number');
    expect(forced.identifiers).toEqual([]);
    expect(forced.rejects.map((reject) => reject.reason)).toEqual(['student-number', 'student-number']);
  });

  it('reports every row of a student-number-only file rather than accepting it', () => {
    // The exact scenario the instructors described: a roster keyed on student
    // number. It must produce zero identifiers and a specific reason.
    const csv = ['Student Number', '12345678', '87654321', '11223344'].join('\n');

    const result = parseRosterFile(csv);

    expect(result.identifiers).toEqual([]);
    expect(result.totalRows).toBe(3);
    expect(result.rejects).toEqual([
      { line: 2, value: '12345678', reason: 'student-number' },
      { line: 3, value: '87654321', reason: 'student-number' },
      { line: 4, value: '11223344', reason: 'student-number' },
    ]);
  });

  it('does not silently consume the first value in a headerless invalid list', () => {
    const result = parseRosterFile('12345678\n87654321\n');

    expect(result.columns).toEqual([]);
    expect(result.totalRows).toBe(2);
    expect(result.rejects).toEqual([
      { line: 1, value: '12345678', reason: 'student-number' },
      { line: 2, value: '87654321', reason: 'student-number' },
    ]);
  });

  it('numbers rejects by the line the instructor sees in their spreadsheet', () => {
    const csv = ['Email', 'ok@ubc.ca', 'broken@', 'fine@ubc.ca'].join('\n');

    // Header is line 1, so the bad row is line 3 — not the 2nd data row.
    expect(parseRosterFile(csv).rejects).toEqual([{ line: 3, value: 'broken@', reason: 'malformed-email' }]);
  });

  it('flags duplicates instead of silently collapsing them', () => {
    const csv = ['Email', 'a@ubc.ca', 'A@UBC.CA', 'b@ubc.ca'].join('\n');

    const result = parseRosterFile(csv);

    expect(result.identifiers).toEqual(['a@ubc.ca', 'b@ubc.ca']);
    expect(result.rejects).toEqual([{ line: 3, value: 'A@UBC.CA', reason: 'duplicate' }]);
  });

  it('skips blank rows without counting them as errors', () => {
    const result = parseRosterFile('Email\na@ubc.ca\n\n\nb@ubc.ca\n');

    expect(result.identifiers).toEqual(['a@ubc.ca', 'b@ubc.ca']);
    expect(result.rejects).toEqual([]);
    expect(result.totalRows).toBe(2);
  });

  it('handles a BOM and quoted fields, which real spreadsheet exports carry', () => {
    const csv = '﻿"Email","Name"\r\n"a@ubc.ca","Smith, Jane"\r\n';

    const result = parseRosterFile(csv);

    expect(result.selectedColumn).toBe('Email');
    expect(result.identifiers).toEqual(['a@ubc.ca']);
  });

  it('returns an empty result for an empty file rather than throwing', () => {
    expect(parseRosterFile('')).toEqual({
      columns: [],
      selectedColumn: null,
      identifiers: [],
      rejects: [],
      totalRows: 0,
    });
  });

  it('falls back to the column that actually validates when no header is recognisable', () => {
    const csv = ['Col A,Col B', 'row one,jsmith22', 'row two,bjones'].join('\n');

    const result = parseRosterFile(csv);

    expect(result.selectedColumn).toBe('Col B');
    expect(result.identifiers).toEqual(['jsmith22', 'bjones']);
  });
});

describe('classifyIdentifierList (the pasted-textarea path)', () => {
  it('applies the same rules as the file import so the two cannot drift', () => {
    const { identifiers, rejects } = classifyIdentifierList([
      'jsmith22',
      '12345678',
      '  a@ubc.ca  ',
      '',
      'Jane Smith',
    ]);

    expect(identifiers).toEqual(['jsmith22', 'a@ubc.ca']);
    expect(rejects).toEqual([
      { line: 2, value: '12345678', reason: 'student-number' },
      { line: 5, value: 'Jane Smith', reason: 'invalid-characters' },
    ]);
  });

  it('dedupes without reporting, since putRoster dedupes anyway', () => {
    const { identifiers, rejects } = classifyIdentifierList(['a@ubc.ca', 'A@ubc.ca']);

    expect(identifiers).toEqual(['a@ubc.ca']);
    expect(rejects).toEqual([]);
  });
});
