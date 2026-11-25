import {vi} from 'vitest';
import {Device} from '../../types';
import {RemoteCommandService} from './remote-command.service';
import {RemoteFileService} from './remote-file.service';
import {ReceiverPackagesService} from './receiver-packages.service';

const device = {name: 'vu', host: '192.0.2.1', port: 22, username: 'root', profile: 'ose'} as Device;
const temp = '/tmp/devman-ipk.ABC123';
const remoteFile = temp + '/package.ipk';

function setup() {
    const exec = vi.fn();
    const put = vi.fn().mockResolvedValue(undefined);
    const service = new ReceiverPackagesService(
        {exec} as unknown as RemoteCommandService,
        {put} as unknown as RemoteFileService,
    );
    return {service, exec, put};
}

describe('ReceiverPackagesService', () => {
    it('reads available plugins when no plugin is installed', async () => {
        const {service, exec} = setup();
        exec.mockResolvedValue(
            '---available---\n' +
            'enigma2-plugin-extensions-example - 1.2 - A plugin\n' +
            'enigma2-plugin-extensions-example - 1.2 - Duplicate feed listing\n' +
            '---upgradable---\n',
        );
        await expect(service.list(device)).resolves.toEqual({
            installed: [],
            available: [{name: 'enigma2-plugin-extensions-example', version: '1.2'}],
        });
    });

    it('updates just the selected plugin', async () => {
        const {service, exec} = setup();
        exec.mockResolvedValue('');
        await service.changePlugin(device, 'upgrade', 'enigma2-plugin-extensions-example');
        expect(exec).toHaveBeenCalledExactlyOnceWith(device, "opkg upgrade 'enigma2-plugin-extensions-example'", 'utf-8');
        await expect(service.changePlugin(device, 'upgrade', '')).rejects.toThrow('Invalid Enigma2 plugin name');
        expect(exec).toHaveBeenCalledOnce();
    });

    it('upgrades the selected plugins together and never calls opkg upgrade without a package', async () => {
        const {service, exec} = setup();
        exec.mockResolvedValue('');
        const first = 'enigma2-plugin-extensions-first';
        const second = 'enigma2-plugin-extensions-second';
        await service.upgradePlugins(device, []);
        await expect(service.upgradePlugins(device, [first, '--force-overwrite'])).rejects.toThrow('Invalid Enigma2 plugin name');
        await service.upgradePlugins(device, [first, second, first]);
        expect(exec).toHaveBeenCalledExactlyOnceWith(device, "opkg upgrade '" + first + "' '" + second + "'", 'utf-8');
    });

    it.each([false, true])('cleans up only the staging file and directory after upload failure=%s', async failed => {
        const {service, exec, put} = setup();
        exec.mockResolvedValueOnce(temp).mockResolvedValue('');
        const original = new Error('upload interrupted');
        if (failed) put.mockRejectedValueOnce(original);

        const install = service.installIpk(device, '/local/test.ipk');
        if (failed) await expect(install).rejects.toBe(original);
        else await expect(install).resolves.toBeUndefined();

        expect(put).toHaveBeenCalledExactlyOnceWith(device, remoteFile, '/local/test.ipk');
        const commands = exec.mock.calls.map(call => call[1]);
        expect(commands[0]).toBe('mktemp -d /tmp/devman-ipk.XXXXXX');
        if (failed) expect(commands).toHaveLength(2);
        else expect(commands[1]).toBe("opkg install '" + remoteFile + "'");
        expect(commands.at(-1)).toBe("rm -f '" + remoteFile + "'; rmdir '" + temp + "'");
    });
});
