import {describe, expect, it, vi} from 'vitest';
import {InstallJob, InstallQueueService} from './install-queue.service';
import {RepositoryItem} from './apps-repo.service';
import {Device} from '../../types';

const device: Device = {name: 'TV', host: 'tv.example.test', port: 22, username: 'prisoner', profile: 'ose'};
const app = (id: string) => new RepositoryItem({id, title: id}, 'https://example.test/repo.json');

describe('InstallQueueService', () => {
    it('runs jobs sequentially on their captured TVs and continues after a failure', async () => {
        const queue = new InstallQueueService();
        const target = {...device};
        queue.add(app('first'), 'Source A', target); queue.add(app('second'), 'Source B', target);
        target.host = 'different.example.test';
        let active = 0;
        const install = vi.fn(async (job: InstallJob) => {
            active++; expect(active).toBe(1); expect(job.device.host).toBe(device.host);
            await Promise.resolve(); active--;
            if (job.name === 'first') throw new Error('Install failed');
            return true;
        });
        await Promise.all([queue.run(install), queue.run(install)]);
        expect(install).toHaveBeenCalledTimes(2);
        expect(queue.jobs().map(job => job.state)).toEqual(['failed', 'installed']);
        expect(queue.running()).toBe(false);
    });
    it('deduplicates pending app/TV jobs and cancels pending jobs without interrupting an active install', async () => {
        const queue = new InstallQueueService();
        queue.add(app('first'), 'Source A', device); queue.add(app('first'), 'Source B', device);
        queue.add(app('second'), 'Source A', device);
        expect(queue.jobs()).toHaveLength(2);
        let finish!: (success: boolean) => void;
        const install = vi.fn(() => new Promise<boolean>(resolve => finish = resolve));
        const running = queue.run(install);
        queue.cancelPending();
        expect(queue.jobs()).toHaveLength(1);
        expect(queue.jobs()[0].state).toBe('installing');
        finish(true); await running;
        expect(install).toHaveBeenCalledTimes(1);
        queue.clearFinished(); expect(queue.jobs()).toEqual([]);
    });
    it('requeues a failed local IPK with its original file and target, and ignores repeated clicks', async () => {
        const queue = new InstallQueueService();
        queue.addLocal('/Downloads/app.IPK', 'app.IPK', device);
        queue.addLocal('/Downloads/app.IPK', 'app.IPK', device);
        const id = queue.jobs()[0].id;
        await queue.run(async () => { throw new Error('Transfer failed'); });
        expect(queue.jobs()[0]).toMatchObject({state: 'failed', failure: 'Transfer failed'});

        queue.retry(id);
        queue.retry(id);
        const install = vi.fn(async () => true);
        await queue.run(install);
        expect(install).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            package: {kind: 'local', path: '/Downloads/app.IPK', name: 'app.IPK'},
            device,
        }));
        expect(queue.jobs()[0]).toMatchObject({id, state: 'installed', failure: undefined});
    });

    it('keeps skipped jobs out of retry', async () => {
        const queue = new InstallQueueService();
        queue.add(app('first'), 'Source A', device);
        await queue.run(async () => false);
        const job = queue.jobs()[0];
        expect(queue.canRetry(job)).toBe(false);
        queue.retry(job.id);
        expect(queue.jobs()[0].state).toBe('skipped');
    });
});
