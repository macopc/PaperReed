// Reuse the isolated desktop launch from the existing compose harness.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const harness = path.resolve(__dirname, '../harness/check-compose-handoff.cjs');
const entry = ' await startDesktop(draftUpgradeSource || upstream);';
const original = fs.readFileSync(harness, 'utf8');
if (original.split(entry).length !== 2) throw new Error('Compose harness entry changed');
const launch = new Module(harness, module);
launch.filename = harness;
launch.paths = Module._nodeModulePaths(path.dirname(harness));
launch._compile(original.replace(entry, entry + `
 await cli('accounts', {});
 fs.writeFileSync(path.join(work,'endpoint'), String(port));
 await until(() => fs.existsSync(path.join(work,'stop')), 'benchmark finish', 1800000);
 return;
`), harness);
