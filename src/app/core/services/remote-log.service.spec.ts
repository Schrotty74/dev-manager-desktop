import {ReplaySubject} from 'rxjs';
import {Buffer} from 'buffer';
import {vi} from 'vitest';
import {RemoteLogService, LogMessage} from './remote-log.service';
import {CommandData, CommandSubject, RemoteCommandService} from './remote-command.service';
import {Device} from '../../types';

const device = {name: 'test-tv', host: '192.168.1.2'} as Device;
const timestamp = Date.UTC(2026, 6, 4, 12, 34, 56, 789);
const prefix = '2026-07-04T12:34:56.789Z [12345.678] user.info appinstalld';

describe('RemoteLogService PmLog parsing', () => {
    let stream: CommandSubject<string>;
    let service: RemoteLogService;
    let popen: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        stream = new ReplaySubject<CommandData<string>>() as CommandSubject<string>;
        stream.write = vi.fn().mockResolvedValue(undefined);
        popen = vi.fn().mockResolvedValue(stream);
        service = new RemoteLogService({popen} as unknown as RemoteCommandService);
    });
    afterEach(() => vi.useRealTimers());

    async function read(...lines: string[]): Promise<LogMessage[]> {
        const messages: LogMessage[] = [];
        const logs = await service.logread(device, 20);
        logs.subscribe(message => messages.push(message));
        lines.forEach(data => stream.next({fd: 0, data}));
        stream.complete();
        expect(popen).toHaveBeenCalledExactlyOnceWith(device, 'tail -f -n 20 /var/log/messages', 'utf-8');
        return messages;
    }

    it.each(['1234:5678', '1234:5', '1:5678', '1:2', ''])(
        'preserves log metadata for PID/TID [%s]', async ids => {
            const [message] = await read(`${prefix} [${ids}] APP_INSTALL INSTALL_START {"appId":"org.webosbrew.hbchannel","bytes":12345} Preparing installation`);
            expect(message).toMatchObject({
                monotonic: 12345.678, level: 'info', process: 'appinstalld',
                context: 'APP_INSTALL', msgid: 'INSTALL_START', message: 'Preparing installation',
                extras: {appId: 'org.webosbrew.hbchannel', bytes: 12345},
            });
            expect(message.datetime.toMillis()).toBe(timestamp);
        });

    it('separates nested JSON extras from a message containing braces', async () => {
        const extras = {appId: 'org.example.app', detail: {paths: ['/tmp/app.ipk'], text: 'value with } brace'}};
        const [message] = await read(`${prefix} [1:2] APP_INSTALL INSTALL_DONE ${JSON.stringify(extras)} Installed {org.example.app}`);
        expect(message.extras).toEqual(extras);
        expect(message.message).toBe('Installed {org.example.app}');
        expect(message.context).toBe('APP_INSTALL');
        expect(message.msgid).toBe('INSTALL_DONE');
    });

    it.each(['legacy log without PmLog metadata', `${prefix} [1234:] APP_INSTALL INVALID {} incomplete ID`])(
        'retains the fallback for an unrecognized line: %s', async line => {
            vi.useFakeTimers();
            vi.setSystemTime(timestamp);
            const [message] = await read(`  ${line}  `);
            expect(message).toMatchObject({
                process: 'unknown', context: 'unknown', level: 'info', message: line,
                monotonic: timestamp / 1000,
            });
            expect(message.datetime.toMillis()).toBe(timestamp);
        });

    it('omits empty and whitespace-only lines', async () => {
        expect(await read('', '  ', '\t')).toEqual([]);
    });
});

describe('RemoteLogService Enigma2 logs', () => {
    it('orders crash files by modification time and reads or exports the selected file', async () => {
        const exec = vi.fn().mockResolvedValueOnce(
            '1700000000 /home/root/enigma2_crash_1.log\n' +
            '1800000000 /media/hdd/enigma2_crash_2.log\n' +
            '1800000000 /media/hdd/enigma2_crash_2.log\n',
        ).mockResolvedValueOnce('traceback').mockResolvedValueOnce(Buffer.from('full log'));
        const service = new RemoteLogService({exec} as unknown as RemoteCommandService);
        const logs = await service.listReceiverLogs(device, 'crash');
        expect(logs.map(file => file.name)).toEqual(['enigma2_crash_2.log', 'enigma2_crash_1.log']);
        expect(exec.mock.calls[0][1]).toContain('/home/root /home/root/logs /media/hdd /tmp');
        expect(exec.mock.calls[0][1]).toContain('enigma2_crash*.log');

        await expect(service.readReceiverLog(device, logs[0])).resolves.toBe('traceback');
        expect(exec).toHaveBeenNthCalledWith(2, device, "tail -n 2000 '/media/hdd/enigma2_crash_2.log'", 'utf-8');
        await expect(service.exportReceiverLog(device, logs[0])).resolves.toEqual(Buffer.from('full log'));
        expect(exec).toHaveBeenNthCalledWith(3, device, "cat '/media/hdd/enigma2_crash_2.log'", 'buffer');
    });

    it('reads the kernel log without clearing or following its buffer', async () => {
        const exec = vi.fn().mockResolvedValue('[0.0] Booting Linux');
        const service = new RemoteLogService({exec} as unknown as RemoteCommandService);
        await expect(service.readReceiverLog(device, null)).resolves.toBe('[0.0] Booting Linux');
        expect(exec).toHaveBeenCalledExactlyOnceWith(device, 'dmesg', 'utf-8');
    });

    it('interrupts the remote follow command even if the tab closes while SSH is opening', async () => {
        const stream = new ReplaySubject<CommandData<string>>() as CommandSubject<string>;
        stream.write = vi.fn().mockResolvedValue(undefined);
        const popen = vi.fn().mockResolvedValue(stream);
        const service = new RemoteLogService({popen} as unknown as RemoteCommandService);
        const next = vi.fn();
        const subscription = service.followReceiverLog(device, {
            path: '/home/root/enigma.20261125.debuglog', name: 'enigma.20261125.debuglog', modified: 0,
        }).subscribe(next);
        subscription.unsubscribe();
        await Promise.resolve();
        expect(popen).toHaveBeenCalledExactlyOnceWith(
            device, "exec tail -n 2000 -f '/home/root/enigma.20261125.debuglog'", 'utf-8',
        );
        expect(stream.write).toHaveBeenCalledOnce();
        expect(next).not.toHaveBeenCalled();
    });
});

describe('RemoteLogService OSCam live log', () => {
    it('decodes OSCam lines, advances the cursor and stops polling on unsubscribe', async () => {
        vi.useFakeTimers();
        try {
            const exec = vi.fn()
                .mockResolvedValueOnce(JSON.stringify({oscam: {uptime: '00:02:00', lines: [
                    {id: '4', line: Buffer.from('2026/11/25 06:58:00 Sender Österreich CAID 1702', 'utf-8').toString('base64')},
                ]}}))
                .mockResolvedValueOnce(JSON.stringify({oscam: {uptime: '00:02:02', lines: [
                    {id: '4', line: 'duplicate'},
                    {id: '5', line: 'Channel B CAID 1830'},
                ]}}));
            const service = new RemoteLogService({exec} as unknown as RemoteCommandService);
            const received: string[] = [];
            const subscription = service.watchOscamLog(device).subscribe(line => received.push(line));
            await vi.advanceTimersByTimeAsync(2000);
            expect(received).toEqual(['2026/11/25 06:58:00 Sender Österreich CAID 1702', 'Channel B CAID 1830']);
            expect(exec.mock.calls[0][1]).toContain('127.0.0.1:8081/logpoll.html?lastid=0');
            expect(exec.mock.calls[1][1]).toContain('127.0.0.1:8081/logpoll.html?lastid=4');
            subscription.unsubscribe();
            await vi.advanceTimersByTimeAsync(4000);
            expect(exec).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });
});
