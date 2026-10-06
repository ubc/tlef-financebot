import { connectMongo, closeMongo } from '../../server/src/components/mongodb';
import { platformInstructorGrantsCol } from '../../server/src/components/mongodb/collections';
// Only the documented local SAML faculty test identity. No production grants.
import { env } from '../../server/src/config/env';
async function main() {
  if (env.samlEnvironment !== 'LOCAL' || env.nodeEnv === 'production') throw new Error('Local fixtures only.');
  await connectMongo();
  await platformInstructorGrantsCol().updateOne({ puid: '12345678' }, { $setOnInsert: { puid: '12345678', grantedByPuid: 'local-canvas-test', grantedAt: new Date() } }, { upsert: true });
  await closeMongo();
}
void main();
