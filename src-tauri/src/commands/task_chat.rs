use std::sync::Mutex;
use tauri::{State, AppHandle, Emitter};
use rusqlite::Connection;
use chrono::{Utc, Duration};

use crate::models::{ChatMessage, ChatRole};
use crate::db::repository::{Repository, SubtaskInput};
use crate::ai::openai::{OpenAiProvider, task_chat_tools};
use crate::AppState;

#[derive(serde::Deserialize)]
pub struct HistoryMessage {
    pub role: String,
    pub content: String,
}

#[derive(serde::Serialize)]
pub struct TaskChatResponse {
    pub message: String,
    pub task_updated: bool,
}

#[tauri::command]
pub async fn task_chat(
    task_id: String,
    content: String,
    history: Vec<HistoryMessage>,
    conn: State<'_, Mutex<Connection>>,
    app_state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<TaskChatResponse, String> {
    let user_id = app_state.current_user_id.lock().map_err(|e| e.to_string())?
        .clone().ok_or("Not logged in")?;

    let (ctx, prefs, events) = {
        let conn = conn.lock().map_err(|e| e.to_string())?;
        let repo = Repository::new(&conn);
        let ctx = repo.get_task_with_goal_event(&task_id).map_err(|e| e.to_string())?;
        let prefs = repo.get_user_preferences(&user_id).map_err(|e| e.to_string())?.unwrap_or_default();
        let now = Utc::now();
        let four_weeks = now + Duration::weeks(4);
        let events = repo.get_events_in_range(&user_id, &now.to_rfc3339(), &four_weeks.to_rfc3339()).unwrap_or_default();
        (ctx, prefs, events)
    };

    let current_event_str = ctx.event.as_ref().map(|e| format!(
        "Currently scheduled: {} – {}",
        e.start_time.get(..16).unwrap_or(&e.start_time),
        e.end_time.get(..16).unwrap_or(&e.end_time),
    )).unwrap_or_else(|| "Not yet scheduled.".to_string());

    let calendar_str = if events.is_empty() {
        "No upcoming events.".to_string()
    } else {
        events.iter().map(|e| {
            let label = e.goal_title.as_deref().map(|g| format!(" [{}]", g)).unwrap_or_default();
            format!("  • {} – {}: {}{}",
                e.start_time.get(..16).unwrap_or(&e.start_time),
                e.end_time.get(..16).unwrap_or(&e.end_time),
                e.title, label)
        }).collect::<Vec<_>>().join("\n")
    };

    let system_prompt = format!(
        "You are Movo — a focused Task Assistant. You help the user manage ONE specific task.\n\
         TODAY: {today} | WORK HOURS: {work_start}–{work_end} | DAYS OFF: {days_off}\n\
         \n\
         TASK: \"{task_title}\"\n\
         GOAL: \"{goal_title}\"\n\
         EFFORT: {effort}min | PRIORITY: P{priority}{deadline_line}\n\
         {current_event}\n\
         \n\
         OCCUPIED SLOTS (next 4 weeks):\n\
         {calendar}\n\
         \n\
         RULES:\n\
         • Stay focused on this task only — do not discuss other goals.\n\
         • Check OCCUPIED SLOTS before proposing any new time.\n\
         • Use reschedule_task to move this task to a new slot.\n\
         • Use complete_task only when the user confirms the task is done.\n\
         • Use split_task to break this into subtasks when the task is too large.\n\
         • For interactive questions use: {{\"type\":\"interactive_question\",\"question\":\"?\",\"options\":[]}}",
        today = Utc::now().format("%A, %B %d, %Y"),
        work_start = prefs.work_start,
        work_end = prefs.work_end,
        days_off = prefs.days_off,
        task_title = ctx.task.title,
        goal_title = ctx.goal_title,
        effort = ctx.task.effort_minutes,
        priority = ctx.task.priority,
        deadline_line = ctx.task.deadline.as_deref().map(|d| format!(" | DEADLINE: {}", d)).unwrap_or_default(),
        current_event = current_event_str,
        calendar = calendar_str,
    );

    // Build message history for the AI
    let mut messages: Vec<ChatMessage> = history.into_iter().enumerate().map(|(i, h)| {
        let role = if h.role == "user" { ChatRole::User } else { ChatRole::Assistant };
        ChatMessage {
            id: format!("hist-{}", i),
            goal_id: task_id.clone(),
            role,
            content: h.content,
            created_at: String::new(),
        }
    }).collect();
    // Append current user message
    messages.push(ChatMessage {
        id: "current".to_string(),
        goal_id: task_id.clone(),
        role: ChatRole::User,
        content: content.clone(),
        created_at: Utc::now().to_rfc3339(),
    });

    let ai = OpenAiProvider::new()?;
    let (ai_text, tool_calls) = ai.chat_with_tools(&system_prompt, messages, task_chat_tools()).await?;

    let mut task_updated = false;

    {
        let conn = conn.lock().map_err(|e| e.to_string())?;
        let repo = Repository::new(&conn);

        for call in &tool_calls {
            match call.name.as_str() {
                "reschedule_task" => {
                    let new_start = call.arguments["new_start"].as_str().unwrap_or("");
                    let new_end   = call.arguments["new_end"].as_str().unwrap_or("");
                    if !new_start.is_empty() && !new_end.is_empty() {
                        if let Ok(event) = repo.reschedule_task_event(&user_id, &task_id, &ctx.task.title, new_start, new_end) {
                            let _ = app_handle.emit("calendar_updated", &event);
                            task_updated = true;
                        }
                    }
                }
                "complete_task" => {
                    if repo.update_task_status(&task_id, "completed").is_ok() {
                        task_updated = true;
                    }
                }
                "split_task" => {
                    if let Some(arr) = call.arguments["subtasks"].as_array() {
                        let subtasks: Vec<SubtaskInput> = arr.iter()
                            .filter_map(|v| serde_json::from_value(v.clone()).ok())
                            .collect();
                        if !subtasks.is_empty() {
                            if repo.split_into_subtasks(&task_id, &subtasks).is_ok() {
                                task_updated = true;
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }

    let response_text = if ai_text.is_empty() && !tool_calls.is_empty() {
        "Done!".to_string()
    } else {
        ai_text
    };

    Ok(TaskChatResponse { message: response_text, task_updated })
}
