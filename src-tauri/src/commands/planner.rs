use tauri::{State, Emitter, AppHandle};
use std::sync::Mutex;
use rusqlite::Connection;
use chrono::Utc;
use crate::models::{Task, ChatRole};
use crate::db::repository::Repository;
use crate::ai::openai::OpenAiProvider;

#[tauri::command]
pub async fn plan_goal(
    goal_id: String,
    conn: State<'_, Mutex<Connection>>,
    app_handle: AppHandle,
) -> Result<Vec<Task>, String> {

    let _ = app_handle.emit("planning-status", "Getting to know your goal...");

    let (goal_title, user_id) = {
        let conn_guard = conn.lock().map_err(|e| e.to_string())?;
        conn_guard
            .query_row(
                "SELECT title, user_id FROM goals WHERE id = ?1",
                rusqlite::params![&goal_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .map_err(|_| "Goal not found".to_string())?
    };

    // Load user preferences + upcoming events for context
    let (prefs_context, calendar_context) = {
        let conn_guard = conn.lock().map_err(|e| e.to_string())?;
        let repo = Repository::new(&conn_guard);

        let prefs_ctx = if let Ok(Some(p)) = repo.get_user_preferences(&user_id) {
            format!(
                "Work hours: {}–{}, focus blocks: {} min, days off: {}",
                p.work_start, p.work_end, p.focus_block_mins, p.days_off
            )
        } else {
            "Work hours: 9:00–18:00, days off: Saturday, Sunday".to_string()
        };

        let now = Utc::now();
        let two_weeks = now + chrono::Duration::weeks(2);
        let events = repo
            .get_events_in_range(&user_id, &now.to_rfc3339(), &two_weeks.to_rfc3339())
            .unwrap_or_default();

        let cal_ctx = if events.is_empty() {
            "No upcoming events in the next 2 weeks.".to_string()
        } else {
            events
                .iter()
                .map(|e| format!("  • {} – {}: {}", e.start_time, e.end_time, e.title))
                .collect::<Vec<_>>()
                .join("\n")
        };

        (prefs_ctx, cal_ctx)
    };

    let _ = app_handle.emit("planning-status", "Preparing your Chief of Staff...");

    let ai = OpenAiProvider::new()?;
    let system = format!(
        "You are Movo, an intelligent AI Chief of Staff. Today is {}.\n\
         {}\n\
         Upcoming calendar:\n{}\n\n\
         The user just created a new goal. Ask ONE concise clarifying question with 3–4 answer options.\n\
         You MUST respond using ONLY this JSON block — no prose, no bullet lists, no tables:\n\
\n\
```json\n\
{{\n\
  \"type\": \"interactive_question\",\n\
  \"question\": \"Your single question here?\",\n\
  \"options\": [\"Option A\", \"Option B\", \"Option C\"]\n\
}}\n\
```\n\
\n\
         Do NOT create tasks. Do NOT list requirements. Just output the JSON block above.",
        Utc::now().format("%A, %B %d, %Y"),
        prefs_context,
        calendar_context
    );

    let user_message = format!("I just created a new goal: {}", goal_title);

    let opening_question = ai
        .chat(
            &system,
            vec![crate::models::ChatMessage {
                id: String::new(),
                goal_id: goal_id.clone(),
                role: ChatRole::User,
                content: user_message.clone(),
                created_at: Utc::now().to_rfc3339(),
            }],
        )
        .await
        .unwrap_or_else(|_| {
            format!(
                "Great goal! To help plan '{}' effectively — what's the most important outcome you want to achieve?",
                goal_title
            )
        });

    // Store the conversation starter
    {
        let conn_guard = conn.lock().map_err(|e| e.to_string())?;
        let repo = Repository::new(&conn_guard);
        let _ = repo.add_message(&goal_id, ChatRole::User, &user_message);
        let _ = repo.add_message(&goal_id, ChatRole::Assistant, &opening_question);
    }

    // Signal frontend to open the chat widget
    let _ = app_handle.emit("plan_started", goal_id.clone());

    // Return empty task list — tasks are created through conversation
    Ok(vec![])
}
