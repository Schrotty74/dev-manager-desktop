import {beforeEach, describe, expect, it, vi} from 'vitest';
import {InstallHistoryService} from './install-history.service';
import {Device} from '../../types';

describe('InstallHistoryService', () => {
    const device = {name: 'Living Room', host: '192.0.2.1', username: 'prisoner', password: 'secret'} as Device;
    let service: InstallHistoryService;

    beforeEach(() => {
        const storage = new Map<string, string>();
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, value),
            removeItem: (key: string) => storage.delete(key),
        });
        service = new InstallHistoryService();
    });

    it('stores only install outcome, time, device and supplied app metadata', () => {
        service.record(device, true, {appId: 'org.example.app', appName: 'Example', version: '1.2.3'});
        expect(service.entries[0]).toMatchObject({success: true, device: 'Living Room', appId: 'org.example.app', appName: 'Example', version: '1.2.3'});
        expect(JSON.stringify(service.entries)).not.toContain('secret');
        expect(JSON.stringify(service.entries)).not.toContain('192.0.2.1');
    });

    it('bounds retained entries to 100', () => {
        for (let i = 0; i < 105; i++) service.record(device, i % 2 === 0);
        expect(service.entries).toHaveLength(100);
    });

    it('ignores malformed stored data and can clear history', () => {
        localStorage.setItem('webos-dev-manager.install-history', '{');
        expect(service.entries).toEqual([]);
        service.record(device, false);
        service.clear();
        expect(service.entries).toEqual([]);
    });
});
