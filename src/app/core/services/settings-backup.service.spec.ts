import {TestBed} from '@angular/core/testing';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {AppearanceService} from './appearance.service';
import {RepositorySourcesService} from './repository-sources.service';
import {SettingsBackupService} from './settings-backup.service';

describe('SettingsBackupService', () => {
    const restoreSources = vi.fn(() => 2);
    const setTheme = vi.fn();
    const sourceBackup = {format: 'webos-dev-manager.repository-sources', version: 1, sources: [], selectedUrl: 'https://repo.webosbrew.org/api/apps.json'};
    let service: SettingsBackupService;

    beforeEach(() => {
        restoreSources.mockClear();
        setTheme.mockClear();
        TestBed.configureTestingModule({providers: [
            SettingsBackupService,
            {provide: AppearanceService, useValue: {theme: () => 'nord', setTheme}},
            {provide: RepositorySourcesService, useValue: {exportBackup: () => JSON.stringify(sourceBackup), restoreBackup: restoreSources}},
        ]});
        service = TestBed.inject(SettingsBackupService);
    });

    afterEach(() => TestBed.resetTestingModule());

    it('exports the current theme and existing versioned source backup together', () => {
        const exported = JSON.parse(service.exportBackup());
        expect(exported).toEqual({format: 'webos-dev-manager.settings', version: 1, theme: 'nord', sources: sourceBackup});
        expect(service.exportBackup()).not.toMatch(/password|credential|device|tvConfig/i);
    });

    it('restores sources and applies the theme after complete validation', () => {
        const text = JSON.stringify({format: 'webos-dev-manager.settings', version: 1, theme: 'macos-clear', sources: sourceBackup});
        expect(service.restoreBackup(text)).toBe(2);
        expect(restoreSources).toHaveBeenCalledWith(JSON.stringify(sourceBackup));
        expect(setTheme).toHaveBeenCalledWith('macos-clear');
    });

    it('rejects an invalid theme before source restoration or theme mutation', () => {
        const text = JSON.stringify({format: 'webos-dev-manager.settings', version: 1, theme: 'unknown', sources: sourceBackup});
        expect(() => service.restoreBackup(text)).toThrow('unsupported appearance theme');
        expect(restoreSources).not.toHaveBeenCalled();
        expect(setTheme).not.toHaveBeenCalled();
    });

    it('enforces the backup limit using UTF-8 byte length', () => {
        expect(() => service.restoreBackup('é'.repeat(524_289))).toThrow('too large');
        expect(restoreSources).not.toHaveBeenCalled();
    });
});
