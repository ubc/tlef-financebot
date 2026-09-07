// One-time migration for the Topic release model (2026-09-05). Before it, a
// Theme with no `availableFrom` was always visible to students; after it, no
// date means "Not released". Run this ONCE per database, right after
// deploying that change, so every Theme that was visible stays visible:
//
//   npm run migrate:theme-release
//
// Idempotent in the sense that it only touches Themes without a date — but
// note that any Theme created as "Not released" AFTER the deploy would be
// released by a second run, so do not re-run it later as a matter of course.
import { connectMongo, closeMongo } from '../server/src/components/mongodb';
import { themesCol } from '../server/src/components/mongodb/collections';

async function main(): Promise<void> {
  await connectMongo();
  const now = new Date();
  const result = await themesCol().updateMany(
    { availableFrom: { $exists: false } },
    { $set: { availableFrom: now } },
  );
  console.log(`[migrate-theme-release] released ${result.modifiedCount} Theme(s) without a date as of ${now.toISOString()}`);
  await closeMongo();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
