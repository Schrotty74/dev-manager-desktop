import {TestBed} from '@angular/core/testing';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {NgbPaginationModule} from '@ng-bootstrap/ng-bootstrap';
import {RouterModule} from '@angular/router';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {CatalogEntry, CatalogIndexService} from '../../core/services/catalog-index.service';
import {RepositorySourcesService} from '../../core/services/repository-sources.service';
import {InstallQueueService} from '../../core/services/install-queue.service';
import {AppsRepoService, PackageManifest, RepositoryItem, RepositoryPage} from '../../core/services/apps-repo.service';
import {AppsComponent} from '../apps.component';
import {ChannelComponent, filterEntries} from './channel.component';
import {ChangeDetectionStrategy, Component} from '@angular/core';
import {of, throwError} from 'rxjs';
import {By} from '@angular/platform-browser';

const entry = (source: string, id: string, version: string): CatalogEntry => ({
    key: source + id, source: {id: source, url: 'https://' + source + '.example.test/repo.json', name: source, builtIn: false},
    item: new RepositoryItem({id, title: id, manifest: new PackageManifest({id, version, appDescription: 'Media player'})}, 'https://example.test'), isNew: false,
});
const a = entry('alpha', 'shared', '2.0.0'), b = entry('beta', 'shared', '1.0.0');

@Component({standalone: false, changeDetection: ChangeDetectionStrategy.Eager, template: '',
    viewProviders: [{provide: AppsComponent, useValue: {device: {name: 'TV'}, openDetails: vi.fn()}}]})
class HostComponent { showAvailable = true; }

describe('Catalog search and filters', () => {
    it('searches case-insensitively by name, ID, description and source across duplicate entries', () => {
        expect(filterEntries([a, b], 'MEDIA shared', 'all', {}, [])).toHaveLength(2);
        expect(filterEntries([a, b], 'beta', 'all', {}, [])).toEqual([b]);
        expect(filterEntries([a, b], 'missing', 'all', {}, [])).toEqual([]);
    });
    it('filters installed, available, updates, favorites and new apps', () => {
        const installed = {shared: {id: 'shared', version: '1.5.0'}} as any;
        expect(filterEntries([a, b], '', 'updates', installed, [])).toEqual([a]);
        expect(filterEntries([a, b], '', 'not-installed', installed, [])).toEqual([]);
        expect(filterEntries([a, b], '', 'installed', installed, [])).toHaveLength(2);
        expect(filterEntries([a, b], '', 'favorites', {}, ['shared'])).toHaveLength(2);
        expect(filterEntries([{...a, isNew: true}, b], '', 'new', {}, [])).toHaveLength(1);
    });
});

describe('ChannelComponent full-catalog loading', () => {
    const allApps = vi.fn();
    beforeEach(async () => {
        const values = new Map<string, string>();
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
            clear: () => values.clear(),
        });
        allApps.mockReset();
        allApps.mockReturnValue(of(new RepositoryPage({packages: [a.item], paging: {page: 1, maxPage: 1, count: 1, itemsTotal: 1}}, a.source.url)));
        await TestBed.configureTestingModule({declarations: [HostComponent, ChannelComponent],
            imports: [CommonModule, FormsModule, NgbPaginationModule, RouterModule.forRoot([])],
            providers: [{provide: AppsRepoService, useValue: {allApps$: allApps}}],
        }).overrideTemplate(HostComponent, '<app-channel *ngIf="showAvailable"/>').compileComponents();
    });
    afterEach(() => { TestBed.resetTestingModule(); vi.unstubAllGlobals(); });
    it('shows loaded apps, searches all sources and queues the chosen source', async () => {
        const sources = TestBed.inject(RepositorySourcesService);
        sources.add('beta', b.source.url);
        const fixture = TestBed.createComponent(HostComponent); fixture.detectChanges();
        await fixture.whenStable(); fixture.detectChanges();
        const component = fixture.debugElement.query(By.directive(ChannelComponent)).componentInstance as ChannelComponent;
        expect(fixture.nativeElement.textContent).toContain('shared');
        component.search('shared');
        await TestBed.inject(CatalogIndexService).refreshAll(false); fixture.detectChanges();
        expect(component.results).toHaveLength(2);
        component.enqueue(component.results.find(result => result.source.name === 'beta')!);
        expect(TestBed.inject(InstallQueueService).jobs()[0].sourceName).toBe('beta');
        fixture.destroy();
    });
    it('keeps All sources after leaving Available and refreshing reloads every source', async () => {
        const sources = TestBed.inject(RepositorySourcesService);
        sources.add('beta', b.source.url);
        let refreshed = false;
        allApps.mockImplementation((_page: number, custom?: string) => of(new RepositoryPage({
            packages: [new RepositoryItem({id: custom ? (refreshed ? 'new-custom-app' : 'custom-app') : 'homebrew-app',
                title: custom ? (refreshed ? 'New custom app' : 'Custom app') : 'Homebrew app'}, a.source.url)],
            paging: {page: 1, maxPage: 1, count: 1, itemsTotal: 1},
        }, a.source.url)));
        const fixture = TestBed.createComponent(HostComponent); fixture.detectChanges();
        await fixture.whenStable(); fixture.detectChanges();
        const select = fixture.nativeElement.querySelector('#package-source') as HTMLSelectElement;
        select.value = '*'; select.dispatchEvent(new Event('change'));
        fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('Custom app');
        // NgbNav destroys the Available view when switching to Installed.
        fixture.componentInstance.showAvailable = false; fixture.detectChanges();
        fixture.componentInstance.showAvailable = true; fixture.detectChanges();
        await fixture.whenStable(); fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('#package-source').value).toBe('*');
        expect(fixture.nativeElement.textContent).toContain('Custom app');
        expect(fixture.nativeElement.textContent).toContain('Homebrew app');
        allApps.mockClear(); refreshed = true;
        const refresh = Array.from(fixture.nativeElement.querySelectorAll('button'))
            .find(button => (button as HTMLButtonElement).textContent?.trim() === 'Refresh') as HTMLButtonElement;
        refresh.click(); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
        expect(allApps).toHaveBeenCalledWith(1);
        expect(allApps).toHaveBeenCalledWith(1, b.source.url);
        expect(fixture.nativeElement.textContent).toContain('New custom app');
        fixture.destroy();
    });

    it('keeps a single-source selection after leaving Available', async () => {
        const sources = TestBed.inject(RepositorySourcesService);
        sources.add('beta', b.source.url);
        const fixture = TestBed.createComponent(HostComponent); fixture.detectChanges();
        await fixture.whenStable(); fixture.detectChanges();
        const component = fixture.debugElement.query(By.directive(ChannelComponent)).componentInstance as ChannelComponent;
        component.changeSource('*'); await fixture.whenStable(); fixture.detectChanges();
        component.changeSource(b.source.url); fixture.detectChanges(); await fixture.whenStable();
        fixture.componentInstance.showAvailable = false; fixture.detectChanges();
        allApps.mockClear();
        fixture.componentInstance.showAvailable = true; fixture.detectChanges();
        await fixture.whenStable(); fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('#package-source').value).toBe(b.source.url);
        expect(allApps).toHaveBeenCalledTimes(1);
        expect(allApps).toHaveBeenCalledWith(1, b.source.url);
        fixture.destroy();
    });

    it('shows a source error and retries without an unhandled error or permanent spinner', async () => {
        allApps.mockReturnValue(throwError(() => new Error('Offline catalog')));
        const fixture = TestBed.createComponent(HostComponent); fixture.detectChanges();
        await fixture.whenStable(); fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('Offline catalog');
        allApps.mockReturnValue(of(new RepositoryPage({packages: [], paging: {page: 1, maxPage: 0, count: 0, itemsTotal: 0}}, a.source.url)));
        const index = TestBed.inject(CatalogIndexService); await index.refresh(index.sources.selected());
        fixture.detectChanges(); expect(fixture.nativeElement.textContent).not.toContain('Offline catalog');
        expect(index.loading()).toBe(false); fixture.destroy();
    });
});
