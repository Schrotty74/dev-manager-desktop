import {fetch} from '@tauri-apps/plugin-http';
import {Injectable} from '@angular/core';
import {Observable} from 'rxjs';
import {eq as semverEq, gt as semverGt} from 'semver';
import {keyBy} from "lodash-es";
import {DeviceInfo} from "./device-manager.service";
import semver from "semver/preload";
import {HomebrewChannelConfiguration} from "../../types/luna-apis";
import {fromPromise} from "rxjs/internal/observable/innerFrom";
import {normalizeRepositoryUrl} from './repository-url';

const baseUrl = 'https://repo.webosbrew.org/api';
const requestTimeoutMs = 30_000;

/** One deadline covers both response headers and the complete JSON body. */
async function requestJson(url: string): Promise<any> {
    const controller = new AbortController();
    const timeoutError = new Error('Repository request timed out after 30 seconds. Please try again.');
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            timedOut = true;
            reject(timeoutError);
            controller.abort();
        }, requestTimeoutMs);
    });
    const request = async () => {
        const response = await fetch(url, {signal: controller.signal});
        if (!response.ok) {
            // Do not wait for an error body (or its cleanup) before reporting the status.
            void response.body?.cancel().catch(() => undefined);
            throw new Error(`Repository request failed (HTTP ${response.status}). Please try again.`);
        }
        try {
            return await response.json();
        } catch (error) {
            if ((error as Error)?.name === 'SyntaxError') {
                throw new Error('Invalid JSON received from the repository. Please try again.');
            }
            throw error;
        }
    };
    try {
        return await Promise.race([request(), deadline]);
    } catch (error) {
        if (timedOut) throw timeoutError;
        throw error instanceof Error ? error : new Error(String(error));
    } finally {
        clearTimeout(timer!);
    }
}

function validatePage(data: any): asserts data is RepositoryPage {
    const paging = data?.paging;
    if (!data || Array.isArray(data) || !paging ||
        !['page', 'count', 'maxPage', 'itemsTotal'].every(key =>
            Number.isSafeInteger(paging[key]) && paging[key] >= 0) ||
        !Array.isArray(data.packages) ||
        !data.packages.every((item: unknown) => item !== null && typeof item === 'object' && !Array.isArray(item))) {
        throw new Error('Invalid repository page received. Please try again.');
    }
}

function validCustomPackage(item: any, catalogUrl: string): boolean {
    const manifest = item?.manifest;
    if (!item || Array.isArray(item) || typeof item !== 'object' ||
        typeof item.id !== 'string' || !item.id.trim() ||
        typeof manifest?.id !== 'string' || manifest.id !== item.id ||
        typeof manifest.version !== 'string' || !manifest.version.trim() ||
        typeof manifest.ipkUrl !== 'string' ||
        typeof manifest.ipkHash?.sha256 !== 'string' || !/^[\da-f]{64}$/i.test(manifest.ipkHash.sha256)) return false;
    try {
        const ipkUrl = new URL(manifest.ipkUrl, catalogUrl);
        return ipkUrl.protocol === 'https:' && !ipkUrl.username && !ipkUrl.password;
    } catch {
        return false;
    }
}

function validOptionalManifestDownload(manifest: any, catalogUrl: string, appId: string): boolean {
    if (!manifest || manifest.ipkUrl === undefined) return true;
    if (manifest.id !== undefined && manifest.id !== appId || typeof manifest.ipkUrl !== 'string' ||
        typeof manifest.ipkHash?.sha256 !== 'string' || !/^[\da-f]{64}$/i.test(manifest.ipkHash.sha256)) return false;
    try {
        const ipkUrl = new URL(manifest.ipkUrl, catalogUrl);
        return ipkUrl.protocol === 'https:' && !ipkUrl.username && !ipkUrl.password;
    } catch {
        return false;
    }
}

function validateCustomCatalog(data: any, catalogUrl: string): {packages: any[]; paging: Paging; skippedCount: number} {
    const sourcePackages = Array.isArray(data) ? data : data?.packages;
    if (!Array.isArray(sourcePackages)) {
        throw new Error('Invalid custom repository catalog. Expected an array of packages.');
    }
    const packages = sourcePackages.filter(item => validCustomPackage(item, catalogUrl) &&
        validOptionalManifestDownload(item.manifestBeta, catalogUrl, item.id));
    const skippedCount = sourcePackages.length - packages.length;
    if (sourcePackages.length > 0 && packages.length === 0) {
        throw new Error('Invalid custom repository catalog. No packages have valid manifests, HTTPS IPK URLs, and SHA-256 hashes.');
    }
    if (data && !Array.isArray(data) && data.paging !== undefined) {
        validatePage({...data, packages});
        return {packages, paging: data.paging, skippedCount};
    }
    const count = packages.length;
    return {packages, paging: {page: 1, count, maxPage: count ? 1 : 0, itemsTotal: count}, skippedCount};
}

function resolveCustomPackage(item: any, catalogUrl: string): any {
    const result = {...item};
    result.iconUri = typeof item.iconUri === 'string' && item.iconUri
        ? new URL(item.iconUri, catalogUrl).toString() : 'assets/icons/favicon.png';
    if (typeof item.detailIconUri === 'string') result.detailIconUri = new URL(item.detailIconUri, catalogUrl).toString();
    else if (typeof item.detailIcon === 'string') result.detailIconUri = new URL(item.detailIcon, catalogUrl).toString();
    const descriptionUrl = item.fullDescriptionUrl ?? item.descriptionUrl;
    if (typeof descriptionUrl === 'string') result.fullDescriptionUrl = new URL(descriptionUrl, catalogUrl).toString();
    const manifestUrl = item.manifestUrl ?? item.manifestURL;
    if (typeof manifestUrl === 'string') result.manifestUrl = new URL(manifestUrl, catalogUrl).toString();
    result.manifest = {...item.manifest, ipkUrl: new URL(item.manifest.ipkUrl, catalogUrl).toString()};
    if (item.manifestBeta) {
        result.manifestBeta = {...item.manifestBeta};
        if (typeof result.manifestBeta.ipkUrl === 'string') {
            result.manifestBeta.ipkUrl = new URL(result.manifestBeta.ipkUrl, catalogUrl).toString();
        }
    }
    return result;
}

@Injectable({
    providedIn: 'root'
})
export class AppsRepoService {

    constructor() {
    }

    async showApp(id: string): Promise<RepositoryItem | undefined> {
        const url = `${baseUrl}/apps/${id}/releases/latest.json`;
        return requestJson(url).then(data => new RepositoryItem(data, url))
            .catch(() => undefined);
    }

    async showApps(...ids: string[]): Promise<Record<string, RepositoryItem>> {
        function assertFulfilled(item: PromiseSettledResult<RepositoryItem | undefined>): item is PromiseFulfilledResult<RepositoryItem> {
            return item.status === 'fulfilled';
        }

        return await Promise.allSettled(ids.map(id => this.showApp(id)))
            .then(list => list.filter(assertFulfilled).map(result => result.value).filter(v => v))
            .then((list: RepositoryItem[]) => keyBy(list, pkg => pkg.id));
    }

    allApps$(page = 0, catalogUrl?: string): Observable<RepositoryPage> {
        if (catalogUrl !== undefined) {
            const normalizedUrl = normalizeRepositoryUrl(catalogUrl);
            const url = page > 1 ? new URL(`apps/${page}.json`, normalizedUrl).toString() : normalizedUrl;
            return fromPromise(requestJson(url).then(data => {
                const parsed = validateCustomCatalog(data, url);
                return new RepositoryPage({paging: parsed.paging,
                    packages: parsed.packages.map(item => resolveCustomPackage(item, url)),
                    skippedCount: parsed.skippedCount}, url);
            }));
        }
        const suffix = page > 1 ? `apps/${page}.json` : 'apps.json';
        const url = `${baseUrl}/${suffix}`;
        return fromPromise(requestJson(url).then(data => {
            validatePage(data);
            return new RepositoryPage(data, url);
        }));
    }

    async checkRepository(catalogUrl: string): Promise<{count: number}> {
        const url = normalizeRepositoryUrl(catalogUrl);
        const parsed = validateCustomCatalog(await requestJson(url), url);
        return {count: parsed.packages.length};
    }
}

export class PackageManifest {
    id: string = '';
    version: string = '';
    ipkUrl: string = '';
    ipkHash?: { sha256: string; };
    sourceUrl?: string;
    appDescription: string = '';
    rootRequired?: boolean | 'optional';

    constructor(data: Partial<PackageManifest>) {
        Object.assign(this, data);
    }

    hasUpdate(version?: string): boolean | null {
        const available = parsePackageVersion(this.version), installed = parsePackageVersion(version);
        if (!available || !installed) return null;
        const [v1, suffix1] = available, [v2, suffix2] = installed;
        if ((suffix1 || suffix2) && semverEq(v1, v2, true)) {
            const snum1 = Number(suffix1), snum2 = Number(suffix2);
            if (!isNaN(snum1) && !isNaN(snum2)) {
                return snum1 > snum2;
            }
            return suffix1.localeCompare(suffix2) > 0;
        }
        return semverGt(v1, v2);
    }
}

function parsePackageVersion(value: unknown): [version: string, suffix: string] | null {
    if (typeof value !== 'string') return null;
    // Dots inside valid prerelease/build metadata are not legacy fourth components.
    if (semver.valid(value)) return [value, ''];
    const parts = value.split('.');
    if (parts.length !== 4 || !parts[3]) return null;
    const base = parts.slice(0, 3).join('.');
    return semver.valid(base) ? [base, parts[3]] : null;
}

export class RepositoryItem {
    id: string = '';
    title: string = '';
    iconUri: string = '';
    detailIconUri?: string;
    manifest?: PackageManifest;
    manifestUrl?: string;
    manifestBeta?: PackageManifest;
    requirements?: PackageRequirements;
    shortDescription?: string;
    fullDescriptionUrl?: string;

    constructor(data: Partial<RepositoryItem>, url: string) {
        Object.assign(this, data);
        if (data.manifest) {
            this.manifest = new PackageManifest(data.manifest);
        }
        if (data.manifestBeta) {
            this.manifestBeta = new PackageManifest(data.manifestBeta);
        }
        if (data.requirements) {
            this.requirements = new PackageRequirements(data.requirements);
        }
        if (data.fullDescriptionUrl) {
            this.fullDescriptionUrl = new URL(data.fullDescriptionUrl, url).toString();
        }
    }

    checkIncompatibility(info?: Partial<DeviceInfo>, hbConf?: Partial<HomebrewChannelConfiguration>): IncompatibleReason[] | null {
        const result = info && this.requirements?.checkIncompatibility(info) || [];
        if (hbConf?.root === false && this.manifest?.rootRequired === true) {
            result.push('root');
        }
        return result.length > 0 ? result : null;
    }
}

export type IncompatibleReason = 'release' | 'soc' | 'root';

export class PackageRequirements {
    webosRelease?: string;
    deviceSoC?: string[];

    constructor(data: Partial<PackageRequirements>) {
        Object.assign(this, data);
    }

    checkIncompatibility(info: Partial<DeviceInfo>): IncompatibleReason[] | null {
        const result: IncompatibleReason [] = [];
        if (info.osVersion && this.webosRelease) {
            if (!semver.satisfies(info.osVersion, this.webosRelease, true)) {
                result.push('release');
            }
        }
        if (info.socName && this.deviceSoC) {
            const excludeSoCs = this.deviceSoC.filter(soc => soc.startsWith('!')).map(soc => soc.substring(1));
            const includeSoCs = this.deviceSoC.filter(soc => !soc.startsWith('!'));
            if (includeSoCs.length > 0 && !includeSoCs.includes(info.socName)) {
                result.push('soc');
            } else if (excludeSoCs.length > 0 && excludeSoCs.includes(info.socName)) {
                result.push('soc');
            }
        }
        return result.length > 0 ? result : null;
    }
}

export interface Paging {
    page: number;
    count: number;
    maxPage: number;
    itemsTotal: number;
}

export class RepositoryPage {
    paging: Paging;
    packages: RepositoryItem[];
    skippedCount: number = 0;

    constructor(data: Partial<RepositoryPage>, url: string) {
        this.paging = data.paging!;
        this.packages = data.packages?.map((item) => new RepositoryItem(item, url)) ?? [];
        this.skippedCount = data.skippedCount ?? 0;
    }
}
