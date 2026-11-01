import {ChangeDetectionStrategy, Component, inject, signal} from '@angular/core';
import {isTauri} from '@tauri-apps/api/core';
import {save} from '@tauri-apps/plugin-dialog';
import {writeTextFile} from '@tauri-apps/plugin-fs';
import {RepositorySourcesService} from '../core/services/repository-sources.service';

@Component({
    selector: 'app-repository-sources', standalone: true,
    templateUrl: './repository-sources.component.html',
    styleUrl: './repository-sources.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepositorySourcesComponent {
    readonly sources = inject(RepositorySourcesService);
    readonly name = signal('');
    readonly url = signal('');
    readonly busy = signal(false);
    readonly error = signal('');
    readonly status = signal('');

    addSource(event: Event): void {
        event.preventDefault();
        this.error.set('');
        this.status.set('');
        try {
            this.sources.add(this.name(), this.url());
            this.name.set('');
            this.url.set('');
            this.status.set('Source added. Select it under Apps > Available to load its catalog.');
        } catch (error) { this.error.set((error as Error).message); }
    }

    async backup(): Promise<void> {
        this.busy.set(true);
        this.error.set('');
        this.status.set('');
        try {
            const text = this.sources.exportBackup();
            if (isTauri()) {
                const target = await save({title: 'Back up package sources', defaultPath: 'webos-dev-manager-sources.json',
                    filters: [{name: 'JSON backup', extensions: ['json']}]});
                if (!target) return;
                await writeTextFile(target, text);
            } else {
                const url = URL.createObjectURL(new Blob([text], {type: 'application/json'}));
                const link = document.createElement('a');
                link.href = url;
                link.download = 'webos-dev-manager-sources.json';
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 0);
            }
            this.status.set('Sources backup saved.');
        } catch { this.error.set('The sources backup could not be saved.'); }
        finally { this.busy.set(false); }
    }

    async restore(event: Event): Promise<void> {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;
        this.busy.set(true);
        this.error.set('');
        this.status.set('');
        try {
            if (file.size > 1_048_576) throw new Error('The sources backup is too large.');
            const added = this.sources.restoreBackup(await file.text());
            this.status.set(`Backup restored: ${added} sources added. Existing sources were kept and duplicates skipped.`);
        } catch (error) { this.error.set((error as Error).message); }
        finally { input.value = ''; this.busy.set(false); }
    }
}
