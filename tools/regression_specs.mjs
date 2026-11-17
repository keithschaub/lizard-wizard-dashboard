// Prints the Playwright specs that guard the gameplay regressions in tests/regression/manifest.json.
// A pending-pr entry's spec runs once it is present; any other listed spec must exist.
import fs from 'fs';

const m = JSON.parse(fs.readFileSync('tests/regression/manifest.json', 'utf8'));
const specs = new Set(); const missing = [];
for (const entry of [...m.issues, ...m.fixes_without_a_report]) {
  for (const t of entry.tests) {
    if (!(t.startsWith('tests/e2e/') && t.endsWith('.spec.js'))) continue;
    if (fs.existsSync(t)) specs.add(t);
    else if (entry.status !== 'pending-pr') missing.push(`${t} (issue ${entry.issue ?? entry.pr})`);
  }
}
if (missing.length) { console.error(`manifest lists missing specs:\n  ${missing.join('\n  ')}`); process.exit(1); }
console.log([...specs].join(' '));
