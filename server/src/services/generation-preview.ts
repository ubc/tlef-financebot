import type { ObjectId } from 'mongodb';
import type { QuestionGenerationRun } from '../types/domain';
import { updateContentRun } from './content-runs.service';

/** Parse an incomplete JSON value without exposing arbitrary model fields.
 * Retain only public question content; nested metadata and reasoning are ignored. */
export function partialVisibleJson(json: string): Record<string, unknown> | undefined {
  const source = json.slice(0, 200000);
  let cursor = source.indexOf('{');
  const space = () => { while (/\s/.test(source[cursor] ?? '') && cursor < source.length) cursor++; };
  const value = (depth: number): unknown => {
    if (depth > 12 || cursor >= source.length) return undefined;
    space();
    if (source[cursor] === '"') { const result = readString(source, cursor+1); cursor = result.end+1; return result.value; }
    if (source[cursor] === '{') {
      cursor++;
      const object: Record<string,unknown> = Object.create(null);
      for (let keys = 0; keys < 100 && cursor < source.length; keys++) {
        space(); if (source[cursor] !== '"') break;
        const key = readString(source,cursor+1); if (!key.closed) break;
        cursor = key.end+1; space(); if (source[cursor++] !== ':') break;
        object[key.value] = value(depth+1); space();
        if (source[cursor] !== ',') break;
        cursor++;
      }
      if (source[cursor] === '}') cursor++;
      return object;
    }
    if (source[cursor] === '[') {
      cursor++; const array: unknown[] = [];
      for (let items = 0; items < 100 && cursor < source.length; items++) {
        space(); if (source[cursor] === ']') break;
        const before = cursor; array.push(value(depth+1)); if (cursor === before) break;
        space(); if (source[cursor] !== ',') break;
        cursor++;
      }
      if (source[cursor] === ']') cursor++;
      return array;
    }
    // Numeric/formula metadata is not needed by the live authoring preview.
    while (cursor < source.length && !/[\s,}\]]/.test(source[cursor])) cursor++;
    return undefined;
  };
  const root = cursor < 0 ? undefined : value(0) as Record<string,unknown> | undefined;
  return root;
}

export function partialQuestion(json: string): Omit<NonNullable<QuestionGenerationRun['preview']>, 'item' | 'attempt'> {
  const root = partialVisibleJson(json);
  const bounded = (field: unknown, max = 4000) => typeof field === 'string' ? field.slice(0,max) : '';
  const options = Array.isArray(root?.options) ? root.options.slice(0,8).filter(item => item && typeof item === 'object' && !Array.isArray(item)).map(item => ({
    key: bounded(item.key,8), text: bounded(item.text), role: bounded(item.role,40), explanation: bounded(item.explanation),
  })) : [];
  return { stem: bounded(root?.stem,12000), ...(typeof root?.difficulty === 'string' ? { difficulty: bounded(root.difficulty,30) } : {}), ...(options.length ? { options } : {}) };
}
export function partialStem(json: string): string { return partialQuestion(json).stem; }
function readString(text: string, start: number): { value: string; end: number; closed: boolean } {
  let value = '';
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (char === '"') return { value, end: i, closed: true };
    if (char !== '\\') { value += char; continue; }
    if (++i >= text.length) break;
    const escaped = text[i];
    if (escaped === 'u') {
      const digits = text.slice(i + 1, i + 5);
      if (digits.length < 4) break;
      if (/^[0-9a-f]{4}$/i.test(digits)) { value += String.fromCharCode(parseInt(digits,16)); i += 4; }
      else value += '\\u';
    } else {
      const escapes: Record<string,string> = { '"': '"', '\\': '\\', '/': '/', n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
      value += escapes[escaped] ?? `\\${escaped}`;
    }
  }
  // Avoid displaying half a unicode surrogate pair.
  return { value: value.replace(/[\uD800-\uDBFF]$/, ''), end: text.length, closed: false };
}

/** Coalesce provider fragments to at most four durable writes per second.
 * Every write is serialized and drained before the caller advances its stage. */
export async function withGenerationPreview<T>(runId: ObjectId, item: number, generate: (onText: (text: string) => void) => Promise<T>): Promise<T> {
  let attempt = 0;
  let lastContent = '';
  let pending: QuestionGenerationRun['preview'];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing: Promise<void> = Promise.resolve();
  let failure: unknown;
  const flush = () => {
    const next = pending; pending = undefined;
    if (!next || failure) return;
    writing = writing.then(async () => { if (!failure) await updateContentRun(runId, { preview: next }); }).catch(error => { failure = error; });
  };
  const onText = (text: string) => {
    if (failure) return;
    if (!text) { attempt++; lastContent = ''; }
    const preview = partialQuestion(text);
    const content = JSON.stringify(preview);
    if (text && content === lastContent) return;
    lastContent = content;
    pending = { item, attempt, ...preview };
    if (!timer) timer = setTimeout(() => { timer = undefined; flush(); }, 250);
  };
  let result!: T;
  let generationError: unknown;
  let generationFailed = false;
  try { result = await generate(onText); }
  catch (error) { generationError = error; generationFailed = true; }
  finally {
    if (timer) clearTimeout(timer);
    flush(); await writing;
  }
  if (failure) throw failure;
  if (generationFailed) throw generationError;
  return result;
}
