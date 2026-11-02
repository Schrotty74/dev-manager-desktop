#!/usr/bin/env node
'use strict';

const APPLE_SILICON_TARGET = 'aarch64-apple-darwin';

function macosArgs(args, platform = process.platform) {
  if (platform !== 'darwin') throw new Error('This fork builds on macOS only.');
  if (['android', 'ios'].includes(args[0])) throw new Error('This fork builds macOS apps only.');
  const result = [...args];
  const separator = result.indexOf('--');
  const optionEnd = separator < 0 ? result.length : separator;
  let hasTarget = false;
  for (let i = 0; i < optionEnd; i++) {
    const arg = result[i];
    if (arg === '--target' || arg === '-t' || arg.startsWith('--target=')) {
      const target = arg.startsWith('--target=') ? arg.slice('--target='.length) : result[++i];
      if (target !== APPLE_SILICON_TARGET) throw new Error(`Only ${APPLE_SILICON_TARGET} is supported.`);
      hasTarget = true;
    }
  }
  if (['build', 'bundle', 'dev'].includes(result[0]) && !hasTarget) {
    result.splice(optionEnd, 0, '--target', APPLE_SILICON_TARGET);
  }
  return result;
}

async function run(args = process.argv.slice(2)) {
  // Use the CLI version pinned by package-lock.json rather than a global cargo-tauri.
  const options = macosArgs(args);
  await require('@tauri-apps/cli').run(options, null);
}

if (require.main === module) {
  run().catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = {macosArgs};
