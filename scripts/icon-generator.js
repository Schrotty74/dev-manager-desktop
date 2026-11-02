#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const cli = require('@tauri-apps/cli');

async function run() {
  if (process.platform !== 'darwin') throw new Error('Generate app icons on macOS.');
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'webos-macos-icons-'));
  try {
    await cli.run(['icon', '-o', temporary, 'resources/icon/desktop.svg'], null);
    await fs.mkdir('src-tauri/icons', {recursive: true});
    // Tauri generates a full icon set; retain only the macOS app icon and PNGs.
    for (const name of ['icon.icns', 'icon.png', '32x32.png', '128x128.png', '128x128@2x.png']) {
      await fs.copyFile(path.join(temporary, name), path.join('src-tauri/icons', name));
    }
  } finally {
    await fs.rm(temporary, {recursive: true, force: true});
  }
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = {run};
