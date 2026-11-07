import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { synthesizePrivateAudio } from '../functions/src/audio';
import { promptManifest } from '../functions/src/audio/prompts';

async function main() {
  if (!process.argv.includes('--admin-generate')) throw new Error('Admin-only cloud command. Run with --admin-generate using authorized ADC and a configured private Storage bucket.');
  const manifest = promptManifest(resolve(__dirname, '../../contracts/replies.json'));
  for (const prompt of manifest.prompts) {
    if (!prompt.runtimeOnly) await synthesizePrivateAudio(prompt.text, { language: prompt.language, path: prompt.path });
  }
  writeFileSync(resolve(process.cwd(), 'audio-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log('Private static prompts generated; member-specific templates require runtime substitution. Native Malayalam review is still required.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
