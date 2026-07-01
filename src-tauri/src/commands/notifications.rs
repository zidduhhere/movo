use tauri::{State, AppHandle};
use std::sync::Mutex;
use rusqlite::Connection;
use chrono::Utc;
use tauri_plugin_notification::NotificationExt;
use crate::AppState;
use crate::db::repository::Repository;
use crate::ai::openai::OpenAiProvider;

#[tauri::command]
pub async fn check_and_send_notifications(
    conn: State<'_, Mutex<Connection>>,
    app_state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<usize, String> {
    let user_id = {
        app_state.current_user_id
            .lock().map_err(|e| e.to_string())?
            .clone()
    }.ok_or("Not logged in")?;

    let prefs = {
        let conn_guard = conn.lock().map_err(|e| e.to_string())?;
        let repo = Repository::new(&conn_guard);
        repo.get_user_preferences(&user_id).map_err(|e| e.to_string())?.unwrap_or_default()
    };

    let now = Utc::now();
    let in_5_min = now + chrono::Duration::minutes(5);
    let mut sent = 0;

    // Fetch events starting in the next 5 minutes
    if prefs.notify_event_reminders {
        let events = {
            let conn_guard = conn.lock().map_err(|e| e.to_string())?;
            let repo = Repository::new(&conn_guard);
            repo.get_events_in_range(&user_id, &now.to_rfc3339(), &in_5_min.to_rfc3339())
                .map_err(|e| e.to_string())?
        };

        // Skip events already notified this session
        let to_notify: Vec<_> = {
            let notified = app_state.notified_event_ids.lock().map_err(|e| e.to_string())?;
            events.into_iter().filter(|e| !notified.contains(&e.id)).collect()
        };

        if !to_notify.is_empty() {
            let ai = OpenAiProvider::new()?;

            for event in to_notify {
                let user_prompt = format!(
                    "Write a brief, warm, motivating push notification (max 20 words) for this upcoming calendar event.\n\
                     Event: '{}'\n\
                     Starting in about 5 minutes.\n\
                     Return ONLY the notification body text, nothing else.",
                    event.title
                );

                let body = ai
                    .simple_completion(
                        "You write concise push notifications. Return only the notification body, no quotes, no labels.",
                        &user_prompt,
                    )
                    .await
                    .unwrap_or_else(|_| format!("'{}' starts in 5 minutes — get ready!", event.title));

                let _ = app_handle
                    .notification()
                    .builder()
                    .title("Movo")
                    .body(&body)
                    .show();

                app_state
                    .notified_event_ids
                    .lock()
                    .map_err(|e| e.to_string())?
                    .insert(event.id);

                sent += 1;
            }
        }
    }

    // ── Deadline alerts: tasks due within the next 24 hours ───────────────────
    if prefs.notify_deadlines {
        let deadline_tasks = {
            let conn_guard = conn.lock().map_err(|e| e.to_string())?;
            let repo = Repository::new(&conn_guard);
            repo.get_tasks_with_upcoming_deadlines(&user_id)
                .map_err(|e| e.to_string())?
        };

        let notified_deadlines = {
            app_state.notified_deadline_task_ids
                .lock().map_err(|e| e.to_string())?.clone()
        };

        for task in deadline_tasks {
            if notified_deadlines.contains(&task.id) { continue; }

            let body = format!(
                "Deadline approaching for '{}'. Movo recommends starting soon.",
                task.title
            );
            let _ = app_handle.notification().builder().title("Movo").body(&body).show();
            app_state.notified_deadline_task_ids
                .lock().map_err(|e| e.to_string())?
                .insert(task.id);
            sent += 1;
        }
    }

    // ── Daily summary: once per calendar day ──────────────────────────────────
    let today = now.format("%Y-%m-%d").to_string();
    let already_sent_today = {
        let guard = app_state.last_daily_summary_date
            .lock().map_err(|e| e.to_string())?;
        guard.as_deref() == Some(today.as_str())
    };

    if !already_sent_today {
        let (task_count, next_event_title) = {
            let conn_guard = conn.lock().map_err(|e| e.to_string())?;
            let repo = Repository::new(&conn_guard);
            let todos = repo.get_todos_for_user(&user_id).map_err(|e| e.to_string())?;
            let today_start = format!("{}T00:00:00Z", today);
            let today_end   = format!("{}T23:59:59Z", today);
            let events = repo.get_events_in_range(&user_id, &today_start, &today_end)
                .map_err(|e| e.to_string())?;
            let next_title = events.first().map(|e| e.title.clone());
            (todos.len(), next_title)
        };

        let body = if let Some(title) = next_event_title {
            format!("You have {} task{} today. Next up: '{}'.", task_count, if task_count == 1 { "" } else { "s" }, title)
        } else {
            format!("You have {} task{} planned for today. Let's get started!", task_count, if task_count == 1 { "" } else { "s" })
        };

        let _ = app_handle.notification().builder().title("Good morning, Movo").body(&body).show();
        *app_state.last_daily_summary_date
            .lock().map_err(|e| e.to_string())? = Some(today);
        sent += 1;
    }

    Ok(sent)
}
