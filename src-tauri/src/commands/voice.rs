use tauri::{AppHandle, State, Emitter, Manager};
use std::sync::Mutex;
use rusqlite::Connection;
use serde_json::json;
use uuid::Uuid;
use chrono::Utc;

use crate::AppState;
use crate::models::UserPreferences;
use crate::ai::openai::OpenAiProvider;

fn normalize_to_utc(s: &str) -> String {
    use chrono::{DateTime, NaiveDateTime, TimeZone};
    // Try RFC 3339 / ISO 8601 with offset first
    if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
        return dt.with_timezone(&Utc).to_rfc3339();
    }
    // Fall back: treat naive datetime as UTC (AI schedules in user's work hours,
    // and we have no user TZ — UTC is at least internally consistent)
    if let Ok(ndt) = NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S") {
        return Utc.from_utc_datetime(&ndt).to_rfc3339();
    }
    s.to_string()
}

#[tauri::command]
pub async fn open_mic_settings(app_handle: AppHandle) -> Result<(), String> {
    open_privacy_settings(app_handle, "Privacy_Microphone".into()).await
}

#[tauri::command]
pub async fn open_privacy_settings(app_handle: AppHandle, section: String) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;
    let url = format!(
        "x-apple.systempreferences:com.apple.preference.security?{}",
        section
    );
    app_handle
        .shell()
        .open(&url, None)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn voice_capture_plan(
    text: String,
    conn: State<'_, Mutex<Connection>>,
    app_state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<String, String> {
    // 1. Get current user
    let user_id = app_state
        .current_user_id
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or("Not logged in. Open Movo and log in first.")?;

    // 2. Load user preferences (use defaults if not set)
    let prefs = {
        let conn_guard = conn.lock().map_err(|e| e.to_string())?;
        let repo = crate::db::repository::Repository::new(&conn_guard);
        repo.get_user_preferences(&user_id)
            .map_err(|e| e.to_string())?
            .unwrap_or_else(|| UserPreferences {
                user_id: user_id.clone(),
                ..UserPreferences::default()
            })
    };

    // 3. Call OpenAI to decompose the voice input into goal + tasks + events
    let ai = OpenAiProvider::new()?;

    let today = Utc::now().format("%Y-%m-%d").to_string();
    let system_prompt = format!(
        "You are an AI Chief of Staff. The user spoke: \"{text}\"\n\
         Today is {today}. \
         User works {work_start}–{work_end}, prefers {block_mins}-minute focus blocks, \
         days off: {days_off}.\n\
         Create a goal with a clear title and description, then decompose it into tasks. \
         Schedule a time block for each task starting from tomorrow, \
         respecting work hours and days off. \
         Use ISO 8601 format for all dates and datetimes.",
        text = text,
        today = today,
        work_start = prefs.work_start,
        work_end = prefs.work_end,
        block_mins = prefs.focus_block_mins,
        days_off = prefs.days_off,
    );

    // Responses API format: name/description/parameters at top level, no `function` wrapper
    let planning_tools = json!([
        {
            "type": "function",
            "name": "create_goal",
            "description": "Create the main goal",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": { "type": "string" },
                    "description": { "type": "string" },
                    "target_date": { "type": ["string", "null"], "description": "ISO 8601 date e.g. 2026-09-01" }
                },
                "required": ["title", "description"]
            }
        },
        {
            "type": "function",
            "name": "create_task",
            "description": "Create a task for the goal",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": { "type": "string" },
                    "description": { "type": ["string", "null"] },
                    "effort_minutes": { "type": "integer" },
                    "priority": { "type": "integer", "minimum": 1, "maximum": 5 },
                    "deadline": { "type": ["string", "null"] },
                    "start_time": { "type": "string", "description": "ISO 8601 datetime for the scheduled block" },
                    "end_time": { "type": "string", "description": "ISO 8601 datetime for end of the scheduled block" }
                },
                "required": ["title", "effort_minutes", "priority", "start_time", "end_time"]
            }
        }
    ]);

    let (_, tool_calls) = ai
        .chat_with_tools(&system_prompt, vec![], planning_tools)
        .await?;

    // 4. Persist goal → tasks → events in one DB lock
    let goal_id = {
        let conn_guard = conn.lock().map_err(|e| e.to_string())?;

        let mut goal_id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        for call in &tool_calls {
            match call.name.as_str() {
                "create_goal" => {
                    let title = call.arguments["title"]
                        .as_str()
                        .unwrap_or("New Goal")
                        .to_string();
                    let description = call.arguments["description"]
                        .as_str()
                        .map(|s| s.to_string());
                    let target_date = call.arguments["target_date"]
                        .as_str()
                        .map(|s| s.to_string());

                    goal_id = Uuid::new_v4().to_string();
                    conn_guard.execute(
                        "INSERT INTO goals (id, user_id, title, description, status, created_at, target_date)
                         VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?6)",
                        rusqlite::params![
                            goal_id, user_id, title, description, now, target_date
                        ],
                    ).map_err(|e| e.to_string())?;
                }
                "create_task" => {
                    let task_id = Uuid::new_v4().to_string();
                    let title = call.arguments["title"]
                        .as_str()
                        .unwrap_or("Task")
                        .to_string();
                    let description = call.arguments["description"]
                        .as_str()
                        .map(|s| s.to_string());
                    let effort_minutes = call.arguments["effort_minutes"]
                        .as_i64()
                        .unwrap_or(60) as i32;
                    let priority = call.arguments["priority"]
                        .as_i64()
                        .unwrap_or(3) as i32;
                    let deadline = call.arguments["deadline"]
                        .as_str()
                        .map(|s| s.to_string());
                    let start_time = normalize_to_utc(
                        call.arguments["start_time"].as_str().unwrap_or("")
                    );
                    let end_time = normalize_to_utc(
                        call.arguments["end_time"].as_str().unwrap_or("")
                    );

                    conn_guard.execute(
                        "INSERT INTO tasks (id, goal_id, title, description, status, effort_minutes, priority, created_at, deadline)
                         VALUES (?1, ?2, ?3, ?4, 'todo', ?5, ?6, ?7, ?8)",
                        rusqlite::params![
                            task_id, goal_id, title, description,
                            effort_minutes, priority, now, deadline
                        ],
                    ).map_err(|e| e.to_string())?;

                    if !start_time.is_empty() && !end_time.is_empty() {
                        let event_id = Uuid::new_v4().to_string();
                        conn_guard.execute(
                            "INSERT INTO events (id, task_id, title, start_time, end_time, status)
                             VALUES (?1, ?2, ?3, ?4, ?5, 'scheduled')",
                            rusqlite::params![
                                event_id, task_id, title, start_time, end_time
                            ],
                        ).map_err(|e| e.to_string())?;
                    }
                }
                _ => {}
            }
        }

        goal_id
    };

    // 5. Open and focus the main window, emit navigation event
    if let Some(main_window) = app_handle.get_webview_window("main") {
        let _ = main_window.show();
        let _ = main_window.set_focus();
        let _ = main_window.emit("navigate_to_goal", goal_id.clone());
    }

    Ok(goal_id)
}
