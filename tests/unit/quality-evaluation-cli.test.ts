import { mkdtemp, readFile, writeFile, rm, stat, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runEvaluationCli } from '../../scripts/prompt-ab/evaluation/cli';
import { DatasetSchema } from '../../scripts/prompt-ab/evaluation/schema';

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'financebot-evaluation-')); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
const json = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
const write = (path: string, value: unknown) => writeFile(path, JSON.stringify(value), 'utf8');
const demo = async () => { const path = join(directory, 'demo'); await runEvaluationCli(['demo', path], () => {}); return path; };

it('creates an executable synthetic walkthrough with private mapping and no teacher labels or measured usage', async () => {
  const path = await demo();
  const dataset = DatasetSchema.parse(await json(join(path, 'dataset.json')));
  const reviews = await json(join(path, 'reviews.blank.json'));
  const report = await json(join(path, 'report.unreviewed.json'));
  expect(dataset.origin).toBe('synthetic');
  expect(dataset.runs).toHaveLength(dataset.cases.length * 2);
  expect(dataset.runs.every(run => run.usage.totalTokens === null)).toBe(true);
  expect(reviews.labels).toEqual([]);
  expect(reviews.reviewerId).toBe('unassigned');
  expect(report.comparison.teacherLabelsComplete).toBe(false);
  expect(report.arms.every((arm: { supply: { acceptedIndependent: number } }) => arm.supply.acceptedIndependent === 0)).toBe(true);
  const html = await readFile(join(path, 'review.html'), 'utf8');
  expect(html).toContain('Blinded question review');
  expect(html).not.toContain('grounded-memory-v1');
  expect(html).not.toContain(dataset.runs[0].runId);
  expect((await stat(join(path, 'private-review-key.json'))).mode & 0o777).toBe(0o600);
});

it('preserves existing output and reviewer edits instead of overwriting a directory on rerun', async () => {
  const path = await demo();
  const edited = 'PRESERVE_EXISTING_TEACHER_WORK';
  await writeFile(join(path, 'reviews.blank.json'), edited);
  await expect(runEvaluationCli(['demo', path], () => {})).rejects.toThrow('Refusing to overwrite');
  expect(await readFile(join(path, 'reviews.blank.json'), 'utf8')).toBe(edited);
});

it('validates, hashes and prepares a new blinded review while preserving the supplied dataset', async () => {
  const path = await demo();
  const file = join(path, 'dataset.json'); const log = jest.fn();
  await runEvaluationCli(['validate', file], log);
  expect(log).toHaveBeenLastCalledWith(expect.stringContaining('Valid synthetic dataset'));
  await runEvaluationCli(['hash', file], log);
  expect(log).toHaveBeenLastCalledWith(expect.stringMatching(/^[a-f0-9]{64}$/));
  const next = join(directory, 'new-review'); await runEvaluationCli(['prepare', file, next], () => {});
  expect(await json(join(next, 'dataset.json'))).toEqual(await json(file));
  expect((await json(join(next, 'private-review-key.json'))).reviewSetId).not.toBe((await json(join(path, 'private-review-key.json'))).reviewSetId);
});

it('reports one explicit synthetic review without treating remaining empty labels as passes', async () => {
  const path = await demo();
  const key = await json(join(path, 'private-review-key.json'));
  const reviews = await json(join(path, 'reviews.blank.json'));
  reviews.reviewerId = 'synthetic-test-rater';
  reviews.labels = [{ reviewId: key.entries[0].reviewId, reviewHash: key.entries[0].reviewHash,
    sourceScope: 'absent', notation: 'absent', duplication: 'absent', difficulty: 'absent', answerQuality: 'absent',
    disposition: 'accepted', reviewMinutes: 2, notes: 'Synthetic test label only.', evidenceRefs: [] }];
  const labels = join(directory, 'reviews.json'); await write(labels, reviews);
  const output = join(directory, 'report');
  await runEvaluationCli(['report', join(path, 'dataset.json'), join(path, 'private-review-key.json'), labels, output], () => {});
  const report = await json(join(output, 'report.json'));
  expect(report.arms[0].supply.acceptedIndependent).toBe(1);
  expect(report.arms[1].supply.acceptedIndependent).toBe(0);
  expect(report.comparison.teacherLabelsComplete).toBe(false);
  expect(report.arms[0].usage.totalTokens).toBeNull();
  expect(await readFile(join(output, 'report.md'), 'utf8')).toContain('Walkthrough only');
});

it('imports manifest-relative real-export files only as retrospective observations', async () => {
  const path = await demo();
  const dataset = DatasetSchema.parse(await json(join(path, 'dataset.json')));
  const run = dataset.runs[0]; const fixture = dataset.cases[0];
  const input = join(directory, 'inputs'); await mkdir(input);
  await write(join(input, 'record.json'), {
    schemaVersion: 'generation-evaluation-export-v1',
    run: { id: 'recorded-run', policy: 'baseline', requestedSlots: run.requestedSlots, type: fixture.context.request.type, difficulty: fixture.context.request.difficulty, prompt: fixture.context.request.instruction, status: 'completed' },
    slots: run.slots.map(slot => ({ item: slot.item, outcome: slot.outcome === 'missing' ? 'unavailable' : slot.outcome,
      ...(slot.candidate ? { candidate: { ...slot.candidate.content, contentHash: slot.candidate.contentHash, truncated: false } } : {}), failureCodes: [] })),
    usage: { summary: run.usage, totalCalls: 0, callsTruncated: false }, limitations: [],
  });
  await write(join(input, 'manifest.json'), { experimentId: 'retrospective-test', cases: [fixture], runs: [{ file: 'record.json', caseId: fixture.caseId, repetition: 1 }] });
  const output = join(directory, 'imported');
  await runEvaluationCli(['import', join(input, 'manifest.json'), output], () => {});
  const imported = await json(join(output, 'dataset.json'));
  expect(imported.origin).toBe('recorded');
  expect(imported.runs[0].comparison).toEqual({ contextTiming: 'retrospective', isolated: null, controlsHash: null });
  expect((await json(join(output, 'report.unreviewed.json'))).comparison.eligiblePairs).toEqual([]);
});

it('rejects unsupported arguments before reading files or starting generation', async () => {
  const log = jest.fn(); await runEvaluationCli(['--help'], log);
  expect(log).toHaveBeenCalledWith(expect.stringContaining('no model or database access'));
  await expect(runEvaluationCli(['generate', 'anything'], log)).rejects.toThrow('Offline FinanceBot');
});
