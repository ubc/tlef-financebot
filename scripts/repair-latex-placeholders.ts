// Repairs stored questions damaged by the placeholder/LaTeX brace collision and
// swallowed JSON escapes (2026-09-14). Each repaired question gets a NEW version
// (editQuestion's copy-on-write), so the damaged text stays in its history.
//
//   npm run repair:latex-placeholders -- <questionId> [<questionId> ...]           # dry run
//   npm run repair:latex-placeholders -- --apply <questionId> [<questionId> ...]   # write
//
// Dry run prints every field it would change, before and after. A question is
// skipped, never half-repaired, when the repaired text still fails the
// placeholder gate, or when it carried a numeric proof and the proof no longer
// holds — an approved numerical question without a proof stops being served.
import { ObjectId } from 'mongodb';
import { closeMongo, connectMongo } from '../server/src/components/mongodb';
import { questionsCol, questionVersionsCol } from '../server/src/components/mongodb/collections';
import {
  optionValueNamesForVerification,
  placeholderSyntaxFailure,
  verifyQuestionNumerics,
} from '../server/src/services/numeric-verification.service';
import { repairPlaceholderText } from '../server/src/services/placeholder-repair';
import { editQuestion } from '../server/src/services/questions.service';
import type { NumericVerification } from '../server/src/types/domain';

const EDITOR = 'script:repair-latex-placeholders';

async function repairOne(questionId: ObjectId, apply: boolean): Promise<'repaired' | 'unchanged' | 'skipped'> {
  const question = await questionsCol().findOne({ _id: questionId });
  const current = question && await questionVersionsCol().findOne({ _id: question.currentVersionId });
  if (!question || !current) {
    console.log(`! ${questionId.toHexString()}: skipped — question or its current version not found`);
    return 'skipped';
  }
  const label = `${questionId.toHexString()} (${question.state}, v${current.version})`;

  const stem = repairPlaceholderText(current.stem);
  const options = current.options.map((option) => ({
    ...option,
    text: repairPlaceholderText(option.text),
    explanation: repairPlaceholderText(option.explanation),
  }));
  const changes: Array<[string, string, string]> = [];
  if (stem !== current.stem) changes.push(['stem', current.stem, stem]);
  current.options.forEach((option, index) => {
    if (options[index]!.text !== option.text) changes.push([`option ${option.key}`, option.text, options[index]!.text]);
    if (options[index]!.explanation !== option.explanation) {
      changes.push([`option ${option.key} explanation`, option.explanation, options[index]!.explanation]);
    }
  });
  if (changes.length === 0) {
    console.log(`= ${label}: nothing to repair`);
    return 'unchanged';
  }

  const names = [...(current.paramSlots ?? []), ...(current.derivedValues ?? [])].map((entry) => entry.name);
  const remaining = placeholderSyntaxFailure({ stem, options }, names);
  if (remaining) {
    console.log(`! ${label}: skipped — still broken after repair: ${remaining}`);
    return 'skipped';
  }

  // Formulas are unchanged, but editQuestion drops the previous proof on every
  // content edit, so recompute it exactly as the formula-save route does.
  let verification: NumericVerification | undefined;
  if (current.numericKind !== 'conceptual' && (current.derivedValues?.length ?? 0) > 0) {
    const optionValues = optionValueNamesForVerification(
      options.map((option) => option.text),
      (current.derivedValues ?? []).map((derived) => derived.name),
    );
    const result = optionValues.ok
      ? verifyQuestionNumerics({ slots: current.paramSlots ?? [], derivedValues: current.derivedValues ?? [], optionValueNames: optionValues.names, optionCurrency: optionValues.currency })
      : { ok: false as const, error: optionValues.error };
    if (result.ok) verification = result.verification;
    else if (current.verification) {
      console.log(`! ${label}: skipped — its numeric proof would not survive the edit: ${result.error}`);
      return 'skipped';
    }
  }

  console.log(`${apply ? '+' : '~'} ${label}: ${changes.length} field(s)${verification ? ', proof recomputed' : ''}`);
  for (const [field, before, after] of changes) {
    console.log(`  [${field}]\n    before: ${JSON.stringify(before)}\n    after:  ${JSON.stringify(after)}`);
  }
  if (!apply) return 'repaired';

  const version = await editQuestion(
    questionId,
    { stem, options, ...(verification ? { verification } : {}) },
    EDITOR,
  );
  console.log(`  saved as version ${version.version}`);
  return 'repaired';
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const ids = args.filter((arg) => arg !== '--apply');
  if (ids.length === 0 || ids.some((id) => !/^[0-9a-f]{24}$/.test(id))) {
    console.error('Usage: npm run repair:latex-placeholders -- [--apply] <questionId> [<questionId> ...]');
    process.exit(1);
  }

  await connectMongo();
  const tally = { repaired: 0, unchanged: 0, skipped: 0 };
  try {
    for (const id of ids) tally[await repairOne(new ObjectId(id), apply)] += 1;
  } finally {
    await closeMongo();
  }
  console.log(`\n${apply ? 'Applied' : 'Dry run (pass --apply to write)'}: ${tally.repaired} repaired, ${tally.unchanged} unchanged, ${tally.skipped} skipped`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
