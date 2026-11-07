import { createDemoToken } from '../functions/src/platform/seed';

async function main() {
  const uid = process.argv[2];
  if (!uid || process.argv.length !== 3) throw new Error('Usage: npm run demo-token -- SEEDED_UID');
  // Local bootstrap only; never persist or commit the printed token.
  console.log(await createDemoToken(uid));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
