import { parse as parseCsv } from 'csv-parse/sync';

// -----------------------------------------------------------------------------
// Roster import (2026-08-06). Turns an uploaded CSV / Workday roster export into
// the identifier list `putRoster` takes, and — the part that actually matters —
// says which rows will NOT work before anything is written.
//
// WHY THE VALIDATION EXISTS. A roster entry is matched at enrolment against
// `user.uid` (the CWL username) and `user.email`, and nothing else:
//
//     enrollment.service.ts:36  [user.uid, user.email].map(lower)
//     domain.ts:681             identifier — "CWL username or student email"
//
// A STUDENT NUMBER MATCHES NEITHER, and cannot be made to: the SAML assertion
// carries no student-number attribute (see saml-attributes.ts — puid, uid, mail,
// affiliations and names are all the IdP releases), so at login the app never
// learns one. Supporting student numbers is a UBC IAM attribute-release request,
// not a code change.
//
// Instructors asked for this upload believing the roster took student numbers,
// which is exactly the mistake `putRoster` used to accept in silence: it takes
// any non-empty string, so a roster of student numbers saved cleanly, reported
// its count, and then failed every single enrolment with "not on roster" and no
// clue why. Rejecting those rows loudly, at import, is the point of this module.
// -----------------------------------------------------------------------------

export type RosterRejectReason =
  | 'student-number'
  | 'malformed-email'
  | 'invalid-characters'
  | 'duplicate';

export interface RosterReject {
  /** 1-based line in the uploaded file, for "row 14 is wrong" messages. */
  line: number;
  value: string;
  reason: RosterRejectReason;
}

export interface RosterParseResult {
  /** Header names, or [] for a headerless single-column list. */
  columns: string[];
  /** The column the identifiers were read from; null when headerless. */
  selectedColumn: string | null;
  /** Valid, unique, lower-cased, in file order. */
  identifiers: string[];
  rejects: RosterReject[];
  /** Data rows examined, excluding the header and blank lines. */
  totalRows: number;
}

/** An email local@domain.tld, rejecting the separators a mis-split CSV leaves behind. */
const EMAIL_SHAPE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
/** A CWL username. Deliberately permissive — a false reject locks a real
 *  student out of the course, which is far worse than letting a typo through
 *  to the (harmless) "not on roster" path. */
const CWL_SHAPE = /^[a-z0-9][a-z0-9._-]{1,31}$/;
const ALL_DIGITS = /^\d+$/;

/**
 * The single source of truth for "is this a usable roster identifier". Used by
 * both the file import and the pasted-textarea path so the two cannot drift.
 */
export function classifyIdentifier(
  raw: string,
): { ok: true; identifier: string } | { ok: false; reason: RosterRejectReason } {
  const value = raw.trim().toLowerCase();
  if (value.includes('@')) {
    return EMAIL_SHAPE.test(value) ? { ok: true, identifier: value } : { ok: false, reason: 'malformed-email' };
  }
  // Checked before the shape test so an all-digit value gets the specific
  // "that's a student number" reason rather than a generic one — the whole
  // reason an instructor can self-diagnose this instead of filing a ticket.
  if (ALL_DIGITS.test(value)) return { ok: false, reason: 'student-number' };
  return CWL_SHAPE.test(value) ? { ok: true, identifier: value } : { ok: false, reason: 'invalid-characters' };
}

/** Header cells that name an identifier column, matched against the whole cell.
 *  Anchored on purpose: a substring test on 'id' or 'user' also matches real
 *  usernames, which would read a headerless list as a header row. */
const IDENTIFIER_HEADERS = [
  /^e-?mail(\s*address)?$/i,
  /^mail$/i,
  /^cwl(\s*(id|login|login\s*name|username|user\s*name))?$/i,
  /^user(\s*(name|id))?$/i,
  /^login(\s*name)?$/i,
  /^identifiers?$/i,
];

/** Columns that look like an identifier column but are not one. Scored down so
 *  a Workday export with both 'Student Number' and 'Email' picks Email. */
const NON_IDENTIFIER_HEADERS = [/^student(\s*(number|id|no\.?))?$/i, /^id$/i, /^number$/i, /^name$/i];

function headerWeight(header: string): number {
  const cell = header.trim();
  if (IDENTIFIER_HEADERS.some((pattern) => pattern.test(cell))) return 5;
  if (NON_IDENTIFIER_HEADERS.some((pattern) => pattern.test(cell))) return -5;
  return 0;
}

/** Any cell naming a known identifier column, or a known non-identifier one. */
function isKnownHeaderCell(cell: string): boolean {
  return headerWeight(cell) !== 0;
}

function readRows(text: string): string[][] {
  return parseCsv(text, {
    bom: true,
    // Workday exports are not always rectangular, and a trailing comma should
    // not abort the whole import.
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: true,
    trim: true,
  }) as string[][];
}

/**
 * Decide whether row 0 names the columns.
 *
 * Multi-column files always carry a header in practice (nothing exports a bare
 * grid), so the interesting case is the single-column list — which is what the
 * old copy-paste flow produced, and which usually has no header at all.
 */
function hasHeaderRow(rows: string[][]): boolean {
  const first = rows[0]?.map((cell) => cell.trim()).filter(Boolean) ?? [];
  if (first.length === 0) return false;
  if (first.length > 1) return true;
  return isKnownHeaderCell(first[0]!) || !classifyIdentifier(first[0]!).ok;
}

/** Pick the column most likely to hold identifiers: mostly by how many of its
 *  values actually validate, nudged by what the header is called. */
function pickColumn(headers: string[], dataRows: string[][]): number {
  let bestIndex = 0;
  let bestScore = -Infinity;

  for (let index = 0; index < headers.length; index += 1) {
    const values = dataRows.map((row) => (row[index] ?? '').trim()).filter(Boolean);
    const valid = values.filter((value) => classifyIdentifier(value).ok).length;
    const validRate = values.length === 0 ? 0 : valid / values.length;
    const score = validRate * 10 + headerWeight(headers[index] ?? '');
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return bestIndex;
}

/**
 * Parse an uploaded roster file into identifiers plus per-row rejects.
 *
 * `column`, when given and present in the file, overrides auto-detection — the
 * UI offers it so an instructor can correct a wrong guess without re-exporting.
 */
export function parseRosterFile(text: string, column?: string): RosterParseResult {
  const rows = readRows(text);
  if (rows.length === 0) {
    return { columns: [], selectedColumn: null, identifiers: [], rejects: [], totalRows: 0 };
  }

  const headed = hasHeaderRow(rows);
  const headers = headed ? (rows[0] ?? []).map((cell) => cell.trim()) : [];
  const dataRows = headed ? rows.slice(1) : rows;
  // 1-based, and one further line down when a header was consumed, so a reject
  // points at the line the instructor sees in their spreadsheet.
  const lineOffset = headed ? 2 : 1;

  const requested = column ? headers.findIndex((header) => header === column) : -1;
  const columnIndex = requested >= 0
    ? requested
    : headed
      ? pickColumn(headers, dataRows)
      : 0;

  const identifiers: string[] = [];
  const rejects: RosterReject[] = [];
  const seen = new Set<string>();
  let totalRows = 0;

  dataRows.forEach((row, offset) => {
    const value = (row[columnIndex] ?? '').trim();
    if (!value) return; // A blank cell is not an error, just an empty row.
    totalRows += 1;
    const line = offset + lineOffset;

    const verdict = classifyIdentifier(value);
    if (!verdict.ok) {
      rejects.push({ line, value, reason: verdict.reason });
      return;
    }
    if (seen.has(verdict.identifier)) {
      rejects.push({ line, value, reason: 'duplicate' });
      return;
    }
    seen.add(verdict.identifier);
    identifiers.push(verdict.identifier);
  });

  return {
    columns: headers,
    selectedColumn: headed ? (headers[columnIndex] ?? null) : null,
    identifiers,
    rejects,
    totalRows,
  };
}

/**
 * The pasted-textarea equivalent: one identifier per line, same rules. Keeps
 * the copy-paste path from silently accepting what the upload path rejects.
 */
export function classifyIdentifierList(values: string[]): { identifiers: string[]; rejects: RosterReject[] } {
  const identifiers: string[] = [];
  const rejects: RosterReject[] = [];
  const seen = new Set<string>();

  values.forEach((raw, index) => {
    const value = raw.trim();
    if (!value) return;
    const line = index + 1;

    const verdict = classifyIdentifier(value);
    if (!verdict.ok) {
      rejects.push({ line, value, reason: verdict.reason });
      return;
    }
    if (seen.has(verdict.identifier)) return; // putRoster dedupes anyway.
    seen.add(verdict.identifier);
    identifiers.push(verdict.identifier);
  });

  return { identifiers, rejects };
}
