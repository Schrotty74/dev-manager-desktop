import {computed, Injectable, signal} from '@angular/core';
import {normalizeRepositoryUrl} from './repository-url';

export interface RepositorySource {
    id: string;
    name: string;
    url: string;
    builtIn: boolean;
}

const STORAGE_KEY = 'devman.repository-sources.v1';
const FORMAT = 'webos-dev-manager.repository-sources';
const HOME: RepositorySource = {
    id: 'homebrew', name: 'Homebrew Channel', url: 'https://repo.webosbrew.org/api/apps.json', builtIn: true,
};

function customSource(value: unknown): RepositorySource {
    const data = value as {name?: unknown; url?: unknown};
    if (!data || typeof data.name !== 'string' || !data.name.trim() || data.name.trim().length > 80 ||
        typeof data.url !== 'string') throw new Error('Each source needs a name and an HTTPS catalog address.');
    const url = normalizeRepositoryUrl(data.url);
    return {id: url, name: data.name.trim(), url, builtIn: false};
}

@Injectable({providedIn: 'root'})
export class RepositorySourcesService {
    private readonly sourceState = signal<readonly RepositorySource[]>([HOME]);
    private readonly selectedState = signal(HOME.id);
    readonly sources = this.sourceState.asReadonly();
    readonly selectedId = this.selectedState.asReadonly();
    readonly selected = computed(() => this.sources().find(s => s.id === this.selectedId()) ?? HOME);
    readonly storageWarning = signal('');

    constructor() {
        try {
            const saved = window.localStorage.getItem(STORAGE_KEY);
            if (saved) this.restoreBackup(saved, false);
        } catch {
            this.storageWarning.set('Saved sources could not be read. Homebrew Channel is still available.');
        }
    }

    add(name: string, url: string): void {
        const source = customSource({name, url});
        if (this.sources().some(s => s.url === source.url)) throw new Error('This source is already in the list.');
        if (this.sources().length >= 101) throw new Error('A maximum of 100 custom sources is supported.');
        this.sourceState.update(sources => [...sources, source]);
        this.persist();
    }

    remove(id: string): void {
        if (id === HOME.id) return;
        this.sourceState.update(sources => sources.filter(s => s.id !== id));
        if (this.selectedId() === id) this.selectedState.set(HOME.id);
        this.persist();
    }

    select(id: string): void {
        if (!this.sources().some(s => s.id === id)) return;
        this.selectedState.set(id);
        this.persist();
    }

    exportBackup(): string {
        return JSON.stringify({
            format: FORMAT, version: 1,
            sources: this.sources().filter(s => !s.builtIn).map(({name, url}) => ({name, url})),
            selectedUrl: this.selected().url,
        }, null, 2) + '\n';
    }

    restoreBackup(text: string, save = true): number {
        if (text.length > 1_048_576) throw new Error('The sources backup is too large.');
        let data: any;
        try { data = JSON.parse(text); } catch { throw new Error('This file is not a valid JSON backup.'); }
        if (!data || data.format !== FORMAT || data.version !== 1 || !Array.isArray(data.sources) ||
            data.sources.length > 100 || (data.selectedUrl !== undefined && typeof data.selectedUrl !== 'string')) {
            throw new Error('This is not a supported package-sources backup.');
        }
        // Validate everything before changing the current configuration.
        const incoming = data.sources.map((s: unknown) => customSource(s));
        const merged = [...this.sources()];
        let added = 0;
        for (const source of incoming) {
            if (merged.some(s => s.url === source.url)) continue;
            merged.push(source);
            added++;
        }
        if (merged.length > 101) throw new Error('The backup would exceed 100 custom sources.');
        this.sourceState.set(merged);
        const selected = merged.find(s => s.url === data.selectedUrl);
        if (selected) this.selectedState.set(selected.id);
        if (save) this.persist();
        return added;
    }

    private persist(): void {
        try {
            window.localStorage.setItem(STORAGE_KEY, this.exportBackup());
            this.storageWarning.set('');
        } catch {
            this.storageWarning.set('Sources are available for this session, but could not be saved. Export a backup to keep them.');
        }
    }
}
