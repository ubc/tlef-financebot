import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { aggregateHeldoutResults, assertHeldoutCli, planHeldoutComparison, readHeldoutPhase, type HeldoutShardReceipt } from './heldout-phase';
import { MODEL_COMPARISON_CODE_FILES } from './run-model-comparison';
import { hashControl, safeError, sha256, type FrozenFixture } from './protocol';

const argument = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
async function runChild(args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/quality-lab/run-model-comparison.ts', ...args], { stdio: 'inherit', shell: false });
    child.once('error', reject); child.once('exit', (code, signal) => signal ? reject(new Error(`quality-lab-heldout-child-signal:${signal}`)) : resolve(code ?? 1));
  });
}
/** Import and ordinary preflight read local evidence only. Runtime components
 * remain behind each child's explicit --live once branch. */
export async function runHeldoutComparison(): Promise<void> {
  assertHeldoutCli(process.argv, ['--fixture', '--output', '--live', '--heldout-phase', '--heldout-phase-sha256', '--aggregate-from'], ['--require-all-shards']);
  const fixturePath = argument('--fixture'), output = argument('--output');
  if (!fixturePath || !output) throw new Error('Supply --fixture and a NEW --output directory. Default is local-only preflight; no declaration or ledger is created.');
  const live = argument('--live'); if (live !== undefined && live !== 'once') throw new Error('quality-lab-live-must-be-once');
  const phaseFile = argument('--heldout-phase'), digest = argument('--heldout-phase-sha256');
  if (Boolean(phaseFile) !== Boolean(digest) || live && (!phaseFile || !digest)) throw new Error('quality-lab-heldout-live-declaration-required');
  const aggregateFrom = argument('--aggregate-from');
  if (aggregateFrom && live) throw new Error('quality-lab-heldout-aggregate-is-offline-only');
  if (process.argv.includes('--require-all-shards') && !aggregateFrom) throw new Error('quality-lab-heldout-require-all-is-aggregate-only');
  const phase = phaseFile && digest ? await readHeldoutPhase(phaseFile, digest, !live) : undefined;
  const fixtureRaw = await readFile(fixturePath, 'utf8'); const fixture = JSON.parse(fixtureRaw) as FrozenFixture;
  const plan = planHeldoutComparison(fixture);
  if (phase && (path.resolve(fixturePath) !== phase.declaration.fixture.path || sha256(fixtureRaw) !== phase.declaration.fixture.sha256)) throw new Error('quality-lab-heldout-driver-fixture-drift');
  if (aggregateFrom && !phase) throw new Error('quality-lab-heldout-aggregate-declaration-required');
  const code = await Promise.all(MODEL_COMPARISON_CODE_FILES.map(async file => ({ file, sha256: sha256(await readFile(file)) })));
  const controls = { version: 1, mode: live ? 'declared-live' : aggregateFrom ? 'offline-aggregate' : 'offline-preflight',
    fixture: path.resolve(fixturePath), fixtureFileSha256: sha256(fixtureRaw), fixtureSha256: fixture.fixtureSha256,
    phase: phase ? { file: phase.file, sha256: phase.digest, ledger: phase.declaration.ledger, scope: phase.declaration.scope, ledgerExists: phase.ledgerExists } : null,
    scheduleSha256: plan.scheduleSha256, code, plan, settingsMutation: false, teacherAcceptance: null, saved: 0, adopted: 0,
    protocol: 'Exact frozen per-case prompts and source/Bank controls, fixed Sol/medium judge, no content repair. Full raw attempted input/output, usage and errors remain in shard transcripts. Portable JSON and same-candidate citation corrections charge one shared immutable declared ledger.',
    completionCaveat: plan.completionPolicy };
  await mkdir(output, { recursive: false });
  await writeFile(path.join(output, 'controls.json'), JSON.stringify(controls, null, 2) + '\n', { flag: 'wx' });
  await writeFile(path.join(output, 'preflight.json'), JSON.stringify({ ...plan, providerCalls: 0, databaseCalls: 0, networkCalls: 0, declarationCreated: false, ledgerCreated: false }, null, 2) + '\n', { flag: 'wx' });
  const receipts: HeldoutShardReceipt[] = [];
  const loadReceipt = async (directory: string) => JSON.parse(await readFile(path.join(directory, 'results.json'), 'utf8')) as HeldoutShardReceipt;
  if (aggregateFrom) {
    const recorded = JSON.parse(await readFile(path.join(aggregateFrom, 'controls.json'), 'utf8')) as typeof controls;
    if (recorded.fixtureFileSha256 !== controls.fixtureFileSha256 || recorded.fixtureSha256 !== controls.fixtureSha256 ||
        recorded.scheduleSha256 !== controls.scheduleSha256 || recorded.phase?.sha256 !== phase!.digest || !Array.isArray(recorded.code)) throw new Error('quality-lab-heldout-aggregate-controls-mismatch');
    for (const shard of plan.shards) try { receipts.push(await loadReceipt(path.join(aggregateFrom, shard.id))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const aggregate = aggregateHeldoutResults(plan, fixture, phase!.digest, receipts, process.argv.includes('--require-all-shards'), recorded.code);
    await writeFile(path.join(output, 'results.json'), JSON.stringify({ ...aggregate, controlsSha256: hashControl(controls), providerCalls: 0, databaseCalls: 0, networkCalls: 0 }, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ output: path.resolve(output), status: aggregate.status, requestedSlots: 60, recordedSlots: aggregate.recordedShardSlots, providerCalls: 0, databaseCalls: 0 })); return;
  }
  if (!live) { console.log(JSON.stringify({ preflight: true, output: path.resolve(output), requestedSlots: 60, plannedBaseStages: 120,
    conditionalMaximumObservedSends: 360, providerCalls: 0, databaseCalls: 0, declarationCreated: false, ledgerCreated: false })); return; }
  for (const identity of code) {
    const snapshot = path.join(output, 'code', identity.file); await mkdir(path.dirname(snapshot), { recursive: true });
    await writeFile(snapshot, await readFile(identity.file), { flag: 'wx' });
  }
  const assertCurrent = async () => {
    await readHeldoutPhase(phase!.file, phase!.digest);
    for (const identity of code) if (sha256(await readFile(identity.file)) !== identity.sha256) throw new Error(`quality-lab-heldout-driver-code-changed:${identity.file}`);
  };
  const started = Date.now(); let terminalError: ReturnType<typeof safeError> | null = null; let stopped = false;
  const save = async () => {
    const aggregate = aggregateHeldoutResults(plan, fixture, phase!.digest, receipts, false, code);
    const current = await readHeldoutPhase(phase!.file, phase!.digest);
    const file = path.join(output, 'results.json'), temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify({ ...aggregate, controlsSha256: hashControl(controls), elapsedMs: Date.now() - started,
      ledger: current.ledger, terminalError, stopped, savedQuestions: 0, adoptedQuestions: 0 }, null, 2) + '\n', { flag: 'wx' }); await rename(temporary, file);
  };
  await save();
  try {
    for (const shard of plan.shards) {
      await assertCurrent();
      const exit = await runChild(['--fixture', path.resolve(fixturePath), '--output', path.join(path.resolve(output), shard.id),
        '--heldout-phase', phase!.file, '--heldout-phase-sha256', phase!.digest, '--shard-index', String(shard.index), '--repair-candidates', '0', '--live', 'once']);
      receipts.push(await loadReceipt(path.join(output, shard.id))); await assertCurrent(); await save();
      if (exit !== 0) { stopped = true; terminalError = { name: 'ShardStopped', message: `${shard.id} stopped. Later shards were not started by this driver; missing receipt cells remain unconfirmed in aggregation. No ledger reset or automatic retry.` }; break; }
    }
  } catch (error) { stopped = true; terminalError = safeError(error); }
  finally { await save(); }
  const aggregate = aggregateHeldoutResults(plan, fixture, phase!.digest, receipts, false, code);
  console.log(JSON.stringify({ output: path.resolve(output), status: aggregate.status, requestedSlots: 60, generated: aggregate.generatedCandidates,
    labEligible: aggregate.labEligibleCandidates, saved: 0, adopted: 0, teacherAcceptance: null }));
  if (stopped) process.exitCode = 1;
}
if (require.main === module) void runHeldoutComparison().catch(error => { console.error(safeError(error).message); process.exitCode = 1; });
