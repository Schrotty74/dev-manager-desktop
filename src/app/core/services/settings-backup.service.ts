import {Injectable, inject} from '@angular/core';
import {AppearanceService, THEME_OPTIONS} from './appearance.service';
import {RepositorySourcesService} from './repository-sources.service';

const FORMAT = 'webos-dev-manager.settings';
const VERSION = 1;
const MAX_BACKUP_BYTES = 1_048_576;

@Injectable({providedIn: 'root'})
export class SettingsBackupService {
    private readonly appearance = inject(AppearanceService);
    private readonly sources = inject(RepositorySourcesService);

    exportBackup(): string {
        return JSON.stringify({
            format: FORMAT,
            version: VERSION,
            theme: this.appearance.theme(),
            sources: JSON.parse(this.sources.exportBackup()),
        }, null, 2) + '\n';
    }

    restoreBackup(text: string): number {
        if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) {
            throw new Error('The settings backup is too large (maximum 1 MiB).');
        }

        let data: unknown;
        try {
            data = JSON.parse(text);
        } catch {
            throw new Error('This file is not a valid settings backup.');
        }

        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            throw new Error('This is not a supported settings backup.');
        }
        const backup = data as {format?: unknown; version?: unknown; theme?: unknown; sources?: unknown};
        if (backup.format !== FORMAT || backup.version !== VERSION || typeof backup.sources !== 'object' ||
            backup.sources === null || Array.isArray(backup.sources)) {
            throw new Error('This is not a supported settings backup.');
        }
        if (typeof backup.theme !== 'string' || !THEME_OPTIONS.some(option => option.id === backup.theme)) {
            throw new Error('The settings backup contains an unsupported appearance theme.');
        }

        // The theme and full file envelope are checked before the source service can mutate state.
        const added = this.sources.restoreBackup(JSON.stringify(backup.sources));
        this.appearance.setTheme(backup.theme);
        return added;
    }
}
