//! Native fullscreen on the current desktop, keeping the live glass backdrop.

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};

use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, WINDOW_SUBMENU_ID},
    AppHandle, Emitter, Manager, State, WindowEvent,
};

const MENU_ID: &str = "glass-fullscreen";
const EVENT_NAME: &str = "glass-fullscreen-changed";

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
pub struct GlassFullscreenState {
    pub active: bool,
    pub available: bool,
}

#[derive(Default)]
pub struct GlassFullscreenController {
    active: AtomicBool,
    available: AtomicBool,
    menu_item: Mutex<Option<tauri::menu::MenuItem<tauri::Wry>>>,
}

impl GlassFullscreenController {
    fn state(&self) -> GlassFullscreenState {
        GlassFullscreenState {
            active: self.active.load(Ordering::SeqCst),
            available: self.available.load(Ordering::SeqCst),
        }
    }

    fn update(&self, window: &tauri::WebviewWindow, active: bool, available: bool) {
        let previous_active = self.active.swap(active, Ordering::SeqCst);
        let previous_available = self.available.swap(available, Ordering::SeqCst);
        if previous_available != available || previous_active != active {
            let _ = window.emit(EVENT_NAME, self.state());
        }
        if let Ok(item) = self.menu_item.lock() {
            if let Some(item) = item.as_ref() {
                let _ = item.set_text(if active {
                    "Glas-Vollbild beenden"
                } else {
                    "Glas-Vollbild"
                });
            }
        }
    }

    fn emit_state(&self, window: &tauri::WebviewWindow) {
        let _ = window.emit(EVENT_NAME, self.state());
    }
}

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    let available = !window.is_fullscreen()?;
    app.manage(GlassFullscreenController {
        active: AtomicBool::new(false),
        available: AtomicBool::new(available),
        ..Default::default()
    });

    let menu = match app.menu() {
        Some(menu) => menu,
        None => {
            let menu = Menu::default(app)?;
            app.set_menu(menu.clone())?;
            menu
        }
    };
    let Some(window_menu) = menu.get(WINDOW_SUBMENU_ID) else {
        return Ok(());
    };
    let Some(window_menu) = window_menu.as_submenu() else {
        return Ok(());
    };
    let item = MenuItem::with_id(
        app,
        MENU_ID,
        "Glas-Vollbild",
        available,
        Some("Command+Control+Shift+F"),
    )?;
    let controller = app.state::<GlassFullscreenController>();
    if let Ok(mut menu_item) = controller.menu_item.lock() {
        *menu_item = Some(item.clone());
    }
    window_menu.append(&PredefinedMenuItem::separator(app)?)?;
    window_menu.append(&item)?;

    let observed = window.clone();
    let observed_item = item.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Resized(_) | WindowEvent::Moved(_)) {
            let available = !observed.is_fullscreen().unwrap_or(true);
            let controller = observed.state::<GlassFullscreenController>();
            let state = controller.state();
            let changed = state.available != available;
            controller.available.store(available, Ordering::SeqCst);
            let _ = observed_item.set_enabled(available);
            if changed {
                controller.emit_state(&observed);
            }
        }
        if matches!(event, WindowEvent::CloseRequested { .. }) {
            let controller = observed.state::<GlassFullscreenController>();
            if controller.active.swap(false, Ordering::SeqCst) {
                let _ = observed.set_simple_fullscreen(false);
                controller.emit_state(&observed);
            }
        }
    });

    let menu_window = window.clone();
    app.on_menu_event(move |_, event| {
        if event.id().as_ref() != MENU_ID {
            return;
        }
        let controller = menu_window.state::<GlassFullscreenController>();
        let next = !controller.active.load(Ordering::SeqCst);
        if let Err(error) = apply_state(&menu_window, &controller, next) {
            log::error!("Cannot change glass fullscreen: {error}");
        }
    });

    Ok(())
}

#[tauri::command]
pub fn glass_fullscreen_state(
    window: tauri::WebviewWindow,
    controller: State<'_, GlassFullscreenController>,
) -> tauri::Result<GlassFullscreenState> {
    let available = !window.is_fullscreen()?;
    let previous = controller.available.swap(available, Ordering::SeqCst);
    if previous != available {
        let _ = window.emit(EVENT_NAME, controller.state());
    }
    Ok(controller.state())
}

#[tauri::command]
pub fn set_glass_fullscreen(
    window: tauri::WebviewWindow,
    controller: State<'_, GlassFullscreenController>,
    active: bool,
) -> Result<GlassFullscreenState, String> {
    apply_state(&window, &controller, active)?;
    Ok(controller.state())
}

fn apply_state(
    window: &tauri::WebviewWindow,
    controller: &GlassFullscreenController,
    active: bool,
) -> Result<(), String> {
    let native_fullscreen = window.is_fullscreen().map_err(|error| error.to_string())?;
    if native_fullscreen {
        controller.available.store(false, Ordering::SeqCst);
        if active {
            return Err("Cannot enable glass fullscreen while native fullscreen is active".into());
        }
        // Inactive simple fullscreen state must never toggle native fullscreen off.
        return Ok(());
    }

    let currently_active = controller.active.load(Ordering::SeqCst);
    if active == currently_active {
        return Ok(());
    }
    window
        .set_simple_fullscreen(active)
        .map_err(|error| error.to_string())?;
    controller.update(window, active, true);
    // Changing the titlebar style can leave the window's native responder in
    // place of WKWebView. Focus both layers so Esc reaches the web keyboard
    // handler immediately, without requiring a click after the transition.
    window.set_focus().map_err(|error| error.to_string())?;
    let webview: &tauri::Webview = window.as_ref();
    webview.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}
