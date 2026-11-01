import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {RepositorySourcesService} from './repository-sources.service';

describe('RepositorySourcesService', () => {
    let values: Map<string, string>;
    let original: PropertyDescriptor | undefined;
    const url = 'https://example.com/catalog.json';
    const backup = (sources: unknown[], selectedUrl?: string) => JSON.stringify({
        format: 'webos-dev-manager.repository-sources', version: 1, sources, selectedUrl,
    });

    beforeEach(() => {
        values = new Map();
        original = Object.getOwnPropertyDescriptor(window, 'localStorage');
        Object.defineProperty(window, 'localStorage', {configurable: true, value: {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
        }});
    });
    afterEach(() => {
        if (original) Object.defineProperty(window, 'localStorage', original);
        else Reflect.deleteProperty(window, 'localStorage');
    });

    it('restores sources and selection on a fresh app instance', () => {
        const first = new RepositorySourcesService();
        first.add('My apps', url);
        first.select(url);
        const restored = new RepositorySourcesService();
        expect(restored.sources().length).toBe(2);
        expect(restored.selected().name).toBe('My apps');
    });

    it('exports portable URLs and names and merges them on another Mac', () => {
        const first = new RepositorySourcesService();
        first.add('My apps', url);
        first.select(url);
        const text = first.exportBackup();
        values.clear();
        const second = new RepositorySourcesService();
        second.add('Existing', 'https://example.org/apps.json');
        expect(second.restoreBackup(text)).toBe(1);
        expect(second.sources().length).toBe(3);
        expect(second.selected().url).toBe(url);
        expect(second.restoreBackup(text)).toBe(0);
        expect(JSON.parse(text).sources).toEqual([{name: 'My apps', url}]);
        expect(text).not.toMatch(/ssh|password|device|token/i);
    });

    it('rejects a partially invalid backup without changing any sources', () => {
        const service = new RepositorySourcesService();
        service.add('Existing', url);
        const original = service.exportBackup();
        expect(() => service.restoreBackup(backup([
            {name: 'Valid', url: 'https://example.org/apps.json'},
            {name: 'Invalid', url: 'file:///secret.json'},
        ]))).toThrow();
        expect(service.exportBackup()).toBe(original);
        expect(() => service.restoreBackup('{broken')).toThrow('valid JSON');
        expect(() => service.restoreBackup(JSON.stringify({packages: []}))).toThrow('supported');
    });

    it('keeps Homebrew protected and resets a removed selection', () => {
        const service = new RepositorySourcesService();
        service.remove('homebrew');
        expect(service.sources().length).toBe(1);
        service.add('My apps', url);
        expect(() => service.add('Duplicate', url)).toThrow('already');
        service.select(url);
        service.remove(url);
        expect(service.selected().builtIn).toBe(true);
    });

    it('tolerates corrupt or unavailable local storage', () => {
        values.set('devman.repository-sources.v1', '{bad');
        const service = new RepositorySourcesService();
        expect(service.sources().length).toBe(1);
        expect(service.storageWarning()).toBeTruthy();
        vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('Denied'); });
        expect(() => service.add('Session apps', url)).not.toThrow();
        expect(service.sources().length).toBe(2);
        expect(service.storageWarning()).toContain('session');
    });
});
