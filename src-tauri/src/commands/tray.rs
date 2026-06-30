use tauri::State;
use std::sync::Mutex;
use rusqlite::Connection;
use serde::{Serialize, Deserialize};
use crate::AppState;
use crate::db::repository::Repository;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TrayTask {
    pub id: String,
    pub goal_id: String,
    pub title: String,
    pub priority: i32,
    pub deadline: Option<String>,
    pub status: String,
    pub goal_title: String,
}

#[tauri::command]
pub fn get_tray_tasks(
    conn: State<'_, Mutex<Connection>>,
    app_state: State<'_, AppState>,
) -> Result<Vec<TrayTask>, String> {
    let user_id = app_state
        .current_user_id
        .lock().map_err(|e| e.to_string())?
        .clone()
        .ok_or("Not logged in")?;

    let conn_guard = conn.lock().map_err(|e| e.to_string())?;
    let repo = Repository::new(&conn_guard);
    let rows = repo.get_active_tasks_with_goals(&user_id).map_err(|e| e.to_string())?;

    Ok(rows.into_iter().map(|(t, goal_title)| TrayTask {
        id: t.id,
        goal_id: t.goal_id.unwrap_or_default(),
        title: t.title,
        priority: t.priority,
        deadline: t.deadline,
        status: format!("{:?}", t.status).to_lowercase(),
        goal_title,
    }).collect())
}
