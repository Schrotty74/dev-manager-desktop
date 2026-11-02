import {Injectable, signal} from '@angular/core';
import {Device} from '../../types';
import {RepositoryItem} from './apps-repo.service';

export interface InstallJob {
    id: number;
    item: RepositoryItem;
    sourceName: string;
    device: Device;
    state: 'pending' | 'installing' | 'installed' | 'not-installed';
}

@Injectable({providedIn: 'root'})
export class InstallQueueService {
    readonly jobs = signal<readonly InstallJob[]>([]);
    readonly running = signal(false);
    private sequence = 0;

    add(item: RepositoryItem, sourceName: string, device: Device): void {
        if (this.jobs().some(job => job.item.id === item.id && job.device.name === device.name &&
            job.device.host === device.host && (job.state === 'pending' || job.state === 'installing'))) return;
        this.jobs.update(jobs => [...jobs, {id: ++this.sequence, item, sourceName, device: {...device}, state: 'pending'}]);
    }
    remove(id: number): void { this.jobs.update(jobs => jobs.filter(job => job.id !== id || job.state === 'installing')); }
    clearFinished(): void { this.jobs.update(jobs => jobs.filter(job => job.state === 'pending' || job.state === 'installing')); }
    cancelPending(): void { this.jobs.update(jobs => jobs.filter(job => job.state !== 'pending')); }

    async run(install: (item: RepositoryItem, device: Device) => Promise<boolean>): Promise<void> {
        if (this.running()) return;
        this.running.set(true);
        try {
            let job: InstallJob | undefined;
            while ((job = this.jobs().find(item => item.state === 'pending'))) {
                const current = job;
                this.update(current.id, 'installing');
                try { this.update(current.id, await install(current.item, current.device) ? 'installed' : 'not-installed'); }
                catch { this.update(current.id, 'not-installed'); }
            }
        } finally { this.running.set(false); }
    }
    private update(id: number, state: InstallJob['state']): void {
        this.jobs.update(jobs => jobs.map(job => job.id === id ? {...job, state} : job));
    }
}
