import {Injectable, signal} from '@angular/core';
import {Device} from '../../types';
import {RepositoryItem} from './apps-repo.service';

export type InstallPackage =
    | {kind: 'catalog'; item: RepositoryItem; channel: 'stable' | 'beta'}
    | {kind: 'local'; path: string; name: string};

export interface InstallJob {
    id: number;
    package: InstallPackage;
    name: string;
    version?: string;
    sourceName: string;
    device: Device;
    state: 'pending' | 'installing' | 'installed' | 'skipped' | 'failed';
    failure?: string;
}

@Injectable({providedIn: 'root'})
export class InstallQueueService {
    readonly jobs = signal<readonly InstallJob[]>([]);
    readonly running = signal(false);
    private sequence = 0;

    add(item: RepositoryItem, sourceName: string, device: Device, channel: 'stable' | 'beta' = 'stable'): void {
        const manifest = channel === 'stable' ? item.manifest : item.manifestBeta;
        this.enqueue({kind: 'catalog', item, channel}, item.title || item.id, sourceName, device, manifest?.version);
    }

    addLocal(path: string, name: string, device: Device): void {
        this.enqueue({kind: 'local', path, name}, name, 'Local file', device);
    }

    canRetry(job: InstallJob): boolean {
        return job.state === 'failed' && !this.hasActiveJob(job.package, job.device);
    }

    retry(id: number): void {
        const job = this.jobs().find(candidate => candidate.id === id);
        if (job && this.canRetry(job)) this.update(id, 'pending');
    }

    remove(id: number): void {
        this.jobs.update(jobs => jobs.filter(job => job.id !== id || job.state === 'installing'));
    }

    clearFinished(): void {
        this.jobs.update(jobs => jobs.filter(job => job.state === 'pending' || job.state === 'installing'));
    }

    cancelPending(): void {
        this.jobs.update(jobs => jobs.filter(job => job.state !== 'pending'));
    }

    async run(install: (job: InstallJob) => Promise<boolean>): Promise<void> {
        if (this.running()) return;
        this.running.set(true);
        try {
            let job: InstallJob | undefined;
            while ((job = this.jobs().find(item => item.state === 'pending'))) {
                this.update(job.id, 'installing');
                try {
                    this.update(job.id, await install(job) ? 'installed' : 'skipped');
                } catch (error) {
                    this.update(job.id, 'failed', error instanceof Error ? error.message : String(error));
                }
            }
        } finally {
            this.running.set(false);
        }
    }

    private enqueue(pkg: InstallPackage, name: string, sourceName: string, device: Device, version?: string): void {
        if (this.hasActiveJob(pkg, device)) return;
        this.jobs.update(jobs => [...jobs, {
            id: ++this.sequence, package: pkg, name, version, sourceName, device: {...device}, state: 'pending',
        }]);
    }

    private hasActiveJob(pkg: InstallPackage, device: Device): boolean {
        return this.jobs().some(job => job.device.name === device.name && job.device.host === device.host &&
            (job.state === 'pending' || job.state === 'installing') &&
            (pkg.kind === 'local'
                ? job.package.kind === 'local' && job.package.path === pkg.path
                : job.package.kind === 'catalog' && job.package.item.id === pkg.item.id));
    }

    private update(id: number, state: InstallJob['state'], failure?: string): void {
        this.jobs.update(jobs => jobs.map(job => job.id === id ? {...job, state, failure} : job));
    }
}
