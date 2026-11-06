/** Enumerate every explicit finite numeric input tuple in retained retest
 * candidates. Arithmetic and formatting use the production closed evaluator.
 * This audit is not a proof of source support, novelty or teacher acceptance. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { evaluateFormula, parseFormula } from '../server/src/components/formula';
import { numericInputDisplayFailure } from '../server/src/services/numeric-input-display.service';
import { substituteParams } from '../server/src/services/parameter-display';
import { verifyQuestionNumerics } from '../server/src/services/numeric-verification.service';
import type { DerivedValue, ParamSlot } from '../server/src/types/domain';

type Candidate = { stem: string; numericKind?: string; paramSlots?: ParamSlot[]; derivedValues?: DerivedValue[]; options: Array<{ key: string; text: string; role: string }> };
const argument = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };

async function main(): Promise<void> {
  const input = argument('--observations'); const output = argument('--output'); assert.ok(input && output);
  const data = JSON.parse(await readFile(input, 'utf8')) as { observations: Array<{ case: string; taskPlans?: Array<{ slots: Array<{ item: number; status: string; candidate?: Candidate }> }> }> };
  const audits = [];
  for (const observation of data.observations) for (const plan of observation.taskPlans ?? []) for (const slot of plan.slots) {
    const candidate = slot.candidate; if (!candidate || candidate.numericKind !== 'numeric') continue;
    const slots = candidate.paramSlots ?? []; const definitions = candidate.derivedValues ?? [];
    const cardinality = slots.reduce((size, param) => size * (param.values?.length ?? Infinity), 1);
    if (!slots.length || !Number.isSafeInteger(cardinality) || cardinality > 5000) {
      audits.push({ case: observation.case, item: slot.item, complete: false, reason: 'Only explicit finite domains of up to5000 tuples are enumerated.', cardinality: Number.isFinite(cardinality) ? cardinality : null });
      continue;
    }
    const options = candidate.options.map(option => option.text); const ast = definitions.map(definition => {
      const parsed = parseFormula(definition.formula); assert.ok(parsed.ok); return { name: definition.name, ast: parsed.ast };
    });
    const failures: Array<Record<string, unknown>> = []; const samples: Array<Record<string, unknown>> = [];
    const allRenderedStems = new Set<string>(); let checked = 0;
    const enumerate = (index: number, drawn: Record<string, number>) => {
      if (index < slots.length) { const param = slots[index]!; for (const value of param.values!) enumerate(index + 1, { ...drawn, [param.name]: value }); return; }
      const values = { ...drawn };
      for (const definition of ast) {
        const result = evaluateFormula(definition.ast, values); assert.ok(result.ok && Number.isFinite(result.value)); values[definition.name] = result.value;
      }
      const visibleStem = substituteParams(candidate.stem, values); const visibleOptions = options.map(option => substituteParams(option, values));
      const displayFailure = numericInputDisplayFailure({ stem: candidate.stem, slots, derivedValues: definitions, optionTexts: options, values });
      if (displayFailure || new Set(visibleOptions).size !== visibleOptions.length) failures.push({ drawn, values, visibleStem, visibleOptions, displayFailure,
        optionCollision: new Set(visibleOptions).size !== visibleOptions.length });
      allRenderedStems.add(visibleStem); if (samples.length < 3) samples.push({ drawn, values, visibleStem, visibleOptions }); checked++;
    };
    enumerate(0, {}); assert.equal(checked, cardinality);
    const mapping = candidate.options.map(option => {
      const matches = [...option.text.matchAll(/\{\{\s*([A-Za-z_]\w*)\s*\}\}/g)]; assert.equal(matches.length, 1); return { key: option.key, derivedName: matches[0]![1]!, role: option.role };
    });
    const proof = verifyQuestionNumerics({ slots, derivedValues: definitions, stem: candidate.stem, optionValueNames: mapping.map(option => option.derivedName) });
    audits.push({ case: observation.case, item: slot.item, candidateStatus: slot.status, complete: true, cardinality, checked,
      distinctVisibleStems: allRenderedStems.size, failures, sampledProductionProof: proof, optionMapping: mapping, samples,
      teacherAcceptance: null, limitation: 'Finite arithmetic/display/distinctness only. Source conventions, required inference and misconception labels need separate inspection. No candidate was approved or served.' });
  }
  await writeFile(output, JSON.stringify({ version: 1, providerCalls: 0, input, audits }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ output, providerCalls: 0, audits: audits.map(audit => ({ case: audit.case, item: audit.item, complete: audit.complete,
    cardinality: audit.cardinality, failures: audit.failures?.length ?? null })) }));
}
void main().catch(error => { console.error(error instanceof Error ? error.message : 'numeric-audit-failed'); process.exitCode = 1; });
