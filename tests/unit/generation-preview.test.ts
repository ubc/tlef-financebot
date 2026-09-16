jest.mock('../../server/src/services/content-runs.service', () => ({ updateContentRun: jest.fn() }));
import { ObjectId } from 'mongodb';
import { updateContentRun } from '../../server/src/services/content-runs.service';
import { partialStem, partialQuestion, withGenerationPreview } from '../../server/src/services/generation-preview';
const update = jest.mocked(updateContentRun);
beforeEach(() => { jest.useFakeTimers(); update.mockReset(); update.mockResolvedValue({} as never); });
afterEach(() => jest.useRealTimers());

it('extracts only top-level text across incomplete JSON and escape boundaries', () => {
  expect(partialStem('{"reasoning":"Private notes", "nested":{"stem":"wrong"},"stem":"A force')).toBe('A force');
  expect(partialStem('{"stem":"Use \\')).toBe('Use ');
  expect(partialStem('{"stem":"A \\u03')).toBe('A ');
  expect(partialStem('{"stem":"A \\u03b1 and \\"quoted\\"')).toBe('A α and "quoted"');
  expect(partialStem('{"reasoning":"unrelated words')).toBe('');
  expect(partialStem('{"nested":{"stem":"wrong"}}')).toBe('');
  expect(partialStem('{"stem":"'+ 'x'.repeat(20000))).toHaveLength(12000);
});

it('coalesces fragments, persists before completion, and drains retry resets in order', async () => {
  const id = new ObjectId();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let emit!: (text: string) => void;
  const work = withGenerationPreview(id, 0, async callback => { emit = callback; await gate; return 'done'; });
  emit(''); emit('{"stem":"First'); emit('{"stem":"First draft');
  await jest.advanceTimersByTimeAsync(250);
  expect(update).toHaveBeenCalledWith(id, { preview: { item: 0, attempt: 1, stem: 'First draft' } });
  emit(''); emit('{"stem":"Revised');
  release(); await expect(work).resolves.toBe('done');
  expect(update.mock.calls[1][1]).toEqual({ preview: { item: 0, attempt: 2, stem: 'Revised' } });
  await jest.runAllTimersAsync(); expect(update).toHaveBeenCalledTimes(2);
});

it('surfaces a terminal-run conflict without unhandled writes or later stage advancement', async () => {
  update.mockRejectedValue(new Error('content-run-conflict'));
  await expect(withGenerationPreview(new ObjectId(), 1, async emit => { emit(''); emit('{"stem":"A'); return 'candidate'; })).rejects.toThrow('content-run-conflict');
  await jest.runAllTimersAsync(); expect(update).toHaveBeenCalledTimes(1);
});


it('streams option text, proposed answer and explanations without nested/internal fields', () => {
  const json = JSON.stringify({ stem: 'Which force?', difficulty: 'easy', reasoning: 'private', nested: { options: [{ text: 'wrong' }] }, options: [{ key: 'A', text: 'A quoted "force".', role: 'correct', explanation: 'Add the vectors.' }, { key: 'B', text: 'They always cancel.', role: 'clearly-wrong', explanation: 'Magnitude matters.' }] });
  const complete = partialQuestion(json);
  expect(complete).toEqual({ stem: 'Which force?', difficulty: 'easy', options: [{ key: 'A', text: 'A quoted "force".', role: 'correct', explanation: 'Add the vectors.' }, { key: 'B', text: 'They always cancel.', role: 'clearly-wrong', explanation: 'Magnitude matters.' }] });
  const prefix = json.slice(0,json.indexOf('Add the vectors.')+7);
  expect(partialQuestion(prefix).options?.[0]).toMatchObject({ role: 'correct', explanation: 'Add the' });
  for (let i=1;i<json.length;i++) expect(() => partialQuestion(json.slice(0,i))).not.toThrow();
  const huge = partialQuestion(JSON.stringify({options:Array.from({length:20},()=>({text:'x'.repeat(5000),explanation:'y'.repeat(5000)}))}));
  expect(huge.options).toHaveLength(8); expect(huge.options?.[0].text).toHaveLength(4000);
});

it('publishes option-only changes after the stem is complete and resets all fields on retry', async () => {
  await withGenerationPreview(new ObjectId(),0,async emit => {
    emit(''); emit('{"stem":"Done"}'); await jest.advanceTimersByTimeAsync(250);
    emit('{"stem":"Done","options":[{"key":"A","text":"First answer'); await jest.advanceTimersByTimeAsync(250);
    emit(''); emit('{"stem":"New draft');
  });
  expect(update.mock.calls[1][1].preview?.options?.[0].text).toBe('First answer');
  expect(update.mock.calls[2][1].preview).toEqual({item:0,attempt:2,stem:'New draft'});
});
