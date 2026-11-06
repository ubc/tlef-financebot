import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { freezeRetainedCases, type RetainedCorpus } from './freeze';

const argument = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
async function main(): Promise<void> {
  const input = argument('--observations'); const output = argument('--output');
  if (!input || !output) throw new Error('Usage: tsx scripts/quality-lab/freeze-retained.ts --observations <retained.json> --output <new-fixture.json>');
  const raw = await readFile(input, 'utf8'); const corpus = JSON.parse(raw) as RetainedCorpus;
  const [{ GENERATOR_V2_PROMPT }, { generationQualityInstruction }] = await Promise.all([
    import('../../server/src/services/generation.service'), import('../../server/src/services/generation-quality.service'),
  ]);
  const fixture = freezeRetainedCases(corpus, raw, path.resolve(input), { generator: GENERATOR_V2_PROMPT, instruction: generationQualityInstruction });
  await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(fixture, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ output: path.resolve(output), fixtureSha256: fixture.fixtureSha256, cases: fixture.cases.map(item => item.id), providerCalls: 0 }));
}
if (require.main === module) void main().catch(error => { console.error(error instanceof Error ? error.message : 'quality-lab-freeze-failed'); process.exitCode = 1; });
