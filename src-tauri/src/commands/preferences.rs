use tauri::State;
use std::sync::Mutex;
use rusqlite::Connection;
use crate::db::repository::Repository;
use crate::models::UserPreferences;
use crate::AppState;

#[tauri::command]
pub fn get_user_preferences(
    conn: State<'_, Mutex<Connection>>,
    app_state: State<'_, AppState>,
) -> Result<Option<UserPreferences>, String> {
    let user_id = app_state
        .current_user_id
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or("Not logged in")?;
    let conn = conn.lock().map_err(|e| e.to_string())?;
    let repo = Repository::new(&conn);
    repo.get_user_preferences(&user_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_user_preferences(
    work_start: String,
    work_end: String,
    focus_block_mins: i32,
    days_off: String,
    buffer_minutes: Option<i32>,
    focus_start: Option<String>,
    focus_end: Option<String>,
    conn: State<'_, Mutex<Connection>>,
    app_state: State<'_, AppState>,
) -> Result<UserPreferences, String> {
    let user_id = app_state
        .current_user_id
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or("Not logged in")?;
    let prefs = UserPreferences {
        user_id: user_id.clone(),
        work_start,
        work_end,
        focus_block_mins,
        days_off,
        buffer_minutes: buffer_minutes.unwrap_or(10),
        focus_start,
        focus_end,
    };
    let conn = conn.lock().map_err(|e| e.to_string())?;
    let repo = Repository::new(&conn);
    repo.save_user_preferences(&prefs).map_err(|e| e.to_string())?;
    Ok(prefs)
}
