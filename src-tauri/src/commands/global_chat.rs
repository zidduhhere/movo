use std::sync::Mutex;
use tauri::{State, AppHandle, Emitter};
use rusqlite::Connection;
use chrono::{Utc, Duration};
use uuid::Uuid;

use crate::models::{ChatMessage, ChatRole, Task, TaskStatus};
use crate::db::repository::Repository;
use crate::ai::openai::{OpenAiProvider, global_chat_tools};
use crate::AppState;

#[derive(serde::Serialize)]
pub struct GlobalChatResponse {
    pub message: ChatMessage,
    pub created_goal_ids: Vec<String>,
}

#[tauri::command]
pub async fn get_global_chat_history(
    conn: State<'_, Mutex<Connection>>,
    app_state: State<'_, AppState>,
) -> Result<Vec<ChatMessage>, String> {
    let user_id = app_state.current_user_id.lock().map_err(|e| e.to_string())?
        .clone().ok_or("Not logged in")?;
    let conn = conn.lock().map_err(|e| e.to_string())?;
    let repo = Repository::new(&conn);
    let goal_id = repo.get_or_create_global_goal(&user_id).map_err(|e| e.to_string())?;
    repo.get_messages_for_goal(&goal_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn global_chat(
    content: String,
    conn: State<'_, Mutex<Connection>>,
    app_state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<GlobalChatResponse, String> {
    let user_id = app_state.current_user_id.lock().map_err(|e| e.to_string())?
        .clone().ok_or("Not logged in")?;

    // Ensure sentinel goal exists, save user message, fetch history and context
    let now = Utc::now();
    let (global_goal_id, messages, prefs, events) = {
        let conn = conn.lock().map_err(|e| e.to_string())?;
        let repo = Repository::new(&conn);
        let goal_id = repo.get_or_create_global_goal(&user_id).map_err(|e| e.to_string())?;
        repo.add_message(&goal_id, ChatRole::User, &content).map_err(|e| e.to_string())?;
        let messages = repo.get_messages_for_goal(&goal_id).map_err(|e| e.to_string())?;
        let prefs = repo.get_user_preferences(&user_id).map_err(|e| e.to_string())?.unwrap_or_default();
        let four_weeks = now + Duration::weeks(4);
        let events = repo.get_events_in_range(&user_id, &now.to_rfc3339(), &four_weeks.to_rfc3339()).unwrap_or_default();
        (goal_id, messages, prefs, events)
    };

    let calendar_str = if events.is_empty() {
        "No upcoming events.".to_string()
    } else {
        events.iter().map(|e| {
            let label = e.goal_title.as_deref().map(|g| format!(" [{}]", g)).unwrap_or_default();
            format!("  • {} – {}: {}{}", e.start_time.get(..10).unwrap_or(&e.start_time), e.end_time.get(..10).unwrap_or(&e.end_time), e.title, label)
        }).collect::<Vec<_>>().join("\n")
    };

    let system_prompt = format!(
        "You are Movo — an intelligent AI Chief of Staff. You help users achieve their goals by managing tasks and schedules.\n\
         TODAY: {today} | WORK HOURS: {work_start}–{work_end} | DAYS OFF: {days_off}\n\
         \n\
         OCCUPIED SLOTS (next 4 weeks — never schedule here):\n\
         {calendar}\n\
         \n\
         RULES:\n\
         • Respond naturally to greetings and casual messages — do NOT create a project unless the user clearly describes a goal.\n\
         • Only call create_project when the user's intent is a clear, trackable goal.\n\
         • After create_project, immediately call create_task for each concrete next step, using the returned goal_id.\n\
         • Check OCCUPIED SLOTS before proposing dates. Warn on conflicts.\n\
         • Ask ONE clarifying question at a time when intent is unclear.\n\
         • When you need to ask a question or offer choices, use this exact JSON format:\n\
         \n\
```json\n\
{{\"type\":\"interactive_question\",\"question\":\"Your question?\",\"options\":[\"Option A\",\"Option B\"]}}\n\
```\n\
         • Present tables with Markdown.",
        today = now.format("%A, %B %d, %Y"),
        work_start = prefs.work_start,
        work_end = prefs.work_end,
        days_off = prefs.days_off,
        calendar = calendar_str,
    );

    let ai = OpenAiProvider::new()?;
    let (ai_text, tool_calls) = ai.chat_with_tools(&system_prompt, messages, global_chat_tools()).await?;

    let mut created_goal_ids: Vec<String> = Vec::new();

    {
        let conn = conn.lock().map_err(|e| e.to_string())?;
        let repo = Repository::new(&conn);

        for call in &tool_calls {
            match call.name.as_str() {
                "create_project" => {
                    let title = call.arguments["title"].as_str().unwrap_or("New Project");
                    let description = call.arguments["description"].as_str();
                    let target_date = call.arguments["target_date"].as_str();
                    let goal = repo.create_goal(&user_id, title, description, target_date)
                        .map_err(|e| e.to_string())?;
                    let _ = app_handle.emit("goal_created", &goal);
                    created_goal_ids.push(goal.id);
                }
                "create_task" => {
                    let goal_id = call.arguments["goal_id"].as_str().unwrap_or("").to_string();
                    if goal_id.is_empty() { continue; }
                    let title = call.arguments["title"].as_str().unwrap_or("New Task").to_string();
                    let description = call.arguments["description"].as_str().map(|s| s.to_string());
                    let effort_minutes = call.arguments["effort_minutes"].as_i64().unwrap_or(30) as i32;
                    let priority = call.arguments["priority"].as_i64().unwrap_or(3) as i32;
                    let deadline = call.arguments["deadline"].as_str().map(|s| s.to_string());
                    let task = Task {
                        id: Uuid::new_v4().to_string(),
                        goal_id: Some(goal_id),
                        title,
                        description,
                        status: TaskStatus::Todo,
                        effort_minutes,
                        priority,
                        created_at: Utc::now().to_rfc3339(),
                        deadline,
                    };
                    if let Err(e) = repo.add_task(&task) {
                        eprintln!("global_chat: failed to create task: {}", e);
                    }
                }
                "delete_task" => {
                    if let Some(task_id) = call.arguments["task_id"].as_str() {
                        if let Err(e) = repo.delete_task(task_id) {
                            eprintln!("global_chat: failed to delete task {}: {}", task_id, e);
                        }
                    }
                }
                "add_to_calendar" => {
                    let title = call.arguments["title"].as_str().unwrap_or("Event").to_string();
                    let start_time = call.arguments["start_time"].as_str().unwrap_or("").to_string();
                    let end_time = call.arguments["end_time"].as_str().unwrap_or("").to_string();
                    if !start_time.is_empty() && !end_time.is_empty() {
                        if let Ok(event) = repo.create_standalone_event(&user_id, &title, &start_time, &end_time) {
                            let _ = app_handle.emit("calendar_updated", &event);
                        }
                    }
                }
                _ => {}
            }
        }
    }

    let response_text = if !ai_text.is_empty() {
        ai_text
    } else if !tool_calls.is_empty() {
        "Done! I've set that up for you.".to_string()
    } else {
        "I'm not sure how to help with that.".to_string()
    };

    let ai_message = {
        let conn = conn.lock().map_err(|e| e.to_string())?;
        let repo = Repository::new(&conn);
        repo.add_message(&global_goal_id, ChatRole::Assistant, &response_text)
            .map_err(|e| e.to_string())?
    };

    Ok(GlobalChatResponse { message: ai_message, created_goal_ids })
}
