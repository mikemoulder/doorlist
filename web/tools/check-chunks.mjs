// Fails the build if any emitted JavaScript chunk does not parse. A browser refuses such a chunk silently
// and webpack reports "Loading chunk N failed (missing)" (seen with an SWC minifier bug, see fix-sr25519-loader.cjs).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const root = 'out/_next/static';
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js')) files.push(p);
  }
})(root);

const broken = [];
for (const f of files) {
  try {
    new vm.Script(readFileSync(f, 'utf8'), { filename: f });
  } catch (e) {
    broken.push(`${f}: ${e.message}`);
  }
}
if (broken.length) {
  console.error(`check-chunks: ${broken.length} of ${files.length} chunks do not parse:\n${broken.join('\n')}`);
  process.exit(1);
}
console.log(`check-chunks: all ${files.length} chunks parse`);
