import {ChangeDetectionStrategy, Component, inject} from '@angular/core';
import {AppearanceService, THEME_OPTIONS} from '../core/services/appearance.service';

@Component({
    selector: 'app-appearance',
    standalone: true,
    templateUrl: './appearance.component.html',
    styleUrl: './appearance.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppearanceComponent {
    readonly appearance = inject(AppearanceService);
    readonly themes = THEME_OPTIONS;
}
