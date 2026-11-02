import {Injectable, NgZone} from '@angular/core';
import {BackendClient} from "./backend-client";
import {Device} from "../../types";
import {Subject} from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class DevModeService extends BackendClient {

  private statusSubject = new Subject<DevModeStatusUpdate>();
  private requestIds = new Map<string, number>();

  readonly statusUpdates$ = this.statusSubject.asObservable();

  constructor(zone: NgZone) {
    super(zone, "dev-mode");
  }

  async status(device: Device): Promise<DevModeStatus> {
    const requestId = (this.requestIds.get(devModeDeviceKey(device)) ?? 0) + 1;
    this.requestIds.set(devModeDeviceKey(device), requestId);
    const status = await this.invoke<DevModeStatus>('status', {device});
    this.statusSubject.next({deviceKey: devModeDeviceKey(device), requestId, status});
    return status;
  }

  latestStatusRequestId(device: Device): number {
    return this.requestIds.get(devModeDeviceKey(device)) ?? 0;
  }

  async token(device: Device): Promise<string> {
    return this.invoke('token', {device});
  }
}

export interface DevModeStatus {
  token?: string;
  remaining?: string;
}

export interface DevModeStatusUpdate {
  deviceKey: string;
  requestId: number;
  status: DevModeStatus;
}

export function devModeDeviceKey(device: Device): string {
  return JSON.stringify([device.name, device.host, device.port, device.username]);
}
