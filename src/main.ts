import {enableProdMode, provideZoneChangeDetection} from '@angular/core';
import {platformBrowserDynamic} from '@angular/platform-browser-dynamic';

import {AppModule} from './app/app.module';
import {AppConfig} from './environments/environment';
import ReleaseInfo from './release.json';
import {browserTracingIntegration, defaultStackParser, init as initSentry} from "@sentry/angular";
import {isTauri} from '@tauri-apps/api/core';
import {platform} from '@tauri-apps/plugin-os';

// Only the macOS window has a native material behind the webview.
document.documentElement.setAttribute('data-platform', isTauri() ? platform() : 'web');

initSentry({
    dsn: "https://93c623f5a47940f0b7bac7d0d5f6a91f@o4504977150377984.ingest.sentry.io/4504978685689856",
    tracePropagationTargets: [],
    integrations: [
        browserTracingIntegration()
    ],
    enabled: !!ReleaseInfo.version,
    environment: AppConfig.environment,
    release: ReleaseInfo.version || 'local',
    stackParser: (stack: string, skipFirst?: number) => {
        // noinspection HttpUrlsUsage
        stack = stack.replace(/@tauri:\/\//g, "@http://");
        return defaultStackParser(stack, skipFirst);
    },
    beforeBreadcrumb: (breadcrumb) => {
        return breadcrumb.level !== 'debug' ? breadcrumb : null;
    },
    beforeSendTransaction: () => {
        return null;
    },
    beforeSend: (event, hint) => {
        const originalException: any = hint.originalException;
        if (originalException && originalException['reason']) {
            if (originalException['unhandled'] !== true) {
                return null;
            }
        }
        return event;
    },
    // Set tracesSampleRate to 1.0 to capture 100%
    // of transactions for performance monitoring.
    // We recommend adjusting this value in production
    tracesSampleRate: 1.0,
});

if (AppConfig.production) {
    enableProdMode();
}

platformBrowserDynamic()
    .bootstrapModule(AppModule, { applicationProviders: [provideZoneChangeDetection()], preserveWhitespaces: false,})
    .catch(err => console.error(err));
