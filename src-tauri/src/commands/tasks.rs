use tauri::State;
use std::sync::Mutex;
use rusqlite::Connection;
use crate::models::Task;
use crate::db::repository::Repository;

#[tauri::command]
pub fn get_tasks_by_goal(goal_id: String, conn: State<'_, Mutex<Connection>>) -> Result<Vec<Task>, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    let repo = Repository::new(&conn);
    repo.get_tasks_by_goal(&goal_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_all_tasks(user_id: String, conn: State<'_, Mutex<Connection>>) -> Result<Vec<Task>, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    let repo = Repository::new(&conn);
    repo.get_all_tasks(&user_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_task_status(id: String, status: String, conn: State<'_, Mutex<Connection>>) -> Result<(), String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    let repo = Repository::new(&conn);
    repo.update_task_status(&id, &status).map_err(|e| e.to_string())
}
