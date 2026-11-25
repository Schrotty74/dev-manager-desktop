import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy} from '@angular/core';
import {EMPTY, Observable, catchError, finalize, from} from 'rxjs';
import {save} from '@tauri-apps/plugin-dialog';
import {writeFile} from '@tauri-apps/plugin-fs';
import {Device} from '../../types';
import {ReceiverLogFile, ReceiverLogKind, RemoteLogService} from '../../core/services/remote-log.service';

@Component({
    selector: 'app-receiver-logs',
    templateUrl: './receiver-logs.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false,
})
export class ReceiverLogsComponent implements OnChanges, OnDestroy {
    @Input() device: Device | null = null;
    @Input() kind: ReceiverLogKind = 'crash';

    files?: ReceiverLogFile[];
    selected: ReceiverLogFile | null = null;
    source?: Observable<string>;
    error?: Error;
    loading = false;
    following = false;
    saving = false;

    private revision = 0;

    constructor(private logs: RemoteLogService, private changeDetector: ChangeDetectorRef) {}

    ngOnChanges(): void {
        this.selected = null;
        this.files = undefined;
        void this.refresh();
    }

    ngOnDestroy(): void {
        this.revision++;
    }

    async refresh(): Promise<void> {
        const device = this.device;
        const revision = this.beginLoad();
        if (!device) return;
        try {
            if (this.kind === 'oscam') {
                this.source = this.logs.watchOscamLog(device).pipe(catchError(error => {
                    if (revision === this.revision) this.setError(error);
                    return EMPTY;
                }));
                return;
            }
            if (this.kind !== 'kernel') {
                const files = await this.logs.listReceiverLogs(device, this.kind);
                if (revision !== this.revision) return;
                this.files = files;
                this.selected = files.find(file => file.path === this.selected?.path) ?? files[0] ?? null;
            }
            if (this.kind === 'kernel' || this.selected) await this.read(device, revision);
        } catch (error) {
            if (revision === this.revision) this.setError(error);
        } finally {
            if (revision === this.revision) this.finishLoad();
        }
    }

    async selectLog(path: string): Promise<void> {
        const device = this.device;
        const selected = this.files?.find(file => file.path === path);
        if (!device || !selected) return;

        this.selected = selected;
        const revision = this.beginLoad();
        try {
            await this.read(device, revision);
        } catch (error) {
            if (revision === this.revision) this.setError(error);
        } finally {
            if (revision === this.revision) this.finishLoad();
        }
    }

    toggleFollow(): void {
        const device = this.device;
        const file = this.selected;
        if (!device || !file) return;
        if (this.following) {
            void this.selectLog(file.path);
            return;
        }

        const revision = ++this.revision;
        this.error = undefined;
        this.following = true;
        this.source = this.logs.followReceiverLog(device, file).pipe(
            catchError(error => {
                if (revision === this.revision) this.setError(error);
                return EMPTY;
            }),
            finalize(() => {
                if (revision !== this.revision) return;
                this.following = false;
                this.changeDetector.markForCheck();
            }),
        );
    }

    async saveLog(): Promise<void> {
        const device = this.device;
        const file = this.selected;
        const revision = this.revision;
        if (!device || (this.kind !== 'kernel' && !file) || this.saving) return;
        this.saving = true;
        this.error = undefined;
        try {
            const path = await save({defaultPath: file?.name ?? 'receiver-kernel.log'});
            if (path) await writeFile(path, await this.logs.exportReceiverLog(device, file));
        } catch (error) {
            if (revision === this.revision) this.setError(error);
        } finally {
            this.saving = false;
            this.changeDetector.markForCheck();
        }
    }

    private beginLoad(): number {
        this.following = false;
        this.source = undefined;
        this.error = undefined;
        this.loading = this.device !== null;
        return ++this.revision;
    }

    private async read(device: Device, revision: number): Promise<void> {
        const text = await this.logs.readReceiverLog(device, this.selected);
        if (revision === this.revision) {
            this.source = from(text ? text.replace(/\r?\n$/, '').split(/\r?\n/) : ['The log is empty.']);
        }
    }

    private finishLoad(): void {
        this.loading = false;
        this.changeDetector.markForCheck();
    }

    private setError(error: unknown): void {
        this.error = error instanceof Error ? error : new Error(String(error));
        this.changeDetector.markForCheck();
    }
}
