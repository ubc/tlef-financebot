/** Offline replay of retained candidates. No model calls or database writes. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { EVALUATOR_VERSION, evaluateFormula, parseFormula } from '../server/src/components/formula';
import { numericInputDisplayFailure, INPUT_DISPLAY_VERIFICATION_VERSION } from '../server/src/services/numeric-input-display.service';
import { optionValueNamesForVerification, verifyQuestionNumerics } from '../server/src/services/numeric-verification.service';
import { drawCollisionFreeParams } from '../server/src/services/params.service';
import type { QuestionVersion } from '../server/src/types/domain';

const source = 'audit-results/generation-quality-corpus/generation-final-run-agent-review.json';
const raw = readFileSync(source, 'utf8');
const review = JSON.parse(raw) as { publicRequestedSlots: Array<{ case: string; item: number; storageOutcome: string;
  numericalDisplayAudit?: { finiteCombinations: number; anyDisplayedCalculationMismatch: number };
  fullBoundedAssessment?: { candidate: QuestionVersion } }> };

async function main() {
  const rows = [];
  for (const row of review.publicRequestedSlots.filter(row => row.numericalDisplayAudit)) {
    const candidate = row.fullBoundedAssessment!.candidate;
    const slots = candidate.paramSlots ?? [], derivedValues = candidate.derivedValues ?? [];
    const names = optionValueNamesForVerification(candidate.options.map(option => option.text), derivedValues.map(value => value.name));
    if (!names.ok) throw new Error(names.error);
    const proof = verifyQuestionNumerics({ stem: candidate.stem, slots, derivedValues, optionValueNames: names.names, optionCurrency: names.currency });
    let combinations: Array<Record<string, number>> = [{}];
    for (const slot of slots) {
      if (!slot.values?.length || combinations.length * slot.values.length > 1000) throw new Error('This audit requires a bounded finite enumeration.');
      combinations = combinations.flatMap(values => slot.values!.map(value => ({ ...values, [slot.name]: value })));
    }
    let refusedCombinations = 0;
    for (const inputs of combinations) {
      const values = { ...inputs };
      for (const derived of derivedValues) {
        const parsed = parseFormula(derived.formula);
        if (!parsed.ok) throw new Error(parsed.error);
        const result = evaluateFormula(parsed.ast, values);
        if (!result.ok) throw new Error(result.error);
        values[derived.name] = result.value;
      }
      if (numericInputDisplayFailure({ stem: candidate.stem, slots, derivedValues, values, optionTexts: candidate.options.map(option => option.text) })) refusedCombinations++;
    }
    let actualDrawRefusal: string | null = null;
    if (!proof.ok && proof.failingSeed !== undefined) {
      try { await drawCollisionFreeParams(candidate, () => proof.failingSeed!); }
      catch (error) { actualDrawRefusal = error instanceof Error ? error.message : 'Refused'; }
    }
    if (proof.ok || !actualDrawRefusal || combinations.length !== row.numericalDisplayAudit!.finiteCombinations
      || refusedCombinations !== row.numericalDisplayAudit!.anyDisplayedCalculationMismatch) throw new Error('The shared guard did not match the retained independent finite-domain audit.');
    rows.push({ case: row.case, item: row.item, recordedStorageOutcome: row.storageOutcome,
      proofAccepted: proof.ok, proofFailure: proof.ok ? null : { reason: proof.error, seed: proof.failingSeed },
      finiteCombinations: combinations.length, refusedCombinations, admittedCombinations: combinations.length - refusedCombinations,
      agreesWithIndependentPreFixAudit: true, actualDrawRefusal, teacherJudgment: null });
  }
  if (rows.length !== 2) throw new Error('Expected the two retained CAPM candidates.');
  const result = { capturedAt: new Date().toISOString(), source, sourceSha256: createHash('sha256').update(raw).digest('hex'),
    providerCalls: 0, databaseWrites: 0, candidateMutations: 0, evaluatorVersion: EVALUATOR_VERSION,
    inputDisplayVersion: INPUT_DISPLAY_VERIFICATION_VERSION, rows,
    limits: ['This replays withheld candidates; it does not establish accepted teacher quality.',
      'The stored admission samples 100 seeds; actual draw checks protect unsampled values.',
      'Existing recorded answers and active/submitted sittings retain their frozen grading.'] };
  writeFileSync('audit-results/generation-quality-corpus/numeric-input-display-verification.json', JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ rows: rows.map(row => ({ item: row.item, combinations: row.finiteCombinations, refused: row.refusedCombinations, proofAccepted: row.proofAccepted })), providerCalls: 0 }) + '\n');
}
void main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : 'Audit failed'}\n`); process.exitCode = 1; });
