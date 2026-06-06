use tauri::{
    menu::{MenuBuilder, SubmenuBuilder},
    App,
};

pub fn setup(app: &mut App) -> tauri::Result<()> {
    let app_menu = SubmenuBuilder::new(app, "Display Layout Manager")
        .text("show", "Show Window")
        .separator()
        .text("quit", "Quit Display Layout Manager")
        .build()?;

    let display_menu = SubmenuBuilder::new(app, "Displays")
        .text("refresh-displays", "Refresh Displays")
        .text("apply-current-layout", "Apply Current Layout")
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .text("show", "Show Window")
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &display_menu, &view_menu])
        .build()?;

    app.set_menu(menu)?;
    Ok(())
}
