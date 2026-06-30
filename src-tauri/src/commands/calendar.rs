use tauri::State;
use std::sync::Mutex;
use rusqlite::Connection;
use crate::db::repository::Repository;
use crate::models::CalendarEvent;
use crate::AppState;

#[tauri::command]
pub fn get_events_in_range(
    from: String,
    to: String,
    conn: State<'_, Mutex<Connection>>,
    app_state: State<'_, AppState>,
) -> Result<Vec<CalendarEvent>, String> {
    let user_id = app_state
        .current_user_id
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or("Not logged in")?;
    let conn = conn.lock().map_err(|e| e.to_string())?;
    let repo = Repository::new(&conn);
    repo.get_events_in_range(&user_id, &from, &to)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_event(
    title: String,
    start_time: String,
    end_time: String,
    conn: State<'_, Mutex<Connection>>,
    app_state: State<'_, AppState>,
) -> Result<CalendarEvent, String> {
    let user_id = app_state
        .current_user_id
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or("Not logged in")?;
    let conn = conn.lock().map_err(|e| e.to_string())?;
    let repo = Repository::new(&conn);
    repo.create_standalone_event(&user_id, &title, &start_time, &end_time)
        .map_err(|e| e.to_string())
}
