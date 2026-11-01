import {computed, Injectable, OnDestroy, signal} from '@angular/core';
import {invoke, isTauri} from '@tauri-apps/api/core';
import {listen, UnlistenFn} from '@tauri-apps/api/event';
import {platform} from '@tauri-apps/plugin-os';

interface GlassFullscreenState {
    active: boolean;
    available: boolean;
}

@Injectable({providedIn: 'root'})
export class GlassFullscreenService implements OnDestroy {
    readonly supported = isTauri() && platform() === 'macos';
    private readonly state = signal<GlassFullscreenState>({active: false, available: false});
    readonly active = computed(() => this.state().active);
    readonly available = computed(() => this.state().available);
    readonly pending = signal(false);
    readonly error = signal('');
    private unlisten?: UnlistenFn;
    private destroyed = false;
    private revision = 0;

    private readonly onKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape' || event.repeat || event.isComposing || !this.active()) return;
        // Let an open overlay consume Esc before leaving fullscreen. Capture the
        // remaining keypress before a terminal can send it to the remote device.
        if (document.querySelector('.modal.show, .dropdown-menu.show, .offcanvas.show')) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        void this.setActive(false);
    };

    constructor() {
        if (!this.supported) return;
        window.addEventListener('keydown', this.onKeyDown, true);
        void this.initialize();
    }

    async toggle(): Promise<void> {
        await this.setActive(!this.active());
    }

    private async setActive(active: boolean): Promise<void> {
        if (!this.supported || this.pending() || (active && !this.available())) return;
        this.pending.set(true);
        this.error.set('');
        const revision = this.revision;
        try {
            const state = await invoke<GlassFullscreenState>('set_glass_fullscreen', {active});
            if (!this.destroyed && revision === this.revision) this.state.set(state);
        } catch {
            if (!this.destroyed) this.error.set('Glas-Vollbild konnte nicht geändert werden.');
        } finally {
            if (!this.destroyed) this.pending.set(false);
        }
    }

    private async initialize(): Promise<void> {
        try {
            const unlisten = await listen<GlassFullscreenState>('glass-fullscreen-changed', event => {
                if (this.destroyed) return;
                this.revision++;
                this.state.set(event.payload);
            });
            if (this.destroyed) {
                unlisten();
                return;
            }
            this.unlisten = unlisten;
            const revision = this.revision;
            const state = await invoke<GlassFullscreenState>('glass_fullscreen_state');
            if (!this.destroyed && revision === this.revision) this.state.set(state);
        } catch {
            if (!this.destroyed) this.error.set('Glas-Vollbild ist gerade nicht verfügbar.');
        }
    }

    ngOnDestroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.unlisten?.();
        window.removeEventListener('keydown', this.onKeyDown, true);
    }
}
