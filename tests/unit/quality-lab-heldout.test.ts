import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { freezeHeldoutCases, heldoutComparisonPlan, HELDOUT_DEFINITIONS, recoverHeldoutPromptBuilder } from '../../scripts/quality-lab/freeze-heldout';
import type { OutlineCorpusFixture } from '../../scripts/quality-lab/outline-controls';
import { caseControls, fixtureHash, hashControl, sha256, validateFixture, type FrozenFixture, type LabCase } from '../../scripts/quality-lab/protocol';

jest.mock('../../server/src/components/genai/llm', () => { throw new Error('Held-out preparation must not import provider code.'); });
jest.mock('../../server/src/components/mongodb/collections', () => { throw new Error('Held-out preparation must not import database code.'); });

const root = path.join(__dirname, '../..');
const sources = { generation: readFileSync(path.join(root, 'server/src/services/generation.service.ts'), 'utf8'),
  quality: readFileSync(path.join(root, 'server/src/services/generation-quality.service.ts'), 'utf8'),
  memory: readFileSync(path.join(root, 'server/src/services/generation-memory.service.ts'), 'utf8'),
  citations: readFileSync(path.join(root, 'server/src/services/generation-citation-spans.ts'), 'utf8') };
const recovered = recoverHeldoutPromptBuilder(sources);

/** Synthetic source documents exercise fixture integrity only; they are never
 * labelled real source evidence or used to claim question quality. */
function corpus(): OutlineCorpusFixture {
  const sourceRows = HELDOUT_DEFINITIONS.map(definition => {
    const chunks = Array.from({ length: Math.max(...definition.chunks.map(chunk => chunk.index)) + 1 }, (_, index) => {
      const selected = definition.chunks.find(chunk => chunk.index === index);
      const text = selected ? `Synthetic unit-only source\n${selected.anchor}\nExact spacing survives. ` : `Synthetic unit-only paragraph ${index}.`;
      return { index, text, characterCount: text.length };
    });
    const digest = createHash('sha256'); chunks.forEach(chunk => digest.update(`${chunk.index}:${Buffer.byteLength(chunk.text, 'utf8')}:`).update(chunk.text));
    const snapshot = { materialId: `heldout-${definition.chapter}`, name: `Synthetic chapter ${definition.chapter}`, sourceTextHash: digest.digest('hex'),
      chunkCount: chunks.length, characterCount: chunks.reduce((sum, chunk) => sum + chunk.characterCount, 0), parserVersion: 'unit-parser', chunkerVersion: 'unit-chunker' };
    return { chapter: definition.chapter, pages: 20, publicPdf: '/unit-only/source.pdf', pdfSha256: sha256(`unit-pdf-${definition.chapter}`),
      materialId: snapshot.materialId, name: snapshot.name, chunks, manifest: { ...snapshot, indexedCount: chunks.length },
      readiness: { materialId: snapshot.materialId, name: snapshot.name, ready: true, state: 'indexed' as const, classification: 'completed' as const, snapshot } };
  });
  return { version: 1, courseId: 'unit-course', actor: 'QUALITY-RETEST-FIXTURE-unit', database: 'financebot_quality_smoke_retest_unit', fixtureKind: 'unit-only', createdAt: '2026-10-16', copiedCacheRows: 0, sources: sourceRows };
}
function tuning(): FrozenFixture {
  const text = 'Synthetic tuning source.';
  const item: LabCase = { id: 'unit-tuning', split: 'tuning', description: 'Unit only.',
    request: { loName: 'Unit tuning', type: 'mcq', kind: 'conceptual', difficulty: 'easy', instructions: 'Unit only.' },
    packet: { id: 'unit-packet', schemaVersion: 'source-passages-v1', policyVersion: 'grounded-memory-v2', courseId: 'unit-course', loIds: ['unit-lo'], sourceFingerprint: 'unit', parsingProvenance: 'unrecorded', materials: [],
      passages: [{ id: 'U1', materialId: 'tuning-material', materialName: 'Unit source', role: 'primary', chunkIndex: 0, start: 0, end: text.length, text, selection: 'retrieved' }],
      coverage: { sourceChunks: 1, selectedChunks: 1, selectedCharacters: text.length, omittedPassages: 0, truncated: false, searchScope: 'retrieved-chunks-and-immediate-neighbors' }, findings: [] },
    memory: recovered.builder.memory([], false, 0), requirements: { intent: 'create-independent-task', preserve: [], requiredChanges: [] },
    generatorPrompt: 'Unit tuning prompt.', generatorPromptSha256: sha256('Unit tuning prompt.'), controlsSha256: '', teacherAcceptance: null };
  item.controlsSha256 = hashControl(caseControls(item));
  const fixture: FrozenFixture = { version: 1, createdAt: '2026-10-16', origin: { observationsPath: '/unit/tuning.json', observationsSha256: 'unit', purpose: 'Unit only.' },
    sourceControls: [{ material: { _id: 'tuning-material', name: 'Unit source' }, pdfSha256: sha256('unit-tuning-pdf'), chunks: [{ index: 0, text }] }],
    bankHeads: [], bankVersions: [], cases: [item], fixtureSha256: '', limitations: [] };
  fixture.fixtureSha256 = fixtureHash(fixture); return fixture;
}
function inputs() {
  const data = corpus();
  return { corpus: data, corpusRaw: JSON.stringify(data), corpusPath: '/unit/corpus.json', tuning: tuning(),
    pdfHashes: Object.fromEntries(data.sources.map(source => [source.materialId, source.pdfSha256])), builder: recovered.builder, createdAt: '2026-10-16T00:00:00.000Z' };
}

describe('prospective source-disjoint held-out question fixtures', () => {
  it('recovers actual pure production prompt declarations without executing module side effects', () => {
    const safe = recoverHeldoutPromptBuilder({ ...sources, generation: `${sources.generation}\nthrow new Error('must-not-execute-production-module');` });
    const frozen = freezeHeldoutCases({ ...inputs(), builder: safe.builder });
    expect(frozen.cases).toHaveLength(6);
    expect(frozen.cases[0]!.generatorPrompt).toContain('Tax Benefit = Depreciation * Tax Rate');
    expect(frozen.cases[0]!.generatorPrompt).toContain('SOURCE EVIDENCE ONLY (S IDs)');
    expect(frozen.cases[0]!.generatorPrompt).toContain('BANK/QUEUE MEMORY ONLY (M IDs)');
    expect(safe.declarations.some(item => item.name === 'GENERATOR_V2_PROMPT')).toBe(true);
    expect(() => recoverHeldoutPromptBuilder({ ...sources, generation: '' })).toThrow('prompt-declaration-missing');
  });
  it('freezes exact original coordinates, complete source archives and byte-identical per-case prompts for both paired repetitions', () => {
    const frozen = freezeHeldoutCases(inputs()); validateFixture(frozen);
    const plan = heldoutComparisonPlan(frozen);
    expect(plan.generatorSlots).toBe(60); expect(plan.minimumGeneratorAndPrimaryJudgeSends).toBe(120);
    expect(plan.positiveSupplySlots).toBe(50); expect(plan.safetyNegativeSlots).toBe(10);
    expect(plan.sendsWithOneCitationCorrectionPerJudgeAndOneJsonCorrectionPerCompletion).toBe(360);
    expect(plan.schedule).toHaveLength(60); expect(plan.providerCalls).toBe(0); expect(plan.databaseCalls).toBe(0);
    for (const item of frozen.cases) {
      expect(item.split).toBe('held-out'); expect(item.teacherAcceptance).toBeNull();
      expect(plan.schedule.filter(cell => cell.caseId === item.id)).toHaveLength(10);
      expect(plan.perCase.find(row => row.id === item.id)!.promptSha256).toBe(sha256(item.generatorPrompt));
      for (const passage of item.packet.passages) {
        const source = frozen.sourceControls.find(row => row.material._id === passage.materialId)!;
        expect(source.chunks.find(chunk => chunk.index === passage.chunkIndex)!.text.slice(passage.start, passage.end)).toBe(passage.text);
      }
    }
    expect(plan.executionBoundary).toContain('at least120');
  });
  it('rejects tuning PDF reuse even when the material identity was changed', () => {
    const input = inputs(); input.tuning.sourceControls[0]!.pdfSha256 = input.corpus.sources[0]!.pdfSha256;
    input.tuning.fixtureSha256 = fixtureHash(input.tuning);
    expect(() => freezeHeldoutCases(input)).toThrow('source-used-for-tuning');
  });
  it('rejects incomplete physical originals, changed manifests and shifted case anchors before prompt generation', () => {
    const pdf = inputs(); pdf.pdfHashes[pdf.corpus.sources[0]!.materialId] = sha256('wrong bytes');
    expect(() => freezeHeldoutCases(pdf)).toThrow('complete-pdf-hash-mismatch');
    const manifest = inputs(); manifest.corpus.sources[0]!.manifest.indexedCount = 0;
    expect(() => freezeHeldoutCases(manifest)).toThrow('manifest-mismatch');
    const text = inputs(); text.corpus.sources[0]!.chunks[0]!.text += ' changed';
    expect(() => freezeHeldoutCases(text)).toThrow('chunks-incomplete');
  });
  it('does not mistake an internally rehashed altered quote for an original source span', () => {
    const frozen = freezeHeldoutCases(inputs()); const item = frozen.cases[0]!;
    item.packet.passages[0]!.start = 1; item.controlsSha256 = hashControl(caseControls(item)); frozen.fixtureSha256 = fixtureHash(frozen);
    expect(() => validateFixture(frozen)).toThrow('source-coordinate');
  });
  it('keeps synthetic Bank provenance, source ambiguity and unknown human labels separate from empirical wins', () => {
    const frozen = freezeHeldoutCases(inputs()); const plan = heldoutComparisonPlan(frozen);
    expect(frozen.heldoutBoundary.bankProvenance).toContain('synthetic');
    expect(frozen.heldoutBoundary.publicPretrainingExposure).toBe('unknown');
    expect(frozen.heldoutBoundary.modelSourceExposure).toContain('outline');
    expect(frozen.heldoutBoundary.cases.filter(item => item.safetyNegative)).toHaveLength(1);
    expect(plan.teacherAcceptance).toBeNull(); expect(plan.saved).toBe(0); expect(plan.adopted).toBe(0);
    expect(plan.fixedSecondAssessor.model).toBeNull();
    for (const item of frozen.cases) for (const entry of item.memory.entries) expect(entry.taskDescriptor!.targetDifficulty).toBe('easy');
  });
});
