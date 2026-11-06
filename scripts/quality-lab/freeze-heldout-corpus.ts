import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { freezeHeldoutCases, heldoutComparisonPlan, HELDOUT_DEFINITIONS, recoverHeldoutPromptBuilder } from './freeze-heldout';
import { sha256, type FrozenFixture } from './protocol';
import type { OutlineCorpusFixture } from './outline-controls';

const argument = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
async function main(): Promise<void> {
  const corpusPath = argument('--corpus'), tuningPath = argument('--tuning'), output = argument('--output');
  if (!corpusPath || !tuningPath || !output) throw new Error('Supply --corpus, --tuning and a NEW --output directory. This command only reads local files and writes frozen evidence.');
  const [corpusRaw, tuningRaw] = await Promise.all([readFile(corpusPath, 'utf8'), readFile(tuningPath, 'utf8')]);
  const corpus = JSON.parse(corpusRaw) as OutlineCorpusFixture, tuning = JSON.parse(tuningRaw) as FrozenFixture;
  const sourceFiles = { generation: 'server/src/services/generation.service.ts', quality: 'server/src/services/generation-quality.service.ts',
    memory: 'server/src/services/generation-memory.service.ts', citations: 'server/src/services/generation-citation-spans.ts' };
  const sourceRows = await Promise.all(Object.entries(sourceFiles).map(async ([key, file]) => ({ key, file, text: await readFile(file, 'utf8') })));
  const sources = Object.fromEntries(sourceRows.map(row => [row.key, row.text])) as Parameters<typeof recoverHeldoutPromptBuilder>[0];
  const recovered = recoverHeldoutPromptBuilder(sources);
  const selected = new Set(HELDOUT_DEFINITIONS.map(item => item.chapter));
  const pdfHashes = Object.fromEntries(await Promise.all(corpus.sources.filter(source => selected.has(source.chapter)).map(async source => [source.materialId, sha256(await readFile(source.publicPdf))])));
  const fixture = freezeHeldoutCases({ corpus, corpusRaw, corpusPath: path.resolve(corpusPath), tuning, pdfHashes, builder: recovered.builder, createdAt: new Date().toISOString() });
  await mkdir(output, { recursive: false });
  const preparationRows = await Promise.all(['scripts/quality-lab/freeze-heldout.ts', 'scripts/quality-lab/freeze-heldout-corpus.ts',
    'scripts/quality-lab/protocol.ts', 'scripts/quality-lab/outline-controls.ts', 'server/src/components/formula/builtins.ts'].map(async file => ({ file, text: await readFile(file, 'utf8') })));
  for (const row of [...sourceRows, ...preparationRows]) {
    const snapshot = path.join(output, 'code', row.file); await mkdir(path.dirname(snapshot), { recursive: true }); await writeFile(snapshot, row.text, { flag: 'wx' });
  }
  const plan = { ...heldoutComparisonPlan(fixture), inputFiles: [{ file: path.resolve(corpusPath), sha256: sha256(corpusRaw) }, { file: path.resolve(tuningPath), sha256: sha256(tuningRaw) }],
    promptCode: sourceRows.map(row => ({ file: row.file, sha256: sha256(row.text) })),
    preparationCode: preparationRows.map(row => ({ file: row.file, sha256: sha256(row.text) })), declarations: recovered.declarations };
  await Promise.all([writeFile(path.join(output, 'fixture.json'), JSON.stringify(fixture, null, 2) + '\n', { flag: 'wx' }),
    writeFile(path.join(output, 'plan.json'), JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' })]);
  console.log(JSON.stringify({ output: path.resolve(output), fixtureSha256: fixture.fixtureSha256, cases: fixture.cases.length,
    generatorSlots: plan.generatorSlots, minimumSends: plan.minimumGeneratorAndPrimaryJudgeSends, providerCalls: 0, databaseCalls: 0 }));
}
if (require.main === module) void main().catch(error => { console.error(error instanceof Error ? error.message : 'heldout-freeze-failed'); process.exitCode = 1; });
