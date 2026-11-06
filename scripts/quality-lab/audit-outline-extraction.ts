import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { StructureOptions } from '../../server/src/types/structure';
import { recoverOutlineFunctions, type OutlineFunctions, type OutlineSection } from './outline-controls';
import { safeRealmError } from './audit-extraction-pair';
import { hashControl, sha256 } from './protocol';

interface ExtractionEvent { phase: string; stage: string; callId: string; item?: number; attempt: number; prompt?: string; output?: unknown }
interface SourcePromptRow { sectionId: string; material: string; passages: Array<{ id: string; text: string }> }

/** Audit the exact recorded output with the production source-local validator.
 * It measures structural reference recovery, never semantic correctness. */
export function auditOutlineExtraction(input: { events: ExtractionEvent[]; sections: OutlineSection[]; options: StructureOptions; functions: OutlineFunctions }) {
  const prepared = input.events.filter(event => event.phase === 'prepared' && event.stage === 'source-extraction');
  const outputById = new Map(input.events.filter(event => event.phase === 'output').map(event => [event.callId, event.output]));
  if (new Set(prepared.map(event => event.callId)).size !== prepared.length) throw new Error('outline-extraction-audit-duplicate-call');
  const invalidSections = new Set<string>(); const validSections = new Set<string>(); const recoveredSections = new Set<string>();
  const calls = prepared.map(event => {
    if (!event.prompt || event.item === undefined || !Number.isSafeInteger(event.item)) throw new Error('outline-extraction-audit-input-missing');
    const anchor = input.sections[event.item]; if (!anchor) throw new Error('outline-extraction-audit-source-missing');
    const base = event.prompt.split('\nCorrect only the remaining sections.')[0]!;
    const requested = JSON.parse(base.split('\n').at(-1)!) as SourcePromptRow[];
    if (!Array.isArray(requested) || !requested.length || new Set(requested.map(row => row.sectionId)).size !== requested.length) throw new Error('outline-extraction-audit-request-identity');
    const originals = requested.map(row => {
      const section = input.sections.find(candidate => candidate.materialId === anchor.materialId && candidate.localId === row.sectionId);
      if (!section || section.materialName !== row.material || hashControl(input.functions.sourcePassages({ ...section, id: row.sectionId }).map(({ id, text }) => ({ id, text }))) !==
        hashControl(row.passages.map(({ id, text }) => ({ id, text })))) throw new Error('outline-extraction-audit-original-drift');
      return { ...section, id: row.sectionId };
    });
    if (input.functions.sourceExtractionPrompt(originals, input.options) !== base) throw new Error('outline-extraction-audit-prompt-drift');
    if (!outputById.has(event.callId)) return { callId: event.callId, item: event.item, attempt: event.attempt, requestedSections: originals.length,
      status: 'no-completed-output' as const, rows: [], extraRowIds: [] as string[] };
    const raw = outputById.get(event.callId);
    const returned = raw && typeof raw === 'object' && 'sections' in raw && Array.isArray(raw.sections) ? raw.sections as Array<{ sectionId?: string }> : [];
    const rows = originals.map(section => {
      const key = `${section.materialId}:${section.id}`; const candidates = returned.filter(row => row?.sectionId === section.id);
      try {
        if (candidates.length !== 1) throw new Error('Return this section exactly once.');
        const [resolved] = input.functions.validateSourceExtraction({ sections: candidates }, [section], true);
        validSections.add(key); if (invalidSections.has(key)) recoveredSections.add(key);
        return { key, materialId: section.materialId, materialName: section.materialName, sectionId: section.id,
          valid: true, objectiveCount: resolved!.objectives.length, knowledgeCount: resolved!.knowledge.length, error: null };
      } catch (error) {
        invalidSections.add(key);
        return { key, materialId: section.materialId, materialName: section.materialName, sectionId: section.id,
          valid: false, objectiveCount: null, knowledgeCount: null, error: safeRealmError(error).message };
      }
    });
    return { callId: event.callId, item: event.item, attempt: event.attempt, requestedSections: originals.length,
      status: 'completed-output' as const, rows, extraRowIds: returned.filter(row => !originals.some(section => section.id === row?.sectionId)).map(row => String(row?.sectionId)) };
  });
  const completed = calls.filter(call => call.status === 'completed-output');
  return { capturedRequests: calls.length, completedLogicalOutputs: completed.length, withoutCompletedOutput: calls.length - completed.length,
    completedCorrectionRequests: completed.filter(call => call.attempt > 0).length,
    rowObservations: completed.reduce((sum, call) => sum + call.rows.length, 0),
    invalidRowObservations: completed.reduce((sum, call) => sum + call.rows.filter(row => !row.valid).length, 0),
    uniqueValidatedSections: validSections.size, uniqueSectionsWithAnInvalidObservation: invalidSections.size,
    uniqueStructurallyRecoveredSections: recoveredSections.size,
    stillUnvalidatedAfterAnInvalidObservation: [...invalidSections].filter(key => !validSections.has(key)), calls };
}

async function main(): Promise<void> {
  const arg = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
  const directory = arg('--run'); const output = arg('--output');
  if (!directory || !output) throw new Error('Supply --run and NEW --output. This reads a single immutable snapshot of live or terminal receipts; zero provider/DB calls.');
  const [raw, controlsRaw, corpusRaw] = await Promise.all(['results.json', 'controls.json', 'live-corpus-before.json'].map(file => readFile(path.join(directory, file), 'utf8')));
  const result = JSON.parse(raw!) as { status: string; elapsedMs: number; events: ExtractionEvent[]; code: Array<{ file: string; snapshot: string; sha256: string }> };
  const controls = JSON.parse(controlsRaw!) as { options: StructureOptions }; const corpus = JSON.parse(corpusRaw!) as { sections: OutlineSection[] };
  const source = result.code.find(row => row.file === 'server/src/services/structure-generation.service.ts');
  const inventory = result.code.find(row => row.file === 'server/src/services/structure-source-inventory.ts');
  if (!source || !inventory) throw new Error('outline-extraction-audit-code-unavailable');
  const [sourceRaw, inventoryRaw] = await Promise.all([readFile(source.snapshot, 'utf8'), readFile(inventory.snapshot, 'utf8')]);
  if (sha256(sourceRaw) !== source.sha256 || sha256(inventoryRaw) !== inventory.sha256) throw new Error('outline-extraction-audit-code-drift');
  const functions = recoverOutlineFunctions(sourceRaw, inventoryRaw).functions;
  const audit = auditOutlineExtraction({ events: result.events, sections: corpus.sections, options: controls.options, functions });
  const receipt = { version: 1, observedAt: new Date().toISOString(), statusAtObservation: result.status, capturedRunElapsedMs: result.elapsedMs,
    run: path.resolve(directory), resultsSha256: sha256(raw!), controlsSha256: sha256(controlsRaw!), corpusSha256: sha256(corpusRaw!),
    providerCalls: 0, databaseCalls: 0, audit,
    limitations: ['This revalidates recorded source-local schema, exact original passage references and passage accounting. It does not measure semantic truth, teacher acceptance or final LO coverage.',
      'A running snapshot may omit later completions and corrections. No-completed-output is not classified as a model failure or zero dispatch.',
      'Extra output rows are recorded as ignored, never counted as validated requested originals. Validated sections are deduplicated by material and local section identity.'] };
  await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ output, statusAtObservation: result.status, requests: audit.capturedRequests,
    uniqueValidatedSections: audit.uniqueValidatedSections, structurallyRecoveredSections: audit.uniqueStructurallyRecoveredSections,
    unvalidated: audit.stillUnvalidatedAfterAnInvalidObservation.length, providerCalls: 0, databaseCalls: 0 }));
}
if (require.main === module) void main().catch(error => { console.error(safeRealmError(error).message); process.exitCode = 1; });
