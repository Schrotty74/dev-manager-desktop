import {ComponentFixture, DeferBlockBehavior, TestBed} from '@angular/core/testing';
import {provideLocationMocks} from '@angular/common/testing';
import {Router} from '@angular/router';
import {emit, TauriEvent} from '@tauri-apps/api/event';
import {mockWindows} from '@tauri-apps/api/mocks';
import {vi} from 'vitest';

import {AppComponent} from './app.component';
import {AppModule} from './app.module';
import {Device} from './types';
import {UpdateService} from './core/services';
import {AppearanceService} from './core/services/appearance.service';
import {InstallQueueService} from './core/services/install-queue.service';
import {RepositorySourcesService} from './core/services/repository-sources.service';
import ReleaseInfo from '../release.json';
import packageInfo from '../../package.json';
import {mockBackend, resetBackend} from '../testing/tauri-mock';
import {mockHttp} from '../testing/tauri-http-mock';

/**
 * End-to-end in the browser: the real AppModule, the real router and the real
 * lazily-loaded route components, with nothing behind the IPC boundary but stubs.
 *
 * This is the widest net the harness casts — it covers routing, the app shell and
 * cross-component wiring that a per-component spec cannot reach, and it needs no
 * Tauri window, no webOS device and no network.
 *
 * These specs are `async`, not `fakeAsync`: the router resolves route components
 * through dynamic `import()`, and those promises settle outside the fake async
 * zone, so `tick()` never sees them.
 */
describe('App (mocked backend e2e)', () => {
    const originalReleaseVersion = ReleaseInfo.version;
    const devices = <Device[]>[
        {name: 'living-room', host: '192.168.1.1', port: 22, username: 'root', profile: 'ose'},
        {name: 'bedroom', host: '192.168.1.2', port: 22, username: 'root', profile: 'ose'},
    ];

    let fixture: ComponentFixture<AppComponent>;
    let router: Router;

    /** Every call the shell makes on startup. */
    function shellHandlers() {
        return {
            ...mockHttp([
                {
                    // The update check. Reporting an old version keeps the
                    // "update available" modal from covering the assertions.
                    url: /api\.github\.com\/.*\/releases\/latest$/,
                    response: {body: {tag_name: 'v0.0.1', html_url: 'https://example.invalid', body: ''}},
                },
                {url: /repo\.webosbrew\.org\/api\//, response: {body: {packages: [], paging: {page: 1, count: 0, maxPage: 0, itemsTotal: 0}}}},
            ]),
            'device-manager/list': () => devices,
        };
    }

    async function settle(): Promise<void> {
        // A macrotask turn first: the mocked IPC handler resolves outside the
        // Angular zone, so whenStable() alone can return before it has run.
        await new Promise(resolve => setTimeout(resolve, 0));
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
    }

    /** Device rows on the devices screen, minus the trailing "Add new device..." row. */
    function deviceRows(): string[] {
        return Array.from(fixture.nativeElement.querySelectorAll('.list-group-item div:first-child'))
            .map(el => (el as HTMLElement).textContent!.trim())
            .filter(text => text.length > 0);
    }

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [AppModule],
            providers: [provideLocationMocks()],
            // The devices screen keeps its row editor behind a @defer block that only
            // opens on click. TestBed would otherwise render every deferred block
            // immediately, instantiating editors for rows nobody selected.
            deferBlockBehavior: DeferBlockBehavior.Manual,
        }).compileComponents();
    });

    /**
     * Installs the mocks and *then* boots the shell. Order matters: AppComponent's
     * constructor calls `deviceManager.load()`, so a mock swapped in after
     * `createComponent` would arrive too late to affect the first load.
     */
    function boot(handlers: Record<string, (args: any) => unknown> = shellHandlers()): void {
        resetBackend();
        mockBackend(handlers);
        router = TestBed.inject(Router);
        fixture = TestBed.createComponent(AppComponent);
        fixture.detectChanges();
    }

    afterEach(() => {
        ReleaseInfo.version = originalReleaseVersion;
        resetBackend();
    });

    it('boots the shell without reaching a real backend', async () => {
        boot();
        await settle();

        expect(fixture.nativeElement.querySelector('router-outlet')).toBeTruthy();
    });

    it('navigates to the devices route and lists what the backend returned', async () => {
        boot();

        await router.navigate(['/home/devices']);
        await settle();

        expect(deviceRows()).toEqual(['living-room', 'bedroom']);
    });

    it('re-renders the devices route when the backend pushes a new list', async () => {
        boot();
        await router.navigate(['/home/devices']);
        await settle();
        // Guard against a false pass: the assertion below is only meaningful if
        // the screen was actually populated first.
        expect(deviceRows().length).toBe(2);

        await emit('device-manager/devicesUpdated', [devices[1]]);
        await settle();

        expect(deviceRows()).toEqual(['bedroom']);
    });

    it.each([
        {releaseVersion: '9.8.7', expectedVersion: '9.8.7'},
        {releaseVersion: '', expectedVersion: packageInfo.version},
    ])('opens About from desktop settings and displays version $expectedVersion offline', async ({releaseVersion, expectedVersion}) => {
        ReleaseInfo.version = releaseVersion;
        TestBed.overrideProvider(UpdateService, {
            useValue: {getRecentRelease: () => Promise.reject(new Error('Network unavailable'))},
        });
        const remoteCommand = vi.fn(() => { throw new Error('TV is offline'); });
        boot({
            'device-manager/list': () => devices,
            'remote-command/exec': remoteCommand,
        });
        await router.navigate(['/home/devices']);
        await settle();

        fixture.nativeElement.querySelector('[aria-label="Settings"]').click();
        await settle();
        const aboutLink = fixture.nativeElement.querySelector('.dropdown-menu.show a[href="/home/nav-more"]') as HTMLAnchorElement;
        expect(aboutLink?.textContent).toBe('About this app');
        aboutLink.click();
        await settle();

        expect(router.url).toBe('/home/nav-more');
        const aboutPage = fixture.nativeElement.querySelector('app-nav-more') as HTMLElement;
        expect(aboutPage.textContent).toContain('About this app');
        expect(aboutPage.querySelector('.text-secondary')?.textContent).toBe(expectedVersion);
        expect(remoteCommand).not.toHaveBeenCalled();
    });

    it('opens Appearance from Settings and keeps the selected theme across navigation', async () => {
        boot();
        await router.navigate(['/home/devices']);
        await settle();

        fixture.nativeElement.querySelector('[aria-label="Settings"]').click();
        await settle();
        const link = fixture.nativeElement.querySelector('.dropdown-menu.show a[href="/home/appearance"]') as HTMLAnchorElement;
        expect(link?.textContent).toBe('Appearance');
        link.click();
        await settle();

        const appearance = TestBed.inject(AppearanceService);
        const original = appearance.theme();
        try {
            expect(router.url).toBe('/home/appearance');
            expect(fixture.nativeElement.querySelectorAll('input[name="app-theme"]').length).toBe(4);
            fixture.nativeElement.querySelector('input[value="nord"]').click();
            await settle();
            expect(document.documentElement.getAttribute('data-app-theme')).toBe('nord');
            expect(document.documentElement.getAttribute('data-bs-theme')).toBe('dark');

            await router.navigate(['/home/devices']);
            await router.navigate(['/home/appearance']);
            await settle();
            expect(fixture.nativeElement.querySelector('input[value="nord"]').checked).toBe(true);
        } finally {
            appearance.setTheme(original);
        }
    });

    it('previews dropped IPKs and queues only valid files for the confirmed TV', async () => {
        boot({
            ...shellHandlers(),
            'fs/stat': ({path}) => ({isFile: !path.endsWith('/folder.ipk')}),
            'remote-command/exec': ({command}) => ({
                stdout: command.startsWith('df ') ? 'Filesystem' :
                    command.includes('command -v enigma2') ? '' : '{"returnValue":true,"apps":[]}',
            }),
        });
        await router.navigate(['/home/devices']);
        await settle();
        mockWindows('main');
        vi.stubGlobal('isTauri', true);
        try {
            await router.navigate(['/home/apps']);
            await settle();
            await vi.waitFor(() => {
                fixture.detectChanges();
                expect(fixture.nativeElement.querySelector('app-apps nav button')).toBeTruthy();
            });
            const queue = TestBed.inject(InstallQueueService);
            const paths = ['/Downloads/first.IPK', '/Downloads/second.ipk', '/Downloads/folder.ipk', '/Downloads/notes.txt'];
            const position = {x: 0, y: 0};

            await emit(TauriEvent.DRAG_ENTER, {paths, position});
            await settle();
            expect(fixture.nativeElement.textContent).toContain('Drop IPK files');

            await emit(TauriEvent.DRAG_DROP, {paths, position});
            await settle();
            const modal = document.querySelector('ngb-modal-window')!;
            expect(modal.textContent).toContain('living-room');
            expect(modal.textContent).toContain('first.IPK');
            expect(modal.textContent).toContain('second.ipk');
            expect(modal.textContent).toContain('Skipped files or folders: 2');
            expect(queue.jobs()).toHaveLength(0);

            modal.querySelector<HTMLButtonElement>('.modal-footer .btn-primary')!.click();
            await settle();
            expect(queue.jobs().map(job => [job.name, job.device.name, job.state])).toEqual([
                ['first.IPK', 'living-room', 'pending'],
                ['second.ipk', 'living-room', 'pending'],
            ]);
            await router.navigate(['/home/devices']);
            await settle();
        } finally {
            fixture.destroy();
            vi.unstubAllGlobals();
        }
    });

    it('lists receiver plugins and system info over SSH without querying webOS', async () => {
        const execute = vi.fn(({command}) => {
            if (command.includes('command -v enigma2')) {
                const metadata = command.includes('/api/about')
                    ? JSON.stringify({info: {brand: 'Vu+', model: 'Uno4K SE',
                        friendlyimagedistro: 'OpenPLi', imagever: 'scarthgap.8a4b48d9'}})
                    : '';
                return {stdout: 'enigma2\ndm8000\n5.15.0\n"Receiver Image"\n' + metadata};
            }
            if (command.includes('opkg list-installed')) {
                return {stdout: [
                    'enigma2-plugin-extensions-openwebif - 2.4.1',
                    'busybox - 1.36.1',
                    '---available---',
                    'enigma2-plugin-extensions-openwebif - 2.5.0 - Web interface',
                    'enigma2-plugin-extensions-example - 1.0 - Example plugin',
                    '---upgradable---',
                    'enigma2-plugin-extensions-openwebif - 2.4.1 - 2.5.0',
                    '',
                ].join('\n')};
            }
            if (command.startsWith('df ')) return {stdout: 'Filesystem'};
            throw new Error('Unexpected receiver command');
        });
        boot({
            ...shellHandlers(),
            'device-manager/list': () => [{...devices[0], name: 'vu'}],
            'remote-command/exec': execute,
        });

        await router.navigate(['/home/apps']);
        await settle();
        await vi.waitFor(() => {
            fixture.detectChanges();
            const plugins = fixture.nativeElement.querySelector('section[aria-labelledby="receiver-plugins-heading"]');
            expect(plugins?.textContent).toContain('enigma2-plugin-extensions-openwebif');
            expect(plugins?.textContent).toContain('2.4.1');
            expect(plugins?.textContent).not.toContain('busybox');
            expect(plugins?.textContent).toContain('2.5.0');
            expect(plugins?.textContent).toContain('Updates (1)');
        });

        await router.navigate(['/home/info']);
        await settle();
        await vi.waitFor(() => {
            fixture.detectChanges();
            const info = fixture.nativeElement.querySelector('app-info');
            expect(info?.textContent).toContain('Vu+ Uno 4K SE');
            expect(info?.textContent).toContain('OpenPLi · scarthgap.8a4b48d9');
            expect(info?.textContent).toContain('5.15.0');
        });
        expect(execute.mock.calls.some(([{command}]) => command.includes('luna-send'))).toBe(false);
    });

    it('opens package sources from Settings and restores a portable source backup', async () => {
        boot();
        await router.navigate(['/home/devices']);
        await settle();
        fixture.nativeElement.querySelector('[aria-label="Settings"]').click();
        await settle();
        fixture.nativeElement.querySelector('.dropdown-menu.show a[href="/home/repositories"]').click();
        await settle();
        expect(router.url).toBe('/home/repositories');
        const sources = TestBed.inject(RepositorySourcesService);
        const name = fixture.nativeElement.querySelector('#source-name') as HTMLInputElement;
        const url = fixture.nativeElement.querySelector('#source-url') as HTMLInputElement;
        name.value = 'Example apps';
        url.value = 'https://example.test/repo.json';
        name.dispatchEvent(new Event('input', {bubbles: true}));
        url.dispatchEvent(new Event('input', {bubbles: true}));
        fixture.nativeElement.querySelector('app-repository-sources form').dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
        await settle();
        try {
            expect(fixture.nativeElement.querySelector('app-repository-sources').textContent).toContain('Example apps');
            const text = sources.exportBackup();
            sources.remove(url.value);
            expect(sources.restoreBackup(text)).toBe(1);
            expect(sources.restoreBackup(text)).toBe(0);
            expect(sources.sources().filter(source => source.url === url.value).length).toBe(1);
        } finally {
            sources.remove(url.value);
        }
    });

    // Not covered here: a failing `device-manager/list` at startup. `DeviceManagerService.load()`
    // calls `this.list().then(...)` with no `.catch`, so a rejection escapes as an unhandled
    // promise rejection and takes the whole karma run down rather than failing one spec.
    // Error mapping is covered at the service level in device-manager.service.spec.ts.
});
