import {TestBed} from '@angular/core/testing';
import {emit} from '@tauri-apps/api/event';
import {vi} from 'vitest';
import {mockBackend} from '../../../testing/tauri-mock';
import {GlassFullscreenService} from './glass-fullscreen.service';

describe('GlassFullscreenService', () => {
    let service: GlassFullscreenService;
    let state: {active: boolean; available: boolean};
    let setState = vi.fn(({active}: {active: boolean}) => ({active, available: true}));
    let originalOs: unknown;

    const settle = () => new Promise(resolve => setTimeout(resolve, 0));
    const escape = () => {
        const event = new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true});
        document.body.dispatchEvent(event);
        return event;
    };

    beforeEach(() => {
        vi.stubGlobal('isTauri', true);
        originalOs = (window as any).__TAURI_OS_PLUGIN_INTERNALS__;
        (window as any).__TAURI_OS_PLUGIN_INTERNALS__ = {platform: 'macos'};
        state = {active: false, available: true};
        setState = vi.fn(({active}: {active: boolean}) => state = {...state, active});
        mockBackend({
            glass_fullscreen_state: () => state,
            set_glass_fullscreen: ({active}) => setState({active}),
        });
    });

    afterEach(() => {
        service?.ngOnDestroy();
        (window as any).__TAURI_OS_PLUGIN_INTERNALS__ = originalOs;
        vi.unstubAllGlobals();
        document.querySelector('[data-fullscreen-test-overlay]')?.remove();
    });

    it('tracks a menu change and lets Esc leave without forwarding it to a terminal', async () => {
        service = TestBed.inject(GlassFullscreenService);
        await settle();
        await emit('glass-fullscreen-changed', {active: true, available: true});
        expect(service.active()).toBe(true);

        const terminalKey = vi.fn();
        document.body.addEventListener('keydown', terminalKey);
        try {
            expect(escape().defaultPrevented).toBe(true);
            await settle();
            expect(setState).toHaveBeenCalledWith({active: false});
            expect(service.active()).toBe(false);
            expect(terminalKey).not.toHaveBeenCalled();
        } finally {
            document.body.removeEventListener('keydown', terminalKey);
        }
    });

    it('leaves Esc alone outside Glass fullscreen and while a dialog is open', async () => {
        service = TestBed.inject(GlassFullscreenService);
        await settle();
        expect(escape().defaultPrevented).toBe(false);
        await emit('glass-fullscreen-changed', {active: true, available: true});
        const modal = document.createElement('div');
        modal.className = 'modal show';
        modal.dataset['fullscreenTestOverlay'] = '';
        document.body.appendChild(modal);
        expect(escape().defaultPrevented).toBe(false);
        await settle();
        expect(setState).not.toHaveBeenCalled();
        expect(service.active()).toBe(true);
    });

    it('disables the app toggle while native fullscreen is active', async () => {
        service = TestBed.inject(GlassFullscreenService);
        await settle();
        await emit('glass-fullscreen-changed', {active: false, available: false});
        await service.toggle();
        expect(service.available()).toBe(false);
        expect(setState).not.toHaveBeenCalled();
    });

    it('keeps the actual state on failure and permits a retry', async () => {
        service = TestBed.inject(GlassFullscreenService);
        await settle();
        setState.mockRejectedValueOnce(new Error('Window transition failed'));
        await service.toggle();
        expect(service.active()).toBe(false);
        expect(service.pending()).toBe(false);
        expect(service.error()).toBeTruthy();
        await service.toggle();
        expect(service.active()).toBe(true);
        expect(service.error()).toBe('');
    });

    it('does not overwrite a newer menu event with a late initial response', async () => {
        let resolveState!: (value: typeof state) => void;
        mockBackend({glass_fullscreen_state: () => new Promise(resolve => resolveState = resolve)});
        service = TestBed.inject(GlassFullscreenService);
        await settle();
        await emit('glass-fullscreen-changed', {active: true, available: true});
        resolveState({active: false, available: true});
        await settle();
        expect(service.active()).toBe(true);
    });

    it('removes keyboard and native event listeners when destroyed', async () => {
        service = TestBed.inject(GlassFullscreenService);
        await settle();
        await emit('glass-fullscreen-changed', {active: true, available: true});
        service.ngOnDestroy();
        expect(escape().defaultPrevented).toBe(false);
        await emit('glass-fullscreen-changed', {active: false, available: true});
        expect(service.active()).toBe(true);
        expect(setState).not.toHaveBeenCalled();
    });
});
