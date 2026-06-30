use tauri::State;
use std::sync::Mutex;
use rusqlite::Connection;
use crate::models::Goal;
use crate::db::repository::Repository;

#[tauri::command]
pub fn create_goal(
    user_id: String,
    title: String,
    description: Option<String>,
    target_date: Option<String>,
    conn: State<'_, Mutex<Connection>>,
) -> Result<Goal, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    let repo = Repository::new(&conn);
    repo.create_goal(&user_id, &title, description.as_deref(), target_date.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_active_goals(user_id: String, conn: State<'_, Mutex<Connection>>) -> Result<Vec<Goal>, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    let repo = Repository::new(&conn);
    repo.get_active_goals(&user_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_goal(id: String, conn: State<'_, Mutex<Connection>>) -> Result<(), String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    let repo = Repository::new(&conn);
    repo.delete_goal(&id).map_err(|e| e.to_string())
}
