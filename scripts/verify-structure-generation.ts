/** Opt-in live-model check using ONLY synthetic teaching text authored here.
 * It does not read or transmit any uploaded course materials. Temporary Mongo
 * records are scoped to a fresh ID and removed in finally. */
import { ObjectId } from 'mongodb';
import { writeFile } from 'node:fs/promises';
import { connectMongo, closeMongo } from '../server/src/components/mongodb';
import { materialsCol, materialChunksCol, contentRunsCol } from '../server/src/components/mongodb/collections';
import { createStructureGenerationRun, getContentRun, subscribeToCourseContentRuns } from '../server/src/services/content-runs.service';
import { runStructureGeneration } from '../server/src/services/structure-generation.service';
import { utilityStepConfig } from '../server/src/services/admin.service';

const notes = [
  'Inertia: explain why constant velocity requires zero net force. Distinguish zero velocity from zero acceleration. A moving object can maintain motion without a net force.',
  'Vectors: resolve a force into horizontal and vertical components, and combine components to find the resultant. Distinguish the magnitude of a vector from a signed component.',
  'Free-body diagrams: isolate one object and draw only forces acting on that object. Identify gravitational, normal, applied and frictional forces. Interaction pairs act on different objects.',
  'Newton’s second law: calculate acceleration from net force and mass. Keep track of units, signed directions, and the distinction between individual forces and the net force.',
  'Friction: distinguish static and kinetic friction. Static friction adjusts up to a limiting value. Determine whether a block starts moving and calculate acceleration once it is sliding.',
  'Inclined planes: resolve weight parallel and perpendicular to a slope. Calculate the normal force and acceleration on an incline with or without friction.',
  'Work and energy: compute work for a constant force along a displacement. Apply the work-energy theorem to relate net work to changes in kinetic energy.',
  'Conservation of energy: relate gravitational potential energy to kinetic energy. Account explicitly for energy transferred by friction instead of assuming mechanical energy is always conserved.',
  'Momentum: distinguish momentum from force. Apply conservation of total momentum to a one-dimensional collision when external impulse is negligible.',
  'Impulse: calculate a change in momentum from the force-time integral. Compare collisions with equal momentum change and different contact times.',
  'Circular motion: identify the radial direction of centripetal acceleration. Find the net inward force needed to maintain circular motion without treating centripetal force as an extra interaction.',
  'Final chapter: torque and angular momentum. Calculate torque as force times perpendicular lever arm. Explain conservation of angular momentum when external torque is zero. This chapter must be represented even though it appears at the end.',
];
async function main() {
  const courseId = new ObjectId();
  await connectMongo();
  let unsubscribe: (() => void) | undefined;
  try {
    const documents = [
      { name: 'Synthetic mechanics lecture notes', sections: notes.map((text, i) => `${text}\n${Array.from({ length: 5 }, (_, n) => `Practice context ${i + 1}.${n + 1}: ${text} State assumptions, identify the system, and explain the physical meaning of the result.`).join('\n')}`) },
      { name: 'Synthetic mechanics problem set', sections: [
        'Exercise 1: a 4 kg box experiences forces of 12 N right and 4 N left. Resolve the net force and use Newton’s second law to find acceleration. Draw a free-body diagram first.',
        'Exercise 2: a puck slides up a rough incline. Resolve the gravitational and frictional forces and use work and energy to determine how far it travels.',
        'Exercise 3: a door is pushed perpendicular to its surface at two different distances from its hinge. Compare the torques and explain the role of the lever arm.',
        'Exercise 4: two rotating disks join without external torque. Apply conservation of angular momentum to predict the final angular velocity. Explain why rotational kinetic energy can change.',
      ] },
    ];
    const ids: string[] = [];
    for (const document of documents) {
      const materialId = new ObjectId(); ids.push(materialId.toHexString());
      await materialsCol().insertOne({ _id: materialId, courseId, name: document.name, format: 'txt', status: 'ready', assignments: [], uploadedAt: new Date() } as never);
      await materialChunksCol().insertMany(document.sections.map((text, index) => ({ courseId, materialId, text, index, characterCount: text.length, createdAt: new Date() })));
    }
    let previews = 0; let previous = ''; let lastStage = '';
    unsubscribe = subscribeToCourseContentRuns(courseId, run => {
      if (run.stage !== lastStage) { console.log('Stage:', run.stage); lastStage = run.stage; }
      if (run.kind === 'structure-generation' && run.structurePreview) {
        const text = JSON.stringify(run.structurePreview); if (text !== previous) { previews++; previous = text; }
      }
      if (run.stage === 'analyzing' && run.completedUnits) console.log('Sections:', run.completedUnits, '/', run.totalUnits);
    });
    const started = Date.now();
    const run = await createStructureGenerationRun({ courseId, requestedBy: 'synthetic-structure-verification', options: { materialIds: ids } });
    await runStructureGeneration(run._id);
    const final = await getContentRun(run._id);
    if (final?.kind !== 'structure-generation' || final.status !== 'completed' || !final.structureResult) throw new Error(JSON.stringify(final?.error ?? 'No completed result'));
    const result = final.structureResult;
    const report = {
      syntheticDataOnly: true, checkedAt: new Date().toISOString(), model: (await utilityStepConfig()).model,
      seconds: Math.round((Date.now() - started) / 1000), progressiveUpdates: previews,
      sources: result.coverage.materials.map(({ name, chunks, sections, mappedObjectives }) => ({ name, chunks, sections, mappedObjectives })),
      topics: result.themes.map(t => ({ name: t.name, objectives: t.los.map(lo => lo.name) })),
      extractedLearningPoints: result.coverage.extractedObjectives, mappedLearningPoints: result.coverage.mappedObjectives,
      unmappedLearningPoints: result.coverage.unmappedEvidenceIds.length, excludedSections: result.coverage.excludedSections.length,
      multiMaterialObjectives: result.themes.flatMap(t => t.los).filter(lo => lo.materialIds.length > 1).length,
      warnings: result.coverage.warnings,
    };
    await writeFile('/tmp/structure-live-validation.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    if (previews < 2 || result.coverage.materials.some(m => m.mappedObjectives === 0) || !/angular momentum/i.test(JSON.stringify(report.topics))) throw new Error('Live verification missed progressive output, a source, or the final chapter.');
  } finally {
    unsubscribe?.();
    await contentRunsCol().deleteMany({ courseId }); await materialChunksCol().deleteMany({ courseId }); await materialsCol().deleteMany({ courseId });
    await closeMongo();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
