use tauri::{
    image::Image,
    menu::MenuBuilder,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Emitter, Manager, Runtime,
};

const TRAY_ID: &str = "display-layout-manager";
const STATUS_TITLE: &str = "Layouts";
const TRAY_ICON_SIZE: u32 = 32;
const ICON_TEMPLATE: [u8; 4] = [0, 0, 0, 255];

pub fn setup(app: &mut App) -> tauri::Result<()> {
    let menu = MenuBuilder::new(app.handle())
        .text("show", "Show Display Layout Manager")
        .separator()
        .text("refresh-displays", "Refresh Displays")
        .text("apply-current-layout", "Apply Current Layout")
        .separator()
        .text("quit", "Quit")
        .build()?;

    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_menu(Some(menu))?;
        tray.set_tooltip(Some("Display Layout Manager"))?;
        tray.set_title(Some(STATUS_TITLE))?;
        tray.set_icon_with_as_template(Some(menu_bar_icon()), true)?;
        tray.set_show_menu_on_left_click(true)?;
        tray.set_visible(true)?;
        tray.on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    } else {
        TrayIconBuilder::with_id(TRAY_ID)
            .tooltip("Display Layout Manager")
            .title(STATUS_TITLE)
            .icon(menu_bar_icon())
            .icon_as_template(true)
            .menu(&menu)
            .show_menu_on_left_click(true)
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    show_main_window(tray.app_handle());
                }
            })
            .build(app)?;
    }

    Ok(())
}

pub fn handle_menu_action<R: Runtime>(app: &AppHandle<R>, id: &str) {
    match id {
        "show" => show_main_window(app),
        "refresh-displays" => {
            let _ = app.emit("tray:refresh-displays", ());
            show_main_window(app);
        }
        "apply-current-layout" => {
            let _ = app.emit("tray:apply-current-layout", ());
            show_main_window(app);
        }
        "quit" => app.exit(0),
        _ => {}
    }
}

fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn menu_bar_icon() -> Image<'static> {
    let size = TRAY_ICON_SIZE as usize;
    let mut rgba = vec![0; size * size * 4];

    fill_rect(&mut rgba, size, 5, 6, 26, 8, ICON_TEMPLATE);
    fill_rect(&mut rgba, size, 5, 8, 7, 21, ICON_TEMPLATE);
    fill_rect(&mut rgba, size, 24, 8, 26, 21, ICON_TEMPLATE);
    fill_rect(&mut rgba, size, 5, 19, 26, 21, ICON_TEMPLATE);
    fill_rect(&mut rgba, size, 14, 22, 17, 26, ICON_TEMPLATE);
    fill_rect(&mut rgba, size, 10, 27, 21, 29, ICON_TEMPLATE);

    Image::new_owned(rgba, TRAY_ICON_SIZE, TRAY_ICON_SIZE)
}

fn fill_rect(
    rgba: &mut [u8],
    size: usize,
    left: usize,
    top: usize,
    right: usize,
    bottom: usize,
    color: [u8; 4],
) {
    for y in top..=bottom {
        for x in left..=right {
            if x < size && y < size {
                set_pixel(rgba, size, x, y, color);
            }
        }
    }
}

fn set_pixel(rgba: &mut [u8], size: usize, x: usize, y: usize, color: [u8; 4]) {
    let index = (y * size + x) * 4;
    rgba[index] = color[0];
    rgba[index + 1] = color[1];
    rgba[index + 2] = color[2];
    rgba[index + 3] = color[3];
}
