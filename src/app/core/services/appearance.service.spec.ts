import {TestBed} from '@angular/core/testing';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {AppearanceService} from './appearance.service';

const STORAGE_KEY = 'devman.appearance.theme';

function createMemoryStorage(): Storage {
    const values = new Map<string, string>();
    return {
        get length() {
            return values.size;
        },
        clear: () => values.clear(),
        getItem: key => values.get(String(key)) ?? null,
        key: index => [...values.keys()][index] ?? null,
        removeItem: key => values.delete(String(key)),
        setItem: (key, value) => values.set(String(key), String(value)),
    } as Storage;
}

function restoreProperty(target: object, property: PropertyKey, descriptor?: PropertyDescriptor): void {
    if (descriptor) Object.defineProperty(target, property, descriptor);
    else Reflect.deleteProperty(target, property);
}

function restoreAttribute(element: Element, name: string, value: string | null): void {
    if (value === null) element.removeAttribute(name);
    else element.setAttribute(name, value);
}

describe('AppearanceService', () => {
    let storage: Storage;
    let originalGlobalStorage: PropertyDescriptor | undefined;
    let originalWindowStorage: PropertyDescriptor | undefined;
    let originalWindowMatchMedia: PropertyDescriptor | undefined;
    let originalAppTheme: string | null;
    let originalBootstrapTheme: string | null;
    let systemIsDark: boolean;
    let mediaQuery: MediaQueryList;
    let changeListener: ((event: MediaQueryListEvent) => void) | undefined;
    let addEventListener: ReturnType<typeof vi.fn>;
    let removeEventListener: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        originalGlobalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
        originalWindowStorage = Object.getOwnPropertyDescriptor(window, 'localStorage');
        originalWindowMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');
        originalAppTheme = document.documentElement.getAttribute('data-app-theme');
        originalBootstrapTheme = document.documentElement.getAttribute('data-bs-theme');
        storage = createMemoryStorage();
        vi.stubGlobal('localStorage', storage);
        Object.defineProperty(window, 'localStorage', {configurable: true, value: storage});
        systemIsDark = true;
        changeListener = undefined;
        addEventListener = vi.fn((type: string, listener: (event: MediaQueryListEvent) => void) => {
            if (type === 'change') changeListener = listener;
        });
        removeEventListener = vi.fn();
        mediaQuery = {
            matches: systemIsDark,
            media: '(prefers-color-scheme: dark)',
            onchange: null,
            addEventListener,
            removeEventListener,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn(),
        } as unknown as MediaQueryList;
        vi.stubGlobal('matchMedia', vi.fn(() => mediaQuery));
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            value: vi.fn(() => mediaQuery),
        });
        TestBed.configureTestingModule({providers: [AppearanceService]});
    });

    afterEach(() => {
        TestBed.resetTestingModule();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        restoreProperty(window, 'localStorage', originalWindowStorage);
        restoreProperty(window, 'matchMedia', originalWindowMatchMedia);
        restoreProperty(globalThis, 'localStorage', originalGlobalStorage);
        restoreAttribute(document.documentElement, 'data-app-theme', originalAppTheme);
        restoreAttribute(document.documentElement, 'data-bs-theme', originalBootstrapTheme);
    });

    it('loads the saved theme and persists later selections', () => {
        storage.setItem(STORAGE_KEY, 'nord');
        const service = TestBed.inject(AppearanceService);

        expect(service.theme()).toBe('nord');
        expect(document.documentElement.getAttribute('data-app-theme')).toBe('nord');
        expect(document.documentElement.getAttribute('data-bs-theme')).toBe('dark');

        service.setTheme('macos-clear');

        expect(service.theme()).toBe('macos-clear');
        expect(storage.getItem(STORAGE_KEY)).toBe('macos-clear');
        expect(document.documentElement.getAttribute('data-app-theme')).toBe('macos-clear');

        TestBed.resetTestingModule();
        TestBed.configureTestingModule({providers: [AppearanceService]});
        expect(TestBed.inject(AppearanceService).theme()).toBe('macos-clear');
    });

    it('follows system color scheme for Glass and macOS Clear', () => {
        const service = TestBed.inject(AppearanceService);
        expect(document.documentElement.getAttribute('data-bs-theme')).toBe('dark');

        systemIsDark = false;
        Object.defineProperty(mediaQuery, 'matches', {configurable: true, value: false});
        changeListener?.({matches: false} as MediaQueryListEvent);
        expect(document.documentElement.getAttribute('data-bs-theme')).toBe('light');

        service.setTheme('macos-clear');
        expect(document.documentElement.getAttribute('data-bs-theme')).toBe('light');

        systemIsDark = true;
        Object.defineProperty(mediaQuery, 'matches', {configurable: true, value: true});
        changeListener?.({matches: true} as MediaQueryListEvent);
        expect(document.documentElement.getAttribute('data-bs-theme')).toBe('dark');
    });

    it('keeps Graphite and Nord dark when the system switches to light', () => {
        storage.setItem(STORAGE_KEY, 'graphite');
        const service = TestBed.inject(AppearanceService);

        systemIsDark = false;
        Object.defineProperty(mediaQuery, 'matches', {configurable: true, value: false});
        changeListener?.({matches: false} as MediaQueryListEvent);

        expect(service.theme()).toBe('graphite');
        expect(document.documentElement.getAttribute('data-bs-theme')).toBe('dark');

        service.setTheme('nord');
        expect(document.documentElement.getAttribute('data-bs-theme')).toBe('dark');
    });

    it('uses Glass for unknown saved values and tolerates denied storage', () => {
        storage.setItem(STORAGE_KEY, 'unknown');
        const service = TestBed.inject(AppearanceService);
        expect(service.theme()).toBe('glass');

        vi.spyOn(storage, 'setItem').mockImplementation(() => {
            throw new DOMException('Storage denied', 'SecurityError');
        });
        expect(() => service.setTheme('nord')).not.toThrow();
        expect(service.theme()).toBe('nord');
        expect(document.documentElement.getAttribute('data-bs-theme')).toBe('dark');
    });

    it('falls back to Glass when storage reads throw', () => {
        vi.spyOn(storage, 'getItem').mockImplementation(() => {
            throw new DOMException('Storage denied', 'SecurityError');
        });

        expect(TestBed.inject(AppearanceService).theme()).toBe('glass');
    });

    it('works without matchMedia support', () => {
        Object.defineProperty(window, 'matchMedia', {configurable: true, value: undefined});
        const service = TestBed.inject(AppearanceService);

        expect(service.theme()).toBe('glass');
        service.setTheme('nord');
        expect(document.documentElement.getAttribute('data-bs-theme')).toBe('dark');
    });

    it('ignores invalid theme values', () => {
        const service = TestBed.inject(AppearanceService);
        service.setTheme('unknown');

        expect(service.theme()).toBe('glass');
        expect(storage.getItem(STORAGE_KEY)).toBeNull();
        expect(document.documentElement.getAttribute('data-app-theme')).toBe('glass');
    });

    it('removes its system color scheme listener when destroyed', () => {
        const service = TestBed.inject(AppearanceService);
        const listener = addEventListener.mock.calls[0]?.[1];
        service.ngOnDestroy();

        expect(addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
        expect(removeEventListener).toHaveBeenCalledWith('change', listener);
    });
});
