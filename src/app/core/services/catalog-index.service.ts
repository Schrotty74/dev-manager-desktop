import {computed, inject, Injectable, signal} from '@angular/core';
import {firstValueFrom} from 'rxjs';
import {AppsRepoService, RepositoryItem} from './apps-repo.service';
import {RepositorySource, RepositorySourcesService} from './repository-sources.service';

export interface CatalogEntry { key: string; source: RepositorySource; item: RepositoryItem; isNew: boolean; }
export interface CatalogState {
    items: RepositoryItem[];
    loading: boolean;
    checkedAt?: number;
    error?: string;
    skipped: number;
}
interface Snapshot { ids: string[]; newIds: string[]; checkedAt: number; }
const SNAPSHOTS = 'devman.catalog-snapshots.v1';
const PREFERENCES = 'devman.catalog-preferences.v1';
const MAX_PAGES = 200;

@Injectable({providedIn: 'root'})
export class CatalogIndexService {
    private readonly repo = inject(AppsRepoService);
    readonly sources = inject(RepositorySourcesService);
    readonly browseAllSources = signal(false);
    readonly states = signal<Record<string, CatalogState>>({});
    readonly favorites = signal<readonly string[]>([]);
    readonly noticesEnabled = signal(false);
    readonly storageWarning = signal('');
    private snapshots: Record<string, Snapshot> = Object.create(null);
    private readonly pending = new Map<string, Promise<void>>();
    readonly entries = computed<CatalogEntry[]>(() => this.sources.sources().flatMap(source => {
        const newIds = new Set(this.snapshots[source.url]?.newIds ?? []);
        return (this.states()[source.url]?.items ?? []).map(item => ({
            key: JSON.stringify([source.url, item.id]), source, item, isNew: newIds.has(item.id),
        }));
    }));
    readonly loading = computed(() => this.sources.sources().some(source => this.states()[source.url]?.loading));
    readonly errors = computed(() => this.sources.sources().filter(source => this.states()[source.url]?.error));
    readonly newCount = computed(() => this.entries().filter(entry => entry.isNew).length);

    constructor() {
        try {
            const data = JSON.parse(localStorage.getItem(SNAPSHOTS) ?? '{}');
            for (const [url, value] of Object.entries(data)) {
                const snapshot = value as Snapshot;
                if (snapshot && Array.isArray(snapshot.ids) && snapshot.ids.length <= 20000 &&
                    snapshot.ids.every(id => typeof id === 'string') && Array.isArray(snapshot.newIds) &&
                    snapshot.newIds.length <= 20000 && snapshot.newIds.every(id => typeof id === 'string') &&
                    Number.isFinite(snapshot.checkedAt)) this.snapshots[url] = snapshot;
            }
            const prefs = JSON.parse(localStorage.getItem(PREFERENCES) ?? '{}');
            if (Array.isArray(prefs.favorites)) this.favorites.set(prefs.favorites.filter((id: unknown) =>
                typeof id === 'string').slice(0, 10000));
            this.noticesEnabled.set(prefs.noticesEnabled === true);
        } catch { this.storageWarning.set('Saved catalog preferences could not be read.'); }
    }

    refresh(source: RepositorySource, force = true): Promise<void> {
        const active = this.pending.get(source.url);
        if (active) return active;
        if (!force && this.states()[source.url]?.checkedAt) return Promise.resolve();
        const task = this.load(source).finally(() => this.pending.delete(source.url));
        this.pending.set(source.url, task);
        return task;
    }

    async refreshAll(force = true): Promise<void> {
        const sources = [...this.sources.sources()];
        let next = 0;
        await Promise.all(Array.from({length: Math.min(4, sources.length)}, async () => {
            while (next < sources.length) await this.refresh(sources[next++], force);
        }));
    }

    private async load(source: RepositorySource): Promise<void> {
        const previous = this.states()[source.url];
        this.setState(source.url, {...previous, items: previous?.items ?? [], skipped: previous?.skipped ?? 0,
            loading: true, error: undefined});
        try {
            const request = (page: number) => firstValueFrom(source.builtIn
                ? this.repo.allApps$(page) : this.repo.allApps$(page, source.url));
            const first = await request(1);
            if (first.paging.maxPage > MAX_PAGES) throw new Error('Catalog exceeds the 200-page search limit.');
            const items = [...first.packages];
            let skipped = first.skippedCount;
            for (let page = 2; page <= first.paging.maxPage; page++) {
                const result = await request(page);
                if (result.paging.page !== page) throw new Error('The catalog returned an unexpected page.');
                items.push(...result.packages);
                skipped += result.skippedCount;
            }
            // Sources removed while a request was running must not repopulate the index.
            if (!this.sources.sources().some(s => s.url === source.url)) return;
            const unique = [...new Map(items.map(item => [item.id, item])).values()];
            const old = this.snapshots[source.url];
            const oldIds = new Set(old?.ids ?? []);
            const newIds = new Set(old?.newIds ?? []);
            if (old) for (const item of unique) if (!oldIds.has(item.id)) newIds.add(item.id);
            const ids = unique.map(item => item.id);
            const checkedAt = Date.now();
            this.snapshots[source.url] = {ids, newIds: ids.filter(id => newIds.has(id)), checkedAt};
            this.persistSnapshots();
            this.setState(source.url, {items: unique, checkedAt, loading: false, skipped});
        } catch (error) {
            this.setState(source.url, {...previous, items: previous?.items ?? [], skipped: previous?.skipped ?? 0,
                loading: false, error: error instanceof Error ? error.message : 'Unable to load catalog.'});
        }
    }

    candidates(id: string): CatalogEntry[] { return this.entries().filter(entry => entry.item.id === id); }

    toggleFavorite(id: string): void {
        this.favorites.update(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]);
        this.persistPreferences();
    }

    setNotices(enabled: boolean): void { this.noticesEnabled.set(enabled); this.persistPreferences(); }

    markSeen(): void {
        for (const source of this.sources.sources()) {
            const snapshot = this.snapshots[source.url];
            if (snapshot) this.snapshots[source.url] = {...snapshot, newIds: []};
        }
        this.persistSnapshots();
        this.states.update(states => ({...states}));
    }

    private setState(url: string, state: CatalogState): void {
        this.states.update(states => ({...states, [url]: state}));
    }
    private persistSnapshots(): void {
        const current = Object.fromEntries(this.sources.sources().filter(source => this.snapshots[source.url])
            .map(source => [source.url, this.snapshots[source.url]]));
        this.save(SNAPSHOTS, current);
    }
    private persistPreferences(): void {
        this.save(PREFERENCES, {favorites: this.favorites(), noticesEnabled: this.noticesEnabled()});
    }
    private save(key: string, value: unknown): void {
        try { localStorage.setItem(key, JSON.stringify(value)); this.storageWarning.set(''); }
        catch { this.storageWarning.set('Catalog preferences could not be saved. They remain available for this session.'); }
    }
}
