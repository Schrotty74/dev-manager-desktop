import {Component, Injector, NgZone, OnDestroy, OnInit, TemplateRef, ViewChild, ChangeDetectionStrategy} from '@angular/core';
import {NgbActiveModal, NgbModal} from '@ng-bootstrap/ng-bootstrap';
import {noop, Observable, Subscription} from 'rxjs';
import {Device, PackageInfo, RawPackageInfo} from '../types';
import {AppManagerService, DeviceManagerService, InstallProgressHandler, RepositoryItem} from '../core/services';
import {MessageDialogComponent} from '../shared/components/message-dialog/message-dialog.component';
import {ProgressDialogComponent} from '../shared/components/progress-dialog/progress-dialog.component';
import {keyBy} from 'lodash';
import {open as showOpenDialog} from '@tauri-apps/plugin-dialog';
import {isTauri} from '@tauri-apps/api/core';
import {UnlistenFn} from '@tauri-apps/api/event';
import {basename} from '@tauri-apps/api/path';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {stat} from '@tauri-apps/plugin-fs';
import {defaultDownloadDir} from "../shared/paths";
import {APP_ID_HBCHANNEL} from "../shared/constants";
import {HbchannelRemoveComponent} from "./hbchannel-remove/hbchannel-remove.component";
import {StatStorageInfoComponent} from "../shared/components/stat-storage-info/stat-storage-info.component";
import {DetailsComponent} from "./details/details.component";
import {InstallJob, InstallQueueService} from '../core/services/install-queue.service';
import {InstallPhase, installPhaseLabels} from '../core/services/install-history.service';

const isIpk = (path: string) => /\.ipk$/i.test(path);

interface LocalSelection {
    device: Device;
    files: {path: string; name: string}[];
    skipped: number;
}

@Component({
    selector: 'app-apps',
    templateUrl: './apps.component.html',
    styleUrls: ['./apps.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class AppsComponent implements OnInit, OnDestroy {

    packages$?: Observable<PackageInfo[] | null>;
    instPackages?: Record<string, RawPackageInfo>;
    device: Device | null = null;
    devices$?: Observable<Device[]|null>;
    tabId: string = 'installed';
    draggingIpk = false;
    localSelection?: LocalSelection;

    @ViewChild('confirmLocalInstall') confirmLocalInstall!: TemplateRef<{$implicit: NgbActiveModal}>;

    @ViewChild('storageInfo') storageInfo?: StatStorageInfoComponent;

    private deviceSubscription?: Subscription;
    private packagesSubscription?: Subscription;
    private unlistenDrop?: UnlistenFn;
    private destroyed = false;
    private choosingLocalFiles = false;

    constructor(
        public deviceManager: DeviceManagerService,
        private modalService: NgbModal,
        private appManager: AppManagerService,
        public queue: InstallQueueService,
        private zone: NgZone,
    ) {
    }

    ngOnInit(): void {
        this.devices$ = this.deviceManager.devices$;
        this.deviceSubscription = this.deviceManager.selected$.subscribe((device) => {
            this.device = device;
            this.instPackages = undefined;
            if (device) {
                this.loadPackages();
            } else {
                this.packages$ = undefined;
                this.packagesSubscription?.unsubscribe();
                this.packagesSubscription = undefined;
            }
        });
        if (isTauri()) {
            void getCurrentWindow().onDragDropEvent(({payload}) => this.zone.run(() => {
                if (this.destroyed) return;
                if (payload.type === 'enter') {
                    this.draggingIpk = !!this.device && !this.modalService.hasOpenModals() && payload.paths.some(isIpk);
                } else if (payload.type === 'leave' || payload.type === 'drop') {
                    this.draggingIpk = false;
                }
                if (payload.type === 'drop' && this.device && !this.modalService.hasOpenModals()) {
                    const device = {...this.device};
                    void this.chooseLocalFiles(device, async () => payload.paths);
                }
            })).then(unlisten => {
                if (this.destroyed) unlisten();
                else this.unlistenDrop = unlisten;
            }).catch(error => console.warn('Could not listen for dropped IPKs', error));
        }
    }

    ngOnDestroy(): void {
        this.destroyed = true;
        this.unlistenDrop?.();
        this.deviceSubscription?.unsubscribe();
        this.packagesSubscription?.unsubscribe();
        this.packagesSubscription = undefined;
    }

    loadPackages(): void {
        const device = this.device;
        if (!device) return;
        this.packagesSubscription?.unsubscribe();
        this.packages$ = this.appManager.packages$(device);
        this.packagesSubscription = this.packages$.subscribe({
            next: (pkgs) => {
                this.instPackages = pkgs ? keyBy(pkgs, (pkg) => pkg.id) : undefined;
            }, error: noop
        });
        this.appManager.load(device).catch(noop);
    }

    openInstallChooser(): void {
        if (!this.device) return;
        const device = {...this.device};
        void this.chooseLocalFiles(device, async () => await showOpenDialog({
            filters: [{name: 'IPK package', extensions: ['ipk']}],
            multiple: true,
            defaultPath: await defaultDownloadDir(),
        }) ?? []);
    }

    private async chooseLocalFiles(device: Device, select: () => Promise<string[]>): Promise<void> {
        if (this.choosingLocalFiles) return;
        this.choosingLocalFiles = true;
        try {
            const paths = [...new Set(await select())];
            if (!paths.length || this.destroyed) return;
            const candidates = await Promise.all(paths.filter(isIpk).map(async path =>
                await this.isAvailableFile(path) ? {path, name: await basename(path)} : null));
            if (this.destroyed) return;
            const files = candidates.filter(file => file !== null);
            if (!files.length) {
                MessageDialogComponent.open(this.modalService, {
                    title: 'No IPK files found',
                    message: 'Choose or drop an accessible .ipk file.',
                    positive: 'Close',
                });
                return;
            }
            this.localSelection = {device, files, skipped: paths.length - files.length};
            const confirm = this.modalService.open(this.confirmLocalInstall, {
                centered: true, scrollable: true, ariaLabelledBy: 'local-install-title',
            });
            if (await confirm.result.catch(() => false) && !this.destroyed) {
                for (const file of files) this.queue.addLocal(file.path, file.name, device);
            }
        } catch (error) {
            if (!this.destroyed) this.handleInstallationError('local packages', error);
        } finally {
            this.localSelection = undefined;
            this.choosingLocalFiles = false;
        }
    }

    private async isAvailableFile(path: string): Promise<boolean> {
        return stat(path).then(info => info.isFile, () => false);
    }

    async retryJob(job: InstallJob): Promise<void> {
        if (job.package.kind === 'local' && !await this.isAvailableFile(job.package.path)) {
            MessageDialogComponent.open(this.modalService, {
                title: 'IPK file unavailable',
                message: 'Choose the IPK file again if it has moved or is no longer accessible.',
                positive: 'Close',
            });
            return;
        }
        this.queue.retry(job.id);
    }

    launchApp(id: string): void {
        if (!this.device) return;
        this.appManager.launch(this.device, id).then(noop);
    }

    async removePackage(pkg: RawPackageInfo): Promise<boolean> {
        if (!this.device) return false;
        const confirm = MessageDialogComponent.open(this.modalService, {
            title: 'Uninstall App',
            message: `Uninstall app \"${pkg.title}\"?`,
            positive: 'Uninstall',
            positiveStyle: 'danger',
            negative: 'Cancel',
            autofocus: 'negative',
        });
        if (!await confirm.result.catch(() => false)) return false;
        if (pkg.id === APP_ID_HBCHANNEL) {
            const doubleConfirm = MessageDialogComponent.open(this.modalService, {
                message: HbchannelRemoveComponent,
                positive: 'Yes, uninstall Homebrew Channel',
                positiveStyle: 'danger',
                negative: 'Cancel',
                autofocus: 'negative',
            });
            if (!await doubleConfirm.result.catch(() => false)) return false;
        }
        const progress = ProgressDialogComponent.open(this.modalService);
        try {
            await this.appManager.remove(this.device, pkg.id);
            this.storageInfo?.refresh();
            return true;
        } catch (e) {
            MessageDialogComponent.open(this.modalService, {
                message: `Failed to uninstall ${pkg.title}`,
                error: e as Error,
                positive: 'Close'
            });
            return false;
        } finally {
            progress.close(true);
        }
    }

    async installPackage(item: RepositoryItem, channel: 'stable' | 'beta' = 'stable', device: Device | null = this.device,
                         queued = false): Promise<boolean> {
        if (!device || (!queued && this.queue.running())) return false;
        const progress = ProgressDialogComponent.open(this.modalService);
        let phase: InstallPhase = 'prepare';
        try {
            const installLocation = await this.appManager.findInstallLocation(device, item.id).catch(() => null);
            if (installLocation && installLocation !== 'developer') {
                MessageDialogComponent.open(this.modalService, {
                    title: `Cannot install ${item.title}`,
                    message: `Another app with the same ID is already installed. If it was install by LG Content Store, you need to uninstall it first.`,
                    positive: 'Close',
                });
                return false;
            }
            const incompatible = await this.appManager.checkIncompatibility(device, item);
            if (incompatible) {
                const incompatibleConfirm = MessageDialogComponent.open(this.modalService, {
                    title: 'Incompatible App',
                    message: `App ${item.title} is marked not compatible with ${device.name}. It may not work properly or not at all.`,
                    positive: 'Install Anyway',
                    positiveStyle: 'danger',
                    negative: 'Cancel',
                    autofocus: 'negative',
                });
                if (!await incompatibleConfirm.result.catch(() => false)) {
                    return false;
                }
            }
            const manifest = channel === 'stable' ? item.manifest : item.manifestBeta;
            if (!manifest) {
                MessageDialogComponent.open(this.modalService, {
                    title: `Failed to install ${item.title}`,
                    message: `No manifest found for ${item.title} in channel ${channel}`,
                    positive: 'Close',
                });
                return false;
            }
            const component = progress.componentInstance as ProgressDialogComponent;
            await this.appManager.installByManifest(device, manifest, (percent, status, next) => {
                if (next) phase = next;
                component.update(status, percent);
            });
            this.storageInfo?.refresh();
            return true;
        } catch (error) {
            if (queued) throw this.describeFailure(phase, error);
            this.handleInstallationError(item.title, error, phase,
                () => this.queue.add(item, 'Catalog', device, channel));
            return false;
        } finally {
            progress.close(true);
        }
    }

    runQueue(): void {
        void this.queue.run(async ({package: pkg, device}) => {
            if (pkg.kind === 'catalog') return this.installPackage(pkg.item, pkg.channel, device, true);
            if (!await this.isAvailableFile(pkg.path)) {
                throw new Error('IPK file unavailable. Choose the file again if it has moved.');
            }
            const progress = ProgressDialogComponent.open(this.modalService);
            const component = progress.componentInstance as ProgressDialogComponent;
            let phase: InstallPhase = 'prepare';
            const update: InstallProgressHandler = (percent, status, next) => {
                if (next) phase = next;
                component.update(status, percent);
            };
            try {
                await this.appManager.installByPath(device, pkg.path, update);
                this.storageInfo?.refresh();
                return true;
            } catch (error) {
                throw this.describeFailure(phase, error);
            } finally {
                progress.close(true);
            }
        });
    }

    openDetails(item: RepositoryItem): void {
        const modalRef = this.modalService.open(DetailsComponent, {
            size: 'lg',
            scrollable: true,
            injector: Injector.create({
                providers: [
                    {provide: RepositoryItem, useValue: item},
                    {provide: 'device', useValue: this.device},
                ],
            }),
        });
        const component = modalRef.componentInstance as DetailsComponent;
        component.parent = this;
    }

    private describeFailure(phase: InstallPhase, error: unknown): Error {
        const detail = error instanceof Error ? error.message : String(error);
        return new Error(`${installPhaseLabels[phase]}: ${detail}`);
    }

    private handleInstallationError(name: string, error: unknown, phase?: InstallPhase, retry?: () => void): void {
        const dialog = MessageDialogComponent.open(this.modalService, {
            title: `Failed to install ${name}`,
            message: phase ? this.describeFailure(phase, error).message : String(error),
            error: error instanceof Error ? error : undefined,
            positive: retry ? 'Add retry to queue' : 'Close',
            negative: retry ? 'Close' : undefined,
            autofocus: retry ? 'negative' : 'positive',
        });
        if (retry) void dialog.result.then(confirmed => { if (confirmed) retry(); }, noop);
    }
}
