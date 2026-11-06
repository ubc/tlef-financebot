/** Source-span policies are structural locators, never interpretations of a
 * table, chart, formula or student learning objective. */
export const SOURCE_PASSAGE_POLICY = 'line-boundary-v2' as const;
export const LEGACY_SOURCE_PASSAGE_POLICY = 'word-boundary-v1' as const;
export type SourcePassagePolicy = typeof SOURCE_PASSAGE_POLICY | typeof LEGACY_SOURCE_PASSAGE_POLICY;
export interface SourcePassage { id: string; text: string }
interface SourceSection { id: string; text: string }
const MAX_PASSAGE_CHARACTERS = 500;

export function resolveSourcePassagePolicy(policy: unknown): SourcePassagePolicy {
  if (policy === undefined || policy === LEGACY_SOURCE_PASSAGE_POLICY) return LEGACY_SOURCE_PASSAGE_POLICY;
  if (policy === SOURCE_PASSAGE_POLICY) return SOURCE_PASSAGE_POLICY;
  throw new Error('source-passage-policy-unsupported');
}

/** Retained receipts without a policy keep their exact historical P aliases. */
export function legacySourcePassages(section: SourceSection): SourcePassage[] {
  const passages: SourcePassage[] = [];
  for (let start = 0; start < section.text.length;) {
    let end = Math.min(start + MAX_PASSAGE_CHARACTERS, section.text.length);
    if (end < section.text.length) {
      const whitespace = section.text.slice(start, end).search(/\s+\S*$/);
      if (whitespace > 250) end = start + whitespace;
    }
    const text = section.text.slice(start, end).trim();
    if (text) passages.push({ id: `${section.id}.P${passages.length + 1}`, text });
    start = end;
  }
  return passages;
}

/** Keep a complete original line together when it fits the existing bound.
 * Overlong lines retain a bounded word fallback; no row ownership is inferred.
 * Every returned quote is still an exact, unnormalized source substring. */
export function splitSourcePassages(section: SourceSection, policy: SourcePassagePolicy = SOURCE_PASSAGE_POLICY): SourcePassage[] {
  if (policy === LEGACY_SOURCE_PASSAGE_POLICY) return legacySourcePassages(section);
  if (policy !== SOURCE_PASSAGE_POLICY) throw new Error('source-passage-policy-unsupported');
  const passages: SourcePassage[] = [];
  for (let start = 0; start < section.text.length;) {
    let end = Math.min(start + MAX_PASSAGE_CHARACTERS, section.text.length);
    if (end < section.text.length) {
      const window = section.text.slice(start, end);
      let lineEnd = 0;
      for (const match of window.matchAll(/\r\n|[\r\n\f]/g)) {
        const offset = match.index!;
        // A CR at the cap is only half of a CRLF delimiter.
        if (match[0] === '\r' && section.text[start + offset + 1] === '\n') continue;
        lineEnd = offset + match[0].length;
      }
      if (lineEnd) end = start + lineEnd;
      else {
        const whitespace = window.search(/\s+\S*$/);
        if (whitespace > 250) end = start + whitespace;
      }
      // The 500-character cap uses JS code units. Never split a valid Unicode
      // surrogate pair when an individual line/token exceeds that cap.
      const before = section.text.charCodeAt(end - 1);
      const after = section.text.charCodeAt(end);
      if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) end--;
    }
    const text = section.text.slice(start, end).trim();
    if (text) passages.push({ id: `${section.id}.P${passages.length + 1}`, text });
    start = end;
  }
  return passages;
}
