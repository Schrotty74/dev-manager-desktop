# macOS Apple Silicon build

This fork builds locally for Apple Silicon macOS (`aarch64-apple-darwin`). Install the following on the Mac:

- Xcode Command Line Tools
- Node.js matching the `engines` entry in the root `package.json`
- Rust 1.92 or later, with the `aarch64-apple-darwin` target
- A C compiler and `make` from Xcode Command Line Tools, plus `perl`, for vendored native dependencies

The Rust configuration uses vendored libssh and OpenSSL. Install project dependencies with `npm ci`; no global npm packages are required.

From the repository root:

```sh
npm ci
npm run build -- --ci -- --locked
npm start
npm test
npm run test:renew-script
npm run test:build-tools
```

The build command produces the app and DMG. To keep Cargo paths out of artifacts and remap the home directory in debug information, use a private temporary target directory and set `RUSTFLAGS` in double quotes so the shell expands `$HOME`:

```sh
export CARGO_TARGET_DIR="$(mktemp -d /private/tmp/webos-dev-manager-build.XXXXXX)"
export RUSTFLAGS="--remap-path-prefix=$HOME=/build/user"
npm run build -- --ci -- --locked
```

With the default target directory, artifacts are under `target/aarch64-apple-darwin/release/bundle/`. With the temporary directory above, the app bundle is under `$CARGO_TARGET_DIR/aarch64-apple-darwin/release/bundle/macos/`; the disk image is under `$CARGO_TARGET_DIR/aarch64-apple-darwin/release/bundle/dmg/`.

The build-check workflow runs on pushes and pull requests to `main`, or manually. Both workflows use GitHub's `macos-26` Apple Silicon runner. The packaging workflow is manual and uploads a DMG plus its SHA-256 checksum as workflow artifacts without publishing a release. It remains disabled in this fork until explicitly enabled. See [GitHub's hosted runner documentation](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

## Native glass and fullscreen

The project pins Tauri Rust 2.12.5 and the JavaScript API/CLI to 2.12.4 in its manifests and lockfiles. These versions support the native Liquid Glass effect configuration used by `tauri.macos.conf.json`; keep the lockfiles when rebuilding.

Glass fullscreen expands the existing window on the current desktop so the native material keeps its live backdrop. It avoids the separate macOS fullscreen Space, which changes the backdrop available to transparent window material. The standard green fullscreen control remains available. The workaround does not capture the wallpaper; Escape returns to the normal window after any open dialog or menu has handled the key.
