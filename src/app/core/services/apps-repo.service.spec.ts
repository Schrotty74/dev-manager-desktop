import {afterEach, describe, expect, it, vi} from 'vitest';
import {firstValueFrom} from 'rxjs';
import {AppsRepoService, PackageManifest, RepositoryItem} from './apps-repo.service';
import {mockBackend} from '../../../testing/tauri-mock';
import {mockHttp} from '../../../testing/tauri-http-mock';

const base = 'https://repo.webosbrew.org/api';
const item = {id: 'example.app', title: 'Example', iconUri: 'https://example.com/icon.png',
    manifest: {id: 'example.app', version: '1.2.3'}, fullDescriptionUrl: './description.html'};
const page = {paging: {page: 1, count: 1, maxPage: 1, itemsTotal: 1}, packages: [item]};
const customUrl = 'https://catalog.example.test/repo/catalog.json';
const customItem = {id: 'custom.app', title: 'Custom', iconUri: './icons/custom.png', detailIcon: './icons/detail.png',
    fullDescriptionUrl: './description.html', manifestUrl: './manifest.json',
    manifest: {id: 'custom.app', version: '2.0.0', ipkUrl: './packages/custom.ipk', ipkHash: {sha256: 'a'.repeat(64)}}};
const service = () => new AppsRepoService();

function respond(body: unknown, status = 200) {
    mockBackend(mockHttp([{url: /./, response: {body, status}}]));
}

afterEach(() => vi.useRealTimers());

describe('AppsRepoService repository requests', () => {
    it.each([0, 1, 2])('routes page %s and constructs repository models', async requested => {
        const url = `${base}/${requested > 1 ? `apps/${requested}.json` : 'apps.json'}`;
        mockBackend(mockHttp([{url, response: {body: page}}]));
        const result = await firstValueFrom(service().allApps$(requested));
        expect(result.paging).toEqual(page.paging);
        expect(result.packages[0]).toBeInstanceOf(RepositoryItem);
        expect(result.packages[0].manifest).toBeInstanceOf(PackageManifest);
        expect(result.packages[0].fullDescriptionUrl).toBe(new URL('./description.html', url).toString());
    });

    it('accepts a valid empty page', async () => {
        respond({paging: {page: 1, count: 0, maxPage: 0, itemsTotal: 0}, packages: []});
        expect((await firstValueFrom(service().allApps$())).packages).toEqual([]);
    });

    it('accepts an unpaged custom catalog and resolves its metadata URLs', async () => {
        respond({packages: [customItem]});
        const result = await firstValueFrom(service().allApps$(0, customUrl));
        expect(result.paging).toEqual({page: 1, count: 1, maxPage: 1, itemsTotal: 1});
        expect(result.packages[0].iconUri).toBe('https://catalog.example.test/repo/icons/custom.png');
        expect(result.packages[0].detailIconUri).toBe('https://catalog.example.test/repo/icons/detail.png');
        expect(result.packages[0].fullDescriptionUrl).toBe('https://catalog.example.test/repo/description.html');
        expect(result.packages[0].manifestUrl).toBe('https://catalog.example.test/repo/manifest.json');
        expect(result.packages[0].manifest?.ipkUrl).toBe('https://catalog.example.test/repo/packages/custom.ipk');
    });

    it('leaves descriptive prose alone and resolves a valid beta download', async () => {
        const value = {...customItem, fullDescriptionUrl: undefined, description: 'A short text description', manifestBeta: {
            id: 'custom.app', version: '2.1.0', ipkUrl: './beta.ipk', ipkHash: {sha256: 'b'.repeat(64)}}};
        respond({packages: [value]});
        const result = await firstValueFrom(service().allApps$(0, customUrl));
        expect(result.packages[0].fullDescriptionUrl).toBeUndefined();
        expect(result.packages[0].manifestBeta?.ipkUrl).toBe('https://catalog.example.test/repo/beta.ipk');
    });

    it('accepts an empty custom catalog and checks its app count', async () => {
        respond({packages: []});
        expect(await service().checkRepository(customUrl)).toEqual({count: 0});
        respond({packages: []});
        expect((await firstValueFrom(service().allApps$(0, customUrl))).packages).toEqual([]);
    });

    it('filters invalid custom entries, reports the skipped count, and preserves valid apps', async () => {
        const invalid = {...customItem, id: 'broken.app'};
        respond({packages: [invalid, customItem]});
        const result = await firstValueFrom(service().allApps$(0, customUrl));
        expect(result.skippedCount).toBe(1);
        expect(result.packages.map(pkg => pkg.id)).toEqual(['custom.app']);
    });

    it.each([
        {...customItem, manifest: {...customItem.manifest, ipkHash: {sha256: 'bad'}}},
        {...customItem, manifest: {...customItem.manifest, ipkUrl: 'http://catalog.example.test/app.ipk'}},
        {...customItem, manifest: {...customItem.manifest, id: 'different.app'}},
        {...customItem, manifestBeta: {id: 'custom.app', version: '2.1.0', ipkUrl: './beta.ipk', ipkHash: {sha256: 'bad'}}},
    ])('rejects unsafe or inconsistent custom package metadata', async value => {
        respond({packages: [value]});
        await expect(firstValueFrom(service().allApps$(0, customUrl))).rejects.toThrow('Invalid custom repository catalog');
    });

    it('rejects HTTP error JSON instead of accepting it as an empty page', async () => {
        respond({message: 'Unavailable'}, 503);
        await expect(firstValueFrom(service().allApps$())).rejects.toThrow('HTTP 503');
    });

    it('disposes an unread HTTP error body without waiting for it', async () => {
        vi.useFakeTimers();
        const cancel = vi.fn(() => null);
        mockBackend({...mockHttp([{url: /./, response: {status: 503}}]),
            'http/fetch_read_body': () => new Promise(() => {}), 'http/fetch_cancel_body': cancel});
        let result: unknown = 'pending';
        void firstValueFrom(service().allApps$()).then(value => result = value, error => result = error);
        await vi.advanceTimersByTimeAsync(0);
        expect(result).toBeInstanceOf(Error);
        expect((result as Error).message).toContain('HTTP 503');
        expect(cancel).toHaveBeenCalled();
    });

    it.each([
        null, [], {}, {packages: []}, {paging: page.paging},
        {paging: page.paging, packages: {}}, {paging: {...page.paging, page: '1'}, packages: []},
        {paging: {...page.paging, count: -1}, packages: []},
        {paging: {...page.paging, maxPage: 1.5}, packages: []},
        {paging: {...page.paging, itemsTotal: null}, packages: []},
        {paging: page.paging, packages: [null]},
    ])('rejects malformed repository page %#', async body => {
        // JSON null needs an explicit serialized body in this HTTP fixture.
        respond(body === null ? 'null' : body);
        await expect(firstValueFrom(service().allApps$())).rejects.toThrow('Invalid repository page');
    });

    it('reports malformed JSON usefully', async () => {
        respond('{broken');
        await expect(firstValueFrom(service().allApps$())).rejects.toThrow('Invalid JSON');
    });

    it('preserves network errors', async () => {
        const failure = new Error('Network unavailable');
        mockBackend({'http/fetch': () => Promise.reject(failure)});
        await expect(firstValueFrom(service().allApps$())).rejects.toBe(failure);
    });

    it.each(['headers', 'body'])('aborts stalled %s after the full request deadline', async stage => {
        vi.useFakeTimers();
        const cancel = vi.fn(() => null);
        const cancelBody = vi.fn(() => null);
        mockBackend({...mockHttp([{url: /./, response: {body: page}}]),
            ...(stage === 'headers' ? {'http/fetch_send': () => new Promise(() => {})}
                : {'http/fetch_read_body': () => new Promise(() => {})}),
            'http/fetch_cancel': cancel, 'http/fetch_cancel_body': cancelBody});
        let result: unknown = 'pending';
        void firstValueFrom(service().allApps$()).then(value => result = value, error => result = error);
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(29_999);
        expect(result).toBe('pending');
        await vi.advanceTimersByTimeAsync(1);
        expect(result).toBeInstanceOf(Error);
        expect((result as Error).message).toContain('timed out');
        expect(cancel).toHaveBeenCalledOnce();
        if (stage === 'body') expect(cancelBody).toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('uses one deadline across headers and body, rather than restarting for JSON', async () => {
        vi.useFakeTimers();
        const handlers = mockHttp([{url: /./, response: {body: page}}]);
        const send = handlers['http/fetch_send'];
        mockBackend({...handlers,
            'http/fetch_send': args => new Promise(resolve => setTimeout(() => resolve(send(args)), 20_000)),
            'http/fetch_read_body': () => new Promise(() => {})});
        let result: unknown = 'pending';
        void firstValueFrom(service().allApps$()).catch(error => result = error);
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(30_000);
        expect(result).toBeInstanceOf(Error);
        expect((result as Error).message).toContain('timed out');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('clears the deadline after success or failure', async () => {
        vi.useFakeTimers();
        respond(page);
        await firstValueFrom(service().allApps$());
        expect(vi.getTimerCount()).toBe(0);
        respond('{bad');
        await expect(firstValueFrom(service().allApps$())).rejects.toThrow();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps missing optional metadata best-effort, even for a JSON 404 body', async () => {
        respond({message: 'Not found'}, 404);
        expect(await service().showApp('missing')).toBeUndefined();
    });

    it('keeps valid optional metadata and filters failed lookups', async () => {
        mockBackend(mockHttp([
            {url: `${base}/apps/example.app/releases/latest.json`, response: {body: item}},
            {url: `${base}/apps/missing/releases/latest.json`, response: {status: 404, body: 'Not found'}},
        ]));
        const result = await service().showApps('example.app', 'missing');
        expect(Object.keys(result)).toEqual(['example.app']);
        expect(result['example.app']).toBeInstanceOf(RepositoryItem);
        expect(result['example.app'].manifest?.version).toBe('1.2.3');
    });
});
