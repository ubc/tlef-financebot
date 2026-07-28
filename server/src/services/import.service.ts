import { parse as parseCsv } from 'csv-parse/sync';
import { XMLParser } from 'fast-xml-parser';
import type { ObjectId } from 'mongodb';
import { completeJson } from '../components/genai/llm';
import { losCol, themesCol } from '../components/mongodb/collections';
import { executeGenerate } from '../components/param-worker';
import type {
  Difficulty,
  OptionRole,
  QuestionLabel,
  QuestionOption,
  QuestionType,
} from '../types/domain';
import { substituteParams } from './params.service';
import { createQuestion } from './questions.service';

export type ImportFormat = 'csv' | 'json' | 'qti';

export interface ImportCandidateOption {
  key: string;
  text: string;
  role?: OptionRole;
  explanation?: string;
}

export interface ImportCandidate {
  type: QuestionType | 'other';
  stem: string;
  options: ImportCandidateOption[];
  correctKey: string;
  difficulty?: Difficulty;
  parameterizable: boolean;
}

export interface ImportFailure {
  line: number | string;
  reason: string;
}

export interface ImportParseResult {
  candidates: ImportCandidate[];
  failures: ImportFailure[];
}

export interface ScriptMigrationInput {
  type: QuestionType;
  stem: string;
  options: ImportCandidateOption[];
  correctKey: string;
  difficulty?: Difficulty;
  script: string;
}

export interface ScriptMigrationResult {
  questionId?: ObjectId;
  sampleValues: Record<string, number>;
  sampleStem: string;
  sampleOptions: Array<{ key: string; text: string; explanation: string }>;
  mismatches: string[];
}

interface RawCandidate {
  type?: unknown;
  stem?: unknown;
  options?: unknown;
  correctKey?: unknown;
  difficulty?: unknown;
}

interface ConvertedCandidate {
  type: unknown;
  stem: unknown;
  options: unknown;
  correctKey: unknown;
  difficulty?: unknown;
}

const DIFFICULTIES = new Set<Difficulty>(['easy', 'medium', 'hard']);
const WRONG_ROLES = new Set<OptionRole>([
  'common-misconception',
  'partially-correct',
  'clearly-wrong',
]);
const SCRIPT_MIGRATION_SAMPLE_SEED = 20260728;

class CandidateError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function serviceError(status: number, message: string, cause?: unknown): Error {
  return Object.assign(new Error(message, cause === undefined ? undefined : { cause }), { status });
}

function candidateType(value: unknown): QuestionType | 'other' | undefined {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_\s/]+/g, '-');
  if (normalized === 'mcq' || normalized === 'multiple-choice') return 'mcq';
  if (
    normalized === 'true-false' ||
    normalized === 'truefalse' ||
    normalized === 'tf' ||
    normalized === 't-f' ||
    normalized === 'boolean'
  ) {
    return 'true-false';
  }
  if (normalized === 'other' || normalized === 'short-answer') return 'other';
  return undefined;
}

function difficulty(value: unknown): Difficulty {
  const normalized = String(value ?? '').trim().toLowerCase();
  return DIFFICULTIES.has(normalized as Difficulty) ? (normalized as Difficulty) : 'medium';
}

function optionArray(value: unknown): ImportCandidateOption[] {
  if (!Array.isArray(value)) throw new CandidateError('options-must-be-an-array');
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new CandidateError('invalid-option');
    const raw = entry as Record<string, unknown>;
    return {
      key: String(raw.key ?? '').trim().toUpperCase(),
      text: String(raw.text ?? '').trim(),
      ...(WRONG_ROLES.has(raw.role as OptionRole) ? { role: raw.role as OptionRole } : {}),
      explanation: String(raw.explanation ?? '').trim(),
    };
  });
}

function normalizeCandidate(raw: RawCandidate): ImportCandidate {
  const type = candidateType(raw.type);
  if (!type) throw new CandidateError('unsupported-question-type');

  const stem = String(raw.stem ?? '').trim();
  if (!stem) throw new CandidateError('stem-is-required');

  const options = optionArray(raw.options ?? []);
  const correctKey = String(raw.correctKey ?? '').trim().toUpperCase();

  if (type === 'other') {
    return {
      type,
      stem,
      options,
      correctKey,
      difficulty: difficulty(raw.difficulty),
      parameterizable: isParameterizable(stem),
    };
  }

  const expected = type === 'mcq' ? 4 : 2;
  if (options.length !== expected) {
    throw new CandidateError(`expected-${expected}-options`);
  }
  if (options.some((option) => !option.key || !option.text)) {
    throw new CandidateError('option-key-and-text-required');
  }
  if (new Set(options.map((option) => option.key)).size !== options.length) {
    throw new CandidateError('duplicate-option-key');
  }
  if (!correctKey || !options.some((option) => option.key === correctKey)) {
    throw new CandidateError('correct-option-not-found');
  }

  return {
    type,
    stem,
    options,
    correctKey,
    difficulty: difficulty(raw.difficulty),
    parameterizable: isParameterizable(stem),
  };
}

function pushCandidate(
  result: ImportParseResult,
  raw: RawCandidate,
  line: number | string,
): void {
  try {
    result.candidates.push(normalizeCandidate(raw));
  } catch (error) {
    result.failures.push({
      line,
      reason: error instanceof CandidateError ? error.code : 'invalid-candidate',
    });
  }
}

/**
 * IN-Q01/IN-Q09 preview hint. A stem is a useful conversion candidate only
 * when it contains at least two distinct numeric values and an explicit
 * money/percentage/rate cue.
 */
export function isParameterizable(stem: string): boolean {
  const literals = stem.match(/-?(?:\$\s*)?\d[\d,]*(?:\.\d+)?%?/g) ?? [];
  const distinct = new Set(
    literals
      .map((literal) => Number(literal.replace(/[$,%\s]/g, '')))
      .filter((value) => Number.isFinite(value)),
  );
  return distinct.size >= 2 && /\$\s*\d|%|\brate\b/i.test(stem);
}

function parseCsvImport(raw: string): ImportParseResult {
  const result: ImportParseResult = { candidates: [], failures: [] };
  let rows: Array<Record<string, string>>;
  try {
    rows = parseCsv(raw, {
      bom: true,
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    }) as Array<Record<string, string>>;
  } catch (error) {
    return {
      candidates: [],
      failures: [
        {
          line: 'file',
          reason: error instanceof Error ? `invalid-csv:${error.message}` : 'invalid-csv',
        },
      ],
    };
  }

  rows.forEach((row, index) => {
    const type = candidateType(row.type);
    const trueFalse = type === 'true-false';
    const sourceKeys = trueFalse ? ['A', 'B'] : ['A', 'B', 'C', 'D'];
    const targetKeys = trueFalse ? ['T', 'F'] : sourceKeys;
    const options = sourceKeys
      .map((sourceKey, optionIndex) => ({
        key: targetKeys[optionIndex],
        text: row[`option${sourceKey}`] ?? '',
        explanation: row[`explanation${sourceKey}`] ?? '',
      }))
      .filter((option) => option.text.trim() !== '');

    let correctKey = String(row.correct ?? '').trim().toUpperCase();
    if (trueFalse) {
      if (correctKey === 'A' || correctKey === 'TRUE') correctKey = 'T';
      if (correctKey === 'B' || correctKey === 'FALSE') correctKey = 'F';
    }

    pushCandidate(
      result,
      {
        type: row.type,
        stem: row.stem,
        options,
        correctKey,
        difficulty: row.difficulty,
      },
      index + 2,
    );
  });
  return result;
}

function parseJsonImport(raw: string): ImportParseResult {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    return {
      candidates: [],
      failures: [
        {
          line: 'file',
          reason: error instanceof Error ? `invalid-json:${error.message}` : 'invalid-json',
        },
      ],
    };
  }
  if (!Array.isArray(value)) {
    return { candidates: [], failures: [{ line: 'file', reason: 'json-root-must-be-an-array' }] };
  }

  const result: ImportParseResult = { candidates: [], failures: [] };
  value.forEach((entry, index) => {
    pushCandidate(
      result,
      entry && typeof entry === 'object' ? (entry as RawCandidate) : {},
      index + 1,
    );
  });
  return result;
}

function collectByKey(value: unknown, key: string, output: unknown[]): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectByKey(entry, key, output));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
    if (entryKey === key) {
      if (Array.isArray(entryValue)) output.push(...entryValue);
      else output.push(entryValue);
    }
    collectByKey(entryValue, key, output);
  }
}

function textOf(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join(' ').trim();
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record['#text'] !== undefined) return textOf(record['#text']);
    return Object.entries(record)
      .filter(([key]) => key !== 'identifier' && key !== 'responseIdentifier')
      .map(([, entry]) => textOf(entry))
      .filter(Boolean)
      .join(' ')
      .trim();
  }
  return '';
}

function parseQtiImport(raw: string): ImportParseResult {
  let parsed: unknown;
  try {
    parsed = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
      removeNSPrefix: true,
      textNodeName: '#text',
      trimValues: true,
    }).parse(raw) as unknown;
  } catch (error) {
    return {
      candidates: [],
      failures: [
        {
          line: 'file',
          reason: error instanceof Error ? `invalid-qti:${error.message}` : 'invalid-qti',
        },
      ],
    };
  }

  const items: unknown[] = [];
  collectByKey(parsed, 'assessmentItem', items);
  if (items.length === 0) {
    return { candidates: [], failures: [{ line: 'file', reason: 'qti-has-no-assessment-items' }] };
  }

  const result: ImportParseResult = { candidates: [], failures: [] };
  items.forEach((entry, index) => {
    const item = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
    const line = String(item.identifier ?? `item-${index + 1}`);
    const interactions: unknown[] = [];
    collectByKey(item.itemBody, 'choiceInteraction', interactions);
    const interaction =
      interactions[0] && typeof interactions[0] === 'object'
        ? (interactions[0] as Record<string, unknown>)
        : {};
    const choices = Array.isArray(interaction.simpleChoice)
      ? interaction.simpleChoice
      : interaction.simpleChoice
        ? [interaction.simpleChoice]
        : [];
    const options = choices.map((choice, optionIndex) => {
      const record =
        choice && typeof choice === 'object' ? (choice as Record<string, unknown>) : {};
      return {
        key: String(record.identifier ?? String.fromCharCode(65 + optionIndex))
          .trim()
          .toUpperCase(),
        text: textOf(choice),
        explanation: '',
      };
    });

    const declarations = Array.isArray(item.responseDeclaration)
      ? item.responseDeclaration
      : item.responseDeclaration
        ? [item.responseDeclaration]
        : [];
    const responseIdentifier = String(interaction.responseIdentifier ?? '');
    const declaration =
      declarations.find(
        (candidate) =>
          candidate &&
          typeof candidate === 'object' &&
          String((candidate as Record<string, unknown>).identifier ?? '') === responseIdentifier,
      ) ?? declarations[0];
    const declarationRecord =
      declaration && typeof declaration === 'object'
        ? (declaration as Record<string, unknown>)
        : {};
    const correctKey = textOf(
      declarationRecord.correctResponse &&
        typeof declarationRecord.correctResponse === 'object'
        ? (declarationRecord.correctResponse as Record<string, unknown>).value
        : undefined,
    ).toUpperCase();
    const trueFalse =
      options.length === 2 &&
      options.map((option) => option.text.toLowerCase()).join('|') === 'true|false';

    pushCandidate(
      result,
      {
        type: trueFalse ? 'true-false' : 'mcq',
        stem: textOf(interaction.prompt),
        options,
        correctKey,
        difficulty: 'medium',
      },
      line,
    );
  });
  return result;
}

export function parseImport(format: ImportFormat, raw: string): ImportParseResult {
  switch (format) {
    case 'csv':
      return parseCsvImport(raw);
    case 'json':
      return parseJsonImport(raw);
    case 'qti':
      return parseQtiImport(raw);
    default:
      throw new Error(`unsupported-import-format:${String(format)}`);
  }
}

function questionOptions(candidate: ImportCandidate): QuestionOption[] {
  return candidate.options.map((option) => ({
    key: option.key,
    text: option.text,
    role:
      option.key === candidate.correctKey
        ? 'correct'
        : WRONG_ROLES.has(option.role as OptionRole)
          ? (option.role as OptionRole)
          : 'common-misconception',
    explanation: option.explanation ?? '',
  }));
}

async function convertOther(candidate: ImportCandidate): Promise<ImportCandidate> {
  const converted = await completeJson<ConvertedCandidate>(
    [
      'Convert this short-answer question into either a four-option MCQ or a two-option True/False question.',
      'Return JSON only with: type ("mcq" or "true-false"), stem, options [{key,text,explanation}], correctKey, difficulty.',
      'Exactly one option key must match correctKey.',
      `Source question: ${candidate.stem}`,
    ].join('\n'),
    {
      systemPrompt:
        'You convert instructor-supplied questions without adding publication approval. Preserve the learning intent.',
      temperature: 0,
    },
  );
  const normalized = normalizeCandidate(converted as RawCandidate);
  if (normalized.type === 'other') throw new Error('auto-conversion-returned-other');
  return normalized;
}

async function assignmentIds(
  courseId: ObjectId,
  opts: { themeId?: ObjectId; loId?: ObjectId },
): Promise<{ themeIds: ObjectId[]; loIds: ObjectId[] }> {
  if (opts.loId) {
    const lo = await losCol().findOne({ _id: opts.loId });
    if (!lo) throw serviceError(404, 'lo-not-found');
    if (!lo.courseId.equals(courseId)) throw serviceError(400, 'lo-not-in-course');
    if (opts.themeId && !lo.themeId.equals(opts.themeId)) {
      throw serviceError(400, 'lo-not-in-theme');
    }
    return { themeIds: [lo.themeId], loIds: [lo._id] };
  }
  if (opts.themeId) {
    const theme = await themesCol().findOne({ _id: opts.themeId });
    if (!theme) throw serviceError(404, 'theme-not-found');
    if (!theme.courseId.equals(courseId)) throw serviceError(400, 'theme-not-in-course');
    return { themeIds: [theme._id], loIds: [] };
  }
  return { themeIds: [], loIds: [] };
}

export async function commitImport(
  courseId: ObjectId,
  candidates: ImportCandidate[],
  opts: { themeId?: ObjectId; loId?: ObjectId; byPuid: string },
): Promise<{ imported: number; autoConverted: number }> {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw serviceError(400, 'invalid-import-candidate:no-candidates');
  }

  let normalized: ImportCandidate[];
  try {
    // Treat the preview response as untrusted input when it comes back from
    // the browser. Validate the entire batch before any LLM or Mongo write.
    normalized = candidates.map((candidate) => normalizeCandidate(candidate));
  } catch (error) {
    const code = error instanceof CandidateError ? error.code : 'invalid-candidate';
    throw serviceError(400, `invalid-import-candidate:${code}`, error);
  }

  const assignment = await assignmentIds(courseId, opts);
  const prepared: Array<{ candidate: ImportCandidate; autoConverted: boolean }> = [];
  for (const candidate of normalized) {
    try {
      prepared.push({
        candidate: candidate.type === 'other' ? await convertOther(candidate) : candidate,
        autoConverted: candidate.type === 'other',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'invalid-candidate';
      throw serviceError(502, `auto-conversion-failed:${message}`, error);
    }
  }

  let autoConverted = 0;
  for (const item of prepared) {
    const labels: QuestionLabel[] = [];
    if (item.candidate.parameterizable) labels.push('convertible-to-parameterized');
    if (item.autoConverted) {
      labels.push('auto-converted');
      autoConverted += 1;
    }
    await createQuestion({
      courseId,
      loIds: assignment.loIds,
      themeIds: assignment.themeIds,
      type: item.candidate.type as QuestionType,
      stem: item.candidate.stem,
      options: questionOptions(item.candidate),
      difficulty: item.candidate.difficulty ?? 'medium',
      createdBy: opts.byPuid,
      labels,
    });
  }

  return { imported: prepared.length, autoConverted };
}

function placeholderNames(text: string): string[] {
  const names: string[] = [];
  const pattern = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
  for (const match of text.matchAll(pattern)) {
    if (!names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

async function inspectScriptMigration(input: ScriptMigrationInput): Promise<{
  candidate: ImportCandidate;
  preview: ScriptMigrationResult;
}> {
  if (!input.script.trim()) {
    throw serviceError(400, 'invalid-script-migration:script-is-required');
  }

  let candidate: ImportCandidate;
  try {
    candidate = normalizeCandidate({
      type: input.type,
      stem: input.stem,
      options: input.options,
      correctKey: input.correctKey,
      difficulty: input.difficulty,
    });
  } catch (error) {
    const code = error instanceof CandidateError ? error.code : 'invalid-candidate';
    throw serviceError(400, `invalid-script-migration:${code}`, error);
  }
  if (candidate.type === 'other') {
    throw serviceError(400, 'invalid-script-migration:unsupported-question-type');
  }

  let sampleValues: Record<string, number>;
  try {
    sampleValues = await executeGenerate(input.script, SCRIPT_MIGRATION_SAMPLE_SEED);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'sandbox-rejected-script';
    throw serviceError(400, `script-validation-failed:${message}`, error);
  }

  const stemPlaceholders = placeholderNames(candidate.stem);
  const templatePlaceholders = placeholderNames(
    [
      candidate.stem,
      ...candidate.options.flatMap((option) => [
        option.text,
        option.explanation ?? '',
      ]),
    ].join('\n'),
  );
  const generatedNames = Object.keys(sampleValues);
  const mismatches = [
    ...generatedNames
      .filter((name) => !stemPlaceholders.includes(name))
      .map((name) => `vars.${name} has no matching {{${name}}} placeholder in the stem`),
    ...templatePlaceholders
      .filter((name) => !Object.prototype.hasOwnProperty.call(sampleValues, name))
      .map((name) => `{{${name}}} has no matching generated vars.${name}`),
  ];

  return {
    candidate,
    preview: {
      sampleValues,
      sampleStem: substituteParams(candidate.stem, sampleValues),
      sampleOptions: candidate.options.map((option) => ({
        key: option.key,
        text: substituteParams(option.text, sampleValues),
        explanation: substituteParams(option.explanation ?? '', sampleValues),
      })),
      mismatches,
    },
  };
}

/** Runs one deterministic sandbox sample and returns review-only rendered data. */
export async function previewScriptMigration(
  input: ScriptMigrationInput,
): Promise<ScriptMigrationResult> {
  return (await inspectScriptMigration(input)).preview;
}

/**
 * Revalidates the reviewed template and creates a Draft only when every
 * generated variable and every stem placeholder match.
 */
export async function migrateScript(
  courseId: ObjectId,
  input: ScriptMigrationInput & {
    themeId?: ObjectId;
    loId?: ObjectId;
    byPuid: string;
  },
): Promise<ScriptMigrationResult> {
  const { candidate, preview } = await inspectScriptMigration(input);
  if (preview.mismatches.length > 0) return preview;

  const assignment = await assignmentIds(courseId, input);
  const { questionId } = await createQuestion({
    courseId,
    loIds: assignment.loIds,
    themeIds: assignment.themeIds,
    type: candidate.type as QuestionType,
    stem: candidate.stem,
    options: questionOptions(candidate),
    difficulty: candidate.difficulty ?? 'medium',
    createdBy: input.byPuid,
    generateScript: input.script,
  });

  return { ...preview, questionId };
}
