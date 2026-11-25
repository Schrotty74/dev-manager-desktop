import {Injectable} from '@angular/core';
import {Device} from '../../types';
import {escapeSingleQuoteString, RemoteCommandService} from './remote-command.service';
import {RemoteFileService} from './remote-file.service';

export interface ReceiverPackage {
    name: string;
    version: string;
    update?: string;
}

export interface ReceiverCatalog {
    installed: ReceiverPackage[];
    available: ReceiverPackage[];
}

const AVAILABLE = '---available---';
const UPGRADABLE = '---upgradable---';
const PACKAGE_LINE = /^(enigma2-plugin-[a-z0-9][a-z0-9+.-]*)\s+-\s+(\S+)/;
const PACKAGE_NAME = /^enigma2-plugin-[a-z0-9][a-z0-9+.-]*$/;

@Injectable({providedIn: 'root'})
export class ReceiverPackagesService {
    private readonly busyReceivers = new Set<string>();

    constructor(private command: RemoteCommandService, private files: RemoteFileService) {}

    async list(device: Device): Promise<ReceiverCatalog> {
        const command = [
            this.pluginList('list-installed'),
            `printf '%s\\n' '${AVAILABLE}'`,
            this.pluginList('list'),
            `printf '%s\\n' '${UPGRADABLE}'`,
            this.pluginList('list-upgradable'),
        ].join(' && ');
        const output = await this.command.exec(device, command, 'utf-8');
        const [installedText, ...catalog] = output.replace(/\r\n/g, '\n').split(new RegExp('^' + AVAILABLE + '\n', 'm'));
        const [availableText, upgrades] = catalog[0]?.split(new RegExp('^' + UPGRADABLE + '\n', 'm')) ?? [];
        if (availableText === undefined || upgrades === undefined) {
            throw new Error('The receiver returned an incomplete package list.');
        }

        const updates = new Map<string, string>();
        for (const line of upgrades.split('\n')) {
            const match = line.match(/^(enigma2-plugin-[a-z0-9][a-z0-9+.-]*)\s+-\s+\S+\s+-\s+(\S+)/);
            if (match) updates.set(match[1], match[2]);
        }
        const installed = this.parsePackages(installedText);
        const installedNames = new Set(installed.map(pkg => pkg.name));
        return {
            installed: installed.map(pkg => ({...pkg, update: updates.get(pkg.name)})),
            available: this.parsePackages(availableText).filter(pkg => !installedNames.has(pkg.name)),
        };
    }

    async refreshFeeds(device: Device): Promise<void> {
        await this.withPackageManager(device, async () => {
            await this.command.exec(device, 'opkg update', 'utf-8');
        });
    }

    changePlugin(device: Device, operation: 'install' | 'upgrade', name: string): Promise<void> {
        return this.changePlugins(device, operation, [name]);
    }

    upgradePlugins(device: Device, names: string[]): Promise<void> {
        return this.changePlugins(device, 'upgrade', [...new Set(names)]);
    }

    private async changePlugins(device: Device, operation: 'install' | 'upgrade', names: string[]): Promise<void> {
        if (!names.length) return;
        if (names.some(name => !PACKAGE_NAME.test(name))) throw new Error('Invalid Enigma2 plugin name.');
        const argumentsList = names.map(escapeSingleQuoteString).join(' ');
        await this.withPackageManager(device, async () => {
            await this.command.exec(device, 'opkg ' + operation + ' ' + argumentsList, 'utf-8');
        });
    }

    async installIpk(device: Device, localPath: string): Promise<void> {
        await this.withPackageManager(device, async () => {
            const directory = (await this.command.exec(device, 'mktemp -d /tmp/devman-ipk.XXXXXX', 'utf-8')).trim();
            if (!/^\/tmp\/devman-ipk\.[A-Za-z0-9]{6}$/.test(directory)) {
                throw new Error('The receiver returned an invalid temporary directory.');
            }

            const destination = directory + '/package.ipk';
            try {
                await this.files.put(device, destination, localPath);
                await this.command.exec(device, `opkg install ${escapeSingleQuoteString(destination)}`, 'utf-8');
            } finally {
                await this.command.exec(device,
                    `rm -f ${escapeSingleQuoteString(destination)}; rmdir ${escapeSingleQuoteString(directory)}`, 'utf-8')
                    .catch(error => console.warn('Could not clean up the receiver IPK', error));
            }
        });
    }

    private pluginList(operation: 'list' | 'list-installed' | 'list-upgradable'): string {
        return `(packages=$(LC_ALL=C opkg ${operation}) || exit $?; printf '%s\\n' "$packages" | sed -n '/^enigma2-plugin-/p')`;
    }

    private parsePackages(output: string): ReceiverPackage[] {
        const packages = new Map<string, ReceiverPackage>();
        for (const line of output.split('\n')) {
            const match = PACKAGE_LINE.exec(line);
            if (match && !packages.has(match[1])) {
                packages.set(match[1], {name: match[1], version: match[2]});
            }
        }
        return [...packages.values()].sort((left, right) => left.name.localeCompare(right.name));
    }

    private async withPackageManager(device: Device, operation: () => Promise<void>): Promise<void> {
        const key = device.host;
        if (this.busyReceivers.has(key)) throw new Error('A package operation is already running on this receiver.');
        this.busyReceivers.add(key);
        try {
            await operation();
        } finally {
            this.busyReceivers.delete(key);
        }
    }
}
