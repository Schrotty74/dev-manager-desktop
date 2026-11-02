import {TestBed} from '@angular/core/testing';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {of, Subject, throwError} from 'rxjs';
import {AppsRepoService, PackageManifest, RepositoryItem, RepositoryPage} from './apps-repo.service';
import {CatalogIndexService} from './catalog-index.service';
import {RepositorySourcesService} from './repository-sources.service';

const url = 'https://catalog.example.test/repo.json';
const item = (id: string) => new RepositoryItem({id, title: id, manifest: new PackageManifest({id, version: '1.0.0'})}, url);
const page = (ids: string[], current = 1, max = 1) => new RepositoryPage({packages: ids.map(item),
    paging: {page: current, maxPage: max, count: ids.length, itemsTotal: ids.length}}, url);

describe('CatalogIndexService', () => {
    let index: CatalogIndexService;
    let sources: RepositorySourcesService;
    const allApps = vi.fn();
    beforeEach(() => {
        const values = new Map<string, string>();
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
            clear: () => values.clear(),
        });
        allApps.mockReset();
        TestBed.configureTestingModule({providers: [CatalogIndexService, RepositorySourcesService,
            {provide: AppsRepoService, useValue: {allApps$: allApps}}]});
        sources = TestBed.inject(RepositorySourcesService);
        sources.add('Custom catalog', url);
        index = TestBed.inject(CatalogIndexService);
    });
    afterEach(() => { TestBed.resetTestingModule(); vi.unstubAllGlobals(); });

    it('loads every page and retains the source for duplicate app IDs across catalogs', async () => {
        allApps.mockImplementation((number: number, custom?: string) => of(custom
            ? page(number === 1 ? ['shared'] : ['last-page'], number, 2) : page(['shared'])));
        await index.refreshAll();
        expect(index.entries().map(e => [e.source.name, e.item.id])).toEqual([
            ['Homebrew Channel', 'shared'], ['Custom catalog', 'shared'], ['Custom catalog', 'last-page']]);
        expect(allApps).toHaveBeenCalledWith(2, url);
        expect(index.candidates('shared')).toHaveLength(2);
    });

    it('keeps other sources searchable when one fails and can retry the failed source', async () => {
        allApps.mockImplementation((_number: number, custom?: string) => custom
            ? throwError(() => new Error('Offline')) : of(page(['working'])));
        await index.refreshAll();
        expect(index.entries().map(e => e.item.id)).toEqual(['working']);
        expect(index.errors().map(e => e.url)).toEqual([url]);
        allApps.mockReturnValue(of(page(['recovered'])));
        await index.refresh(sources.sources()[1]);
        expect(index.errors()).toEqual([]);
        expect(index.entries().map(e => e.item.id)).toContain('recovered');
    });

    it('marks additions after the baseline, retains them until acknowledged and survives restart', async () => {
        allApps.mockReturnValue(of(page(['existing'])));
        await index.refresh(sources.sources()[1]);
        expect(index.newCount()).toBe(0);
        allApps.mockReturnValue(of(page(['existing', 'added'])));
        await index.refresh(sources.sources()[1]);
        expect(index.entries().find(e => e.item.id === 'added')?.isNew).toBe(true);
        await index.refresh(sources.sources()[1]);
        expect(index.newCount()).toBe(1);
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({providers: [CatalogIndexService, RepositorySourcesService,
            {provide: AppsRepoService, useValue: {allApps$: allApps}}]});
        index = TestBed.inject(CatalogIndexService);
        await index.refresh(index.sources.sources()[1]);
        expect(index.newCount()).toBe(1);
        index.markSeen();
        expect(index.newCount()).toBe(0);
    });

    it('does not replace an intact cache with an incomplete catalog or advance its baseline on failure', async () => {
        allApps.mockReturnValue(of(page(['existing'])));
        await index.refresh(sources.sources()[1]);
        allApps.mockImplementation((number: number) => number === 1 ? of(page(['added'], 1, 2))
            : throwError(() => new Error('Second page unavailable')));
        await index.refresh(sources.sources()[1]);
        expect(index.entries().map(e => e.item.id)).toEqual(['existing']);
        expect(index.newCount()).toBe(0);
        expect(index.states()[url].error).toContain('Second page');
    });

    it('deduplicates simultaneous fetches and discards responses for removed sources', async () => {
        const response = new Subject<RepositoryPage>();
        allApps.mockReturnValue(response.asObservable());
        const source = sources.sources()[1];
        const first = index.refresh(source), second = index.refresh(source);
        expect(allApps).toHaveBeenCalledTimes(1);
        sources.remove(source.id);
        response.next(page(['removed-source'])); response.complete();
        await Promise.all([first, second]);
        expect(index.entries()).toEqual([]);
    });

    it('saves favorites by app ID independent of source, without persisting package URLs or credentials', () => {
        index.toggleFavorite('shared'); index.setNotices(true);
        const saved = localStorage.getItem('devman.catalog-preferences.v1')!;
        expect(JSON.parse(saved)).toEqual({favorites: ['shared'], noticesEnabled: true});
        index.toggleFavorite('shared'); expect(index.favorites()).toEqual([]);
    });
});
