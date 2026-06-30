use std::sync::Mutex;
use tauri::{State, AppHandle, Emitter};
use rusqlite::Connection;
use chrono::Utc;
use crate::models::{ChatMessage, ChatRole, Task, TaskStatus};
use crate::db::repository::Repository;
use crate::ai::openai::{OpenAiProvider, chat_tools};
use crate::AppState;
use uuid::Uuid;

#[tauri::command]
pub async fn get_chat_history(
    goal_id: String,
    conn: State<'_, Mutex<Connection>>,
) -> Result<Vec<ChatMessage>, String> {
    let conn_guard = conn.lock().map_err(|e| e.to_string())?;
    let repo = Repository::new(&conn_guard);
    repo.get_messages_for_goal(&goal_id).map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
pub struct ChatResponse {
    pub message: ChatMessage,
    pub tasks: Vec<Task>,
}

#[tauri::command]
pub async fn chat_with_ai(
    goal_id: String,
    content: String,
    conn: State<'_, Mutex<Connection>>,
    app_state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<ChatResponse, String> {
    let (messages, goal_title, user_id, current_tasks) = {
        let conn_guard = conn.lock().map_err(|e| e.to_string())?;
        let repo = Repository::new(&conn_guard);

        repo.add_message(&goal_id, ChatRole::User, &content)
            .map_err(|e| e.to_string())?;

        let messages = repo.get_messages_for_goal(&goal_id)
            .map_err(|e| e.to_string())?;

        let (goal_title, user_id) = conn_guard
            .query_row(
                "SELECT title, user_id FROM goals WHERE id = ?1",
                rusqlite::params![&goal_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .unwrap_or_else(|_| (String::new(), String::new()));

        let current_tasks = repo.get_tasks_by_goal(&goal_id)
            .map_err(|e| e.to_string())?;

        (messages, goal_title, user_id, current_tasks)
    };

    // Load user preferences
    let prefs_line = {
        let conn_guard = conn.lock().map_err(|e| e.to_string())?;
        let repo = Repository::new(&conn_guard);
        if let Ok(Some(p)) = repo.get_user_preferences(&user_id) {
            format!(
                "Work hours: {}–{}, focus blocks: {} min, days off: {}",
                p.work_start, p.work_end, p.focus_block_mins, p.days_off
            )
        } else {
            "Work hours: 9:00–18:00, days off: Saturday, Sunday".to_string()
        }
    };

    // Load upcoming calendar events as occupied slots
    let calendar_context = {
        let conn_guard = conn.lock().map_err(|e| e.to_string())?;
        let repo = Repository::new(&conn_guard);
        let now = Utc::now();
        let two_weeks = now + chrono::Duration::weeks(2);
        let events = repo
            .get_events_in_range(&user_id, &now.to_rfc3339(), &two_weeks.to_rfc3339())
            .unwrap_or_default();
        if events.is_empty() {
            "No upcoming events.".to_string()
        } else {
            events
                .iter()
                .map(|e| {
                    let label = e.goal_title.as_deref()
                        .map(|g| format!(" [{}]", g))
                        .unwrap_or_default();
                    format!("  • {} – {}: {}{}", e.start_time, e.end_time, e.title, label)
                })
                .collect::<Vec<_>>()
                .join("\n")
        }
    };

    let _ = app_state; // user_id sourced from goals table
    let ai = OpenAiProvider::new()?;
    let current_tasks_json = serde_json::to_string(&current_tasks).unwrap_or_default();

    let system_prompt = format!(
        "You are Movo — an intelligent AI Chief of Staff.\n\
         TODAY: {today} | SCHEDULE: {prefs} | GOAL: '{goal}'\n\
         \n\
         OCCUPIED SLOTS (next 2 weeks — never schedule here):\n\
         {calendar}\n\
         CURRENT TASKS: {tasks}\n\
         \n\
         ══════════════════════════════════════════════════\n\
         RULE #1 — QUESTIONS MUST USE THIS JSON FORMAT:\n\
         ══════════════════════════════════════════════════\n\
         Whenever you need to ask a question or offer choices, output EXACTLY this JSON block.\n\
         NEVER write the question as prose. NEVER use bullet points or numbered lists for questions.\n\
         NEVER write a table of 'what I need to know'. Just output the JSON block:\n\
\n\
```json\n\
{{\n\
  \"type\": \"interactive_question\",\n\
  \"question\": \"Your single question here?\",\n\
  \"options\": [\"Option A\", \"Option B\", \"Option C\"]\n\
}}\n\
```\n\
\n\
         Keep options to 3–5. You may write ONE short sentence before the block for context — nothing more.\n\
         ══════════════════════════════════════════════════\n\
         \n\
         OTHER RULES:\n\
         • Ask ONE question at a time. Never dump questions or requirements lists.\n\
         • Only call create_task once you clearly understand what needs to be done.\n\
         • Check OCCUPIED SLOTS before scheduling. Warn on conflicts and suggest alternatives.\n\
         • Create specific, actionable tasks — never meta-tasks like 'identify dates' or 'check calendar'.\n\
         • Respect work hours and days off.\n\
         • Present schedules or data as Markdown tables.",
        today = Utc::now().format("%A, %B %d, %Y"),
        prefs = prefs_line,
        goal = goal_title,
        calendar = calendar_context,
        tasks = current_tasks_json
    );

    let (ai_text, tool_calls) = ai
        .chat_with_tools(&system_prompt, messages, chat_tools())
        .await?;

    // Execute tool calls and detect conflicts
    let mut pending_conflicts: Vec<(String, String)> = Vec::new(); // (task_title, deadline)

    {
        let conn_guard = conn.lock().map_err(|e| e.to_string())?;
        let repo = Repository::new(&conn_guard);

        for call in &tool_calls {
            match call.name.as_str() {
                "create_task" => {
                    let title = call.arguments["title"]
                        .as_str()
                        .unwrap_or("New Task")
                        .to_string();
                    let description = call.arguments["description"]
                        .as_str()
                        .map(|s| s.to_string());
                    let effort_minutes = call.arguments["effort_minutes"]
                        .as_i64()
                        .unwrap_or(30) as i32;
                    let priority = call.arguments["priority"]
                        .as_i64()
                        .unwrap_or(3) as i32;
                    let deadline = call.arguments["deadline"]
                        .as_str()
                        .map(|s| s.to_string());

                    // Check if deadline conflicts with existing calendar events
                    if let Some(ref dl) = deadline {
                        let date_part = &dl[..dl.len().min(10)];
                        let day_start = format!("{}T00:00:00Z", date_part);
                        let day_end = format!("{}T23:59:59Z", date_part);
                        if let Ok(conflicts) = repo.get_events_in_range(&user_id, &day_start, &day_end) {
                            if !conflicts.is_empty() {
                                pending_conflicts.push((title.clone(), dl.clone()));
                                // Emit conflict immediately with details
                                let _ = app_handle.emit("calendar_conflict", serde_json::json!({
                                    "task_title": title,
                                    "deadline": dl,
                                    "conflicting_events": conflicts,
                                }));
                            }
                        }
                    }

                    let task = Task {
                        id: Uuid::new_v4().to_string(),
                        goal_id: Some(goal_id.clone()),
                        title,
                        description,
                        status: TaskStatus::Todo,
                        effort_minutes,
                        priority,
                        created_at: chrono::Utc::now().to_rfc3339(),
                        deadline,
                    };
                    let _ = repo.add_task(&task);
                }
                "delete_task" => {
                    if let Some(task_id) = call.arguments["task_id"].as_str() {
                        let _ = repo.delete_task(task_id);
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

    let response_text = if ai_text.is_empty() && !tool_calls.is_empty() {
        let conflict_note = if !pending_conflicts.is_empty() {
            format!(
                "\n\n⚠️ Heads up: {} task(s) have deadlines that conflict with existing calendar events. Check the calendar for details.",
                pending_conflicts.len()
            )
        } else {
            String::new()
        };
        format!("Done! I've updated {} task(s).{}", tool_calls.len(), conflict_note)
    } else {
        ai_text
    };

    let (assistant_msg, final_tasks) = {
        let conn_guard = conn.lock().map_err(|e| e.to_string())?;
        let repo = Repository::new(&conn_guard);
        let msg = repo
            .add_message(&goal_id, ChatRole::Assistant, &response_text)
            .map_err(|e| e.to_string())?;
        let final_tasks = repo.get_tasks_by_goal(&goal_id).unwrap_or_default();
        (msg, final_tasks)
    };

    Ok(ChatResponse {
        message: assistant_msg,
        tasks: final_tasks,
    })
}
