import { createHash } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import { BUILTIN_REFERENCE } from '../../server/src/components/formula';
import type { PedagogicalTaskDescriptor } from '../../server/src/types/authoring-task';
import type { GenerationEvidencePacket } from '../../server/src/types/generation-evidence';
import type { GenerationMemoryContent, GenerationMemoryEntry, GenerationMemorySnapshot } from '../../server/src/services/generation-memory.service';
import { fixtureSections, type OutlineCorpusFixture } from './outline-controls';
import { caseControls, fixtureHash, hashControl, MODEL_ARMS, scheduleCells, sha256, validateFixture, type FrozenFixture, type LabCase } from './protocol';

interface BankSeed { stem: string; answers: [string, string, string, string]; inference: string; solution: string[] }
interface HeldoutDefinition {
  id: string; chapter: number; chunks: Array<{ index: number; anchor: string }>;
  request: LabCase['request']; description: string; inference: string; solution: string[]; misconception: string;
  bank: BankSeed[]; safetyNegative: boolean;
}

/** These cases are selected before any experimental question response. They are
 * source-disjoint from the retained tuning PDFs, not unseen public knowledge. */
export const HELDOUT_DEFINITIONS: readonly HeldoutDefinition[] = [
  { id: 'heldout-depreciation-decimal-units', chapter: 5, chunks: [{ index: 21, anchor: 'Tax Benefit = Depreciation * Tax Rate' }],
    request: { loName: 'Compute the tax benefit of tax-deductible depreciation.', type: 'mcq', kind: 'calculation', difficulty: 'easy',
      instructions: 'Create one independent calculation task using small explicit decimal input grids. State depreciation in dollars and the tax rate as a percentage; preserve the source tax-benefit relationship. Show every input and compute every option from a formula. Do not add deferred-tax, loss-carryforward or depreciation-schedule assumptions.' },
    description: 'Decimal currency and percentage units with an overlapping non-cash-expense recall comparator.',
    inference: 'Apply the source depreciation tax-benefit relationship to explicitly displayed decimal dollar and percentage inputs.',
    solution: ['Identify tax-deductible depreciation and the tax percentage.', 'Multiply depreciation by the percentage divided by 100.', 'Express the benefit in the same dollar unit as depreciation.'],
    misconception: 'Treating the depreciation charge itself as a cash outflow rather than computing its tax benefit.',
    bank: [{ stem: 'Why is depreciation added back when moving from earnings to cash flows?', answers: ['It is a non-cash charge.', 'It is itself a cash receipt.', 'It reduces taxes but remains a cash expense.', 'It is always irrelevant to taxes.'], inference: 'Recognize depreciation as a non-cash charge.', solution: ['Identify whether the accounting charge is a cash expenditure.'] }], safetyNegative: false },
  { id: 'heldout-interest-tax-condition-memory', chapter: 8, chunks: [{ index: 2, anchor: 'you need to have the income to cover interest payments' }],
    request: { loName: 'Explain the income condition on the annual tax benefit of debt.', type: 'mcq', kind: 'conceptual', difficulty: 'medium',
      instructions: 'Create a distinct task relative to both supplied Bank tasks. Test the source income-coverage caveat using a short scenario; do not repeat the interest-deductibility definition or a changed-number tax-benefit calculation. Do not infer tax refunds, carryforwards or jurisdiction-specific rules absent from the source.' },
    description: 'Two overlapping Bank tasks leave the stated income condition as a prospective distinct inference, without guaranteeing independent supply.',
    inference: 'Determine why the source does not justify an unconditional interest tax benefit when income does not cover the interest payment.',
    solution: ['Identify the annual tax-benefit claim.', 'Check the source condition that income covers the interest payment.', 'Refuse an unconditional benefit claim when that premise is absent.'],
    misconception: 'Assuming an interest deduction always produces the same tax benefit regardless of available income.',
    bank: [{ stem: 'What source-stated difference gives debt an annual tax advantage over equity?', answers: ['Interest payments are deductible when arriving at taxable income.', 'Dividends are deductible but interest is not.', 'Both can reduce investor risk, so their tax treatment is identical.', 'Debt eliminates all taxes on operating income.'], inference: 'Recall interest deductibility relative to payments to equity.', solution: ['Identify which financing payment the notes permit deducting.'] },
      { stem: 'Which expression is the annual tax benefit from an interest payment?', answers: ['Tax Rate * Interest Payment', 'Interest Payment / Tax Rate', 'Interest Payment is deductible, so the benefit must equal the whole payment.', 'Tax Rate + Interest Payment'], inference: 'State the annual interest tax-benefit formula.', solution: ['Multiply the tax rate by the interest payment.'] }], safetyNegative: false },
  { id: 'heldout-debt-currency-not-location', chapter: 9, chunks: [{ index: 53, anchor: 'figure out which currency its cash flows are in' }, { index: 62, anchor: 'but its revenues are in US dollars' }],
    request: { loName: 'Match financing currency to the source of operating cash flows.', type: 'mcq', kind: 'conceptual', difficulty: 'medium',
      instructions: 'Create a distinct inference from the Bank recall task by contrasting the locations of operating assets or customers with the currency of revenues. Use only the source conditions. Do not infer a numerical currency exposure or optimal percentage of debt from geography alone.' },
    description: 'Source-owned business example separates revenue currency from mine/customer geography; Bank memory already contains the direct matching rule.',
    inference: 'Distinguish geographic exposure from the currency of cash flows when evaluating a proposed debt currency.',
    solution: ['Identify the currency of the revenue cash flows.', 'Keep asset and customer locations separate from revenue denomination.', 'Apply the source financing-currency recommendation without inventing debt weights.'],
    misconception: 'Choosing debt currency only from the country of a mine or customer rather than the stated cash-flow currency.',
    bank: [{ stem: 'What should guide the currency of a firm’s debt according to the source?', answers: ['The currency of its cash flows.', 'Only the country in which its headquarters is located.', 'Cash-flow sensitivity is relevant, but the currency need not match.', 'The currency with the shortest printed name.'], inference: 'Recall that debt currency should reflect cash-flow currency.', solution: ['Identify the cash-flow currency matching rule.'] }], safetyNegative: false },
  { id: 'heldout-dividend-thin-hardness', chapter: 10, chunks: [{ index: 36, anchor: 'The Miller-Modigliani Hypothesis: Dividends do not affect' }],
    request: { loName: 'Explain dividend irrelevance under the source’s explicit assumptions.', type: 'mcq', kind: 'conceptual', difficulty: 'hard',
      instructions: 'Keep the stem short and attempt a distinct task under the supplied assumptions. Do not repeat the Bank definition by adding names or longer wording. Do not add signaling, clientele, agency or tax-rate models absent from this packet to manufacture hardness. Report the difficulty actually earned if the thin source cannot support a hard independent task.' },
    description: 'Hardness pressure on one tightly scoped argument; source support, novelty and achieved difficulty are separate outcomes.',
    inference: 'Trace the source explanation for replacing cash paid out with costless new equity while keeping investment policy unchanged.',
    solution: ['Keep the source investment-policy and cash-flow assumptions fixed.', 'Trace replacement financing when more cash is paid out.', 'Distinguish the payout split from total value under the stated assumptions.'],
    misconception: 'Treating a higher dividend alone as a value increase while ignoring replacement equity and price appreciation.',
    bank: [{ stem: 'What does the stated Miller-Modigliani hypothesis predict for a change in dividends under its assumptions?', answers: ['The change does not affect value.', 'Every dividend increase raises value.', 'Value can stay unchanged only if the dividend is zero.', 'The hypothesis requires investment cash flows to disappear.'], inference: 'Recall the dividend-irrelevance conclusion under the stated assumptions.', solution: ['Apply the source hypothesis while preserving its assumptions.'] }], safetyNegative: false },
  { id: 'heldout-valuation-notation-mismatch', chapter: 12, chunks: [{ index: 4, anchor: 'at the cost of equity' }, { index: 5, anchor: 'at the weighted average cost of capital' }, { index: 6, anchor: 'WACC = Weighted Average Cost of Capital' }, { index: 14, anchor: 'mismatching cashflows' }],
    request: { loName: 'Diagnose a mismatch between valuation cash flows and discount rates.', type: 'mcq', kind: 'conceptual', difficulty: 'medium',
      instructions: 'Preserve the source ke and WACC notation and its cash-flow ownership. Create a distinct diagnostic task relative to the two Bank recall tasks. Do not substitute cost-of-equity notation for WACC, invent debt-tax calculations, or treat a formula damaged by PDF layout as new source content.' },
    description: 'Cross-chunk definitions preserve equity/firm cash-flow ownership and ke/WACC conventions without reusing the tuning CAPM examples.',
    inference: 'Identify the specific rate/cash-flow mismatch in an analyst’s valuation while retaining the source symbols.',
    solution: ['Identify whether the valued claim receives equity or firm cash flows.', 'Match equity cash flows to ke or firm cash flows to WACC.', 'Explain the mismatch rather than merely restating a symbol definition.'],
    misconception: 'Discounting cash flows to the firm at ke or cash flows to equity at WACC.',
    bank: [{ stem: 'Which discount rate does the source associate with cash flows to equity?', answers: ['Cost of equity, ke.', 'Weighted Average Cost of Capital, WACC.', 'A rate consistent with risk but unrelated to the equity claim.', 'Zero regardless of risk.'], inference: 'Recall the rate for cash flows to equity.', solution: ['Match the equity claim to its source discount rate.'] },
      { stem: 'Which discount rate does the source associate with cash flows to the firm?', answers: ['Weighted Average Cost of Capital, WACC.', 'Cost of equity, ke.', 'The cost of one financing component without weighting.', 'The sum of all yearly cash flows.'], inference: 'Recall the rate for cash flows to the firm.', solution: ['Match the firm claim to its source discount rate.'] }], safetyNegative: false },
  { id: 'heldout-chart-missing-point-negative', chapter: 11, chunks: [{ index: 15, anchor: 'Chrysler: FCFE, Dividends and Cash Balance' }, { index: 16, anchor: 'Free CF to Equity' }],
    request: { loName: 'Read a year-specific cash-flow value from the supplied source chart.', type: 'mcq', kind: 'calculation', difficulty: 'easy',
      instructions: 'Create a numerical task using Chrysler’s 1989 Free CF to Equity and cash returned to stockholders from the supplied chart. Use actual source point values, not axis ticks, nearby years, pretraining or invented numbers. If the parsed packet does not retain the point-to-series-to-year relationships, do not invent a numerical answer to fill the requested slot.' },
    description: 'Safety negative: extracted chart axes and series labels do not specify a reliable 1989 point value. The complete PDF remains archived; absence in this packet is not absence in the original image.',
    inference: 'Read exact year/series values only when the supplied original-source representation preserves those relationships.',
    solution: ['Locate the requested year and the correct series.', 'Require a readable point value for each requested quantity.', 'Do not substitute axis labels for the missing year/series point values.'],
    misconception: 'Treating a chart axis tick or nearby year as an observed cash-flow point.', bank: [], safetyNegative: true },
];

export interface HeldoutPromptBuilder {
  generator(params: { type: LabCase['request']['type']; loName: string; difficulty: LabCase['request']['difficulty']; prompt: string; kind: LabCase['request']['kind']; chunks: Array<{ text: string; materialId: string; chunkIndex: number }>; qualityContext: string }): string;
  instruction(packet: GenerationEvidencePacket, memory: GenerationMemorySnapshot, query: string, requirements: LabCase['requirements']): string;
  fingerprint(content: GenerationMemoryContent): GenerationMemoryEntry['fingerprint'];
  memory(entries: GenerationMemoryEntry[], truncated: boolean, missingVersions: number): GenerationMemorySnapshot;
}
export interface HeldoutFixture extends FrozenFixture {
  heldoutBoundary: { questionResponseHeldOutAtFreeze: true; priorTuningFixtureSha256: string; excludedTuningPdfHashes: string[];
    definitionVersion: string; modelSourceExposure: string; publicPretrainingExposure: 'unknown'; teacherAcceptance: null;
    bankProvenance: 'prospectively-authored-synthetic-comparators-not-live-bank';
    cases: Array<{ id: string; chapter: number; safetyNegative: boolean; selectedChunks: number[]; originalChunks: number; originalPdfPages: number; teacherAcceptance: null }> };
}

/** Recover only named trusted pure declarations. This never imports a provider,
 * Mongo, embeddings or the side-effectful production generation module. */
export function recoverHeldoutPromptBuilder(sources: { generation: string; quality: string; memory: string; citations: string }): {
  builder: HeldoutPromptBuilder; declarations: Array<{ file: string; name: string; sha256: string }> } {
  const groups = [
    ['generation', ['DIFFICULTY_RUBRIC', 'HARDNESS_MOVES', 'HARDNESS_MOVE_DECLARATION', 'integrationRule', 'renderChunks', 'GENERATOR_V2_PROMPT']],
    ['memory', ['GENERATION_MEMORY_SCHEMA_VERSION', 'normalizeText', 'variantText', 'digest', 'contentFingerprint', 'snapshot', 'tokens', 'cosine', 'boundedInteger', 'compactTaskComparison', 'selectGenerationMemory']],
    ['citations', ['sourceCitationSpans', 'renderSourceCitationSpans']],
    ['quality', ['memoryAliases', 'renderQualityMemory', 'authoringIntentInstruction', 'generationQualityInstruction']],
  ] as const;
  const code: string[] = []; const identities: Array<{ file: string; name: string; sha256: string }> = [];
  for (const [file, wanted] of groups) {
    const parsed = ts.createSourceFile(`${file}.ts`, sources[file], ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const declarations = new Map<string, string>();
    for (const statement of parsed.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name) declarations.set(statement.name.text, statement.getText(parsed).replace(/^export\s+/, ''));
      if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) declarations.set(declaration.name.text, `const ${declaration.getText(parsed)};`);
      }
    }
    for (const name of wanted) {
      const text = declarations.get(name); if (!text) throw new Error(`quality-lab-heldout-prompt-declaration-missing:${file}:${name}`);
      code.push(text); identities.push({ file, name, sha256: sha256(text) });
    }
  }
  const exported = '{generator:GENERATOR_V2_PROMPT,instruction:generationQualityInstruction,fingerprint:contentFingerprint,memory:snapshot}';
  const compiled = ts.transpileModule(`${code.join('\n')}\n(${exported});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const builder = vm.runInNewContext(compiled, { BUILTIN_REFERENCE, createHash }, { timeout: 1000 }) as HeldoutPromptBuilder;
  return { builder, declarations: identities };
}

export function freezeHeldoutCases(input: { corpus: OutlineCorpusFixture; corpusRaw: string; corpusPath: string; tuning: FrozenFixture;
  pdfHashes: Record<string, string>; builder: HeldoutPromptBuilder; createdAt: string }): HeldoutFixture {
  validateFixture(input.tuning);
  const corpus = fixtureSections(input.corpus, HELDOUT_DEFINITIONS.map(item => item.chapter));
  const tuningHashes = new Set(input.tuning.sourceControls.map(source => source.pdfSha256));
  const tuningIds = new Set(input.tuning.sourceControls.map(source => source.material._id));
  for (const source of corpus.included) {
    if (tuningHashes.has(source.pdfSha256) || tuningIds.has(source.materialId)) throw new Error('quality-lab-heldout-source-used-for-tuning');
    if (input.pdfHashes[source.materialId] !== source.pdfSha256) throw new Error('quality-lab-heldout-complete-pdf-hash-mismatch');
  }
  const bankHeads: unknown[] = []; const bankVersions: unknown[] = [];
  const cases: LabCase[] = HELDOUT_DEFINITIONS.map(definition => {
    const source = corpus.included.find(item => item.chapter === definition.chapter)!;
    const loId = sha256(definition.id).slice(0, 24);
    const passages = definition.chunks.map(({ index, anchor }) => {
      const chunk = source.chunks.find(row => row.index === index);
      if (!chunk || !chunk.text.includes(anchor)) throw new Error(`quality-lab-heldout-source-anchor-changed:${definition.id}:${index}`);
      return { id: `H${definition.chapter}-C${index}`, materialId: source.materialId, materialName: source.name, role: 'primary' as const,
        chunkIndex: index, start: 0, end: chunk.text.length, text: chunk.text, selection: 'retrieved' as const };
    });
    const packet: GenerationEvidencePacket = { id: '', schemaVersion: 'source-passages-v1', policyVersion: 'grounded-memory-v2',
      courseId: input.corpus.courseId, loIds: [loId], sourceFingerprint: hashControl({ materialId: source.materialId, hash: source.manifest.sourceTextHash, passages }),
      parsingProvenance: 'unrecorded', materials: [{ materialId: source.materialId, role: 'primary', name: source.name,
        revision: source.readiness.snapshot?.revision ?? null, activeRunId: null, contentHash: source.manifest.sourceTextHash,
        chunkCount: source.chunks.length, parserVersion: source.manifest.parserVersion, chunkerVersion: source.manifest.chunkerVersion }],
      passages, coverage: { sourceChunks: source.chunks.length, selectedChunks: passages.length,
        selectedCharacters: passages.reduce((sum, passage) => sum + passage.text.length, 0), omittedPassages: 0, truncated: false,
        searchScope: 'retrieved-chunks-and-immediate-neighbors' }, findings: [] };
    packet.id = hashControl(packet);
    const descriptor = (inference: string, solution: string[]): PedagogicalTaskDescriptor => ({ concepts: [definition.request.loName], requiredInference: inference,
      solutionPath: solution, misconception: definition.misconception, targetDifficulty: definition.request.difficulty, passageIds: passages.map(passage => passage.id), intent: 'create-independent-task' });
    const entries: GenerationMemoryEntry[] = definition.bank.map((seed, index) => {
      const questionId = sha256(`${definition.id}:bank:${index}`).slice(0, 24), versionId = sha256(`${definition.id}:version:${index}`).slice(0, 24);
      const content: GenerationMemoryContent = { type: 'mcq', numericKind: 'conceptual', paramSlots: [], derivedValues: [], stem: seed.stem,
        options: seed.answers.map((text, item) => ({ key: 'ABCD'[item]!, role: (['correct', 'common-misconception', 'partially-correct', 'clearly-wrong'] as const)[item]!, text,
          explanation: item === 0 ? seed.solution.join(' ') : 'This alternative does not preserve the source-stated relationship.' })) };
      bankHeads.push({ _id: questionId, currentVersionId: versionId, state: 'draft', provenance: 'synthetic-heldout-comparator' });
      bankVersions.push({ _id: versionId, questionId, ...content, provenance: 'synthetic-heldout-comparator' });
      return { id: `q:${questionId}:${versionId}`, source: 'bank', questionId, versionId, familyId: questionId, state: 'draft', content,
        taskDescriptor: { ...descriptor(seed.inference, seed.solution), targetDifficulty: 'easy' }, fingerprint: input.builder.fingerprint(content) };
    });
    const memory = input.builder.memory(entries, false, 0);
    const requirements: LabCase['requirements'] = { intent: 'create-independent-task', requiredChanges: [definition.request.instructions],
      preserve: [], requestedDifficulty: definition.request.difficulty, plannedTask: descriptor(definition.inference, definition.solution) };
    const qualityContext = input.builder.instruction(packet, memory, `${definition.request.loName}\n${definition.request.instructions}`, requirements);
    const generatorPrompt = input.builder.generator({ ...definition.request, prompt: definition.request.instructions, qualityContext,
      chunks: passages.map(passage => ({ materialId: passage.materialId, chunkIndex: passage.chunkIndex, text: passage.text })) });
    const item: LabCase = { id: definition.id, split: 'held-out', description: definition.description, request: definition.request, packet, memory,
      requirements, generatorPrompt, generatorPromptSha256: sha256(generatorPrompt), controlsSha256: '', teacherAcceptance: null };
    item.controlsSha256 = hashControl(caseControls(item)); return item;
  });
  const fixture: HeldoutFixture = { version: 1, createdAt: input.createdAt,
    origin: { observationsPath: input.corpusPath, observationsSha256: sha256(input.corpusRaw), purpose: 'Prospective source-disjoint question-response comparison; two repetitions across five exact arms. No model calls occur during freezing.' },
    sourceControls: corpus.included.map(source => ({ material: { _id: source.materialId, name: source.name, chapter: source.chapter, pages: source.pages },
      pdfSha256: source.pdfSha256, chunks: source.chunks.map(chunk => ({ ...chunk })) })), bankHeads, bankVersions, cases, fixtureSha256: '',
    heldoutBoundary: { questionResponseHeldOutAtFreeze: true, priorTuningFixtureSha256: input.tuning.fixtureSha256,
      excludedTuningPdfHashes: [...tuningHashes], definitionVersion: 'heldout-question-cases-v1',
      modelSourceExposure: 'No experimental question responses were used to select these cases. The complete ten-source outline may expose these source texts before question comparison; this is not a source-naive or pretraining-held-out test.',
      publicPretrainingExposure: 'unknown', teacherAcceptance: null, bankProvenance: 'prospectively-authored-synthetic-comparators-not-live-bank',
      cases: HELDOUT_DEFINITIONS.map(definition => { const source = corpus.included.find(item => item.chapter === definition.chapter)!; return {
        id: definition.id, chapter: definition.chapter, safetyNegative: definition.safetyNegative, selectedChunks: definition.chunks.map(chunk => chunk.index),
        originalChunks: source.chunks.length, originalPdfPages: source.pages, teacherAcceptance: null }; }) },
    limitations: ['Selected original chunks are the declared case scope. Complete PDFs and chunks are retained for audit; this comparison does not establish full chapter coverage.',
      'These are held out from prior experimental question responses and the Chapter 3/4 tuning sources, not from engineering inspection, outline exposure or unknown public-book pretraining.',
      'Bank comparators are prospectively authored synthetic engineering fixtures, not persisted or instructor-approved questions.',
      'One source-ambiguity negative is reported separately from positive supply; a withheld unsupported slot is not a generation-quality failure.',
      'Teacher acceptance, review time and source-semantic gold labels remain null. The fixed Sol assessor shares a family with Sol generators.',
      'No Bank writes, model setting changes, question saves/adoptions, provider calls or database calls occur during this preparation.'] };
  fixture.fixtureSha256 = fixtureHash(fixture); validateFixture(fixture); return structuredClone(fixture);
}

export function heldoutComparisonPlan(fixture: HeldoutFixture) {
  const schedule = scheduleCells(fixture, 2);
  return { version: 1, fixtureSha256: fixture.fixtureSha256, providerCalls: 0, databaseCalls: 0, state: 'prepared-not-executed',
    arms: MODEL_ARMS, repetitions: 2, schedule, scheduleSha256: hashControl(schedule),
    generatorSlots: schedule.length, minimumGeneratorAndPrimaryJudgeSends: schedule.length * 2,
    positiveSupplySlots: fixture.heldoutBoundary.cases.filter(item => !item.safetyNegative).length * MODEL_ARMS.length * 2,
    safetyNegativeSlots: fixture.heldoutBoundary.cases.filter(item => item.safetyNegative).length * MODEL_ARMS.length * 2,
    sendsWithOneJsonCorrectionPerCompletionAndNoCitationCorrection: schedule.length * 4,
    sendsWithOneCitationCorrectionPerJudgeAndOneJsonCorrectionPerCompletion: schedule.length * 6,
    logicalRepairSendsIncluded: false,
    perCase: fixture.cases.map(item => ({ id: item.id, split: item.split, promptSha256: item.generatorPromptSha256,
      controlsSha256: item.controlsSha256, generatorInputEnvelopeUnits: Buffer.byteLength(JSON.stringify([{ role: 'user', content: item.generatorPrompt }]), 'utf8') + 32 })),
    fixedPrimaryAssessor: { model: 'gpt-6.1-sol', effort: 'medium', proposedOutputCap: 6000 },
    fixedSecondAssessor: { model: null, family: 'different-from-both-generator-families', state: 'recommended-not-selected-or-executed',
      protocol: 'Predeclare an available exact model/effort and identical frozen candidate/source/Bank/request input; judge blinded. Report agreement and disagreements without treating majority vote as teacher truth.' },
    recorder: 'Reuse captureJson/createCapturedCompletion: full actual prompt/options/raw visible output per attempt, corrections, failure/omitted slots, actual model identity, reported tokens and latency. Hidden reasoning is not recorded.',
    executionBoundary: 'The unchanged phase-one runner refuses more than100 sends. This six-case/two-repetition matrix needs at least120. A later versioned prospective phase envelope and code freeze are required; do not reset the phase-one ledger or silently run a partial matrix.',
    teacherAcceptance: null, saved: 0, adopted: 0 };
}
