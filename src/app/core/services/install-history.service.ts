import {Injectable} from '@angular/core';
import {Device} from '../../types';

export interface InstallHistoryEntry {
    timestamp: number;
    success: boolean;
    device: string;
    appId?: string;
    appName?: string;
    version?: string;
}

const STORAGE_KEY = 'webos-dev-manager.install-history';
const MAX_ENTRIES = 100;

@Injectable({providedIn: 'root'})
export class InstallHistoryService {
    get entries(): InstallHistoryEntry[] {
        try {
            const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
            if (!Array.isArray(parsed)) return [];
            return parsed.filter(isEntry).slice(0, MAX_ENTRIES);
        } catch {
            return [];
        }
    }

    record(device: Device, result: boolean, metadata: Pick<InstallHistoryEntry, 'appId' | 'appName' | 'version'> = {}): void {
        const entry: InstallHistoryEntry = {
            timestamp: Date.now(), success: result, device: device.name,
            ...metadata,
        };
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify([entry, ...this.entries].slice(0, MAX_ENTRIES)));
        } catch {
            // History is best-effort and must not change installation behavior.
        }
    }

    clear(): void {
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* Storage may be unavailable. */ }
    }
}

function isEntry(value: unknown): value is InstallHistoryEntry {
    if (!value || typeof value !== 'object') return false;
    const entry = value as Partial<InstallHistoryEntry>;
    return typeof entry.timestamp === 'number' && typeof entry.success === 'boolean'
        && typeof entry.device === 'string'
        && (entry.appId === undefined || typeof entry.appId === 'string')
        && (entry.appName === undefined || typeof entry.appName === 'string')
        && (entry.version === undefined || typeof entry.version === 'string');
}
