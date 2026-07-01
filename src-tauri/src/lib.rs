pub mod db;
pub mod models;
pub mod commands;
pub mod ai;
pub mod scheduler;

use std::sync::Mutex;
use std::collections::HashSet;
use tauri::Manager;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState};
use tauri_plugin_positioner::{Position, WindowExt};

pub struct AppState {
    pub current_user_id: Mutex<Option<String>>,
    pub notified_event_ids: Mutex<HashSet<String>>,
    pub notified_deadline_task_ids: Mutex<HashSet<String>>,
    pub last_daily_summary_date: Mutex<Option<String>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_liquid_glass::init())
        .manage(AppState {
            current_user_id: Mutex::new(None),
            notified_event_ids: Mutex::new(HashSet::new()),
            notified_deadline_task_ids: Mutex::new(HashSet::new()),
            last_daily_summary_date: Mutex::new(None),
        })
        .setup(|app| {
            dotenvy::dotenv().ok();

            let conn = db::connection::init_db(app.handle())
                .expect("Failed to initialize database");
            app.manage(Mutex::new(conn));

            // Native macOS menu bar tray
            let open_item  = MenuItemBuilder::with_id("open_movo",    "Open Movo").build(app)?;
            let voice_item = MenuItemBuilder::with_id("voice_input",  "🎤 Voice Input").build(app)?;
            let separator  = PredefinedMenuItem::separator(app)?;
            let quit_item  = MenuItemBuilder::with_id("quit",         "Quit Movo").build(app)?;

            let menu = MenuBuilder::new(app)
                .items(&[&open_item, &voice_item, &separator, &quit_item])
                .build()?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open_movo" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    "voice_input" => {
                        if let Some(win) = app.get_webview_window("voice_popup") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    // Left-click toggles the tray task popup
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event {
                        let app = tray.app_handle();
                        if let Some(popup) = app.get_webview_window("tray_popup") {
                            let visible = popup.is_visible().unwrap_or(false);
                            if visible {
                                let _ = popup.hide();
                            } else {
                                // Size and position before showing to avoid a visible flash
                                let monitor = app.primary_monitor()
                                    .ok().flatten()
                                    .or_else(|| popup.current_monitor().ok().flatten());
                                if let Some(monitor) = monitor {
                                    let scale = monitor.scale_factor();
                                    let screen_w = monitor.size().width as f64 / scale;
                                    let screen_h = monitor.size().height as f64 / scale;
<<<<<<< HEAD
=======
                                    
>>>>>>> 28cb24e (feat(tray): rewrite tray popup as inline chat panel)
                                    let width = 420.0;
                                    let height = 420.0;
                                    let _ = popup.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }));
                                    let x = (screen_w - width) / 2.0;
                                    let bottom_margin = screen_h * 0.15;
                                    let y = screen_h - height - bottom_margin;
                                    let _ = popup.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));
                                }
                                let _ = popup.show();
                                let _ = popup.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::goals::create_goal,
            commands::goals::get_active_goals,
            commands::goals::delete_goal,
            commands::tasks::get_tasks_by_goal,
            commands::tasks::get_all_tasks,
            commands::auth::register_user,
            commands::auth::login_user,
            commands::auth::update_user_profile,
            commands::auth::delete_account,
            commands::auth::logout_session,
            commands::global_chat::global_chat,
            commands::global_chat::get_global_chat_history,
            commands::task_chat::task_chat,
            commands::preferences::get_user_preferences,
            commands::preferences::save_user_preferences,
            commands::calendar::get_events_in_range,
            commands::calendar::create_event,
            commands::voice::voice_capture_plan,
            commands::voice::open_mic_settings,
            commands::voice::open_privacy_settings,
            commands::notifications::check_and_send_notifications,
            commands::tray::get_tray_tasks,
            commands::tasks::update_task_status,
            commands::recommendations::get_next_action,
            commands::recommendations::get_goal_stats,
            commands::recommendations::check_missed_sessions,
            commands::schedule::schedule_goal,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
