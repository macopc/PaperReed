#!/usr/bin/env node
// Lets a launcher installed by an earlier desktop release reach the native binary until refreshed.
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { nativeExecutable } = require('./install.cjs');

const executable = nativeExecutable(path.resolve(__dirname, '../../..'));
const result = spawnSync(executable, process.argv.slice(2), { stdio: 'inherit' });
if (result.error) {
  process.stderr.write(JSON.stringify({
    error: 'Desktop CLI executable is unavailable.',
    code: 'runtime-missing',
    hint: 'Reinstall CLI from the current Paper Reed app.',
  }) + '\n');
}
process.exitCode = result.status ?? 1;
