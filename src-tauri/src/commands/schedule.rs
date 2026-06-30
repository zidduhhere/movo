use tauri::State;
use std::sync::Mutex;
use rusqlite::Connection;
use crate::scheduler::engine::{schedule_goal as run_scheduler, ScheduleResult};

#[tauri::command]
pub fn schedule_goal(
    goal_id: String,
    conn: State<'_, Mutex<Connection>>,
) -> Result<ScheduleResult, String> {
    let conn_guard = conn.lock().map_err(|e| e.to_string())?;
    run_scheduler(&goal_id, &conn_guard)
}
