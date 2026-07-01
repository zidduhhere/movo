use tauri::State;
use std::sync::Mutex;
use rusqlite::Connection;
use serde::{Serialize, Deserialize};
use chrono::Utc;
use crate::AppState;
use crate::db::repository::Repository;
use crate::models::Task;
use crate::scheduler::priority::score_task;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScoredTask {
    pub id: String,
    pub goal_id: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub priority: i32,
    pub effort_minutes: i32,
    pub deadline: Option<String>,
    pub score: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NextAction {
    pub task: ScoredTask,
    pub reason: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GoalStat {
    pub goal_id: String,
    pub completed: i64,
    pub total: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MissedSession {
    pub task_id: String,
    pub task_title: String,
    pub goal_id: String,
    pub goal_title: String,
}

fn build_reason(task: &Task) -> String {
    let now = Utc::now().date_naive();

    if let Some(dl_str) = &task.deadline {
        let deadline_date = if let Ok(d) = chrono::NaiveDate::parse_from_str(dl_str, "%Y-%m-%d") {
            Some(d)
        } else if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(dl_str) {
            Some(dt.date_naive())
        } else {
            None
        };

        if let Some(dl) = deadline_date {
            let days = (dl - now).num_days();
            return match days {
                d if d < 0 => format!("Overdue by {} day{} · complete this now", d.abs(), if d.abs() == 1 { "" } else { "s" }),
                0 => "Due today · top priority".to_string(),
                1 => format!("Due tomorrow · Priority {} task", task.priority),
                2..=6 => format!("Due in {} days · Priority {}", days, task.priority),
                _ => format!("Priority {} task · {}-min effort block", task.priority, task.effort_minutes),
            };
        }
    }

    match task.priority {
        1 => "Your highest-priority task right now".to_string(),
        2 => "High priority · best use of your time".to_string(),
        _ => format!("Recommended based on priority and effort ({} min)", task.effort_minutes),
    }
}

#[tauri::command]
pub fn get_next_action(
    conn: State<'_, Mutex<Connection>>,
    app_state: State<'_, AppState>,
) -> Result<Option<NextAction>, String> {
    let user_id = app_state
        .current_user_id
        .lock().map_err(|e| e.to_string())?
        .clone()
        .ok_or("Not logged in")?;

    let conn_guard = conn.lock().map_err(|e| e.to_string())?;
    let repo = Repository::new(&conn_guard);
    let tasks = repo.get_todos_for_user(&user_id).map_err(|e| e.to_string())?;

    if tasks.is_empty() {
        return Ok(None);
    }

    let best = tasks
        .iter()
        .map(|t| (t, score_task(t)))
        .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));

    Ok(best.map(|(task, score)| NextAction {
        reason: build_reason(task),
        task: ScoredTask {
            id: task.id.clone(),
            goal_id: task.goal_id.clone(),
            title: task.title.clone(),
            description: task.description.clone(),
            priority: task.priority,
            effort_minutes: task.effort_minutes,
            deadline: task.deadline.clone(),
            score,
        },
    }))
}

#[tauri::command]
pub fn get_goal_stats(
    conn: State<'_, Mutex<Connection>>,
    app_state: State<'_, AppState>,
) -> Result<Vec<GoalStat>, String> {
    let user_id = app_state
        .current_user_id
        .lock().map_err(|e| e.to_string())?
        .clone()
        .ok_or("Not logged in")?;

    let conn_guard = conn.lock().map_err(|e| e.to_string())?;
    let repo = Repository::new(&conn_guard);
    let counts = repo.get_goal_task_counts(&user_id).map_err(|e| e.to_string())?;

    Ok(counts.into_iter().map(|(goal_id, completed, total)| GoalStat { goal_id, completed, total }).collect())
}

#[tauri::command]
pub fn check_missed_sessions(
    conn: State<'_, Mutex<Connection>>,
    app_state: State<'_, AppState>,
) -> Result<Vec<MissedSession>, String> {
    let user_id = app_state
        .current_user_id
        .lock().map_err(|e| e.to_string())?
        .clone()
        .ok_or("Not logged in")?;

    let conn_guard = conn.lock().map_err(|e| e.to_string())?;
    let repo = Repository::new(&conn_guard);
    let prefs = repo.get_user_preferences(&user_id).map_err(|e| e.to_string())?.unwrap_or_default();
    if !prefs.notify_missed_sessions {
        return Ok(Vec::new());
    }
    let rows = repo.get_missed_sessions(&user_id).map_err(|e| e.to_string())?;

    Ok(rows.into_iter().map(|(task, goal_title)| MissedSession {
        task_id: task.id,
        task_title: task.title,
        goal_id: task.goal_id.unwrap_or_default(),
        goal_title,
    }).collect())
}
