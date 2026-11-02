import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {macosArgs} = createRequire(import.meta.url)('./tauri-wrapper.js');
const target = 'aarch64-apple-darwin';

describe('macOS build entry point', () => {
  it('builds for Apple Silicon and keeps Cargo arguments after the separator', () => {
    assert.deepEqual(macosArgs(['build', '--ci', '--', '--locked'], 'darwin'),
      ['build', '--ci', '--target', target, '--', '--locked']);
    assert.deepEqual(macosArgs(['dev'], 'darwin'), ['dev', '--target', target]);
    assert.deepEqual(macosArgs(['bundle', '--bundles', 'dmg'], 'darwin'), ['bundle', '--bundles', 'dmg', '--target', target]);
  });
  it('keeps explicit Apple Silicon targets without adding a second one', () => {
    for (const args of [['build', '--target', target], ['build', `--target=${target}`], ['bundle', '-t', target]]) {
      assert.deepEqual(macosArgs(args, 'darwin'), args);
    }
  });
  it('rejects non-macOS hosts, mobile commands and other build targets', () => {
    for (const host of ['linux', 'win32']) assert.throws(() => macosArgs(['build'], host), /macOS only/);
    for (const command of ['android', 'ios']) assert.throws(() => macosArgs([command, 'build'], 'darwin'), /macOS apps only/);
    for (const value of ['universal-apple-darwin', 'x86_64-pc-windows-msvc', 'aarch64-linux-android']) {
      assert.throws(() => macosArgs(['build', '--target', value], 'darwin'), /Only aarch64-apple-darwin/);
    }
  });
});
