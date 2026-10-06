import { readFile, mkdir, writeFile, access, stat } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { DatasetSchema, ReviewFileSchema, ReviewKeySchema, hashValue } from './schema';
import { ExportManifestSchema, importGenerationExports } from './import-exports';
import { importTeacherReviews } from './import-reviews';
import { createBlindReview, renderReviewHtml } from './review';
import { summarizeEvaluation } from './metrics';
import { renderEvaluationReport } from './report';
import { createDemoDataset } from './demo';
import { parseSyntheticQualityFixtures } from '../quality-fixture-schema';
import type { EvaluationDataset } from './schema';

const HELP = `Offline FinanceBot quality evaluation (no model or database access)
  npx tsx scripts/prompt-ab/evaluation/cli.ts demo <new-output-directory>
  npx tsx scripts/prompt-ab/evaluation/cli.ts import <export-manifest.json> <new-output-directory>
  npx tsx scripts/prompt-ab/evaluation/cli.ts prepare <dataset.json> <new-output-directory>
  npx tsx scripts/prompt-ab/evaluation/cli.ts report <dataset.json> <private-review-key.json> <reviews.json> <new-output-directory>
  npx tsx scripts/prompt-ab/evaluation/cli.ts validate <dataset.json>
  npx tsx scripts/prompt-ab/evaluation/cli.ts hash <json-file>
Share only review.html with reviewers. Keep the dataset and private key private.
All output files are created without overwriting existing files.`;

async function readJson(file: string): Promise<unknown> {
  if ((await stat(file)).size > 50 * 1024 * 1024) throw new Error('Evaluation input exceeds the 50 MiB file limit.');
  return JSON.parse(await readFile(file, 'utf8')) as unknown;
}
async function writeArtifacts(directory: string, artifacts: Record<string, string>): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  for (const name of Object.keys(artifacts)) {
    try { await access(join(directory, name)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    throw new Error(`Refusing to overwrite existing ${name}; choose another output directory.`);
  }
  for (const [name, content] of Object.entries(artifacts)) await writeFile(join(directory, name), content, { flag: 'wx', mode: 0o600 });
}
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';

async function prepare(dataset: EvaluationDataset, output: string): Promise<void> {
  const { bundle, key, reviews } = createBlindReview(dataset);
  const report = summarizeEvaluation(dataset, []);
  await writeArtifacts(output, {
    'dataset.json': json(dataset), 'review.html': renderReviewHtml(bundle, reviews),
    'reviews.blank.json': json(reviews), 'private-review-key.json': json(key),
    'report.unreviewed.json': json(report), 'report.unreviewed.md': renderEvaluationReport(report),
  });
}

export async function runEvaluationCli(argv: string[], log: (message: string) => void = console.log): Promise<void> {
  const [command, ...args] = argv;
  if (!command || command === '--help' || command === 'help') { log(HELP); return; }
  const expected: Record<string, number> = { demo: 1, import: 2, prepare: 2, report: 4, validate: 1, hash: 1 };
  if (!(command in expected) || args.length !== expected[command]) throw new Error(HELP);
  if (command === 'demo') {
    const fixtures = parseSyntheticQualityFixtures(await readJson(resolve(__dirname, '../../..', 'tests/fixtures/generation-quality/synthetic-finance.json')));
    await prepare(createDemoDataset(fixtures), resolve(args[0]));
    log('Synthetic walkthrough created. No generation or teacher evaluation was performed.'); return;
  }
  if (command === 'hash') { log(hashValue(await readJson(resolve(args[0])))); return; }
  if (command === 'import') {
    const manifestPath = resolve(args[0]);
    const manifest = ExportManifestSchema.parse(await readJson(manifestPath));
    const exports: unknown[] = [];
    for (const run of manifest.runs) exports.push(await readJson(resolve(dirname(manifestPath), run.file)));
    await prepare(importGenerationExports(manifest, exports), resolve(args[1]));
    log('Retrospective exports imported. Strict paired comparison remains unavailable.'); return;
  }
  const dataset = DatasetSchema.parse(await readJson(resolve(args[0])));
  if (command === 'validate') { log(`Valid ${dataset.origin} dataset: ${dataset.cases.length} cases and ${dataset.runs.length} recorded runs.`); return; }
  if (command === 'prepare') { await prepare(dataset, resolve(args[1])); log('Blind review files created with unassigned teacher labels.'); return; }
  const key = ReviewKeySchema.parse(await readJson(resolve(args[1])));
  const reviews = ReviewFileSchema.parse(await readJson(resolve(args[2])));
  const linked = importTeacherReviews(dataset, key, reviews);
  const report = summarizeEvaluation(dataset, linked);
  await writeArtifacts(resolve(args[3]), { 'report.json': json(report), 'report.md': renderEvaluationReport(report) });
  log(`Report created: ${linked.length} submitted rows; ${report.comparison.eligiblePairs.length} eligible declared-context pairs. See coverage before interpreting differences.`);
}

if (require.main === module) runEvaluationCli(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Evaluation command failed.');
  process.exitCode = 1;
});
