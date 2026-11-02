# webOS Dev Manager

Manage developer mode and apps on webOS TVs from macOS. This is the [Schrotty74 fork](https://github.com/Schrotty74/dev-manager-desktop) of [webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop).

## Download

See the [latest fork release](https://github.com/Schrotty74/dev-manager-desktop/releases/latest) or download the Apple Silicon disk image for [version 1.99.24](https://github.com/Schrotty74/dev-manager-desktop/releases/tag/v1.99.24):

[`webOS-Dev-Manager_1.99.24_arm64.dmg`](https://github.com/Schrotty74/dev-manager-desktop/releases/download/v1.99.24/webOS-Dev-Manager_1.99.24_arm64.dmg)

This build is for Apple Silicon Macs. It is ad-hoc signed and not notarized by Apple. macOS may require approval to open it; see [Apple's instructions](https://support.apple.com/en-us/102445).

## Features

- Add and manage TVs, install and remove apps, browse files, use the terminal, and inspect device information and logs over SSH.
- Add custom package sources, search across catalogs, filter by installation status, updates, favorites, or new apps, and refresh one or all sources.
- Compare an app's versions and sources, save favorites, queue installations, and review the last 100 installation results.
- See an app-wide Developer Mode warning during the final 24 hours and renew the session.
- Back up and restore package sources with the selected theme.
- Choose Glass, Graphite, Nord, or macOS Clear. Native Liquid Glass window effects require macOS 26 or later; older macOS versions use native sidebar material as a fallback.
- Enter Glass fullscreen through the sidebar, the Window menu, or `Control+Command+Shift+F`. Press Escape to leave it.

Under **Apps > Available**, choose **All sources** or one catalog. Enable **Search all sources** to search across catalogs. **Refresh** reloads the current scope; **Refresh all** reloads every configured source. New-app notices appear after a refresh, and the first successful load establishes the baseline.

Manage sources and JSON backups under **Settings > Package sources** (also accessible through **More** in compact layouts). Source-only backups remain supported. Settings backups include the theme and sources; they exclude TV credentials and configuration. **Apps > History** records new installation attempts and updates, without importing previously installed apps.

See the [macOS build instructions](src-tauri/README.md) and [changelog](CHANGELOG.md).

Screenshots below are from the upstream project and may not show this fork's current interface.

![Add device (upstream screenshot)](https://user-images.githubusercontent.com/830358/215522596-196d9629-3942-4533-bebb-5a81ba62ebc0.png)

![Installed apps (upstream screenshot)](https://user-images.githubusercontent.com/830358/215522298-eadebc84-661b-40ad-b6a9-9379710f88dc.png)

![Install from Homebrew catalog (upstream screenshot)](https://user-images.githubusercontent.com/830358/215523117-0fdbde24-a503-4eed-8e2f-50a3486ce7f7.png)

![Manage files (upstream screenshot)](https://user-images.githubusercontent.com/830358/215522354-50997437-e3de-43a9-89cc-52cdaecb0502.png)

![Built-in terminal (upstream screenshot)](https://user-images.githubusercontent.com/830358/215522468-bc3e4871-01b2-4eed-a8b2-31f683874ba1.png)

![Device information (upstream screenshot)](https://user-images.githubusercontent.com/830358/215522554-5554a89b-ff3e-455e-8ed7-0f28c03f04a9.png)

## Scheduled Developer Mode renewal

The generated renewal script requires `curl`, `jq`, and OpenSSH (`ssh` and `ssh-keygen`) on the machine that runs it. Install these with that system's package manager before scheduling the script. The script keeps a token cache for periods when the TV is unreachable and exits with an error if renewal fails.

## License

This project is licensed under the [Apache License 2.0](LICENSE). The fork builds on [webOS Dev Manager by the webOS Homebrew Team](https://github.com/webosbrew/dev-manager-desktop).
