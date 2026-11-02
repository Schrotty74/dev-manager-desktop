import {Component, Host, Input, OnInit, OnDestroy, ChangeDetectionStrategy, effect, untracked} from '@angular/core';
import {RawPackageInfo} from '../../types';
import {AppsComponent} from '../apps.component';
import {CatalogEntry, CatalogIndexService} from '../../core/services/catalog-index.service';
import {RepositorySourcesService} from '../../core/services/repository-sources.service';
import {InstallQueueService} from '../../core/services/install-queue.service';

export type CatalogFilter = 'all' | 'installed' | 'not-installed' | 'updates' | 'favorites' | 'new';

export function filterEntries(entries: readonly CatalogEntry[], query: string, filter: CatalogFilter,
    installed: Record<string, RawPackageInfo>, favorites: readonly string[], descending = false): CatalogEntry[] {
    const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return entries.filter(entry => {
        const item = entry.item;
        const text = [item.title, item.id, item.manifest?.appDescription, entry.source.name].join(' ').toLocaleLowerCase();
        if (!words.every(word => text.includes(word))) return false;
        const local = installed[item.id];
        switch (filter) {
            case 'installed': return !!local;
            case 'not-installed': return !local;
            case 'updates': return !!local && item.manifest?.hasUpdate(local.version) === true;
            case 'favorites': return favorites.includes(item.id);
            case 'new': return entry.isNew;
            default: return true;
        }
    }).sort((a, b) => ((a.item.title || a.item.id).localeCompare(b.item.title || b.item.id) ||
        a.source.name.localeCompare(b.source.name)) * (descending ? -1 : 1));
}

@Component({
    selector: 'app-channel', templateUrl: './channel.component.html', styleUrls: ['./channel.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager, standalone: false,
})
export class ChannelComponent implements OnInit, OnDestroy {
    @Input() installed?: Record<string, RawPackageInfo>;
    query = '';
    get allSources(): boolean { return this.index.browseAllSources(); }
    set allSources(value: boolean) { this.index.browseAllSources.set(value); }
    searchAll = true;
    filter: CatalogFilter = 'all';
    descending = false;
    page = 1;
    readonly pageSize = 30;
    comparedId = '';
    selected = new Set<string>();
    private searchTimer?: ReturnType<typeof setTimeout>;

    constructor(@Host() public parent: AppsComponent, public index: CatalogIndexService,
        public sources: RepositorySourcesService, public queue: InstallQueueService) {
        let selectedId = sources.selectedId();
        effect(() => {
            const next = sources.selectedId();
            if (next !== selectedId) {
                selectedId = next;
                untracked(() => { this.page = 1; void this.index.refresh(sources.selected()); });
            }
        });
    }
    ngOnInit(): void { this.refresh(); }
    ngOnDestroy(): void { clearTimeout(this.searchTimer); }
    get acrossSources(): boolean { return this.allSources || !!this.query.trim() && this.searchAll; }
    get results(): CatalogEntry[] {
        const entries = this.index.entries().filter(entry => this.acrossSources || entry.source.id === this.sources.selectedId());
        return filterEntries(entries, this.query, this.filter, this.installed ?? {}, this.index.favorites(), this.descending);
    }
    get visible(): CatalogEntry[] { return this.results.slice((this.page - 1) * this.pageSize, this.page * this.pageSize); }
    get selectedCount(): number { return this.index.entries().filter(entry => this.selected.has(entry.key)).length; }
    changeSource(id: string): void {
        this.page = 1;
        this.allSources = id === '*';
        if (this.allSources) void this.index.refreshAll(false);
        else {
            const same = id === this.sources.selectedId();
            this.sources.select(id);
            if (same) void this.index.refresh(this.sources.selected());
        }
    }
    search(value: string): void {
        this.query = value;
        this.page = 1;
        clearTimeout(this.searchTimer);
        this.searchTimer = setTimeout(() => { if (this.acrossSources) void this.index.refreshAll(false); }, 250);
    }
    changeScope(enabled: boolean): void { this.searchAll = enabled; this.search(this.query); }
    refresh(): void {
        this.page = 1;
        if (this.acrossSources) void this.index.refreshAll();
        else void this.index.refresh(this.sources.selected());
    }
    compare(id: string): void {
        this.comparedId = this.comparedId === id ? '' : id;
        if (this.comparedId) void this.index.refreshAll(false);
    }
    toggleSelected(key: string): void {
        if (this.selected.has(key)) this.selected.delete(key); else this.selected.add(key);
    }
    enqueue(entry: CatalogEntry): void {
        const device = this.parent.device;
        if (device) this.queue.add(entry.item, entry.source.name, device);
    }
    enqueueSelected(): void {
        for (const entry of this.index.entries()) if (this.selected.has(entry.key)) this.enqueue(entry);
        this.selected.clear();
    }
}
