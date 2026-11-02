import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Subject} from 'rxjs';
import {HomeComponent} from './home.component';
import {Device} from '../types';
import {DevModeStatusUpdate, devModeDeviceKey} from '../core/services/dev-mode.service';

const tv: Device = {name: 'TV', host: 'tv.example.test', port: 9922, username: 'prisoner', profile: 'ose', default: true};

describe('App-wide Developer Mode warning', () => {
    let devices: Subject<Device[]>;
    let updates: Subject<DevModeStatusUpdate>;
    let home: HomeComponent;
    let status: ReturnType<typeof vi.fn>;
    let extend: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        vi.useFakeTimers();
        devices = new Subject<Device[]>(); updates = new Subject<DevModeStatusUpdate>();
        status = vi.fn().mockResolvedValue({}); extend = vi.fn().mockResolvedValue(undefined);
        home = new HomeComponent({devices$: devices.asObservable(), extendDevMode: extend} as any,
            {open: vi.fn()} as any, {} as any,
            {statusUpdates$: updates.asObservable(), status, latestStatusRequestId: () => 1} as any);
    });
    afterEach(() => { home.ngOnDestroy(); vi.useRealTimers(); });
    const update = (device: Device, remaining: string, requestId = 1) => ({
        deviceKey: devModeDeviceKey(device), requestId, status: {token: 'test-token', remaining},
    });
    it('checks once per selected TV, warns at the threshold and performs no periodic network polls', () => {
        devices.next([tv]); devices.next([tv]);
        expect(status).toHaveBeenCalledTimes(1);
        updates.next(update(tv, '24:00:01')); vi.advanceTimersByTime(0);
        expect(home.devModeExpiresSoon).toBe(false);
        vi.advanceTimersByTime(1000); expect(home.devModeExpiresSoon).toBe(true);
        vi.advanceTimersByTime(60000); expect(status).toHaveBeenCalledTimes(1);
    });
    it('ignores stale replies and clears the old warning when the target address changes', () => {
        devices.next([tv]); updates.next(update(tv, '01:00:00')); vi.advanceTimersByTime(0);
        expect(home.devModeExpiresSoon).toBe(true);
        const changed = {...tv, host: 'other.example.test'};
        devices.next([changed]); expect(home.devModeExpiresSoon).toBe(false);
        expect(status).toHaveBeenCalledTimes(2);
        updates.next(update(tv, '00:10:00')); vi.advanceTimersByTime(0);
        expect(home.devModeExpiresSoon).toBe(false);
        updates.next(update(changed, '00:10:00', 0)); vi.advanceTimersByTime(0);
        expect(home.devModeExpiresSoon).toBe(false);
        updates.next(update(changed, '00:10:00')); vi.advanceTimersByTime(0);
        expect(home.devModeExpiresSoon).toBe(true);
    });
    it('refreshes the status after renewal, clears a renewed warning and shows renewal errors', async () => {
        devices.next([tv]); updates.next(update(tv, '01:00:00')); vi.advanceTimersByTime(0);
        await home.renewDevMode(); expect(extend).toHaveBeenCalledWith(tv);
        expect(status).toHaveBeenCalledTimes(2);
        updates.next(update(tv, '999:00:00')); vi.advanceTimersByTime(0);
        expect(home.devModeExpiresSoon).toBe(false);
        extend.mockRejectedValueOnce(new Error('Offline')); await home.renewDevMode();
        expect(home.devModeRenewError).toContain('Could not renew');
        expect(home.renewingDevMode).toBe(false);
    });
    it('stops the countdown on teardown and does not query root devices', () => {
        devices.next([{...tv, username: 'root'}]); expect(status).not.toHaveBeenCalled();
        devices.next([tv]); updates.next(update(tv, '24:00:01')); vi.advanceTimersByTime(0);
        home.ngOnDestroy(); vi.advanceTimersByTime(2000); expect(home.devModeExpiresSoon).toBe(false);
    });
});
