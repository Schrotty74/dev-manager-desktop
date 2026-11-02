import {Component, ElementRef, HostListener, Injector, OnDestroy, OnInit, ViewChild, ChangeDetectionStrategy} from '@angular/core';
import {NgbModal} from '@ng-bootstrap/ng-bootstrap';
import {Device} from '../types';
import {DeviceManagerService} from '../core/services';
import packageInfo from '../../../package.json';
import {WizardComponent} from "../add-device/wizard/wizard.component";
import {map, noop, Subscription, timer} from "rxjs";
import {filter} from "rxjs/operators";
import {isNonNull} from "../shared/operators";
import ReleaseInfo from '../../release.json';
import {DeviceChooserComponent} from "./device-chooser/device-chooser.component";
import {DevicesComponent} from "../devices/devices.component";
import {GlassFullscreenService} from '../core/services/glass-fullscreen.service';
import {DevModeService, DevModeStatusUpdate, devModeDeviceKey} from '../core/services/dev-mode.service';

@Component({
    selector: 'app-home',
    templateUrl: './home.component.html',
    styleUrls: ['./home.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class HomeComponent implements OnInit, OnDestroy {

    selectedDevice?: Device;
    appVersion: string;
    @ViewChild('appNav', {static: true})
    appNav?: ElementRef<HTMLElement>;
    appNavTooltipDirection: string = 'right';
    devModeExpiresSoon = false;
    renewingDevMode = false;
    devModeRenewError = '';
    private devicesSubscription?: Subscription;
    private statusSubscription?: Subscription;
    private expirySubscription?: Subscription;
    private activeDeviceKey?: string;

    constructor(
        public deviceManager: DeviceManagerService,
        private modalService: NgbModal,
        public glassFullscreen: GlassFullscreenService,
        private devMode: DevModeService
    ) {
        this.statusSubscription = this.devMode.statusUpdates$.subscribe(update => this.applyStatusUpdate(update));
        this.devicesSubscription = deviceManager.devices$.pipe(filter(isNonNull)).subscribe((devices) => {
            this.selectedDevice = devices.find((device) => device.default) || devices[0];
            this.onSelectedDeviceChanged(this.selectedDevice);
            if (!this.selectedDevice) {
                this.openSetupDevice(false);
            }
        });
        this.appVersion = ReleaseInfo.version || packageInfo.version;
    }

    markDefault(device: Device): void {
        this.deviceManager.setDefault(device.name).catch(reason => {
            console.log(reason);
        });
    }

    openSetupDevice(cancellable: boolean): void {
        const ref = this.modalService.open(WizardComponent, {
            size: 'xl', centered: true, scrollable: true,
            injector: Injector.create({
                providers: [
                    {provide: 'cancellable', useValue: cancellable}
                ]
            }),
            beforeDismiss: () => cancellable,
        });
        ref.result.then((device) => this.deviceManager.setDefault(device.name)).catch(noop);
    }

    defaultDragOver(event: DragEvent): void {
        event.preventDefault();
    }

    defaultDragEnter(event: DragEvent): void {
        const transfer = event.dataTransfer!;
        if (transfer.items.length != 1 || transfer.items[0].kind != 'file') {
            return;
        }
        event.preventDefault();
        console.log('defaultDragEnter', event.type, transfer.items.length && transfer.items[0]);
    }

    defaultDragLeave(event: DragEvent): void {
        const dataTransfer = event.dataTransfer!;
        console.log('defaultDragLeave', dataTransfer.items.length && dataTransfer.items[0]);
    }

    defaultDrop(event: DragEvent): boolean {
        console.log('defaultDrop', event);
        event.stopPropagation();
        event.preventDefault();
        return false;
    }

    openDeviceChooser(): void {
        this.modalService.open(DeviceChooserComponent, {
            size: 'sm',
            centered: true,
        }).result.then((device) => this.markDefault(device)).catch(noop);
    }

    ngOnInit(): void {
        this.updateTooltipDirection();
    }

    ngOnDestroy(): void {
        this.devicesSubscription?.unsubscribe();
        this.statusSubscription?.unsubscribe();
        this.expirySubscription?.unsubscribe();
    }

    async renewDevMode(): Promise<void> {
        const device = this.selectedDevice;
        if (!device || device.username !== 'prisoner' || this.renewingDevMode) return;
        this.renewingDevMode = true;
        this.devModeRenewError = '';
        try {
            await this.deviceManager.extendDevMode(device);
            await this.devMode.status(device);
        } catch (error) {
            this.devModeRenewError = 'Could not renew Developer Mode. Check the TV connection and try again.';
        } finally {
            this.renewingDevMode = false;
        }
    }

    @HostListener('window:resize')
    onResize(): void {
        this.updateTooltipDirection();
    }

    private updateTooltipDirection(): void {
        const flexDirection = this.appNav?.nativeElement?.computedStyleMap()?.get('flex-direction');
        if (!(flexDirection instanceof CSSKeywordValue)) {
            return;
        }
        this.appNavTooltipDirection = flexDirection.value === 'row' ? 'top' : 'right';
    }

    private onSelectedDeviceChanged(device?: Device): void {
        const key = device ? devModeDeviceKey(device) : undefined;
        if (key === this.activeDeviceKey) return;
        this.activeDeviceKey = key;
        this.devModeRenewError = '';
        this.expirySubscription?.unsubscribe();
        this.devModeExpiresSoon = false;
        if (!device || device.username !== 'prisoner') return;
        this.devMode.status(device).catch(() => undefined);
    }

    private applyStatusUpdate(update: DevModeStatusUpdate): void {
        if (!this.selectedDevice || devModeDeviceKey(this.selectedDevice) !== update.deviceKey
            || update.requestId !== this.devMode.latestStatusRequestId(this.selectedDevice)) return;
        this.expirySubscription?.unsubscribe();
        this.devModeExpiresSoon = false;
        if (!update.status.token) return;
        const match = /^(\d+):(\d{2}):(\d{2})$/.exec(update.status.remaining ?? '');
        if (!match) return;
        const initialSeconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
        const startedAt = Date.now();
        this.expirySubscription = timer(0, 1000).pipe(
            map(() => initialSeconds - Math.floor((Date.now() - startedAt) / 1000) <= 24 * 3600)
        ).subscribe(soon => this.devModeExpiresSoon = soon);
    }

    openDevices() {
        this.modalService.open(DevicesComponent, {
            scrollable: true
        });
    }
}
