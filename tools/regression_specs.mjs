// Prints the Playwright specs that guard the gameplay regressions in tests/regression/manifest.json,
// skipping issues whose tests live in an open PR.
import fs from 'fs';

const m = JSON.parse(fs.readFileSync('tests/regression/manifest.json', 'utf8'));
const specs = new Set();
for (const entry of [...m.issues.filter((i) => i.status !== 'pending-pr'), ...m.fixes_without_a_report]) {
  for (const t of entry.tests) if (t.startsWith('tests/e2e/') && t.endsWith('.spec.js')) specs.add(t);
}
console.log([...specs].join(' '));
