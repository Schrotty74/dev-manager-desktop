import {Component, DestroyRef, OnInit, computed, inject, input, signal} from '@angular/core';
import {CommonModule} from '@angular/common';
import {NgbModal} from '@ng-bootstrap/ng-bootstrap';
import {open} from '@tauri-apps/plugin-dialog';
import {basename} from '@tauri-apps/api/path';
import {SharedModule} from '../../shared/shared.module';
import {ReceiverCatalog, ReceiverPackage, ReceiverPackagesService} from '../../core/services/receiver-packages.service';
import {MessageDialogComponent} from '../../shared/components/message-dialog/message-dialog.component';
import {defaultDownloadDir} from '../../shared/paths';
import {Device} from '../../types';

type ReceiverView = 'installed' | 'available' | 'updates';

@Component({
    selector: 'app-receiver-apps',
    templateUrl: './receiver-apps.component.html',
    imports: [CommonModule, SharedModule],
})
export class ReceiverAppsComponent implements OnInit {
    readonly device = input.required<Device>();
    readonly catalog = signal<ReceiverCatalog | undefined>(undefined);
    readonly view = signal<ReceiverView>('installed');
    readonly query = signal('');
    readonly busy = signal('');
    readonly error = signal<Error | undefined>(undefined);
    readonly notice = signal('');

    readonly pendingUpdates = computed(() => this.catalog()?.installed.filter(pkg => pkg.update) ?? []);
    readonly visible = computed(() => {
        const catalog = this.catalog();
        if (!catalog) return [];
        const view = this.view();
        const filter = this.query().trim().toLowerCase();
        const packages = view === 'available' ? catalog.available : catalog.installed;
        return packages.filter(pkg => (view !== 'updates' || pkg.update) && pkg.name.includes(filter));
    });

    private readonly packages = inject(ReceiverPackagesService);
    private readonly modals = inject(NgbModal);
    private readonly destroyRef = inject(DestroyRef);

    ngOnInit(): void {
        void this.refresh();
    }

    refresh(): Promise<void> {
        return this.run('Reading receiver packages…', async device => {
            this.catalog.set(await this.packages.list(device));
        });
    }

    checkUpdates(): Promise<void> {
        return this.run('Refreshing receiver feeds…', async device => {
            await this.packages.refreshFeeds(device);
            const catalog = await this.packages.list(device);
            this.catalog.set(catalog);
            this.notice.set(catalog.installed.some(pkg => pkg.update) ? 'Package lists refreshed.' : 'No plugin updates available.');
        });
    }

    changePlugin(pkg: ReceiverPackage, operation: 'install' | 'upgrade'): Promise<void> {
        const label = operation === 'install' ? 'Install' : 'Update';
        return this.run(label === 'Install' ? 'Installing plugin…' : 'Updating plugin…', async device => {
            const description = operation === 'upgrade' ? pkg.name + ' (' + pkg.version + ' → ' + pkg.update + ')' : pkg.name;
            if (!await this.confirm(label, description, device)) return;
            await this.packages.changePlugin(device, operation, pkg.name);
            this.notice.set(operation === 'install' ? 'Plugin installed.' : 'Plugin updated.');
            this.catalog.set(await this.packages.list(device));
        });
    }

    updateAll(): Promise<void> {
        const names = this.pendingUpdates().map(pkg => pkg.name);
        if (!names.length) return Promise.resolve();

        return this.run('Updating plugins…', async device => {
            const selection = names.length === 1 ? '1 plugin' : 'all ' + names.length + ' plugins';
            if (!await this.confirm('Update', selection, device)) return;
            try {
                await this.packages.upgradePlugins(device, names);
            } catch (error) {
                this.catalog.set(await this.packages.list(device).catch(() => undefined));
                throw error;
            }
            this.notice.set('Plugin updates installed.');
            this.catalog.set(await this.packages.list(device));
        });
    }

    installLocal(): Promise<void> {
        return this.run('Installing IPK…', async device => {
            const path = await open({
                filters: [{name: 'IPK package', extensions: ['ipk']}],
                multiple: false,
                defaultPath: await defaultDownloadDir(),
            });
            if (!path || this.destroyRef.destroyed || !await this.confirm('Install IPK', await basename(path), device)) return;
            await this.packages.installIpk(device, path);
            this.notice.set('IPK installed.');
            this.catalog.set(await this.packages.list(device));
        });
    }

    private async confirm(label: string, name: string, device: Device): Promise<boolean> {
        const dialog = MessageDialogComponent.open(this.modals, {
            title: label,
            message: label + ' ' + name + ' on ' + device.name + '?',
            positive: label,
            negative: 'Cancel',
            autofocus: 'negative',
        });
        return await dialog.result.catch(() => false) === true && !this.destroyRef.destroyed;
    }

    private async run(label: string, operation: (device: Device) => Promise<void>): Promise<void> {
        if (this.busy()) return;
        this.busy.set(label);
        this.error.set(undefined);
        this.notice.set('');
        try {
            await operation(this.device());
        } catch (error) {
            this.error.set(error instanceof Error ? error : new Error(String(error)));
        } finally {
            this.busy.set('');
        }
    }
}
