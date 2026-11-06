/** File-only preflight and explicitly declared root-only review probe.
 * No database access, outline application, semantic repair or question writes. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import net from 'node:net';
import ts from 'typescript';
import { z } from 'zod';
import type { GroundingObjective, OutlineGroundingFinding } from '../../server/src/types/structure';
import type { GroundingSection, OutlineGroundingBatch } from '../../server/src/services/structure-outline-grounding';
import type { OutlineCorpusFixture } from './outline-controls';
import type { ConservativeLedger } from './ledger';
import type { CapturedCompletion, JsonCompletion } from './protocol';
import { hashControl, safeError, sha256 } from './protocol';
import { fixtureSections } from './outline-controls';
import { assertLedgerIntegrity, readDeclaredOutlinePhase } from './phase-declaration';
import { createCapturedCompletion } from './completion';
import { summarizeHarnessUsage } from '../prompt-ab/usage-summary';

export const OUTLINE_REVIEW_PROBE_LIMITS = Object.freeze({ maxSends: 4, maxInputTokens: 24000, maxOutputTokens: 6000, maxEstimatedTokens: 120000 });
const ROOT = path.resolve(__dirname, '../..');
const GROUNDING_FILE = 'server/src/services/structure-outline-grounding.ts';
const CODE_FILES = [
  'scripts/quality-lab/run-outline-review-probe.ts', 'scripts/quality-lab/outline-controls.ts', 'scripts/quality-lab/completion.ts',
  'scripts/quality-lab/capture.ts', 'scripts/quality-lab/protocol.ts', 'scripts/quality-lab/ledger.ts', 'scripts/quality-lab/phase-declaration.ts',
  'scripts/prompt-ab/usage-summary.ts', GROUNDING_FILE, 'server/src/services/structure-generation.service.ts',
  'server/src/services/structure-source-inventory.ts', 'server/src/services/source-evidence-cache.service.ts',
  'server/src/services/source-readiness.service.ts', 'server/src/types/structure.ts', 'server/src/types/authoring-budget.ts',
  'server/src/components/genai/llm/index.ts', 'server/src/components/genai/llm/model-call.ts',
  'server/src/components/genai/llm/model-capabilities.ts', 'server/src/components/genai/llm/openai-usage-adapter.ts',
  'server/src/components/genai/llm/provider-usage.ts', 'server/src/components/genai/llm/authoring-budget.ts',
  'server/src/components/genai/llm/latex-escapes.ts', 'server/src/components/genai/logger.ts',
  'server/src/services/authoring-budget.service.ts', 'server/src/config/env.ts', 'package.json', 'package-lock.json',
] as const;
interface PromptObjective { id: string; topic: string; objective: string; sourceIds: string[]; learningPoints: GroundingObjective['learningPoints'] }
interface PromptOriginal { id: string; material: string; chunkIndex: number; text: string }
interface ReviewPrompt { objectives: PromptObjective[]; originalSections: PromptOriginal[] }
interface SourceGroup { materialId: string; chunkIndex: number; quote: string; sourceAlias: string }
interface SynthesisPrompt {
  originalPassages: Array<{ id: string; materialId: string; material: string; chunkIndex: number; quote: string }>;
  learningPoints: Array<{ id: string; objective: string; passageId: string; supportingPassageIds?: string[] }>;
}
export interface RetainedReviewRun {
  status: string; result: unknown; error: { message: string }; runId: string; controlsSha256: string;
  diagnosticRun: { status: string; structureDiagnostics: { outlineGrounding: { version: string; findings: OutlineGroundingFinding[] } };
    structurePreview?: { themes: Array<{ name: string; los: Array<{ name: string }> }> } };
  liveCorpus: { sections: GroundingSection[]; fingerprint: string };
  captures: Array<{ file: string; transcript: CapturedCompletion }>;
}
export interface RecoveredGroundingFunctions {
  selectOutlineGroundingBatch(batch: OutlineGroundingBatch, ids: string[]): OutlineGroundingBatch;
  validateOutlineGrounding(raw: unknown, batch: OutlineGroundingBatch): OutlineGroundingFinding[];
}
export interface ReviewProbeCase {
  id: 'L14-source-supported-topic-rejection' | 'L38-foreign-source-alias' | 'synthetic-L14-black-scholes-negative';
  batch: OutlineGroundingBatch; promptSha256: string; inputEstimate: number; quotedOriginalGroups: Array<{ evidenceId: string; objective: string; groups: SourceGroup[];
    retainedMappings: Array<{ transcript: string; packLocalLearningPointId: string }> }>;
  binding: { kind: 'retained-durable-original' | 'fresh-probe-binding'; originalContentHash: string | null; currentContentHash: string; position: string; explanation: string };
  expectedSourceStatus: 'supported' | 'not-supported' | null; historicalRows: unknown[];
  limitations: string[];
}
export interface ReviewProbeControls {
  version: 1; probeId: string; createdAt: string; limits: typeof OUTLINE_REVIEW_PROBE_LIMITS;
  phase: { declaration: string; declarationSha256: string; ledger: string; scope: string; ledgerBefore: ConservativeLedger };
  origin: { directory: string; controls: string; controlsSha256: string; results: string; resultsSha256: string; fixture: string; fixtureSha256: string };
  identities: Array<{ file: string; sha256: string }>; code: Array<{ file: string; sha256: string }>; declarationFunctions: Array<{ name: string; sha256: string }>;
  transport: { provider: string; historicalEndpointVerification: 'unavailable-not-recorded-in-retained-controls' };
  model: { model: 'gpt-6-luna'; reasoningEffort: 'medium' }; cases: ReviewProbeCase[]; saved: 0; adopted: 0; teacherAcceptance: null; limitations: string[];
}

/** Extract only named trusted repository declarations. No source/model data
 * becomes executable code and no environment/provider component is imported. */
export function recoverGroundingProbeFunctions(source: string): { functions: RecoveredGroundingFunctions; identities: Array<{ name: string; sha256: string }> } {
  const parsed = ts.createSourceFile('trusted-grounding.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found = new Map<string, string>();
  for (const statement of parsed.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) found.set(statement.name.text, statement.getText(parsed).replace(/^export\s+/, ''));
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) found.set(declaration.name.text, `const ${declaration.getText(parsed)};`);
  }
  const names = ['reviewSchema', 'envelopeSchema', 'knownCoverage', 'positiveCoverageFailure', 'render', 'selectOutlineGroundingBatch', 'validateOutlineGroundingRows', 'validateOutlineGrounding'];
  for (const name of names) if (!found.has(name)) throw new Error(`outline-review-probe-current-declaration-missing:${name}`);
  if (!found.get('reviewSchema')!.includes('sourceStatus') || !found.get('reviewSchema')!.includes('topicFit')) throw new Error('outline-review-probe-v2-schema-required');
  const code = `${names.map(name => found.get(name)).join('\n')}\n({selectOutlineGroundingBatch,validateOutlineGrounding});`;
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, strict: true } }).outputText;
  return { functions: vm.runInNewContext(compiled, { z, structuredClone }, { timeout: 1000 }) as RecoveredGroundingFunctions,
    identities: names.map(name => ({ name, sha256: sha256(found.get(name)!) })) };
}
function promptObject<T>(prompt: string, predicate: (value: Record<string, unknown>) => boolean): T {
  const matches: T[] = [];
  for (const line of prompt.split('\n')) if (line.startsWith('{')) try {
    const value: unknown = JSON.parse(line);
    if (value && typeof value === 'object' && !Array.isArray(value) && predicate(value as Record<string, unknown>)) matches.push(value as T);
  } catch { /* Only complete standalone JSON payloads qualify. */ }
  if (matches.length !== 1) throw new Error('outline-review-probe-exact-prompt-payload-required');
  return matches[0];
}
function originalSources(payload: ReviewPrompt, sections: GroundingSection[]): OutlineGroundingBatch['sources'] {
  if (new Set(payload.originalSections.map(item => item.id)).size !== payload.originalSections.length) throw new Error('outline-review-probe-source-alias-duplicate');
  return payload.originalSections.map(item => {
    const matches = sections.filter(section => section.materialName === item.material && section.chunkIndex === item.chunkIndex && section.text === item.text);
    if (matches.length !== 1) throw new Error('outline-review-probe-original-section-mismatch');
    return { ...matches[0], alias: item.id };
  });
}
function historicalBinding(finding: OutlineGroundingFinding): GroundingObjective {
  return { id: finding.id, themeIndex: finding.themeIndex, loIndex: finding.loIndex, topic: finding.topic, name: finding.name, contentHash: finding.contentHash,
    evidenceIds: [...finding.evidenceIds], materialIds: [...finding.materialIds], sourceIds: [...finding.sourceIds], learningPoints: structuredClone(finding.learningPoints) };
}
function productionBindingHash(objective: Omit<GroundingObjective, 'contentHash'> | GroundingObjective, sources: OutlineGroundingBatch['sources']): string {
  return createHash('sha256').update(JSON.stringify({ topic: objective.topic, name: objective.name, evidenceIds: objective.evidenceIds,
    materialIds: objective.materialIds, learningPoints: objective.learningPoints, originals: sources.filter(source => objective.sourceIds.includes(source.alias)) })).digest('hex');
}
/** Pure preparation from actual retained inputs. The explicit negative changes
 * objective wording only; it cannot borrow a source from another objective. */
export function prepareOutlineReviewCases(prior: RetainedReviewRun, sections: GroundingSection[], functions: RecoveredGroundingFunctions): ReviewProbeCase[] {
  if (prior.status !== 'stopped' || prior.result !== null || prior.error?.message !== 'structure-grounding-review-source' || prior.diagnosticRun.status !== 'failed' ||
    prior.diagnosticRun.structureDiagnostics.outlineGrounding.version !== 'original-final-lo-review-v1') throw new Error('outline-review-probe-terminal-v1-source-stop-required');
  if (hashControl(prior.liveCorpus.sections) !== hashControl(sections)) throw new Error('outline-review-probe-live-originals-changed');
  const reviews = prior.captures.filter(item => item.transcript.stage === 'outline-source-review').map(item => {
    assert.equal(item.transcript.status, 'succeeded');
    assert.equal(item.transcript.request.model, 'gpt-6-luna'); assert.equal(item.transcript.request.effort, 'medium');
    assert.equal(item.transcript.request.maxOutputTokens, 6000);
    const payload = promptObject<ReviewPrompt>(item.transcript.request.prompt, value => Array.isArray(value.objectives) && Array.isArray(value.originalSections));
    return { ...item, payload, sources: originalSources(payload, sections) };
  });
  const synthesis = prior.captures.filter(item => item.transcript.stage === 'outline-synthesis').map(item => {
    try { return { file: item.file, payload: promptObject<SynthesisPrompt>(item.transcript.request.prompt, value => Array.isArray(value.originalPassages) && Array.isArray(value.learningPoints)) }; }
    catch { return null; }
  }).filter((value): value is { file: string; payload: SynthesisPrompt } => value !== null);
  const make = (id: 'L14' | 'L38'): ReviewProbeCase => {
    const containing = reviews.filter(item => item.payload.objectives.some(objective => objective.id === id)); assert(containing.length > 0);
    const selected = containing.at(-1)!; const raw = selected.payload.objectives.find(item => item.id === id)!;
    const durable = prior.diagnosticRun.structureDiagnostics.outlineGrounding.findings.find(item => item.id === id);
    let objective: GroundingObjective; let binding: ReviewProbeCase['binding'];
    if (durable) {
      objective = historicalBinding(durable); assert.equal(objective.topic, raw.topic); assert.equal(objective.name, raw.objective);
      assert.equal(hashControl(objective.sourceIds), hashControl(raw.sourceIds)); assert.equal(hashControl(objective.learningPoints), hashControl(raw.learningPoints));
      assert.equal(productionBindingHash(objective, selected.sources), objective.contentHash, 'The durable production binding must still match original sections.');
      binding = { kind: 'retained-durable-original', originalContentHash: objective.contentHash, currentContentHash: objective.contentHash,
        position: 'Retained durable original themeIndex/loIndex.', explanation: 'Exact original durable binding retained; v1 source verdict/reason remain historical observations.' };
    } else {
      const evidenceIds = raw.learningPoints.map(point => point.id); const materialIds = [...new Set(raw.learningPoints.map(point => point.materialId))];
      let themeIndex = 0; let loIndex = 0; let position = 'Fresh single-objective probe positions 0/0; original production positions unavailable.';
      const matches = (prior.diagnosticRun.structurePreview?.themes ?? []).flatMap((theme, ti) => theme.los.flatMap((lo, li) => theme.name === raw.topic && lo.name === raw.objective ? [{ ti, li }] : []));
      if (matches.length === 1) { themeIndex = matches[0].ti; loIndex = matches[0].li; position = 'Positions reconstructed from exact unique retained structurePreview topic/objective wording.'; }
      objective = { id, themeIndex, loIndex, topic: raw.topic, name: raw.objective, evidenceIds, materialIds, sourceIds: [...raw.sourceIds], learningPoints: structuredClone(raw.learningPoints), contentHash: '' };
      objective.contentHash = productionBindingHash(objective, selected.sources);
      binding = { kind: 'fresh-probe-binding', originalContentHash: null, currentContentHash: objective.contentHash, position,
        explanation: 'No durable finding exists because the original multi-objective batch failed identity validation. Fresh hash binds the exact last-prompt objective, learning points and unchanged own originals; it is not an invented original production hash.' };
    }
    const batch = functions.selectOutlineGroundingBatch({ objectives: [objective], sources: selected.sources, prompt: '' }, [id]);
    assert(batch.sources.every(source => objective.sourceIds.includes(source.alias)));
    const quotedOriginalGroups = objective.learningPoints.map(point => {
      // Synthesis packs renumber E IDs locally. Bind by exact wording and own
      // material/coordinates; preserve both ID namespaces in the receipt.
      const matches = synthesis.flatMap(({ file, payload }) => payload.learningPoints.filter(row => row.objective === point.objective).flatMap(row => {
        const references = [row.passageId, ...(row.supportingPassageIds ?? [])].map(id => payload.originalPassages.filter(item => item.id === id));
        assert(references.every(group => group.length === 1));
        if (!references.every(group => group[0].materialId === point.materialId && batch.sources.some(source => point.sourceIds.includes(source.alias) &&
          source.materialId === group[0].materialId && source.materialName === group[0].material && source.chunkIndex === group[0].chunkIndex))) return [];
        return [{ file, payload, row }];
      }));
      assert(matches.length > 0, `No retained quote group matches the point's own unchanged original coordinates: ${point.id}`);
      const variants = matches.map(({ payload, row }) => {
        assert.equal(row.objective, point.objective);
        return [row.passageId, ...(row.supportingPassageIds ?? [])].map(passageId => {
          const passage = payload.originalPassages.filter(item => item.id === passageId); assert.equal(passage.length, 1);
          const reference = passage[0]; assert.equal(reference.materialId, point.materialId);
          const own = batch.sources.filter(source => point.sourceIds.includes(source.alias) && source.materialId === reference.materialId &&
            source.materialName === reference.material && source.chunkIndex === reference.chunkIndex && source.text.includes(reference.quote));
          assert.equal(own.length, 1, `Exact quote is not in the learning point's own unchanged original: ${point.id}`);
          return { materialId: reference.materialId, chunkIndex: reference.chunkIndex, quote: reference.quote, sourceAlias: own[0].alias };
        });
      });
      assert(variants.every(groups => hashControl(groups) === hashControl(variants[0])), `Conflicting retained quote groups: ${point.id}`);
      return { evidenceId: point.id, objective: point.objective, groups: variants[0],
        retainedMappings: matches.map(({ file, row }) => ({ transcript: file, packLocalLearningPointId: row.id })) };
    });
    const historicalRows = containing.flatMap(item => {
      const parsed = item.transcript.parsed as { reviews?: Array<{ id?: string }> } | null;
      return (parsed?.reviews ?? []).filter(row => row.id === id).map(row => ({ transcript: item.file, rawRow: row,
        foreignSourceIds: (row as { sourceIds?: string[] }).sourceIds?.filter(alias => !objective.sourceIds.includes(alias)) ?? [] }));
    });
    if (id === 'L14') { assert(durable && durable.status === 'unsupported'); assert.equal(objective.evidenceIds.length, 1); }
    else { assert(historicalRows.length >= 2); assert(historicalRows.slice(-2).every(row => row.foreignSourceIds.includes('S136'))); }
    const inputEstimate = Buffer.byteLength(JSON.stringify([{ role: 'user', content: batch.prompt }]), 'utf8') + 32;
    if (inputEstimate > OUTLINE_REVIEW_PROBE_LIMITS.maxInputTokens) throw new Error(`outline-review-probe-full-original-input-too-large:${id}`);
    return { id: id === 'L14' ? 'L14-source-supported-topic-rejection' : 'L38-foreign-source-alias', batch, promptSha256: sha256(batch.prompt), inputEstimate,
      quotedOriginalGroups, binding, expectedSourceStatus: id === 'L14' ? 'supported' : null, historicalRows,
      limitations: ['Selected one objective and only its full own originals, retaining original aliases. Multi-objective neighboring source IDs are deliberately absent.',
        'Current v2 schema and prompt separate source support from advisory topic placement. These coupled changes are not a randomized causal A/B.',
        ...(id === 'L38' ? ['The source verdict has no forced positive label. Missing alpha/index premises may legitimately remain unsupported or uncertain.'] : ['The expected source-supported label is a documented engineering control, not professor acceptance.'])] };
  };
  const positive = make('L14'); const alias = make('L38'); const negative = structuredClone(positive);
  negative.id = 'synthetic-L14-black-scholes-negative'; negative.expectedSourceStatus = 'not-supported'; negative.historicalRows = [];
  const objective = negative.batch.objectives[0]; const originalHash = objective.contentHash;
  objective.name = 'Derive and apply the Black-Scholes option-pricing formula to calculate European call and put values and calibrate implied volatility from market option prices.';
  assert(negative.batch.sources.every(source => !/Black[– -]Scholes|implied volatility/i.test(source.text)));
  objective.contentHash = productionBindingHash(objective, negative.batch.sources);
  negative.binding = { kind: 'fresh-probe-binding', originalContentHash: originalHash, currentContentHash: objective.contentHash, position: positive.binding.position,
    explanation: 'Explicit synthetic out-of-source objective wording replaces L14 only. Topic, learning points, aliases and full original source text remain identical. Not a retained production failure.' };
  negative.batch = functions.selectOutlineGroundingBatch(negative.batch, [objective.id]); negative.promptSha256 = sha256(negative.batch.prompt);
  negative.inputEstimate = Buffer.byteLength(JSON.stringify([{ role: 'user', content: negative.batch.prompt }]), 'utf8') + 32;
  if (negative.inputEstimate > OUTLINE_REVIEW_PROBE_LIMITS.maxInputTokens) throw new Error('outline-review-probe-full-negative-input-too-large');
  negative.limitations = ['Synthetic negative engineering label, not professor review. Only objective wording and its binding hash change from L14; unchanged evidence cannot justify an option-pricing capability.', ...positive.limitations];
  return [positive, alias, negative];
}
export function assertReviewProbeLedgerPrefix(before: ConservativeLedger, current: ConservativeLedger, probeId?: string): void {
  assertLedgerIntegrity(before); assertLedgerIntegrity(current);
  const header = (value: ConservativeLedger) => { const { reservedSends: _s, conservativeTokens: _t, reservations: _r, ...rest } = value; void _s; void _t; void _r; return rest; };
  assert.equal(hashControl(header(before)), hashControl(header(current))); assert(current.reservations.length >= before.reservations.length);
  assert.equal(new Set(current.reservations.map(row => row.id)).size, current.reservations.length);
  assert.equal(hashControl(current.reservations.slice(0, before.reservations.length)), hashControl(before.reservations));
  const added = current.reservations.slice(before.reservations.length);
  if (probeId) assert(added.every(row => row.cellId.startsWith(`${probeId}-`) && row.stage === 'outline-source-review-probe'));
  assert(added.length <= OUTLINE_REVIEW_PROBE_LIMITS.maxSends);
}
const argument = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
export function assertReviewProbeCli(args: string[]): void {
  const allowed = new Set(['--prior', '--output', '--live', '--controls', '--controls-sha256']); const seen = new Set<string>();
  for (let index = 2; index < args.length; index += 2) {
    const flag = args[index]; const value = args[index + 1];
    if (!allowed.has(flag) || seen.has(flag) || !value || value.startsWith('--')) throw new Error('outline-review-probe-unknown-duplicate-or-missing-cli-argument');
    seen.add(flag);
  }
  if (seen.has('--live') && seen.has('--prior')) throw new Error('outline-review-probe-live-requires-only-frozen-controls');
}
async function saveJson(file: string, value: unknown, exclusive = false): Promise<void> {
  if (exclusive) { await writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); return; }
  const temporary = `${file}.${randomUUID()}.tmp`; await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); await rename(temporary, file);
}
async function loadRetained(priorDirectory: string) {
  const controlsFile = path.join(priorDirectory, 'controls.json'); const resultsFile = path.join(priorDirectory, 'results.json');
  const controlsRaw = await readFile(controlsFile, 'utf8'); const resultsRaw = await readFile(resultsFile, 'utf8');
  const controls = JSON.parse(controlsRaw) as { fixture: string; fixtureSha256: string; ledger: string; scope: string; phaseDeclaration: { file: string; sha256: string } };
  const prior = JSON.parse(resultsRaw) as RetainedReviewRun; assert.equal(hashControl(JSON.parse(controlsRaw)), prior.controlsSha256);
  const fixtureRaw = await readFile(controls.fixture, 'utf8'); assert.equal(sha256(fixtureRaw), controls.fixtureSha256);
  const fixture = JSON.parse(fixtureRaw) as OutlineCorpusFixture; const sections = fixtureSections(fixture).sections;
  const identities = [{ file: path.resolve(controlsFile), sha256: sha256(controlsRaw) }, { file: path.resolve(resultsFile), sha256: sha256(resultsRaw) },
    { file: path.resolve(controls.fixture), sha256: sha256(fixtureRaw) }];
  for (const source of fixture.sources) {
    const bytes = await readFile(source.publicPdf); assert.equal(sha256(bytes), source.pdfSha256); assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    identities.push({ file: path.resolve(source.publicPdf), sha256: source.pdfSha256 });
  }
  for (const capture of prior.captures) {
    const file = path.resolve(capture.file); const raw = await readFile(file, 'utf8');
    assert.equal(hashControl(JSON.parse(raw)), hashControl(capture.transcript), 'Embedded and exact transcript file must agree.');
    identities.push({ file, sha256: sha256(raw) });
  }
  return { controls, prior, fixture, sections, identities, controlsFile, controlsRaw, resultsFile, resultsRaw };
}
async function prepareProbe(priorDirectory: string, output: string): Promise<void> {
  const retained = await loadRetained(priorDirectory);
  const phase = await readDeclaredOutlinePhase(retained.controls.phaseDeclaration.file, retained.controls.phaseDeclaration.sha256, retained.controls.ledger, retained.controls.scope);
  assert(phase.ledgerExists, 'Never create/reset the existing phase-two ledger.');
  const groundingSource = await readFile(path.join(ROOT, GROUNDING_FILE), 'utf8'); const recovered = recoverGroundingProbeFunctions(groundingSource);
  const cases = prepareOutlineReviewCases(retained.prior, retained.sections, recovered.functions);
  const code = await Promise.all(CODE_FILES.map(async file => ({ file: path.join(ROOT, file), sha256: sha256(await readFile(path.join(ROOT, file))) })));
  const providers = [...new Set(retained.prior.captures.filter(item => item.transcript.stage === 'outline-source-review')
    .flatMap(item => item.transcript.attempts.map(attempt => attempt.input.provider)))];
  assert.equal(providers.length, 1); assert(providers[0].trim());
  const controls: ReviewProbeControls = { version: 1, probeId: `outline-review-probe-${randomUUID()}`, createdAt: new Date().toISOString(), limits: OUTLINE_REVIEW_PROBE_LIMITS,
    phase: { declaration: retained.controls.phaseDeclaration.file, declarationSha256: retained.controls.phaseDeclaration.sha256, ledger: retained.controls.ledger,
      scope: retained.controls.scope, ledgerBefore: structuredClone(phase.ledger) },
    origin: { directory: path.resolve(priorDirectory), controls: path.resolve(retained.controlsFile), controlsSha256: sha256(retained.controlsRaw),
      results: path.resolve(retained.resultsFile), resultsSha256: sha256(retained.resultsRaw), fixture: path.resolve(retained.controls.fixture), fixtureSha256: retained.controls.fixtureSha256 },
    identities: retained.identities, code, declarationFunctions: recovered.identities, model: { model: 'gpt-6-luna', reasoningEffort: 'medium' }, cases,
    transport: { provider: providers[0], historicalEndpointVerification: 'unavailable-not-recorded-in-retained-controls' },
    saved: 0, adopted: 0, teacherAcceptance: null,
    limitations: ['Targeted diagnostic review only: no final outline, LO application, database writes, question generation or adoption.',
      'Historical v1 verdicts are reference observations, not a randomized causal A/B. V2 source/topic separation, row validation and single-objective context change together.',
      'L38 deliberately excludes neighboring objectives and their source aliases while preserving all of its own original text; its original source verdict is not assumed positive.',
      'The Black-Scholes case is explicitly synthetic and keeps L14 source text/learning points unchanged. It is not a production failure.',
      'Four actual sends include portable JSON correction. No semantic repair or schema/identity retry is added; exhausted or malformed cases remain missing/failed.',
      'Historical provider identity is retained, but endpoint URL/hash was not archived. Live endpoint origin/hash are recorded prospectively; historical endpoint equality is not claimed.',
      'The same append-only phase-two ledger is shared. Conservative reservations are not billed provider tokens; hidden SDK retries remain unknown.'] };
  await mkdir(output, { recursive: false });
  for (const item of code) { const relative = path.relative(ROOT, item.file); const snapshot = path.join(output, 'code', relative); const bytes = await readFile(item.file);
    assert.equal(sha256(bytes), item.sha256, `Code changed during preflight: ${item.file}`); await mkdir(path.dirname(snapshot), { recursive: true }); await writeFile(snapshot, bytes, { flag: 'wx' }); }
  await saveJson(path.join(output, 'controls.json'), controls, true);
  const remainingSends = phase.ledger.limits.maxSends - phase.ledger.reservedSends; const remainingConservativeUnits = phase.ledger.limits.maxConservativeTokens - phase.ledger.conservativeTokens;
  await saveJson(path.join(output, 'preflight.json'), { version: 1, controlsSha256: sha256(await readFile(path.join(output, 'controls.json'))), runtimeImports: 0,
    databaseCalls: 0, providerCalls: 0, ledgerWrites: 0, requestedCases: 3, nativeMaximumSends: 4, nativeConservativeCap: 120000, outputCap: 6000,
    phaseBefore: { reservedSends: phase.ledger.reservedSends, conservativeUnits: phase.ledger.conservativeTokens, remainingSends, remainingConservativeUnits },
    cases: cases.map(item => ({ id: item.id, promptSha256: item.promptSha256, exactInputEstimate: item.inputEstimate, fullOwnOriginalSections: item.batch.sources.length,
      binding: item.binding, firstAttemptConservativeUnits: item.inputEstimate + 6000 })),
    firstAttemptTotalUnits: cases.reduce((sum, item) => sum + item.inputEstimate + 6000, 0),
    firstAttemptsFit: remainingSends >= 3 && remainingConservativeUnits >= cases.reduce((sum, item) => sum + item.inputEstimate + 6000, 0),
    maximumFourAttemptsFit: remainingSends >= 4 && remainingConservativeUnits >= 120000, completionGuaranteed: false, limitations: controls.limitations }, true);
  console.log(JSON.stringify({ preflight: true, output: path.resolve(output), cases: cases.length, providerCalls: 0, databaseCalls: 0, ledgerWrites: 0 }));
}
export async function validateReviewProbeControls(controls: ReviewProbeControls): Promise<void> {
  assert.equal(controls.version, 1); assert.match(controls.probeId, /^outline-review-probe-[a-f0-9-]{36}$/);
  assert.equal(hashControl(controls.limits), hashControl(OUTLINE_REVIEW_PROBE_LIMITS)); assert.equal(controls.saved, 0); assert.equal(controls.adopted, 0); assert.equal(controls.teacherAcceptance, null);
  assert.deepEqual(controls.model, { model: 'gpt-6-luna', reasoningEffort: 'medium' });
  assert(controls.transport.provider.trim()); assert.equal(controls.transport.historicalEndpointVerification, 'unavailable-not-recorded-in-retained-controls');
  for (const item of [...controls.identities, ...controls.code]) assert.equal(sha256(await readFile(item.file)), item.sha256, `Frozen probe input/code changed: ${item.file}`);
  const retained = await loadRetained(controls.origin.directory);
  assert.equal(sha256(retained.controlsRaw), controls.origin.controlsSha256); assert.equal(sha256(retained.resultsRaw), controls.origin.resultsSha256);
  const providers = [...new Set(retained.prior.captures.filter(item => item.transcript.stage === 'outline-source-review').flatMap(item => item.transcript.attempts.map(attempt => attempt.input.provider)))];
  assert.deepEqual(providers, [controls.transport.provider]);
  const recovered = recoverGroundingProbeFunctions(await readFile(path.join(ROOT, GROUNDING_FILE), 'utf8'));
  assert.equal(hashControl(recovered.identities), hashControl(controls.declarationFunctions));
  assert.equal(hashControl(prepareOutlineReviewCases(retained.prior, retained.sections, recovered.functions)), hashControl(controls.cases));
  const phase = await readDeclaredOutlinePhase(controls.phase.declaration, controls.phase.declarationSha256, controls.phase.ledger, controls.phase.scope);
  assertReviewProbeLedgerPrefix(controls.phase.ledgerBefore, phase.ledger, controls.probeId);
}
function providerOnlySocketFence(endpoint: URL, failures: string[]): () => void {
  const original = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]): net.Socket {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    const options = first && typeof first === 'object' ? first as { host?: string; port?: string | number; path?: string } : { host: args[1], port: first };
    const host = String(options.host ?? 'localhost'); const port = Number(options.port);
    if (host !== endpoint.hostname || port !== Number(endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80)) || ('path' in options && options.path)) {
      failures.push(`host=${host};port=${port}`); throw new Error('outline-review-probe-forbidden-network');
    }
    return Reflect.apply(original, this, args) as net.Socket;
  } as typeof original;
  return () => { net.Socket.prototype.connect = original; };
}
async function executeProbe(controlsFile: string, expectedSha: string, output: string): Promise<void> {
  const raw = await readFile(controlsFile, 'utf8'); assert.equal(sha256(raw), expectedSha); const controls = JSON.parse(raw) as ReviewProbeControls;
  await validateReviewProbeControls(controls);
  const initial = JSON.parse(await readFile(controls.phase.ledger, 'utf8')) as ConservativeLedger;
  assert.equal(hashControl(initial), hashControl(controls.phase.ledgerBefore), 'Prepare a new file-only preflight after other phase work; never silently change the starting budget.');
  // Only explicit root live execution can import environment/provider modules.
  const { env } = await import('../../server/src/config/env');
  assert.equal(env.llmProvider, controls.transport.provider, 'Retained provider identity must stay unchanged.');
  const endpoint = env.llmEndpoint ? new URL(env.llmEndpoint) : env.llmProvider === 'openai' ? new URL('https://api.openai.com') : undefined;
  assert(endpoint && ['http:', 'https:'].includes(endpoint.protocol) && !endpoint.username && !endpoint.password);
  const networkFailures: string[] = []; const restoreSocket = providerOnlySocketFence(endpoint, networkFailures);
  try {
  await mkdir(output, { recursive: false }); await saveJson(path.join(output, 'controls-reference.json'), { file: path.resolve(controlsFile), sha256: expectedSha }, true);
  const transportObserved = { provider: env.llmProvider, endpointOrigin: endpoint.origin, endpointSha256: sha256(endpoint.href),
    historicalEndpointVerified: false, limitation: controls.transport.historicalEndpointVerification };
  const outcomes: Array<Record<string, unknown>> = controls.cases.map(item => ({ id: item.id, status: 'not-evaluated', expectedSourceStatus: item.expectedSourceStatus,
    sourceStatus: null, topicFit: null, sourceReason: null, topicReason: null, schemaValid: null, saved: false, adopted: false, teacherAcceptance: null }));
  const recorders: Array<ReturnType<typeof createCapturedCompletion>> = []; const all = () => recorders.flatMap(item => item.captures);
  let status = 'running'; let error: ReturnType<typeof safeError> | null = null; const started = Date.now();
  const { completeJson } = await import('../../server/src/components/genai/llm');
  const { AuthoringBudget, withAuthoringBudget } = await import('../../server/src/services/authoring-budget.service');
  const grounding = await import('../../server/src/services/structure-outline-grounding');
  const budget = new AuthoringBudget(`${controls.phase.scope}:${controls.probeId}`, controls.limits);
  const phase = await readDeclaredOutlinePhase(controls.phase.declaration, controls.phase.declarationSha256, controls.phase.ledger, controls.phase.scope);
  const assertCurrent = async () => {
    await validateReviewProbeControls(controls); assert.equal(networkFailures.length, 0);
    if (budget.snapshot().observedSends >= controls.limits.maxSends) throw new Error('outline-review-probe-local-send-cap');
  };
  const save = async () => saveJson(path.join(output, 'results.json'), { version: 1, status, elapsedMs: Date.now() - started, controlsFile: path.resolve(controlsFile), controlsSha256: expectedSha,
    outcomes, captures: all(), budget: budget.snapshot(), phaseBefore: controls.phase.ledgerBefore,
    phaseAfter: JSON.parse(await readFile(controls.phase.ledger, 'utf8')) as unknown,
    usage: summarizeHarnessUsage(all().flatMap(item => item.transcript.attempts.flatMap(attempt => attempt.events)), { coverageComplete: all().every(item => item.transcript.attempts.every(attempt => attempt.dispatch === 'finished')) }),
    networkFailures, transportObserved, saved: 0, adopted: 0, teacherAcceptance: null, databaseCalls: 0, semanticRepairs: 0, error, limitations: controls.limitations });
  try {
    await save();
    await withAuthoringBudget(budget, async () => {
      for (const [index, item] of controls.cases.entries()) {
        if (budget.snapshot().observedSends >= controls.limits.maxSends) { outcomes[index].status = 'not-evaluated-send-cap'; continue; }
        const currentBatch = grounding.selectOutlineGroundingBatch(item.batch, item.batch.objectives.map(objective => objective.id));
        assert.equal(sha256(currentBatch.prompt), item.promptSha256, 'The actual current module must match the file-only recovered prompt.');
        const recorder = createCapturedCompletion({ directory: path.join(output, 'transcripts'), ledgerPath: controls.phase.ledger, scope: controls.phase.scope,
          limits: phase.declaration.limits, cellId: `${controls.probeId}-${item.id}`, complete: completeJson as JsonCompletion,
          maxSendsPerCompletion: 2, maxInputTokens: 24000, maxOutputTokens: 6000, assertCurrent,
          onSnapshot: async () => { await save(); } });
        recorders.push(recorder); const at = Date.now();
        try {
          const response = await recorder.complete<unknown>(currentBatch.prompt, { ...controls.model, maxTokens: 6000, usageContext: { stage: 'outline-source-review-probe', item: index } });
          outcomes[index].rawParsed = response;
          const findings = grounding.validateOutlineGrounding(response, currentBatch); assert.equal(findings.length, 1); const finding = findings[0];
          Object.assign(outcomes[index], { status: 'reviewed', schemaValid: true, sourceStatus: finding.status, sourceReason: finding.reason,
            topicFit: finding.topicFit, topicReason: finding.topicReason, coveredEvidenceIds: finding.coveredEvidenceIds, citedSourceIds: finding.citedSourceIds, finding,
            expectedSourceCheck: item.expectedSourceStatus === null ? null : item.expectedSourceStatus === 'supported' ? finding.status === 'supported' : finding.status !== 'supported' });
        } catch (caught) {
          const failure = safeError(caught); Object.assign(outcomes[index], { status: 'failed-or-budget-stopped', error: failure, schemaValid: outcomes[index].rawParsed !== undefined ? false : null });
          if (/code changed|Frozen probe|ledger-prefix|frozen|forbidden-network|model-identity|unverified-actual-model|evidence-write/i.test(failure.message)) throw caught;
        }
        outcomes[index].elapsedMs = Date.now() - at; await save();
      }
    });
    const after = JSON.parse(await readFile(controls.phase.ledger, 'utf8')) as ConservativeLedger; assertReviewProbeLedgerPrefix(initial, after, controls.probeId);
    assert(budget.snapshot().observedSends <= 4); assert.equal(networkFailures.length, 0); status = 'completed';
  } catch (caught) { status = 'stopped'; error = safeError(caught); throw caught; }
  finally { await save(); }
  console.log(JSON.stringify({ status, output: path.resolve(output), actualObservedSends: budget.snapshot().observedSends, saved: 0, adopted: 0, teacherAcceptance: null }));
  } finally { restoreSocket(); }
}
export async function main(): Promise<void> {
  assertReviewProbeCli(process.argv);
  const output = argument('--output'); const live = argument('--live'); assert(output, 'Supply a NEW --output directory.');
  if (live !== undefined) { assert.equal(live, 'once'); const controls = argument('--controls'); const digest = argument('--controls-sha256'); assert(controls && digest); await executeProbe(controls, digest, output); }
  else { const prior = argument('--prior'); assert(prior && !argument('--controls'), 'File-only preflight requires --prior. Explicit --live once is required to execute controls.'); await prepareProbe(prior, output); }
}
if (require.main === module) void main().catch(error => { console.error(JSON.stringify(safeError(error))); process.exitCode = 1; });
