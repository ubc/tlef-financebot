jest.mock('../../server/src/config/env', () => { throw new Error('V2 acceptance guard imported runtime environment.'); });
jest.mock('../../server/src/components/mongodb', () => { throw new Error('V2 acceptance guard imported Mongo.'); });
jest.mock('../../server/src/components/mongodb/collections', () => { throw new Error('V2 acceptance guard imported collections.'); });
jest.mock('../../server/src/components/genai/llm', () => { throw new Error('V2 acceptance guard imported a provider.'); });
jest.mock('../../server/src/services/structure-generation.service', () => { throw new Error('V2 acceptance guard imported runtime structure service.'); });

import { assertOutlineV2Declaration, assertOutlineV2History, assertOutlineV2Ledgers, assertOutlineV2PaidStage, emptyOutlineV2AcceptanceLedger,
  OUTLINE_V2_COLD_RUN, OUTLINE_V2_RECOVERY_RUN, OUTLINE_V2_LIMITS, OUTLINE_V2_SCOPE, type OutlineV2AcceptanceDeclaration } from '../../scripts/quality-lab/run-outline-v2-acceptance';
import { hashControl, sha256 } from '../../scripts/quality-lab/protocol';
import type { ConservativeLedger } from '../../scripts/quality-lab/ledger';
import type { AuthoringBudgetReceipt } from '../../server/src/types/authoring-budget';
import type { RecoveryControls } from '../../scripts/quality-lab/run-outline-recovery';
import type { OutlineCorpusFixture } from '../../scripts/quality-lab/outline-controls';

const date = '2026-10-17T00:00:00.000Z';
const filePin = (name: string) => ({ path: `/synthetic/outline-v2/${name}`, sha256: sha256(name) });
const id = (n: number) => n.toString(16).padStart(24, '0');
type Prior = Parameters<typeof assertOutlineV2History>[3];

function ledger(scope: string, sends: number, tokens: number, phaseTwo = false): ConservativeLedger & { phaseDeclarationSha256: string } {
  const share = Math.floor(tokens / sends); const remainder = tokens - share * sends;
  const reservations = Array.from({ length: sends }, (_, index) => ({ id: `${scope}-${index}`, cellId: 'synthetic-history', stage: 'source-extraction', jsonAttempt: 0,
    inputSha256: sha256(`synthetic input ${index}`), inputEstimate: share - 12000 + (index === 0 ? remainder : 0), outputReservation: 12000, reservedAt: date }));
  return { version: 1, scope, createdAt: date, accounting: 'conservative-reservations-v1', phaseDeclarationSha256: sha256(scope),
    limits: phaseTwo ? { maxSends: 160, maxConservativeTokens: 4000000, maxInputTokens: 200000 } : { ...OUTLINE_V2_LIMITS }, reservedSends: sends, conservativeTokens: tokens, reservations };
}

/** Synthetic metadata only. No actual historical file, database or model output
 * is read, and these receipts are never presented as measured provider work. */
function fixture() {
  const phaseOne = ledger('quality-lab-2026-10-16-phase-one', 64, 1799920);
  const recoveryAfter = ledger('quality-lab-2026-10-16-ten-chapter-phase-two', 90, 3404208, true);
  const phaseTwo = structuredClone(recoveryAfter);
  phaseTwo.reservations.push({ ...phaseTwo.reservations[0], id: 'synthetic-probe', cellId: 'review-v2-probe', inputEstimate: 1000 });
  phaseTwo.reservedSends++; phaseTwo.conservativeTokens += 13000;
  const declaration: OutlineV2AcceptanceDeclaration = { version: 1, phase: 'ten-chapter-outline-v2-acceptance', createdAt: date, scope: OUTLINE_V2_SCOPE,
    ledger: '/synthetic/outline-v2/new-ledger.json', limits: { ...OUTLINE_V2_LIMITS }, model: { model: 'gpt-6-luna', reasoningEffort: 'medium' },
    maximumOutputTokens: 24000, extractionOutputCap: 12000, synthesisOutputCap: 24000, sourceReviewOutputCap: 6000,
    fixture: filePin('corpus-fixture.json'), sourceFingerprint: '32c828c5aa9a4778b8f6b0802026a2861968d09bc0362a7be833c14b310a97ed',
    purpose: 'Synthetic declaration guard validation only.', rootAgentReviewedAfterProbe: true, reviewProbe: filePin('probe-results.json'),
    code: ['scripts/quality-lab/run-outline-v2-acceptance.ts', 'server/src/services/structure-outline-grounding.ts', 'server/src/services/structure-generation.service.ts',
      'server/src/components/genai/document-parsing/index.ts', 'server/src/services/source-readiness.service.ts', 'package.json', 'package-lock.json'].map(file => ({ file, sha256: sha256(file) })),
    priorLedgers: [phaseOne, phaseTwo].map((value, index) => ({ ...filePin(`phase-${index + 1}-ledger.json`), scope: value.scope, reservedSends: value.reservedSends, conservativeTokens: value.conservativeTokens, immutable: true })),
    history: { cold: { runId: OUTLINE_V2_COLD_RUN, controls: filePin('cold-controls.json'), results: filePin('cold-results.json') },
      recovery: { runId: OUTLINE_V2_RECOVERY_RUN, controls: filePin('recovery-controls.json'), results: filePin('recovery-results.json'), ledgerAfter: filePin('recovery-ledger-after.json') } },
  };
  const sources = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12].map((chapter, index) => ({ chapter, pages: index < 9 ? 60 : 59,
    materialId: id(index + 1), chunks: Array.from({ length: index < 9 ? 67 : 68 }, () => ({})) }));
  const corpus = { version: 1, fixtureKind: 'http-upload-real-index', copiedCacheRows: 0, courseId: '6ad2ad04e474ab8460b47c07', sourceBatchId: '6ad2ad05e474ab8460b47c09',
    database: 'financebot_quality_smoke_retest_20261016', actor: 'QUALITY-RETEST-FIXTURE-81eeb3b2-c89e-4dc3-be9f-4d097eddbecd', sources } as unknown as OutlineCorpusFixture;
  const options = { materialIds: corpus.sources.map(source => source.materialId), sourceBatchId: corpus.sourceBatchId, level: 'auto' as const, emphasis: 'balanced' as const };
  const coldControls = { version: 1, fixture: declaration.fixture.path, fixtureSha256: declaration.fixture.sha256, courseId: corpus.courseId, database: corpus.database, actor: corpus.actor,
    options, coldCacheRequired: true, model: 'gpt-6-luna', reasoningEffort: 'medium', maxOutputTokens: 24000, extractionOutputCap: 12000, synthesisOutputCap: 24000, sourceReviewOutputCap: 6000 } as RecoveryControls;
  const recoveryControls = { ...coldControls, coldCacheRequired: false, priorRunId: OUTLINE_V2_COLD_RUN,
    priorControlsSha256: declaration.history.cold.controls.sha256, priorResultsSha256: declaration.history.cold.results.sha256 };
  const makePrior = (index: number): Prior => {
    const observedSends = index === 0 ? 64 : 26; const admissionTokens = index === 0 ? 1575756 : 1828452;
    const budget = { observedSends, admissionTokens, estimatedInputTokens: admissionTokens - observedSends * 12000, reservedOutputTokens: observedSends * 12000,
      accounting: 'conservative-reservations-v1', settledSends: 0, conservativeFinishedSends: observedSends, pendingSends: 0,
      limits: { maxEstimatedTokens: 2000000, maxInputTokens: 200000, maxOutputTokens: 24000, maxSends: 256 } } as AuthoringBudgetReceipt;
    const runId = index === 0 ? OUTLINE_V2_COLD_RUN : OUTLINE_V2_RECOVERY_RUN;
    const error = { name: 'Error', message: index === 0 ? 'Unknown error occurred while calling OpenAI API' : 'structure-grounding-review-source' };
    const captures = Array.from({ length: observedSends }, () => ({ transcript: { status: 'succeeded', attempts: [{ dispatch: 'finished' }] } }));
    return { version: 1, status: 'stopped', result: null, controlsSha256: hashControl(index === 0 ? coldControls : recoveryControls), runId, elapsedMs: 10,
      error, budget: structuredClone(budget), liveCorpus: { fingerprint: declaration.sourceFingerprint }, captures,
      diagnosticRun: { _id: runId, courseId: corpus.courseId, requestedBy: corpus.actor, kind: 'structure-generation', status: 'failed', input: options,
        completedUnits: index === 0 ? 552 : 671, totalUnits: 671, structureDiagnostics: { budget },
        structureSynthesisPacks: index === 0 ? [] : Array.from({ length: 5 }, (_, pack) => ({ key: sha256(`synthetic pack ${pack}`), evidenceIds: ['E1'] })),
        error: { code: index === 0 ? 'quality-lab-outline-stopped' : 'quality-lab-outline-recovery-stopped', message: error.message } } } as unknown as Prior;
  };
  const digest = sha256('synthetic declaration bytes');
  return { declaration, digest, phaseOne, phaseTwo, recoveryAfter, corpus, coldControls, recoveryControls, cold: makePrior(0), recovery: makePrior(1) };
}

it('imports pure guards without runtime provider, Mongo or environment imports', () => {
  expect(typeof assertOutlineV2Declaration).toBe('function'); expect(typeof assertOutlineV2History).toBe('function');
});

it('admits a prospective new ledger with immutable prior cost lineage and the original failed history', () => {
  const f = fixture(); const current = emptyOutlineV2AcceptanceLedger(f.declaration, f.digest); const before = hashControl(f);
  expect(() => assertOutlineV2Declaration(f.declaration)).not.toThrow();
  expect(() => assertOutlineV2Ledgers(f.declaration, [f.phaseOne, f.phaseTwo], current, f.digest, f.recoveryAfter)).not.toThrow();
  expect(() => assertOutlineV2History(f.declaration, f.corpus, f.coldControls, f.cold, f.recoveryControls, f.recovery)).not.toThrow();
  expect(current.reservedSends).toBe(0); expect(current.scope).toBe(OUTLINE_V2_SCOPE); expect(hashControl(f)).toBe(before);
});

it('never raises the declared send, token, input or production stage caps', () => {
  for (const change of ['sends', 'tokens', 'input', 'extraction', 'synthesis', 'review', 'model', 'effort', 'scope']) {
    const { declaration } = fixture();
    if (change === 'sends') declaration.limits.maxSends = 101;
    if (change === 'tokens') declaration.limits.maxConservativeTokens = 4000000;
    if (change === 'input') declaration.limits.maxInputTokens = 240000;
    if (change === 'extraction') declaration.extractionOutputCap = 14000 as never;
    if (change === 'synthesis') declaration.synthesisOutputCap = 30000 as never;
    if (change === 'review') declaration.sourceReviewOutputCap = 8000 as never;
    if (change === 'model') declaration.model.model = 'gpt-6.1-sol' as never;
    if (change === 'effort') declaration.model.reasoningEffort = 'high' as never;
    if (change === 'scope') declaration.scope = 'quality-lab-2026-10-16-ten-chapter-phase-two';
    expect(() => assertOutlineV2Declaration(declaration)).toThrow('declaration-invalid');
  }
});

it('requires root-agent review after a pinned terminal probe without implying human or pedagogical approval', () => {
  for (const change of ['reviewed', 'probe', 'fixture', 'fingerprint']) {
    const { declaration } = fixture();
    if (change === 'reviewed') declaration.rootAgentReviewedAfterProbe = false as never;
    if (change === 'probe') declaration.reviewProbe.sha256 = 'pending';
    if (change === 'fixture') declaration.fixture.path = 'relative-fixture.json';
    if (change === 'fingerprint') declaration.sourceFingerprint = sha256('other sources');
    expect(() => assertOutlineV2Declaration(declaration)).toThrow('declaration-invalid');
  }
});

it('refuses recycled phase paths, mutable or missing prior ledgers and missing current critical code', () => {
  for (const change of ['same-ledger', 'same-prior', 'mutable', 'missing-prior', 'wrong-cold-id', 'code-missing', 'code-duplicate', 'code-traversal']) {
    const { declaration } = fixture();
    if (change === 'same-ledger') declaration.ledger = declaration.priorLedgers[1].path;
    if (change === 'same-prior') declaration.priorLedgers[1].path = declaration.priorLedgers[0].path;
    if (change === 'mutable') declaration.priorLedgers[1].immutable = false as never;
    if (change === 'missing-prior') declaration.priorLedgers.pop();
    if (change === 'wrong-cold-id') declaration.history.cold.runId = id(999);
    if (change === 'code-missing') declaration.code.pop();
    if (change === 'code-duplicate') declaration.code.push({ ...declaration.code[0] });
    if (change === 'code-traversal') declaration.code[0].file = '../uncontrolled.ts';
    expect(() => assertOutlineV2Declaration(declaration)).toThrow();
  }
});

it('preserves the complete recovery ledger prefix when the final old phase includes later probe charges', () => {
  const f = fixture(); const current = emptyOutlineV2AcceptanceLedger(f.declaration, f.digest);
  f.phaseTwo.reservations[0].inputSha256 = sha256('rewritten cold input');
  expect(() => assertOutlineV2Ledgers(f.declaration, [f.phaseOne, f.phaseTwo], current, f.digest, f.recoveryAfter)).toThrow('ledger-prefix-changed');
});

it('binds new ledger identity and refuses arbitrary work, inconsistent totals or changed prior counters', () => {
  for (const change of ['digest', 'scope', 'new-work', 'old-counter', 'new-limit']) {
    const f = fixture(); const current = emptyOutlineV2AcceptanceLedger(f.declaration, f.digest);
    if (change === 'digest') current.phaseDeclarationSha256 = sha256('another declaration');
    if (change === 'scope') current.scope = f.phaseTwo.scope;
    if (change === 'new-work') { current.reservations.push({ ...f.phaseOne.reservations[0], id: 'new-unrelated', cellId: 'unrelated' }); current.reservedSends = 1; current.conservativeTokens = current.reservations[0].inputEstimate + current.reservations[0].outputReservation; }
    if (change === 'old-counter') f.declaration.priorLedgers[1].reservedSends--;
    if (change === 'new-limit') current.limits.maxSends = 101;
    expect(() => assertOutlineV2Ledgers(f.declaration, [f.phaseOne, f.phaseTwo], current, f.digest, f.recoveryAfter)).toThrow();
  }
});

it('requires the complete original HTTP/index corpus rather than a copied, reduced or foreign course fixture', () => {
  for (const change of ['copied', 'kind', 'course', 'batch', 'actor', 'database', 'source', 'duplicate', 'pages', 'chunks']) {
    const f = fixture();
    if (change === 'copied') f.corpus.copiedCacheRows = 1;
    if (change === 'kind') f.corpus.fixtureKind = 'recorded-index-cold-clone';
    if (change === 'course') f.corpus.courseId = id(999);
    if (change === 'batch') f.corpus.sourceBatchId = id(999);
    if (change === 'actor') f.corpus.actor = 'another actor';
    if (change === 'database') f.corpus.database = 'shared-app-db';
    if (change === 'source') f.corpus.sources.pop();
    if (change === 'duplicate') f.corpus.sources[0].materialId = f.corpus.sources[1].materialId;
    if (change === 'pages') f.corpus.sources[0].pages--;
    if (change === 'chunks') f.corpus.sources[0].chunks.pop();
    expect(() => assertOutlineV2History(f.declaration, f.corpus, f.coldControls, f.cold, f.recoveryControls, f.recovery)).toThrow('exact-ten-originals-required');
  }
});

it('requires terminal exact owned failures and refuses changed cost, source, result or in-flight histories', () => {
  for (const change of ['running', 'complete', 'error', 'foreign', 'fingerprint', 'input', 'pending', 'tokens', 'settled', 'dispatch', 'controls']) {
    const f = fixture();
    if (change === 'running') f.recovery.diagnosticRun.status = 'running';
    if (change === 'complete') f.cold.result = {} as never;
    if (change === 'error') f.recovery.error.message = 'authoring-budget-exhausted:total';
    if (change === 'foreign') f.recovery.diagnosticRun.requestedBy = 'another actor';
    if (change === 'fingerprint') f.cold.liveCorpus.fingerprint = sha256('changed original');
    if (change === 'input') f.recovery.diagnosticRun.input = { materialIds: [] };
    if (change === 'pending') f.cold.budget.pendingSends = 1;
    if (change === 'tokens') f.cold.budget.admissionTokens!--;
    if (change === 'settled') f.recovery.budget.settledSends = 26;
    if (change === 'dispatch') f.recovery.captures[0].transcript.attempts[0].dispatch = 'started';
    if (change === 'controls') f.cold.controlsSha256 = sha256('different controls');
    expect(() => assertOutlineV2History(f.declaration, f.corpus, f.coldControls, f.cold, f.recoveryControls, f.recovery)).toThrow('terminal-owned-history-mismatch');
  }
});

it('counts native JSON correction attempts independently from logical capture count', () => {
  const f = fixture(); const last = f.recovery.captures.pop()!; f.recovery.captures.at(-1)!.transcript.attempts.push(last.transcript.attempts[0]);
  expect(f.recovery.captures).toHaveLength(25);
  expect(() => assertOutlineV2History(f.declaration, f.corpus, f.coldControls, f.cold, f.recoveryControls, f.recovery)).not.toThrow();
});

it('keeps cold-to-recovery lineage, full source completion and five bounded packs explicit', () => {
  for (const change of ['cold-cache', 'recovery-cache', 'run-id', 'cold-hash', 'packs', 'partial-source']) {
    const f = fixture();
    if (change === 'cold-cache') f.coldControls.coldCacheRequired = false;
    if (change === 'recovery-cache') f.recoveryControls.coldCacheRequired = true;
    if (change === 'run-id') f.recoveryControls.priorRunId = id(999);
    if (change === 'cold-hash') f.recoveryControls.priorResultsSha256 = sha256('changed cold result');
    if (change === 'packs') f.recovery.diagnosticRun.structureSynthesisPacks!.pop();
    if (change === 'partial-source') f.recovery.diagnosticRun.completedUnits = 670;
    f.cold.controlsSha256 = hashControl(f.coldControls); f.recovery.controlsSha256 = hashControl(f.recoveryControls);
    expect(() => assertOutlineV2History(f.declaration, f.corpus, f.coldControls, f.cold, f.recoveryControls, f.recovery)).toThrow('recovery-lineage-mismatch');
  }
});

it('allows only fresh final organization and full v2 source reviews at unchanged caps', () => {
  expect(() => assertOutlineV2PaidStage('outline-organization', 24000)).not.toThrow();
  expect(() => assertOutlineV2PaidStage('outline-source-review', 6000)).not.toThrow();
  for (const [stage, cap] of [['source-extraction', 12000], ['outline-synthesis', 24000], ['outline-source-review', 8000], ['outline-organization', 12000], ['unlabelled', 6000]] as const) {
    expect(() => assertOutlineV2PaidStage(stage, cap)).toThrow('validated-warm-cache-or-stage-cap-required');
  }
});
