jest.mock('../../server/src/components/mongodb/collections', () => ({ sourceEvidenceExtractionsCol: jest.fn() }));
jest.mock('../../server/src/services/authoring-commit.service', () => ({ authoringCollection: (value: unknown) => value, withCourseAuthoringWrite: jest.fn() }));
import { ObjectId } from 'mongodb';
import { legacySourcePassages, splitSourcePassages, resolveSourcePassagePolicy, SOURCE_PASSAGE_POLICY, LEGACY_SOURCE_PASSAGE_POLICY } from '../../server/src/services/source-passages';
import { sourceExtractionIdentity, readSourceExtraction } from '../../server/src/services/source-evidence-cache.service';
import { sourceEvidenceExtractionsCol } from '../../server/src/components/mongodb/collections';

/** Exact public-source section C50.S1, Chapter 10 physical PDF page 32.
 * Structural regression only: no model output or table interpretation. */
const table = [
  'Class B', '                   shares offer', '                   the same', '                   amount as a',
  '                   stock', '                   dividend &', '                   can be', '                   converted to',
  '                   class A', 'Aswath Damodaran   shares 177',
  '\fCompany                      Premium for cash dividend shares',
  'Consolidated Bathurst        + 19.30%', 'Donfasco                     + 13.30%',
  'Dome Petroleum               + 0.30%', 'Imperial Oil                 +12.10%',
  'Newfoundland Light & Power   + 1.80%', 'Royal Trustco                + 17.30%',
  'Stelco                       + 2.70%', 'TransAlta                    +1.10%',
  'Average across companies     + 7.54%',
].join('\n');
const section = { id: 'C50.S1', text: table };
const compact = (value: string) => value.replace(/\s/g, '');
function invariant(text: string): void {
  const input = { id: 'C1.S1', text };
  const output = splitSourcePassages(input);
  expect(output).toEqual(splitSourcePassages(input));
  expect(output.map(row => row.id)).toEqual(output.map((_, index) => `C1.S1.P${index + 1}`));
  expect(output.every(row => row.text.length > 0 && row.text.length <= 500 && text.includes(row.text))).toBe(true);
  expect(output.map(row => compact(row.text)).join('')).toBe(compact(text));
}

it('preserves the complete original table row instead of splitting its company name at the cap', () => {
  expect(table).toHaveLength(666);
  const old = legacySourcePassages(section);
  expect(old.map(row => row.text.length)).toEqual([494, 171]);
  expect(old[0].text.endsWith('Newfoundland')).toBe(true);
  expect(old[1].text.startsWith('Light & Power   + 1.80%')).toBe(true);
  const current = splitSourcePassages(section);
  expect(current.map(row => row.text.length)).toEqual([481, 184]);
  expect(current[1].text.startsWith('Newfoundland Light & Power   + 1.80%')).toBe(true);
  invariant(table);
});

it.each([
  ['plain prose', 'An exact source statement with no boundary change.'],
  ['repeated lines', 'same original row\n'.repeat(120)],
  ['CRLF', `${'A'.repeat(470)}\r\nName with spaces   + 1.80%\r\nNext row   + 2.70%`],
  ['form feed', `${'A'.repeat(480)}\fSource row   12%\nTail\n${'B'.repeat(500)}`],
  ['overlong line', `Heading\n${'longword '.repeat(200)}`],
  ['overlong token', 'T'.repeat(1601)],
  ['only whitespace', ' \r\n\f\t'.repeat(400)],
  ['empty', ''],
  ['Unicode', `${'A'.repeat(499)}😀 ${'β'.repeat(499)}🧮${'中'.repeat(800)}`],
] as const)('keeps deterministic bounded exact quotes and every non-whitespace character: %s', (_name, text) => invariant(text));

it('does not cut a valid UTF-16 surrogate pair at a 500-code-unit boundary', () => {
  const result = splitSourcePassages({ id: 'C1.S1', text: `${'A'.repeat(499)}😀${'B'.repeat(499)}🧮` });
  expect(result.every(row => !/(?:[\uD800-\uDBFF](?![\uDC00-\uDFFF]))|(?:(?<![\uD800-\uDBFF])[\uDC00-\uDFFF])/.test(row.text))).toBe(true);
});

it('keeps historical aliases explicit and refuses an unknown policy', () => {
  expect(resolveSourcePassagePolicy(undefined)).toBe(LEGACY_SOURCE_PASSAGE_POLICY);
  expect(splitSourcePassages(section, resolveSourcePassagePolicy(undefined))).toEqual(legacySourcePassages(section));
  expect(resolveSourcePassagePolicy(SOURCE_PASSAGE_POLICY)).toBe(SOURCE_PASSAGE_POLICY);
  expect(() => resolveSourcePassagePolicy('future-unknown')).toThrow('source-passage-policy-unsupported');
  expect(() => splitSourcePassages(section, 'future-unknown' as never)).toThrow('source-passage-policy-unsupported');
});

it('changes an exact extraction identity only when the rendered source spans change', () => {
  const base = { courseId: new ObjectId(), materialId: new ObjectId(), sourceTextHash: 'same-originals', parserVersion: 'unchanged-parser', chunkerVersion: 'unchanged-chunker',
    sourceTitle: 'Public source', guidance: '', modelConfiguration: { model: 'no-model-call' }, sections: [{ ...section, chunkIndex: 49 }] };
  const identity = (text: string, passagePolicy: typeof SOURCE_PASSAGE_POLICY | typeof LEGACY_SOURCE_PASSAGE_POLICY) => sourceExtractionIdentity({ ...base, passagePolicy,
    promptText: JSON.stringify(splitSourcePassages({ id: section.id, text }, passagePolicy)) });
  expect(identity(table, SOURCE_PASSAGE_POLICY).cacheKey).not.toBe(identity(table, LEGACY_SOURCE_PASSAGE_POLICY).cacheKey);
  const same = 'A short exact source row.';
  expect(identity(same, SOURCE_PASSAGE_POLICY).cacheKey).toBe(identity(same, LEGACY_SOURCE_PASSAGE_POLICY).cacheKey);
  expect(identity(same, SOURCE_PASSAGE_POLICY).promptTextHash).toBe(identity(same, LEGACY_SOURCE_PASSAGE_POLICY).promptTextHash);
  expect(identity(same, SOURCE_PASSAGE_POLICY).passagePolicy).toBe(SOURCE_PASSAGE_POLICY);
  expect(() => sourceExtractionIdentity({ ...base, passagePolicy: 'future-unknown' as never, promptText: 'same' })).toThrow('source-passage-policy-unsupported');
});

it('refuses an explicitly unknown cached policy before quote admission', async () => {
  const identity = sourceExtractionIdentity({ courseId: new ObjectId(), materialId: new ObjectId(), sourceTextHash: 'same-originals', parserVersion: 'p', chunkerVersion: 'c',
    sourceTitle: 'Source', guidance: '', modelConfiguration: {}, sections: [], promptText: 'same' });
  jest.mocked(sourceEvidenceExtractionsCol).mockReturnValue({ findOne: async () => ({ ...identity, passagePolicy: 'future-unknown', sections: [] }) } as never);
  const validate = jest.fn();
  await expect(readSourceExtraction(identity, validate)).resolves.toBeNull();
  expect(validate).not.toHaveBeenCalled();
});
