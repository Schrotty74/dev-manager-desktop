# Changelog

Changes to the [Schrotty74 fork](https://github.com/Schrotty74/dev-manager-desktop)
of webOS Dev Manager are recorded here. Earlier upstream releases are listed in
the [webosbrew release history](https://github.com/webosbrew/dev-manager-desktop/releases).

## 1.99.24-beta.2 - 2026-11-02

- Preserve the All sources selection when switching between Installed and Available.
  Refresh continues to reload all sources after returning to Available.

## 1.99.24-beta.1 - 2026-11-01

- Search app names, IDs and descriptions across all configured catalogs, including
  every catalog page. Filter by installation status, available updates, favorites
  or new apps, and sort results by name.
- Refresh one source or all sources, show the last successful refresh, and retain
  existing results when a source fails. Mark apps added after the first successful
  check as new; optional notices appear in the app after a refresh.
- Compare an app's sources, versions and package addresses. Review updates from
  custom sources alongside the existing Homebrew Channel update checks.
- Queue apps for sequential installation on the TV selected when each app was
  queued. Keep the existing compatibility checks and display each queue result.
- Save favorites locally and record the last 100 installation results without
  storing credentials, device addresses or local file paths in the history.
- Show an app-wide warning during the final 24 hours of Developer Mode, with
  renewal controls. Read the status when selecting a TV and update the countdown
  locally; renewal and device-info checks update the warning.
- Back up and restore the appearance theme and package sources together. Existing
  source-only backups remain supported; TV configuration and credentials are
  excluded.

## [1.99.23] - 2026-11-01

- Add locally saved custom package sources alongside Homebrew Channel, with a
  source selector under Apps > Available and management under Settings > Package
  sources (also accessible from More in compact layouts).
- Support compatible JSON catalogs with embedded package manifests, including
  catalogs without pagination and GitHub repository addresses.
- Add JSON backup and restore for custom sources and the selected catalog.
  Restoration merges sources, skips duplicate addresses, and validates the full
  backup before changing settings. TV credentials are not included.

## [1.99.22] - 2026-11-01

First macOS release of this fork, built for Apple Silicon (arm64).

### Added

- Native AppKit Liquid Glass window effects on macOS 26 and later, including
  macOS 27, with Sidebar material fallback configured for older macOS versions.
- Glass fullscreen on the current desktop, preserving the live backdrop. It is
  available through the sidebar button, `Window > Glas-Vollbild`, and
  `Control+Command+Shift+F`. Standard macOS Space fullscreen remains available.
- Escape handling for Glass fullscreen. Open web dialogs and menus receive
  Escape first; a subsequent press exits fullscreen.
- Appearance settings with Glass, Graphite, Nord, and macOS Clear themes, preview
  cards, and a locally saved selection. Appearance is accessible from Settings
  and from More in compact layouts.
- Theme persistence and fullscreen service tests, plus a navigation test for
  Appearance settings.

### Changed

- Upgraded Rust Tauri to 2.12.5, tauri-build to 2.7.4, and the npm API and CLI to
  2.12.4, with updated lockfiles.
- Added responsive sidebar labels and shared theme colors for navigation,
  content, forms, menus, dialogs, and tooltips. Graphite and Nord use dark
  palettes; Glass and macOS Clear follow the system light/dark preference.
- Enabled the existing desktop and vendored OpenSSL features in the macOS
  configuration, including single-instance handling and native startup errors.
- Updated native-dialog calls for the desktop build and removed the duplicate,
  undeclared env_logger initialization.

### Fixed

- Restored window and WKWebView keyboard focus after Glass fullscreen
  transitions, allowing Escape to work without an additional click.
- Kept the app's fullscreen button and Window menu state synchronized.
- Corrected invisible tooltip text over transparent Glass surfaces.

### Distribution

- Published an Apple Silicon DMG containing the app and an Applications shortcut
  for drag-and-drop installation, together with a SHA-256 checksum file.
- Included the Apache-2.0 license in the app's resources.
- Used neutral build paths and checked the app files and DMG metadata for
  personal build paths before publication.
- Verified disk-image integrity, version and architecture metadata, strict
  code-signature integrity, copying the app out of the DMG, and launching the
  copied app. The existing frontend suite passed all 230 tests.
- The app is ad-hoc signed and is not notarized by Apple. Downloaded copies may
  require approval through macOS Privacy & Security settings; see
  [Apple's guidance](https://support.apple.com/en-us/102445).

[1.99.22]: https://github.com/Schrotty74/dev-manager-desktop/releases/tag/v1.99.22
[1.99.23]: https://github.com/Schrotty74/dev-manager-desktop/releases/tag/v1.99.23
