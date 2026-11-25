import {Component, OnDestroy, OnInit, ViewEncapsulation, ChangeDetectionStrategy} from '@angular/core';
import {ActivatedRoute} from "@angular/router";
import {DeviceManagerService} from "../core/services";
import {Device} from "../types";
import {Subscription, from, map, of, startWith, switchMap} from "rxjs";
import {NgbNavChangeEvent} from "@ng-bootstrap/ng-bootstrap";
import {Location} from "@angular/common";

@Component({
    selector: 'app-debug',
    templateUrl: './debug.component.html',
    styleUrls: ['./debug.component.scss'],
    encapsulation: ViewEncapsulation.None,
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class DebugComponent implements OnInit, OnDestroy {
  device: Device | null = null;
  activeTab: string = 'crashes';
  receiver = false;
  checkingDevice = false;

  private subscriptions: Subscription = new Subscription();

  constructor(public route: ActivatedRoute, private location: Location, private deviceManager: DeviceManagerService) {
  }

  ngOnInit(): void {
    this.subscriptions.add(this.route.fragment.subscribe(fragment => {
      if (fragment) this.activeTab = fragment;
      this.ensureAvailableTab();
    }));
    this.subscriptions.add(this.deviceManager.selected$.pipe(switchMap(device => {
      if (!device) return of({device, receiver: false, checking: false});
      return from(this.deviceManager.getReceiverInfo(device).catch(() => null)).pipe(
        map(info => ({device, receiver: info !== null, checking: false})),
        startWith({device, receiver: false, checking: true}),
      );
    })).subscribe(({device, receiver, checking}) => {
      this.device = device;
      this.receiver = receiver;
      this.checkingDevice = checking;
      this.ensureAvailableTab();
    }));
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  private ensureAvailableTab(): void {
    if (!this.device || this.checkingDevice) return;
    const tabs = this.receiver ? ['crashes', 'enigma', 'dmesg', 'oscam'] :
      this.device.username === 'prisoner' ? ['crashes'] : ['crashes', 'pmlog', 'dmesg', 'ls-monitor'];
    if (!tabs.includes(this.activeTab)) this.activeTab = 'crashes';
  }

  tabChange($event: NgbNavChangeEvent<string>) {
    $event.preventDefault();
    const nextId = $event.nextId;
    this.activeTab = nextId;
    this.location.replaceState(`${this.location.path(false)}#${nextId}`);
  }
}
