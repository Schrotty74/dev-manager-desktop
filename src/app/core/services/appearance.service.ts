import {Injectable, OnDestroy, signal} from '@angular/core';

export type AppTheme = 'glass' | 'graphite' | 'nord' | 'macos-clear';

export const THEME_OPTIONS: ReadonlyArray<{
    id: AppTheme;
    label: string;
    description: string;
}> = [
    {id: 'glass', label: 'Glass', description: 'Translucent surfaces in system light and dark.'},
    {id: 'graphite', label: 'Graphite', description: 'Dark gray surfaces with blue accents.'},
    {id: 'nord', label: 'Nord', description: 'Blue-gray surfaces with cool accents.'},
    {id: 'macos-clear', label: 'macOS Clear', description: 'Clean surfaces in system light and dark.'},
];

const STORAGE_KEY = 'devman.appearance.theme';
const COLOR_SCHEME_QUERY = '(prefers-color-scheme: dark)';
const DARK_THEMES = new Set<AppTheme>(['graphite', 'nord']);

function isAppTheme(value: string | null): value is AppTheme {
    return THEME_OPTIONS.some(option => option.id === value);
}

@Injectable({providedIn: 'root'})
export class AppearanceService implements OnDestroy {
    private readonly themeState = signal<AppTheme>('glass');
    readonly theme = this.themeState.asReadonly();

    private readonly colorScheme: MediaQueryList | null;
    private readonly onColorSchemeChange = (event: MediaQueryListEvent): void => {
        this.applyTheme(this.theme(), event.matches);
    };

    constructor() {
        this.themeState.set(this.loadTheme());
        this.colorScheme = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
            ? window.matchMedia(COLOR_SCHEME_QUERY)
            : null;
        this.applyTheme(this.theme());
        this.colorScheme?.addEventListener('change', this.onColorSchemeChange);
    }

    setTheme(value: string): void {
        if (!isAppTheme(value)) return;

        this.themeState.set(value);
        this.applyTheme(value);
        try {
            if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, value);
        } catch {
            // Theme changes still work when browser storage is unavailable.
        }
    }

    ngOnDestroy(): void {
        this.colorScheme?.removeEventListener('change', this.onColorSchemeChange);
    }

    private loadTheme(): AppTheme {
        try {
            if (typeof window !== 'undefined') {
                const saved = window.localStorage.getItem(STORAGE_KEY);
                if (isAppTheme(saved)) return saved;
            }
        } catch {
            // Fall back to Glass when storage is unavailable.
        }
        return 'glass';
    }

    private applyTheme(theme: AppTheme, systemIsDark = this.colorScheme?.matches ?? false): void {
        if (typeof document === 'undefined') return;

        const root = document.documentElement;
        root.setAttribute('data-app-theme', theme);
        root.setAttribute('data-bs-theme', DARK_THEMES.has(theme) || systemIsDark ? 'dark' : 'light');
    }
}
