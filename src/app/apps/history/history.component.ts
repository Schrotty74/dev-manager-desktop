import {ChangeDetectionStrategy, Component} from '@angular/core';
import {InstallHistoryService} from '../../core/services/install-history.service';

@Component({
    selector: 'app-install-history',
    templateUrl: './history.component.html',
    styleUrls: ['./history.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false,
})
export class HistoryComponent {
    constructor(public history: InstallHistoryService) {}

    clear(): void {
        this.history.clear();
    }
}
