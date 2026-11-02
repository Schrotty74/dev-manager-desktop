#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const targetDir = process.env.CARGO_TARGET_DIR || 'target';
const pattern = path.join(targetDir, 'aarch64-apple-darwin/release/bundle/dmg/*.dmg');
const images = Array.from(fs.globSync(pattern));
if (!images.length) throw new Error('No Apple Silicon DMG was found.');
const version = require('../package.json').version;
const expected = `webOS Dev Manager_${version}_aarch64.dmg`;
const image = images.find(file => path.basename(file) === expected);
if (!image) throw new Error(`Missing current-version DMG: ${expected}`);
fs.mkdirSync('release', {recursive: true});
const filename = `webOS-Dev-Manager_${version}_arm64.dmg`;
const destination = path.join('release', filename);
fs.copyFileSync(image, destination);
const sha = crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex');
const checksums = path.join('release', 'SHA256SUMS.txt');
fs.writeFileSync(checksums, `${sha}  ${filename}\n`);
const output = process.env.GITHUB_OUTPUT;
if (!output) throw new Error('GITHUB_OUTPUT is required.');
fs.appendFileSync(output, `paths<<ARTIFACT_PATHS\n${destination}\n${checksums}\nARTIFACT_PATHS\n`);
console.log('Prepared Apple Silicon DMG and SHA256SUMS.txt.');
