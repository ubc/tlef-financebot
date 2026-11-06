import { initializeDeclaredOutlineLedger } from './phase-declaration';
import { safeError } from './protocol';
const argument = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
async function main() {
  const declaration = argument('--declaration'); const digest = argument('--sha256');
  if (!declaration || !digest) throw new Error('Supply the immutable --declaration and prospective --sha256. Creates its NEW empty ledger only; never modifies the declaration or an existing ledger.');
  await initializeDeclaredOutlineLedger(declaration, digest);
  console.log(JSON.stringify({ initialized: true, declaration, sha256: digest, providerCalls: 0, databaseCalls: 0 }));
}
if (require.main === module) void main().catch(error => { console.error(safeError(error).message); process.exitCode = 1; });
