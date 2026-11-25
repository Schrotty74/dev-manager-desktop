import {Injectable} from "@angular/core";
import {CommandSubject, escapeSingleQuoteString, RemoteCommandService} from "./remote-command.service";
import {Device, DeviceLike} from "../../types";
import {defer, exhaustMap, finalize, mergeMap, noop, Observable, Subscription, timer} from "rxjs";
import {filter, map} from "rxjs/operators";
import matchBracket from "find-matching-bracket";
import {DateTime} from "luxon";
import {isNonNull} from "../../shared/operators";

export type ReceiverLogKind = 'crash' | 'enigma' | 'kernel' | 'oscam';

export interface ReceiverLogFile {
    path: string;
    name: string;
    modified: number;
}

@Injectable({
    providedIn: 'root'
})
export class RemoteLogService {
    constructor(private cmd: RemoteCommandService) {
    }


    async listReceiverLogs(device: Device, kind: 'crash' | 'enigma'): Promise<ReceiverLogFile[]> {
        const patterns = kind === 'crash'
            ? ['enigma2_crash*.log', '*-enigma2-crash.log']
            : ['enigma.*.debuglog', '*-enigma2-debug.log', 'enigma2_debug*.log', 'enigma.log'];
        const globs = patterns.map(pattern => '"$dir"/' + pattern).join(' ');
        const output = await this.cmd.exec(device,
            'for dir in /home/root /home/root/logs /media/hdd /tmp; do ' +
            'for file in ' + globs + '; do ' +
            'if [ -f "$file" ]; then stat -c "%Y %n" "$file"; fi; done; done', 'utf-8');
        const files = new Map<string, ReceiverLogFile>();
        for (const line of output.split(/\r?\n/)) {
            const entry = /^(\d+) (\/[^\r\n]+)$/.exec(line);
            if (!entry) continue;
            const [, seconds, path] = entry;
            files.set(path, {path, name: path.slice(path.lastIndexOf('/') + 1), modified: Number(seconds) * 1000});
        }
        return [...files.values()].sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name));
    }

    readReceiverLog(device: Device, file: ReceiverLogFile | null): Promise<string> {
        const command = file ? 'tail -n 2000 ' + escapeSingleQuoteString(file.path) : 'dmesg';
        return this.cmd.exec(device, command, 'utf-8');
    }

    exportReceiverLog(device: Device, file: ReceiverLogFile | null) {
        const command = file ? 'cat ' + escapeSingleQuoteString(file.path) : 'dmesg';
        return this.cmd.exec(device, command, 'buffer');
    }

    followReceiverLog(device: Device, file: ReceiverLogFile): Observable<string> {
        return new Observable(observer => {
            let command: CommandSubject<string> | undefined;
            let subscription: Subscription | undefined;
            const stop = () => {
                if (command && !command.isStopped) void command.write().catch(noop);
            };
            this.cmd.popen(device, 'exec tail -n 2000 -f ' + escapeSingleQuoteString(file.path), 'utf-8')
                .then(session => {
                    command = session;
                    if (observer.closed) {
                        stop();
                        return;
                    }
                    subscription = session.subscribe({
                        next: line => observer.next(line.data),
                        error: error => observer.error(error),
                        complete: () => observer.complete(),
                    });
                }, error => observer.error(error));
            return () => {
                subscription?.unsubscribe();
                stop();
            };
        });
    }

    watchOscamLog(device: Device): Observable<string> {
        return defer(() => {
            let lastId = 0;
            let previousUptime: number | undefined;

            return timer(0, 2000).pipe(
                exhaustMap(async () => {
                    const receiverUrl = new URL('http://127.0.0.1:8081/logpoll.html');
                    receiverUrl.searchParams.set('lastid', String(lastId));
                    const url = escapeSingleQuoteString(receiverUrl.href);
                    const response = await this.cmd.exec(device,
                        'if command -v curl >/dev/null 2>&1; then curl -fsS --max-time 3 ' + url +
                        '; else wget -q -T 3 -t 1 -O - ' + url + '; fi', 'utf-8');
                    const page = JSON.parse(response) as {
                        oscam?: {uptime?: string; lines?: {id: string | number; line: string}[]};
                    };
                    if (!Array.isArray(page.oscam?.lines)) throw new Error('OSCam returned an invalid log response.');

                    const uptime = /^(\d+):(\d{2}):(\d{2})$/.exec(page.oscam.uptime ?? '');
                    if (uptime) {
                        const seconds = Number(uptime[1]) * 3600 + Number(uptime[2]) * 60 + Number(uptime[3]);
                        if (previousUptime !== undefined && seconds < previousUptime) lastId = 0;
                        previousUptime = seconds;
                    }
                    const batch: string[] = [];
                    for (const entry of page.oscam.lines) {
                        const id = Number(entry?.id);
                        if (!Number.isSafeInteger(id) || id <= lastId || typeof entry?.line !== 'string') continue;
                        lastId = id;
                        batch.push(this.decodeOscamLine(entry.line));
                    }
                    return batch;
                }),
                mergeMap(lines => lines),
            );
        });
    }

    private decodeOscamLine(line: string): string {
        try {
            const bytes = Uint8Array.from(atob(line), character => character.charCodeAt(0));
            return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
        } catch {
            return line;
        }
    }

    async logread(device: Device, lastLines: number = 0): Promise<Observable<LogMessage>> {
        const subject = await this.cmd.popen(device, `tail -f -n ${lastLines} /var/log/messages`, 'utf-8');
        return subject.pipe(map(output => this.parsePmLog(output.data)),
            filter((msg): msg is LogMessage => isNonNull(msg)),
            finalize(() => subject.write()));
    }

    async dmesg(device: Device): Promise<Observable<LogMessage>> {
        const subject = await this.cmd.popen(device, `dmesg -w -x`, 'utf-8');
        return subject.pipe(map(output => this.parseDmesg(output.data)),
            filter((msg): msg is LogMessage => isNonNull(msg)),
            finalize(() => subject.write()));
    }

    async logClear(device: DeviceLike): Promise<void> {
        await this.cmd.exec(device, 'echo > /var/log/messages', 'utf-8');
    }

    async dmesgClear(device: DeviceLike): Promise<void> {
        await this.cmd.exec(device, 'dmesg -c', 'utf-8');
    }

    private parsePmLog(line: string): LogMessage | null {
        line = line.trim();
        if (!line) {
            return null;
        }
        const match = line.match(/^(?<datetime>[\w:.\-]+) \[(?<monotonic>\d+\.\d+)] (?<facility>\S+)\.(?<level>\S+) (?<process>\S+) \[((?<pid>\S+):(?<tid>\S+))?] (?<context>\S+) (?<msgid>\S+) (?<remaining>\{.+)$/);
        if (!match) {
            const now = DateTime.now();
            return {
                datetime: now,
                monotonic: now.toMillis() / 1000.0,
                process: 'unknown',
                context: 'unknown',
                level: 'info',
                message: line
            };
        }
        const groups: PmLogGroups = match.groups as PmLogGroups;
        const extrasEnd = matchBracket(groups.remaining, 0);
        let extras: Record<string, any> | undefined;
        try {
            extras = JSON.parse(groups.remaining.substring(0, extrasEnd + 1))
        } catch (e) {
            // Ignore
        }
        const message = groups.remaining.substring(extrasEnd + 1).trim();

        return {
            datetime: DateTime.fromISO(groups.datetime),
            monotonic: parseFloat(groups.monotonic),
            level: groups.level,
            context: groups.context,
            msgid: groups.msgid,
            process: groups.process,
            message, extras,
        };
    }

    private parseDmesg(line: string): LogMessage | null {
        const match = line.match(/^(?<facility>\S+)\s*:(?<level>\S+)\s*:\s*\[\s*(?<monotonic>\d+\.\d+)]\s+(:?(?<context>.+?): )?(?<remaining>.+)$/);
        if (!match) {
            return null;
        }
        const groups: DmesgGroups = match.groups as DmesgGroups;
        return {
            datetime: DateTime.now(),
            monotonic: parseFloat(groups.monotonic),
            level: groups.level,
            context: groups.context,
            process: 'unknown',
            message: groups.remaining,
        };
    }

    async pmLogShow(device: DeviceLike): Promise<[string, LogLevel][]> {
        return this.cmd.exec(device, 'PmLogCtl show', 'utf-8', undefined, true).then(({stdout, stderr}) => {
            const lines = stdout || stderr;
            return Array.from<RegExpMatchArray>(lines.matchAll(/^PmLogCtl: Context '([^']+)' = (.+)$/mg))
                .map((m): [string, LogLevel] => m.slice(1) as [string, LogLevel]);
        });
    }

    async pmLogSetLevel(device: DeviceLike, context: string, value: PrefLogLevel): Promise<string[]> {
        return await this.cmd.exec(device, `PmLogCtl set ${escapeSingleQuoteString(context)} ${value}`, 'utf-8').then((lines) => {
            return Array.from<RegExpMatchArray>(lines.matchAll(/^PmLogCtl: Setting context level for '([^']+)'/mg))
                .map((m): string => m[1]);
        });
    }
}

declare interface PmLogGroups extends Record<string, undefined | string> {
    datetime: string;
    monotonic: string;
    facility: string;
    level: LogLevel;
    process: string;
    pid?: string;
    tid?: string;
    context: string;
    msgid: string;
    remaining: string;
}

declare interface DmesgGroups extends Record<string, undefined | string> {
    facility: string;
    level: LogLevel;
    monotonic: string;
    context?: string;

    remaining: string;
}

export type LogLevel = 'emerg' | 'alert' | 'crit' | 'err' | 'warning' | 'notice' | 'info' | 'debug';

export type PrefLogLevel = LogLevel | 'none';

export interface LogMessage {
    datetime: DateTime,
    monotonic: number,
    level: LogLevel;
    process: string;
    context?: string;
    msgid?: string;
    message: string;
    extras?: Record<string, any>;
}
