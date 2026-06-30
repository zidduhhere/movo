# Movo Voice Capture + Calendar View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add macOS menu bar voice capture, AI planning with user persona, and an in-app calendar view to Movo.

**Architecture:** A Tauri SystemTray icon opens a frameless secondary window (voice popup) where the user speaks or types a goal; the Web SpeechRecognition API transcribes it; a Tauri command creates the goal, calls OpenAI with function calling (not regex), schedules events based on user preferences, then opens/focuses the main window. The main app gains a Calendar tab that renders scheduled events from SQLite and a one-time onboarding wizard that collects work hours, focus block size, and days off.

**Tech Stack:** Tauri v2 · Rust · rusqlite · OpenAI API (existing `openai.rs`) · React 19 · Zustand · Tailwind CSS v4 · date-fns (already in package.json) · tauri-plugin-positioner (already in Cargo.toml)

## Global Constraints

- macOS only (some code is `#[cfg(target_os = "macos")]`)
- Tauri v2 APIs throughout — no v1 imports
- All Tauri commands registered in `src-tauri/src/lib.rs` `invoke_handler!`
- No new npm packages — date-fns, lucide-react, framer-motion, clsx, zustand already installed
- No new Cargo crates except where listed explicitly per task
- OpenAI API key from env var `OPENAI_API_KEY`, base URL from `OPENAI_BASE_URL` (existing pattern)
- SQLite migrations run at startup via `db::migrations::run_migrations` — append only, never modify existing tables

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src-tauri/src/db/migrations.rs` | Modify | Add `user_preferences` table |
| `src-tauri/src/models/user_preferences.rs` | Create | `UserPreferences` struct |
| `src-tauri/src/models/event.rs` | Modify | Add `CalendarEvent` view model |
| `src-tauri/src/models/mod.rs` | Modify | Export `UserPreferences`, `CalendarEvent` |
| `src-tauri/src/db/repository.rs` | Modify | Add preferences + event methods |
| `src-tauri/src/commands/preferences.rs` | Create | `get_user_preferences`, `save_user_preferences` |
| `src-tauri/src/commands/calendar.rs` | Create | `get_events_in_range` |
| `src-tauri/src/commands/voice.rs` | Create | `voice_capture_plan`, `open_mic_settings` |
| `src-tauri/src/commands/chat.rs` | Modify | Replace `<tool>` regex with OpenAI function calling |
| `src-tauri/src/commands/mod.rs` | Modify | Add `preferences`, `calendar`, `voice` modules |
| `src-tauri/src/ai/openai.rs` | Modify | Add function-calling-aware `chat_with_tools` method |
| `src-tauri/src/lib.rs` | Modify | Add `AppState`, SystemTray, register new commands |
| `src-tauri/tauri.conf.json` | Modify | Add `voice_popup` window + `NSMicrophoneUsageDescription` |
| `src/main.tsx` | Modify | Detect window label, render VoicePopup vs App |
| `src/components/VoicePopup.tsx` | Create | Voice capture UI |
| `src/components/Onboarding.tsx` | Create | 3-step preferences wizard |
| `src/components/CalendarView.tsx` | Create | Week/month event grid |
| `src/store/index.ts` | Modify | Add preferences, events, `fetchEvents`, `calendar` view |
| `src/App.tsx` | Modify | Show Onboarding, listen for `navigate_to_goal` event |
| `src/components/Sidebar.tsx` | Modify | Add Calendar tab |

---

## Task 1: DB Migration + UserPreferences Model + Repository Methods

**Files:**
- Modify: `src-tauri/src/db/migrations.rs`
- Create: `src-tauri/src/models/user_preferences.rs`
- Modify: `src-tauri/src/models/event.rs`
- Modify: `src-tauri/src/models/mod.rs`
- Modify: `src-tauri/src/db/repository.rs`

**Interfaces:**
- Produces:
  - `Repository::get_user_preferences(user_id: &str) -> Result<Option<UserPreferences>>`
  - `Repository::save_user_preferences(prefs: &UserPreferences) -> Result<()>`
  - `Repository::add_event(event: &Event) -> Result<()>`
  - `Repository::get_events_in_range(user_id: &str, from: &str, to: &str) -> Result<Vec<CalendarEvent>>`
  - `UserPreferences { user_id, work_start, work_end, focus_block_mins, days_off }`
  - `CalendarEvent { id, task_id, title, start_time, end_time, status, goal_id, goal_title }`

- [ ] **Step 1: Add user_preferences table to migrations**

Open `src-tauri/src/db/migrations.rs` and append the new table to the `execute_batch` SQL string — add it right before the closing `"`:

```rust
        CREATE TABLE IF NOT EXISTS user_preferences (
            user_id TEXT PRIMARY KEY,
            work_start TEXT NOT NULL DEFAULT '09:00',
            work_end TEXT NOT NULL DEFAULT '18:00',
            focus_block_mins INTEGER NOT NULL DEFAULT 60,
            days_off TEXT NOT NULL DEFAULT 'Saturday,Sunday',
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
```

The full file after the edit:

```rust
use rusqlite::{Connection, Result};

pub fn run_migrations(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS goals (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            target_date TEXT,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            goal_id TEXT,
            title TEXT NOT NULL,
            description TEXT,
            status TEXT NOT NULL,
            effort_minutes INTEGER NOT NULL,
            priority INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            deadline TEXT,
            FOREIGN KEY(goal_id) REFERENCES goals(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY,
            task_id TEXT,
            title TEXT NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            status TEXT NOT NULL,
            FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS chat_messages (
            id TEXT PRIMARY KEY,
            goal_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(goal_id) REFERENCES goals(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS user_preferences (
            user_id TEXT PRIMARY KEY,
            work_start TEXT NOT NULL DEFAULT '09:00',
            work_end TEXT NOT NULL DEFAULT '18:00',
            focus_block_mins INTEGER NOT NULL DEFAULT 60,
            days_off TEXT NOT NULL DEFAULT 'Saturday,Sunday',
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        "
    )?;

    Ok(())
}
```

- [ ] **Step 2: Create UserPreferences model**

Create `src-tauri/src/models/user_preferences.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UserPreferences {
    pub user_id: String,
    pub work_start: String,
    pub work_end: String,
    pub focus_block_mins: i32,
    pub days_off: String,
}

impl Default for UserPreferences {
    fn default() -> Self {
        Self {
            user_id: String::new(),
            work_start: "09:00".to_string(),
            work_end: "18:00".to_string(),
            focus_block_mins: 60,
            days_off: "Saturday,Sunday".to_string(),
        }
    }
}
```

- [ ] **Step 3: Add CalendarEvent to event.rs**

Open `src-tauri/src/models/event.rs` and add `CalendarEvent` at the bottom:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Event {
    pub id: String,
    pub task_id: Option<String>,
    pub title: String,
    pub start_time: String,
    pub end_time: String,
    pub status: EventStatus,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum EventStatus {
    Scheduled,
    Completed,
    Skipped,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CalendarEvent {
    pub id: String,
    pub task_id: Option<String>,
    pub title: String,
    pub start_time: String,
    pub end_time: String,
    pub status: String,
    pub goal_id: Option<String>,
    pub goal_title: Option<String>,
}
```

- [ ] **Step 4: Export new types from models/mod.rs**

Replace the full contents of `src-tauri/src/models/mod.rs`:

```rust
pub mod goal;
pub mod task;
pub mod event;
pub mod user;
pub mod message;
pub mod user_preferences;

pub use goal::{Goal, GoalStatus};
pub use task::{Task, TaskStatus};
pub use event::{Event, EventStatus, CalendarEvent};
pub use user::User;
pub use message::{ChatMessage, ChatRole};
pub use user_preferences::UserPreferences;
```

- [ ] **Step 5: Add repository methods**

Open `src-tauri/src/db/repository.rs`. Add `UserPreferences` and `CalendarEvent` to the existing use line at the top:

```rust
use crate::models::{Goal, GoalStatus, Task, TaskStatus, User, ChatMessage, ChatRole, Event, EventStatus, UserPreferences, CalendarEvent};
```

Then append the following four methods at the end of `impl<'a> Repository<'a>`, before the closing `}`:

```rust
    pub fn get_user_preferences(&self, user_id: &str) -> Result<Option<UserPreferences>> {
        let mut stmt = self.conn.prepare(
            "SELECT user_id, work_start, work_end, focus_block_mins, days_off
             FROM user_preferences WHERE user_id = ?1"
        )?;
        let mut rows = stmt.query_map([user_id], |row| {
            Ok(UserPreferences {
                user_id: row.get(0)?,
                work_start: row.get(1)?,
                work_end: row.get(2)?,
                focus_block_mins: row.get(3)?,
                days_off: row.get(4)?,
            })
        })?;
        if let Some(row) = rows.next() {
            Ok(Some(row?))
        } else {
            Ok(None)
        }
    }

    pub fn save_user_preferences(&self, prefs: &UserPreferences) -> Result<()> {
        self.conn.execute(
            "INSERT INTO user_preferences (user_id, work_start, work_end, focus_block_mins, days_off)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(user_id) DO UPDATE SET
               work_start = excluded.work_start,
               work_end = excluded.work_end,
               focus_block_mins = excluded.focus_block_mins,
               days_off = excluded.days_off",
            rusqlite::params![
                prefs.user_id,
                prefs.work_start,
                prefs.work_end,
                prefs.focus_block_mins,
                prefs.days_off,
            ],
        )?;
        Ok(())
    }

    pub fn add_event(&self, event: &Event) -> Result<()> {
        let status_str = match event.status {
            EventStatus::Scheduled => "scheduled",
            EventStatus::Completed => "completed",
            EventStatus::Skipped => "skipped",
        };
        self.conn.execute(
            "INSERT INTO events (id, task_id, title, start_time, end_time, status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                event.id,
                event.task_id,
                event.title,
                event.start_time,
                event.end_time,
                status_str,
            ],
        )?;
        Ok(())
    }

    pub fn get_events_in_range(
        &self,
        user_id: &str,
        from: &str,
        to: &str,
    ) -> Result<Vec<CalendarEvent>> {
        let mut stmt = self.conn.prepare(
            "SELECT e.id, e.task_id, e.title, e.start_time, e.end_time, e.status,
                    g.id, g.title
             FROM events e
             LEFT JOIN tasks t ON e.task_id = t.id
             LEFT JOIN goals g ON t.goal_id = g.id
             WHERE g.user_id = ?1
               AND e.start_time >= ?2
               AND e.start_time < ?3
             ORDER BY e.start_time ASC",
        )?;
        let rows = stmt.query_map(rusqlite::params![user_id, from, to], |row| {
            Ok(CalendarEvent {
                id: row.get(0)?,
                task_id: row.get(1)?,
                title: row.get(2)?,
                start_time: row.get(3)?,
                end_time: row.get(4)?,
                status: row.get(5)?,
                goal_id: row.get(6)?,
                goal_title: row.get(7)?,
            })
        })?;
        let mut events = Vec::new();
        for row in rows {
            events.push(row?);
        }
        Ok(events)
    }
```

- [ ] **Step 6: Verify it builds**

```bash
cd src-tauri && cargo build 2>&1 | tail -20
```

Expected: `Compiling movo v0.1.0` … `Finished` with no errors.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/db/migrations.rs \
        src-tauri/src/models/user_preferences.rs \
        src-tauri/src/models/event.rs \
        src-tauri/src/models/mod.rs \
        src-tauri/src/db/repository.rs
git commit -m "feat: add user_preferences table, CalendarEvent model, and repository methods"
```

---

## Task 2: AppState + Auth Update + open_mic_settings Command

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/commands/auth.rs`
- Create: `src-tauri/src/commands/voice.rs` (just the `open_mic_settings` command for now)
- Modify: `src-tauri/src/commands/mod.rs`

**Interfaces:**
- Consumes: nothing new
- Produces:
  - `AppState { current_user_id: Mutex<Option<String>> }` available as Tauri managed state
  - `login_user` and `register_user` now set `AppState.current_user_id`
  - `open_mic_settings()` Tauri command — opens System Settings to Microphone pane

- [ ] **Step 1: Add AppState to lib.rs and wire SystemTray**

Replace the full contents of `src-tauri/src/lib.rs`:

```rust
pub mod db;
pub mod models;
pub mod commands;
pub mod ai;
pub mod scheduler;

use std::sync::Mutex;
use tauri::Manager;
use tauri::tray::{TrayIconBuilder, MouseButton, MouseButtonState, TrayIconEvent};
use tauri_plugin_positioner::{Position, WindowExt};

pub struct AppState {
    pub current_user_id: Mutex<Option<String>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_liquid_glass::init())
        .manage(AppState {
            current_user_id: Mutex::new(None),
        })
        .setup(|app| {
            dotenvy::dotenv().ok();

            let conn = db::connection::init_db(app.handle())
                .expect("Failed to initialize database");
            app.manage(Mutex::new(conn));

            // System tray
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(popup) = app.get_webview_window("voice_popup") {
                            if popup.is_visible().unwrap_or(false) {
                                let _ = popup.hide();
                            } else {
                                let _ = popup.show();
                                let _ = popup.set_focus();
                                let _ = popup.as_ref().move_window(Position::TrayCenter);
                            }
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::goals::create_goal,
            commands::goals::get_active_goals,
            commands::goals::delete_goal,
            commands::tasks::get_tasks_by_goal,
            commands::tasks::get_all_tasks,
            commands::planner::plan_goal,
            commands::auth::register_user,
            commands::auth::login_user,
            commands::chat::chat_with_ai,
            commands::chat::get_chat_history,
            commands::preferences::get_user_preferences,
            commands::preferences::save_user_preferences,
            commands::calendar::get_events_in_range,
            commands::voice::voice_capture_plan,
            commands::voice::open_mic_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 2: Update auth.rs to set AppState on login/register**

Replace the full contents of `src-tauri/src/commands/auth.rs`:

```rust
use tauri::State;
use std::sync::Mutex;
use rusqlite::Connection;
use bcrypt::{hash, verify, DEFAULT_COST};

use crate::db::repository::Repository;
use crate::models::User;
use crate::AppState;

#[tauri::command]
pub fn register_user(
    email: &str,
    name: &str,
    password: &str,
    conn: State<'_, Mutex<Connection>>,
    app_state: State<'_, AppState>,
) -> Result<User, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    let repo = Repository::new(&conn);

    let password_hash = hash(password, DEFAULT_COST)
        .map_err(|e| format!("Failed to hash password: {}", e))?;

    let user = repo.create_user(email, name, &password_hash)
        .map_err(|e| format!("Failed to register user: {}", e))?;

    *app_state.current_user_id.lock().map_err(|e| e.to_string())? = Some(user.id.clone());
    Ok(user)
}

#[tauri::command]
pub fn login_user(
    email: &str,
    password: &str,
    conn: State<'_, Mutex<Connection>>,
    app_state: State<'_, AppState>,
) -> Result<User, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    let repo = Repository::new(&conn);

    let user = repo.get_user_by_email(email)
        .map_err(|e| format!("Database error: {}", e))?;

    match user {
        Some(user) => {
            let valid = verify(password, &user.password_hash)
                .map_err(|e| format!("Auth error: {}", e))?;
            if valid {
                *app_state.current_user_id.lock().map_err(|e| e.to_string())? =
                    Some(user.id.clone());
                Ok(user)
            } else {
                Err("Invalid email or password".to_string())
            }
        }
        None => Err("Invalid email or password".to_string()),
    }
}
```

- [ ] **Step 3: Create commands/voice.rs with open_mic_settings**

Create `src-tauri/src/commands/voice.rs` with just this command for now (voice_capture_plan added in Task 7):

```rust
use tauri::{AppHandle, State};
use std::sync::Mutex;
use rusqlite::Connection;

use crate::AppState;

#[tauri::command]
pub async fn open_mic_settings(app_handle: AppHandle) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;
    app_handle
        .shell()
        .open(
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
            None,
        )
        .map_err(|e| e.to_string())
}

// voice_capture_plan will be added in Task 7
#[tauri::command]
pub async fn voice_capture_plan(
    _text: String,
    _conn: State<'_, Mutex<Connection>>,
    _app_state: State<'_, AppState>,
    _app_handle: AppHandle,
) -> Result<String, String> {
    Err("not yet implemented".to_string())
}
```

- [ ] **Step 4: Register new modules in commands/mod.rs**

Replace the full contents of `src-tauri/src/commands/mod.rs`:

```rust
pub mod goals;
pub mod tasks;
pub mod planner;
pub mod schedule;
pub mod auth;
pub mod chat;
pub mod preferences;
pub mod calendar;
pub mod voice;
```

- [ ] **Step 5: Create empty preferences and calendar modules (stubs for now)**

Create `src-tauri/src/commands/preferences.rs`:

```rust
use tauri::State;
use std::sync::Mutex;
use rusqlite::Connection;
use crate::db::repository::Repository;
use crate::models::UserPreferences;
use crate::AppState;

#[tauri::command]
pub fn get_user_preferences(
    conn: State<'_, Mutex<Connection>>,
    app_state: State<'_, AppState>,
) -> Result<Option<UserPreferences>, String> {
    let user_id = app_state
        .current_user_id
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or("Not logged in")?;
    let conn = conn.lock().map_err(|e| e.to_string())?;
    let repo = Repository::new(&conn);
    repo.get_user_preferences(&user_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_user_preferences(
    work_start: String,
    work_end: String,
    focus_block_mins: i32,
    days_off: String,
    conn: State<'_, Mutex<Connection>>,
    app_state: State<'_, AppState>,
) -> Result<UserPreferences, String> {
    let user_id = app_state
        .current_user_id
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or("Not logged in")?;
    let prefs = UserPreferences {
        user_id: user_id.clone(),
        work_start,
        work_end,
        focus_block_mins,
        days_off,
    };
    let conn = conn.lock().map_err(|e| e.to_string())?;
    let repo = Repository::new(&conn);
    repo.save_user_preferences(&prefs).map_err(|e| e.to_string())?;
    Ok(prefs)
}
```

Create `src-tauri/src/commands/calendar.rs`:

```rust
use tauri::State;
use std::sync::Mutex;
use rusqlite::Connection;
use crate::db::repository::Repository;
use crate::models::CalendarEvent;
use crate::AppState;

#[tauri::command]
pub fn get_events_in_range(
    from: String,
    to: String,
    conn: State<'_, Mutex<Connection>>,
    app_state: State<'_, AppState>,
) -> Result<Vec<CalendarEvent>, String> {
    let user_id = app_state
        .current_user_id
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or("Not logged in")?;
    let conn = conn.lock().map_err(|e| e.to_string())?;
    let repo = Repository::new(&conn);
    repo.get_events_in_range(&user_id, &from, &to)
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 6: Verify build**

```bash
cd src-tauri && cargo build 2>&1 | tail -30
```

Expected: `Finished` with no errors.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/lib.rs \
        src-tauri/src/commands/auth.rs \
        src-tauri/src/commands/voice.rs \
        src-tauri/src/commands/preferences.rs \
        src-tauri/src/commands/calendar.rs \
        src-tauri/src/commands/mod.rs
git commit -m "feat: add AppState, SystemTray setup, preferences/calendar/voice command stubs"
```

---

## Task 3: Voice Popup Window Config + NSMicrophoneUsageDescription

**Files:**
- Modify: `src-tauri/tauri.conf.json`

**Interfaces:**
- Produces: A second Tauri window with label `"voice_popup"` that loads the same `index.html`; NSMicrophoneUsageDescription in app bundle Info.plist

- [ ] **Step 1: Update tauri.conf.json**

Replace the full contents of `src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "movo",
  "version": "0.1.0",
  "identifier": "com.zidduhhere.movo",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "movo",
        "width": 1000,
        "height": 700,
        "transparent": true,
        "decorations": true,
        "titleBarStyle": "Overlay",
        "hiddenTitle": true
      },
      {
        "label": "voice_popup",
        "title": "Movo",
        "width": 420,
        "height": 110,
        "visible": false,
        "decorations": false,
        "transparent": true,
        "alwaysOnTop": true,
        "resizable": false,
        "skipTaskbar": true
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "macOS": {
      "infoPlist": {
        "NSMicrophoneUsageDescription": "Movo uses your microphone to capture tasks by voice."
      }
    }
  }
}
```

- [ ] **Step 2: Verify the main window label was added**

The main window must now have `"label": "main"` so `app.get_webview_window("main")` works in lib.rs and in the voice command. Confirm the config has it.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "feat: add voice_popup window config and NSMicrophoneUsageDescription"
```

---

## Task 4: OpenAI Function Calling Upgrade

**Files:**
- Modify: `src-tauri/src/ai/openai.rs`
- Modify: `src-tauri/src/commands/chat.rs`

**Interfaces:**
- Consumes: `OpenAiProvider` (existing), `Repository` methods from Task 1
- Produces:
  - `OpenAiProvider::chat_with_tools(system_prompt, messages, tools) -> Result<(String, Vec<ToolCall>)>`
  - `chat_with_ai` command now uses `chat_with_tools` and proper `tool_calls` parsing
  - `ToolCall { name: String, arguments: serde_json::Value }`

- [ ] **Step 1: Add ToolCall struct and chat_with_tools to openai.rs**

Replace the full contents of `src-tauri/src/ai/openai.rs`:

```rust
use super::provider::{AiGeneratedTask, AiProvider};
use std::env;
use std::future::Future;
use reqwest::Client;
use serde_json::json;
use crate::models::ChatMessage;

pub struct OpenAiProvider {
    api_key: String,
    base_url: String,
    model_name: String,
    client: Client,
}

#[derive(Debug, Clone)]
pub struct ToolCall {
    pub name: String,
    pub arguments: serde_json::Value,
}

impl OpenAiProvider {
    pub fn new() -> Result<Self, String> {
        let api_key = env::var("OPENAI_API_KEY")
            .map_err(|_| "OPENAI_API_KEY not set in environment".to_string())?;
        let base_url = env::var("OPENAI_BASE_URL")
            .unwrap_or_else(|_| "https://api.openai.com/v1".to_string());
        let model_name = env::var("OPENAI_MODEL")
            .unwrap_or_else(|_| "gpt-4o".to_string());
        Ok(Self {
            api_key,
            base_url,
            model_name,
            client: Client::new(),
        })
    }

    pub async fn chat_with_tools(
        &self,
        system_prompt: &str,
        messages: Vec<ChatMessage>,
        tools: serde_json::Value,
    ) -> Result<(String, Vec<ToolCall>), String> {
        let url = format!("{}/chat/completions", self.base_url.trim_end_matches('/'));

        let mut openai_messages = vec![json!({
            "role": "system",
            "content": system_prompt
        })];
        for msg in &messages {
            openai_messages.push(json!({
                "role": msg.role.to_string(),
                "content": msg.content
            }));
        }

        let body = json!({
            "model": self.model_name,
            "messages": openai_messages,
            "tools": tools,
            "tool_choice": "auto"
        });

        let resp = self.client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("HTTP request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("API error {}: {}", status, text));
        }

        let json_resp: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        let message = &json_resp["choices"][0]["message"];

        // Extract text content (may be null when only tool_calls are returned)
        let content = message["content"]
            .as_str()
            .unwrap_or("")
            .to_string();

        // Extract tool calls
        let mut tool_calls = Vec::new();
        if let Some(calls) = message["tool_calls"].as_array() {
            for call in calls {
                let name = call["function"]["name"]
                    .as_str()
                    .unwrap_or("")
                    .to_string();
                let args_str = call["function"]["arguments"]
                    .as_str()
                    .unwrap_or("{}");
                let arguments: serde_json::Value =
                    serde_json::from_str(args_str).unwrap_or(json!({}));
                tool_calls.push(ToolCall { name, arguments });
            }
        }

        Ok((content, tool_calls))
    }

    // Legacy plain chat (used by plan_goal decompose flow)
    pub async fn chat(
        &self,
        system_prompt: &str,
        messages: Vec<ChatMessage>,
    ) -> Result<String, String> {
        let (content, _) = self
            .chat_with_tools(system_prompt, messages, json!([]))
            .await?;
        Ok(content)
    }
}

impl AiProvider for OpenAiProvider {
    fn decompose_goal(
        &self,
        goal_title: &str,
        goal_description: Option<&str>,
    ) -> impl Future<Output = Result<Vec<AiGeneratedTask>, String>> + Send {
        let api_key = self.api_key.clone();
        let base_url = self.base_url.clone();
        let model_name = self.model_name.clone();
        let client = self.client.clone();
        let title = goal_title.to_string();
        let desc = goal_description.unwrap_or("").to_string();

        async move {
            let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
            let prompt = format!(
                "You are an AI Chief of Staff. Decompose the following goal into a list of actionable tasks.\nGoal: {}\nDescription: {}\n\nReturn ONLY a JSON array of objects, where each object has: 'title' (string), 'description' (string or null), 'effort_minutes' (integer), 'priority' (integer 1-5, where 1 is highest). No markdown wrappers, no other text.",
                title, desc
            );
            let body = json!({
                "model": model_name,
                "messages": [
                    {"role": "system", "content": "You are a helpful assistant that only outputs valid JSON arrays."},
                    {"role": "user", "content": prompt}
                ]
            });
            let resp = client
                .post(&url)
                .header("Authorization", format!("Bearer {}", api_key))
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("HTTP request failed: {}", e))?;

            if !resp.status().is_success() {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                return Err(format!("API error {}: {}", status, text));
            }

            let json_resp: serde_json::Value = resp
                .json()
                .await
                .map_err(|e| format!("Failed to parse response: {}", e))?;
            let text = json_resp["choices"][0]["message"]["content"]
                .as_str()
                .ok_or("Failed to extract text from response")?;
            let clean_text = text
                .trim()
                .trim_start_matches("```json")
                .trim_start_matches("```")
                .trim_end_matches("```")
                .trim();
            let tasks: Vec<AiGeneratedTask> = serde_json::from_str(clean_text)
                .map_err(|e| format!("Failed to parse JSON array: {} (Response was: {})", e, clean_text))?;
            Ok(tasks)
        }
    }
}
```

- [ ] **Step 2: Define the tools JSON for the chat command**

The chat command uses two tools: `create_task` and `delete_task`. Add a helper function for the tools definition:

```rust
pub fn chat_tools() -> serde_json::Value {
    json!([
        {
            "type": "function",
            "function": {
                "name": "create_task",
                "description": "Create a new task for the current goal",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "title": { "type": "string" },
                        "description": { "type": ["string", "null"] },
                        "effort_minutes": { "type": "integer" },
                        "priority": { "type": "integer", "minimum": 1, "maximum": 5 },
                        "deadline": { "type": ["string", "null"], "description": "ISO 8601 date string, e.g. 2026-07-15" }
                    },
                    "required": ["title", "effort_minutes", "priority"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "delete_task",
                "description": "Delete an existing task by its ID",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "task_id": { "type": "string" }
                    },
                    "required": ["task_id"]
                }
            }
        }
    ])
}
```

Add this function to `src-tauri/src/ai/openai.rs` after the `impl AiProvider` block.

- [ ] **Step 3: Rewrite chat.rs to use function calling**

Replace the full contents of `src-tauri/src/commands/chat.rs`:

```rust
use std::sync::Mutex;
use tauri::{State, AppHandle};
use rusqlite::Connection;
use crate::models::{ChatMessage, ChatRole, Task, TaskStatus};
use crate::db::repository::Repository;
use crate::ai::openai::{OpenAiProvider, chat_tools};
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
    _app_handle: AppHandle,
) -> Result<ChatResponse, String> {
    let (messages, goal_title, current_tasks) = {
        let conn_guard = conn.lock().map_err(|e| e.to_string())?;
        let repo = Repository::new(&conn_guard);

        repo.add_message(&goal_id, ChatRole::User, &content)
            .map_err(|e| e.to_string())?;

        let messages = repo.get_messages_for_goal(&goal_id)
            .map_err(|e| e.to_string())?;

        let mut stmt = conn_guard
            .prepare("SELECT title FROM goals WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        let mut goal_title = String::new();
        if let Some(Ok(title)) = stmt
            .query_map([&goal_id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .next()
        {
            goal_title = title;
        }

        let current_tasks = repo.get_tasks_by_goal(&goal_id)
            .map_err(|e| e.to_string())?;

        (messages, goal_title, current_tasks)
    };

    let ai = OpenAiProvider::new()?;
    let current_tasks_json = serde_json::to_string(&current_tasks).unwrap_or_default();

    let system_prompt = format!(
        "You are an AI Chief of Staff helping the user plan their goal: '{}'.\n\
         Current tasks: {}\n\n\
         Discuss the plan and ask clarifying questions. \
         Use the create_task or delete_task tools to modify the task list.",
        goal_title, current_tasks_json
    );

    let (ai_text, tool_calls) = ai
        .chat_with_tools(&system_prompt, messages, chat_tools())
        .await?;

    // Execute tool calls
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
                _ => {}
            }
        }
    }

    let response_text = if ai_text.is_empty() && !tool_calls.is_empty() {
        format!("Done! I've updated {} task(s).", tool_calls.len())
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
```

- [ ] **Step 4: Verify build**

```bash
cd src-tauri && cargo build 2>&1 | tail -30
```

Expected: `Finished` with no errors.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/ai/openai.rs \
        src-tauri/src/commands/chat.rs
git commit -m "feat: upgrade AI chat to OpenAI function calling, remove <tool> regex parser"
```

---

## Task 5: Frontend Store + main.tsx Window Routing

**Files:**
- Modify: `src/store/index.ts`
- Modify: `src/main.tsx`

**Interfaces:**
- Consumes: `get_user_preferences`, `save_user_preferences`, `get_events_in_range` Tauri commands
- Produces:
  - Zustand store: `preferences`, `events`, `fetchPreferences`, `savePreferences`, `fetchEvents`
  - `activeView` type extended with `'calendar'`
  - `main.tsx` renders `VoicePopup` when `getCurrentWindow().label === 'voice_popup'`

- [ ] **Step 1: Update store/index.ts**

Replace the full contents of `src/store/index.ts`:

```typescript
import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export interface Goal {
    id: string;
    title: string;
    description?: string;
    status: string;
    created_at: string;
    target_date?: string;
}

export interface Task {
    id: string;
    goal_id?: string;
    title: string;
    description?: string;
    status: string;
    effort_minutes: number;
    priority: number;
    created_at: string;
    deadline?: string;
}

export interface ChatMessage {
    id: string;
    goal_id: string;
    role: 'user' | 'assistant';
    content: string;
    created_at: string;
}

export interface User {
    id: string;
    email: string;
    name: string;
    created_at: string;
}

export interface UserPreferences {
    user_id: string;
    work_start: string;
    work_end: string;
    focus_block_mins: number;
    days_off: string;
}

export interface CalendarEvent {
    id: string;
    task_id?: string;
    title: string;
    start_time: string;
    end_time: string;
    status: string;
    goal_id?: string;
    goal_title?: string;
}

type ActiveView = 'all' | 'recent' | 'upcoming' | 'completed' | 'project' | 'new_project' | 'calendar';

interface AppState {
    user: User | null;
    goals: Goal[];
    tasks: Task[];
    messages: ChatMessage[];
    preferences: UserPreferences | null;
    events: CalendarEvent[];
    activeGoalId: string | null;
    activeView: ActiveView;
    isLoading: boolean;
    error: string | null;
    isSidebarOpen: boolean;

    login: (email: string, password: string) => Promise<void>;
    register: (email: string, name: string, password: string) => Promise<void>;
    logout: () => void;
    fetchGoals: () => Promise<void>;
    fetchTasksForGoal: (goalId: string) => Promise<void>;
    fetchAllTasks: () => Promise<void>;
    createGoal: (title: string, description?: string, targetDate?: string) => Promise<Goal>;
    deleteGoal: (id: string) => Promise<void>;
    planGoal: (goalId: string) => Promise<void>;
    fetchMessages: (goalId: string) => Promise<void>;
    sendMessage: (goalId: string, content: string) => Promise<void>;
    setActiveGoal: (id: string | null) => void;
    setActiveView: (view: ActiveView) => void;
    toggleSidebar: () => void;
    fetchPreferences: () => Promise<void>;
    savePreferences: (prefs: Omit<UserPreferences, 'user_id'>) => Promise<void>;
    fetchEvents: (from: string, to: string) => Promise<void>;
}

export const useStore = create<AppState>((set, _get) => ({
    user: null,
    goals: [],
    tasks: [],
    messages: [],
    preferences: null,
    events: [],
    activeGoalId: null,
    activeView: 'all',
    isLoading: false,
    error: null,
    isSidebarOpen: false,

    login: async (email, password) => {
        set({ isLoading: true, error: null });
        try {
            const user = await invoke<User>('login_user', { email, password });
            set({ user, isLoading: false });
            _get().fetchGoals();
            _get().fetchPreferences();
        } catch (error: any) {
            set({ error: error.toString(), isLoading: false });
            throw error;
        }
    },

    register: async (email, name, password) => {
        set({ isLoading: true, error: null });
        try {
            const user = await invoke<User>('register_user', { email, name, password });
            set({ user, isLoading: false });
            _get().fetchGoals();
        } catch (error: any) {
            set({ error: error.toString(), isLoading: false });
            throw error;
        }
    },

    logout: () => {
        set({ user: null, goals: [], tasks: [], activeGoalId: null, preferences: null, events: [] });
    },

    toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),

    fetchGoals: async () => {
        const user = _get().user;
        if (!user) return;
        set({ isLoading: true, error: null });
        try {
            const goals = await invoke<Goal[]>('get_active_goals', { userId: user.id });
            set({ goals, isLoading: false });
        } catch (error: any) {
            set({ error: error.toString(), isLoading: false });
        }
    },

    fetchTasksForGoal: async (goalId) => {
        set({ isLoading: true, error: null });
        try {
            const tasks: Task[] = await invoke('get_tasks_by_goal', { goalId });
            set({ tasks, isLoading: false });
        } catch (error) {
            set({ error: error as string, isLoading: false });
        }
    },

    fetchAllTasks: async () => {
        const user = _get().user;
        if (!user) return;
        set({ isLoading: true, error: null });
        try {
            const tasks: Task[] = await invoke('get_all_tasks', { userId: user.id });
            set({ tasks, isLoading: false });
        } catch (error) {
            set({ error: error as string, isLoading: false });
        }
    },

    createGoal: async (title, description, targetDate) => {
        const user = _get().user;
        if (!user) throw new Error('Not logged in');
        set({ isLoading: true, error: null });
        try {
            const newGoal = await invoke<Goal>('create_goal', { userId: user.id, title, description, targetDate });
            set((state) => ({ goals: [...state.goals, newGoal], isLoading: false }));
            return newGoal;
        } catch (error: any) {
            set({ error: error.toString(), isLoading: false });
            throw error;
        }
    },

    deleteGoal: async (id) => {
        set({ isLoading: true, error: null });
        try {
            await invoke('delete_goal', { id });
            set((state) => {
                const newGoals = state.goals.filter((g) => g.id !== id);
                return {
                    goals: newGoals,
                    isLoading: false,
                    activeGoalId: state.activeGoalId === id ? null : state.activeGoalId,
                    activeView: (state.activeGoalId === id ? 'all' : state.activeView) as ActiveView,
                };
            });
            if (useStore.getState().activeView === 'all') {
                useStore.getState().fetchAllTasks();
            }
        } catch (error: any) {
            set({ error: error.toString(), isLoading: false });
            throw error;
        }
    },

    planGoal: async (goalId) => {
        set({ isLoading: true, error: null });
        try {
            const newTasks = await invoke<Task[]>('plan_goal', { goalId });
            set((state) => ({ tasks: [...state.tasks, ...newTasks], isLoading: false }));
        } catch (error: any) {
            set({ error: error.toString(), isLoading: false });
            throw error;
        }
    },

    fetchMessages: async (goalId) => {
        try {
            const messages = await invoke<ChatMessage[]>('get_chat_history', { goalId });
            set({ messages });
        } catch (error: any) {
            console.error('Failed to fetch messages:', error);
        }
    },

    sendMessage: async (goalId, content) => {
        const tempMsg: ChatMessage = {
            id: 'temp-' + Date.now(),
            goal_id: goalId,
            role: 'user',
            content,
            created_at: new Date().toISOString(),
        };
        set((state) => ({ messages: [...state.messages, tempMsg] }));
        try {
            const response = await invoke<{ message: ChatMessage; tasks: Task[] }>('chat_with_ai', { goalId, content });
            set({ tasks: response.tasks });
            await useStore.getState().fetchMessages(goalId);
        } catch (error: any) {
            set((state) => ({ messages: state.messages.filter((m) => m.id !== tempMsg.id) }));
            throw error;
        }
    },

    setActiveGoal: (id) => {
        set({ activeGoalId: id, activeView: 'project' });
        if (id) {
            useStore.getState().fetchTasksForGoal(id);
        }
    },

    setActiveView: (view) => {
        set({ activeView: view, activeGoalId: null });
        if (view === 'all') {
            useStore.getState().fetchAllTasks();
        }
    },

    fetchPreferences: async () => {
        try {
            const prefs = await invoke<UserPreferences | null>('get_user_preferences');
            set({ preferences: prefs });
        } catch {
            set({ preferences: null });
        }
    },

    savePreferences: async (prefs) => {
        await invoke<UserPreferences>('save_user_preferences', {
            workStart: prefs.work_start,
            workEnd: prefs.work_end,
            focusBlockMins: prefs.focus_block_mins,
            daysOff: prefs.days_off,
        });
        await useStore.getState().fetchPreferences();
    },

    fetchEvents: async (from, to) => {
        try {
            const events = await invoke<CalendarEvent[]>('get_events_in_range', { from, to });
            set({ events });
        } catch (error) {
            console.error('Failed to fetch events:', error);
        }
    },
}));
```

- [ ] **Step 2: Update main.tsx for window routing**

Replace the full contents of `src/main.tsx`:

```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';
import { getCurrentWindow } from '@tauri-apps/api/window';
import App from './App';
import './App.css';

const windowLabel = getCurrentWindow().label;

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

if (windowLabel === 'voice_popup') {
    // Lazy import so VoicePopup CSS/JS isn't bundled with main window unnecessarily
    import('./components/VoicePopup').then(({ VoicePopup }) => {
        root.render(
            <React.StrictMode>
                <VoicePopup />
            </React.StrictMode>
        );
    });
} else {
    root.render(
        <React.StrictMode>
            <App />
        </React.StrictMode>
    );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors (or only pre-existing errors unrelated to our changes).

- [ ] **Step 4: Commit**

```bash
git add src/store/index.ts src/main.tsx
git commit -m "feat: extend store with preferences/events/calendar, add window routing in main.tsx"
```

---

## Task 6: VoicePopup React Component

**Files:**
- Create: `src/components/VoicePopup.tsx`

**Interfaces:**
- Consumes: `voice_capture_plan` Tauri command, `open_mic_settings` Tauri command
- Produces: `<VoicePopup />` — frameless 420×110 window with live transcription + "Plan it" button

- [ ] **Step 1: Create VoicePopup.tsx**

Create `src/components/VoicePopup.tsx`:

```typescript
import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Mic, MicOff, Send, Loader2 } from 'lucide-react';

declare global {
    interface Window {
        SpeechRecognition: typeof SpeechRecognition;
        webkitSpeechRecognition: typeof SpeechRecognition;
    }
}

export function VoicePopup() {
    const [transcript, setTranscript] = useState('');
    const [isListening, setIsListening] = useState(false);
    const [isPlanning, setIsPlanning] = useState(false);
    const [micError, setMicError] = useState<string | null>(null);
    const recognitionRef = useRef<SpeechRecognition | null>(null);
    const win = getCurrentWindow();

    useEffect(() => {
        // Close on blur
        const unlisten = win.onFocusChanged(({ payload: focused }) => {
            if (!focused && !isPlanning) {
                win.hide();
            }
        });

        startListening();

        return () => {
            unlisten.then((fn) => fn());
            recognitionRef.current?.stop();
        };
    }, []);

    function startListening() {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) {
            setMicError('Speech recognition not available in this browser.');
            return;
        }

        const recognition = new SR();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event: SpeechRecognitionEvent) => {
            let fullTranscript = '';
            for (let i = 0; i < event.results.length; i++) {
                fullTranscript += event.results[i][0].transcript;
            }
            setTranscript(fullTranscript);
        };

        recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
            if (event.error === 'not-allowed') {
                setMicError('Microphone access denied.');
                setIsListening(false);
            }
        };

        recognition.onend = () => {
            setIsListening(false);
        };

        recognitionRef.current = recognition;

        try {
            recognition.start();
            setIsListening(true);
            setMicError(null);
        } catch {
            setMicError('Could not start microphone.');
        }
    }

    async function handlePlan() {
        const text = transcript.trim();
        if (!text) return;

        recognitionRef.current?.stop();
        setIsPlanning(true);

        try {
            await invoke('voice_capture_plan', { text });
            setTranscript('');
            win.hide();
        } catch (err) {
            console.error('Planning failed:', err);
        } finally {
            setIsPlanning(false);
        }
    }

    async function handleOpenSettings() {
        await invoke('open_mic_settings');
    }

    function handleKeyDown(e: React.KeyboardEvent) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handlePlan();
        }
        if (e.key === 'Escape') {
            win.hide();
        }
    }

    return (
        <div
            className="w-full h-full flex items-center gap-3 px-4 bg-white/80 backdrop-blur-2xl rounded-2xl shadow-2xl border border-white/60"
            onKeyDown={handleKeyDown}
            tabIndex={-1}
        >
            {/* Mic icon */}
            <div className="shrink-0">
                {micError ? (
                    <MicOff className="w-5 h-5 text-red-400" />
                ) : isListening ? (
                    <Mic className="w-5 h-5 text-[#85D24E] animate-pulse" />
                ) : (
                    <Mic className="w-5 h-5 text-gray-400" />
                )}
            </div>

            {/* Input / transcript */}
            <div className="flex-1 min-w-0">
                {micError ? (
                    <div className="flex flex-col gap-1">
                        <span className="text-[12px] text-red-500">{micError}</span>
                        <button
                            onClick={handleOpenSettings}
                            className="text-[11px] text-[#85D24E] underline text-left"
                        >
                            Open Microphone Settings →
                        </button>
                    </div>
                ) : (
                    <input
                        autoFocus
                        type="text"
                        value={transcript}
                        onChange={(e) => setTranscript(e.target.value)}
                        placeholder={isListening ? 'Listening…' : 'Type or speak your goal…'}
                        className="w-full bg-transparent text-[14px] text-gray-800 placeholder:text-gray-400 outline-none"
                    />
                )}
            </div>

            {/* Waveform animation while listening */}
            {isListening && !micError && (
                <div className="shrink-0 flex items-center gap-[2px] h-5">
                    {[0, 1, 2, 3, 4].map((i) => (
                        <div
                            key={i}
                            className="w-[3px] bg-[#85D24E] rounded-full animate-bounce"
                            style={{
                                height: `${8 + (i % 3) * 4}px`,
                                animationDelay: `${i * 0.1}s`,
                                animationDuration: '0.6s',
                            }}
                        />
                    ))}
                </div>
            )}

            {/* Plan button */}
            <button
                onClick={handlePlan}
                disabled={!transcript.trim() || isPlanning}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-[#85D24E] text-white text-[13px] font-medium rounded-xl hover:bg-[#7bc248] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
                {isPlanning ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                    <Send className="w-3.5 h-3.5" />
                )}
                Plan it
            </button>
        </div>
    );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/VoicePopup.tsx
git commit -m "feat: add VoicePopup component with SpeechRecognition and mic permission error flow"
```

---

## Task 7: voice_capture_plan Tauri Command

**Files:**
- Modify: `src-tauri/src/commands/voice.rs`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `Repository::create_goal`, `Repository::add_task`, `Repository::add_event`, `Repository::get_user_preferences`, `OpenAiProvider::chat_with_tools`, `AppState::current_user_id`
- Produces:
  - `voice_capture_plan(text) -> Result<String, String>` — returns the new goal_id
  - Main window receives `navigate_to_goal` Tauri event with the goal_id

- [ ] **Step 1: Implement voice_capture_plan in voice.rs**

Replace the full contents of `src-tauri/src/commands/voice.rs`:

```rust
use tauri::{AppHandle, State, Emitter, Manager};
use std::sync::Mutex;
use rusqlite::Connection;
use serde_json::json;
use uuid::Uuid;
use chrono::{DateTime, Utc, Duration, NaiveTime, Weekday, Datelike, Timelike};

use crate::AppState;
use crate::db::repository::Repository;
use crate::models::{Goal, GoalStatus, Task, TaskStatus, Event, EventStatus, UserPreferences};
use crate::ai::openai::OpenAiProvider;

#[tauri::command]
pub async fn open_mic_settings(app_handle: AppHandle) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;
    app_handle
        .shell()
        .open(
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
            None,
        )
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
        let repo = Repository::new(&conn_guard);
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

    let planning_tools = json!([
        {
            "type": "function",
            "function": {
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
            }
        },
        {
            "type": "function",
            "function": {
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
        }
    ]);

    let (_, tool_calls) = ai
        .chat_with_tools(&system_prompt, vec![], planning_tools)
        .await?;

    // 4. Persist goal → tasks → events in one DB lock
    let goal_id = {
        let conn_guard = conn.lock().map_err(|e| e.to_string())?;
        let repo = Repository::new(&conn_guard);

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
                    let start_time = call.arguments["start_time"]
                        .as_str()
                        .unwrap_or("")
                        .to_string();
                    let end_time = call.arguments["end_time"]
                        .as_str()
                        .unwrap_or("")
                        .to_string();

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
```

- [ ] **Step 2: Listen for navigate_to_goal in App.tsx**

Open `src/App.tsx` and add an event listener for `navigate_to_goal`. Add these imports at the top:

```typescript
import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
```

Then inside `function App()`, add this `useEffect` (place it right after the existing `useEffect` for liquid glass):

```typescript
useEffect(() => {
    const unlisten = listen<string>('navigate_to_goal', (event) => {
        setActiveGoal(event.payload);
    });
    return () => {
        unlisten.then((fn) => fn());
    };
}, []);
```

Add `setActiveGoal` to the destructure from `useStore`:

```typescript
const { user, goals, toggleSidebar, isSidebarOpen, activeView, setActiveGoal } = useStore();
```

The full updated `src/App.tsx`:

```typescript
import { useEffect } from 'react';
import { setLiquidGlassEffect, GlassMaterialVariant } from 'tauri-plugin-liquid-glass-api';
import { listen } from '@tauri-apps/api/event';
import { TaskList } from './components/TaskList';
import { SettingsDropdown } from './components/SettingsDropdown';
import { Sidebar } from './components/Sidebar';
import { NextActionWidget } from './components/NextActionWidget';
import { Auth } from './components/Auth';
import { EmptyState } from './components/EmptyState';
import { ProjectChat } from './components/ProjectChat';
import { CalendarView } from './components/CalendarView';
import { Onboarding } from './components/Onboarding';
import { useStore } from './store';
import { PanelLeft } from 'lucide-react';
import clsx from 'clsx';

function App() {
  const { user, goals, toggleSidebar, isSidebarOpen, activeView, setActiveGoal, preferences } = useStore();

  useEffect(() => {
    setLiquidGlassEffect({ variant: GlassMaterialVariant.Clear }).catch(console.error);
  }, []);

  useEffect(() => {
    if (!user) return;
    const unlisten = listen<string>('navigate_to_goal', (event) => {
      setActiveGoal(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [user]);

  if (!user) {
    return (
      <div className="flex h-screen w-screen text-black font-sans bg-transparent titlebar">
        <Auth />
      </div>
    );
  }

  // Show onboarding if user has never set preferences
  if (preferences === null) {
    return (
      <div className="flex h-screen w-screen text-black font-sans bg-transparent titlebar">
        <Onboarding />
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen text-black font-sans bg-transparent titlebar">
      <Sidebar />
      <div className="flex-1 h-full flex flex-col bg-[#FAFAFA] relative overflow-hidden no-drag border-l border-black/10">

        {goals.length === 0 || activeView === 'new_project' ? (
          <>
            <div className={clsx('absolute top-4 z-50', isSidebarOpen ? 'left-4' : 'left-20')}>
              <button onClick={toggleSidebar} className="p-2 rounded hover:bg-black/5 active:bg-black/10 transition-colors text-black/50 focus:outline-none">
                <PanelLeft className="w-4 h-4" />
              </button>
            </div>
            <EmptyState />
          </>
        ) : activeView === 'calendar' ? (
          <>
            <div className={clsx('absolute top-0 left-0 right-0 h-[64px] flex items-center justify-between px-6 bg-transparent z-10 pointer-events-none', !isSidebarOpen && 'pl-24')}>
              <div className="flex items-center gap-2 pointer-events-auto">
                <button onClick={toggleSidebar} className="p-2 rounded-full bg-white border border-[#E5E5E5] shadow-sm hover:bg-black/5 transition-colors text-[#2D2D2D] h-10 w-10 flex items-center justify-center">
                  <PanelLeft className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center pointer-events-auto">
                <SettingsDropdown />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-8 pt-20">
              <CalendarView />
            </div>
          </>
        ) : (
          <>
            <div className={clsx('absolute top-0 left-0 right-0 h-[64px] flex items-center justify-between px-6 bg-transparent z-10 pointer-events-none', !isSidebarOpen && 'pl-24')}>
              <div className="flex items-center gap-2 pointer-events-auto">
                <button onClick={toggleSidebar} className="p-2 rounded-full bg-white border border-[#E5E5E5] shadow-sm hover:bg-black/5 transition-colors text-[#2D2D2D] h-10 w-10 flex items-center justify-center">
                  <PanelLeft className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center pointer-events-auto">
                <SettingsDropdown />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-8 pt-20 flex flex-col items-center relative z-0">
              <div className="w-full max-w-3xl mb-8">
                <h1 className="text-[28px] font-semibold tracking-tight text-[#1C1C1E]">
                  {activeView === 'project' ? 'Project Plan' : 'Today'}
                </h1>
              </div>
              <div className="w-full max-w-3xl mb-8">
                <NextActionWidget />
              </div>
              <div className="w-full max-w-3xl pb-24">
                <TaskList />
              </div>
            </div>
            {activeView === 'project' && <ProjectChat />}
          </>
        )}
      </div>
    </div>
  );
}

export default App;
```

- [ ] **Step 3: Verify build**

```bash
cd src-tauri && cargo build 2>&1 | tail -30
```

Expected: `Finished` with no errors.

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/voice.rs \
        src/App.tsx
git commit -m "feat: implement voice_capture_plan command and navigate_to_goal event listener"
```

---

## Task 8: Onboarding UI

**Files:**
- Create: `src/components/Onboarding.tsx`

**Interfaces:**
- Consumes: `savePreferences` from Zustand store
- Produces: `<Onboarding />` — 3-step wizard shown once after first login

- [ ] **Step 1: Create Onboarding.tsx**

Create `src/components/Onboarding.tsx`:

```typescript
import { useState } from 'react';
import { useStore } from '../store';
import clsx from 'clsx';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const FOCUS_BLOCKS = [30, 60, 90, 120];

export function Onboarding() {
    const { savePreferences } = useStore();
    const [step, setStep] = useState(1);
    const [workStart, setWorkStart] = useState('09:00');
    const [workEnd, setWorkEnd] = useState('18:00');
    const [focusBlock, setFocusBlock] = useState(60);
    const [daysOff, setDaysOff] = useState<string[]>(['Saturday', 'Sunday']);

    function toggleDay(day: string) {
        setDaysOff((prev) =>
            prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
        );
    }

    async function handleFinish() {
        await savePreferences({
            work_start: workStart,
            work_end: workEnd,
            focus_block_mins: focusBlock,
            days_off: daysOff.join(','),
        });
    }

    return (
        <div className="flex flex-col items-center justify-center w-full h-full bg-[#FAFAFA] px-8">
            <div className="w-full max-w-md">
                {/* Progress dots */}
                <div className="flex justify-center gap-2 mb-10">
                    {[1, 2, 3].map((s) => (
                        <div
                            key={s}
                            className={clsx(
                                'w-2 h-2 rounded-full transition-colors',
                                s === step ? 'bg-[#85D24E]' : s < step ? 'bg-[#85D24E]/50' : 'bg-black/10'
                            )}
                        />
                    ))}
                </div>

                {step === 1 && (
                    <div className="flex flex-col gap-6">
                        <div>
                            <h2 className="text-[22px] font-semibold text-[#1C1C1E] mb-1">When do you work?</h2>
                            <p className="text-[14px] text-black/50">Movo will schedule tasks only within these hours.</p>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="flex flex-col gap-1 flex-1">
                                <label className="text-[12px] font-medium text-black/50">Start</label>
                                <input
                                    type="time"
                                    value={workStart}
                                    onChange={(e) => setWorkStart(e.target.value)}
                                    className="px-3 py-2 rounded-xl border border-black/10 bg-white text-[14px] text-[#1C1C1E] outline-none focus:border-[#85D24E] focus:ring-2 focus:ring-[#85D24E]/20"
                                />
                            </div>
                            <span className="text-black/30 mt-5">→</span>
                            <div className="flex flex-col gap-1 flex-1">
                                <label className="text-[12px] font-medium text-black/50">End</label>
                                <input
                                    type="time"
                                    value={workEnd}
                                    onChange={(e) => setWorkEnd(e.target.value)}
                                    className="px-3 py-2 rounded-xl border border-black/10 bg-white text-[14px] text-[#1C1C1E] outline-none focus:border-[#85D24E] focus:ring-2 focus:ring-[#85D24E]/20"
                                />
                            </div>
                        </div>
                        <button
                            onClick={() => setStep(2)}
                            className="mt-4 py-3 bg-[#85D24E] text-white font-semibold rounded-xl hover:bg-[#7bc248] transition-colors"
                        >
                            Continue
                        </button>
                    </div>
                )}

                {step === 2 && (
                    <div className="flex flex-col gap-6">
                        <div>
                            <h2 className="text-[22px] font-semibold text-[#1C1C1E] mb-1">Ideal focus session?</h2>
                            <p className="text-[14px] text-black/50">Movo will schedule tasks in blocks of this length.</p>
                        </div>
                        <div className="flex gap-3 flex-wrap">
                            {FOCUS_BLOCKS.map((mins) => (
                                <button
                                    key={mins}
                                    onClick={() => setFocusBlock(mins)}
                                    className={clsx(
                                        'px-5 py-2.5 rounded-xl text-[14px] font-medium border transition-colors',
                                        focusBlock === mins
                                            ? 'bg-[#85D24E] text-white border-[#85D24E]'
                                            : 'bg-white text-black/70 border-black/10 hover:border-[#85D24E]/50'
                                    )}
                                >
                                    {mins < 60 ? `${mins} min` : `${mins / 60} hr${mins > 60 ? 's' : ''}`}
                                </button>
                            ))}
                        </div>
                        <div className="flex gap-3 mt-4">
                            <button
                                onClick={() => setStep(1)}
                                className="flex-1 py-3 bg-black/5 text-black/60 font-semibold rounded-xl hover:bg-black/10 transition-colors"
                            >
                                Back
                            </button>
                            <button
                                onClick={() => setStep(3)}
                                className="flex-1 py-3 bg-[#85D24E] text-white font-semibold rounded-xl hover:bg-[#7bc248] transition-colors"
                            >
                                Continue
                            </button>
                        </div>
                    </div>
                )}

                {step === 3 && (
                    <div className="flex flex-col gap-6">
                        <div>
                            <h2 className="text-[22px] font-semibold text-[#1C1C1E] mb-1">Days off?</h2>
                            <p className="text-[14px] text-black/50">Movo won't schedule anything on these days.</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {DAYS.map((day) => (
                                <button
                                    key={day}
                                    onClick={() => toggleDay(day)}
                                    className={clsx(
                                        'px-4 py-2 rounded-xl text-[13px] font-medium border transition-colors',
                                        daysOff.includes(day)
                                            ? 'bg-[#85D24E] text-white border-[#85D24E]'
                                            : 'bg-white text-black/70 border-black/10 hover:border-[#85D24E]/50'
                                    )}
                                >
                                    {day.slice(0, 3)}
                                </button>
                            ))}
                        </div>
                        <div className="flex gap-3 mt-4">
                            <button
                                onClick={() => setStep(2)}
                                className="flex-1 py-3 bg-black/5 text-black/60 font-semibold rounded-xl hover:bg-black/10 transition-colors"
                            >
                                Back
                            </button>
                            <button
                                onClick={handleFinish}
                                className="flex-1 py-3 bg-[#85D24E] text-white font-semibold rounded-xl hover:bg-[#7bc248] transition-colors"
                            >
                                Let's go →
                            </button>
                        </div>
                        <button
                            onClick={handleFinish}
                            className="text-[12px] text-black/30 hover:text-black/50 text-center transition-colors"
                        >
                            Skip — use defaults
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/Onboarding.tsx
git commit -m "feat: add 3-step onboarding wizard for user preferences"
```

---

## Task 9: Calendar View + Sidebar Tab

**Files:**
- Create: `src/components/CalendarView.tsx`
- Modify: `src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `fetchEvents`, `events` from Zustand store; `date-fns` for date math
- Produces: `<CalendarView />` — week view with event blocks, `<Sidebar />` with Calendar tab

- [ ] **Step 1: Create CalendarView.tsx**

Create `src/components/CalendarView.tsx`:

```typescript
import { useEffect, useState } from 'react';
import {
    startOfWeek,
    endOfWeek,
    eachDayOfInterval,
    format,
    addWeeks,
    subWeeks,
    parseISO,
    getHours,
    getMinutes,
    isSameDay,
    startOfMonth,
    endOfMonth,
    eachWeekOfInterval,
    getDay,
} from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useStore } from '../store';
import clsx from 'clsx';

const GOAL_COLORS = [
    'bg-[#85D24E]/80 border-[#85D24E]',
    'bg-blue-400/80 border-blue-500',
    'bg-purple-400/80 border-purple-500',
    'bg-orange-400/80 border-orange-500',
    'bg-pink-400/80 border-pink-500',
];

const WORK_START_HOUR = 8;
const WORK_END_HOUR = 20;
const HOURS = Array.from({ length: WORK_END_HOUR - WORK_START_HOUR }, (_, i) => WORK_START_HOUR + i);

export function CalendarView() {
    const { events, fetchEvents } = useStore();
    const [currentDate, setCurrentDate] = useState(new Date());
    const [viewMode, setViewMode] = useState<'week' | 'month'>('week');

    // Build a stable goal → color map from the events in the current view
    const goalColorMap = new Map<string, string>();
    let colorIndex = 0;
    for (const ev of events) {
        if (ev.goal_id && !goalColorMap.has(ev.goal_id)) {
            goalColorMap.set(ev.goal_id, GOAL_COLORS[colorIndex % GOAL_COLORS.length]);
            colorIndex++;
        }
    }

    useEffect(() => {
        const from = viewMode === 'week'
            ? startOfWeek(currentDate, { weekStartsOn: 1 })
            : startOfMonth(currentDate);
        const to = viewMode === 'week'
            ? endOfWeek(currentDate, { weekStartsOn: 1 })
            : endOfMonth(currentDate);
        fetchEvents(from.toISOString(), to.toISOString());
    }, [currentDate, viewMode]);

    function prev() {
        setCurrentDate((d) => viewMode === 'week' ? subWeeks(d, 1) : new Date(d.getFullYear(), d.getMonth() - 1, 1));
    }
    function next() {
        setCurrentDate((d) => viewMode === 'week' ? addWeeks(d, 1) : new Date(d.getFullYear(), d.getMonth() + 1, 1));
    }

    const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
    const weekDays = eachDayOfInterval({ start: weekStart, end: endOfWeek(currentDate, { weekStartsOn: 1 }) });

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-[28px] font-semibold tracking-tight text-[#1C1C1E]">Calendar</h1>
                <div className="flex items-center gap-3">
                    <div className="flex rounded-xl overflow-hidden border border-black/10">
                        <button
                            onClick={() => setViewMode('week')}
                            className={clsx(
                                'px-4 py-1.5 text-[13px] font-medium transition-colors',
                                viewMode === 'week' ? 'bg-[#85D24E] text-white' : 'bg-white text-black/60 hover:bg-black/5'
                            )}
                        >
                            Week
                        </button>
                        <button
                            onClick={() => setViewMode('month')}
                            className={clsx(
                                'px-4 py-1.5 text-[13px] font-medium transition-colors',
                                viewMode === 'month' ? 'bg-[#85D24E] text-white' : 'bg-white text-black/60 hover:bg-black/5'
                            )}
                        >
                            Month
                        </button>
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={prev}
                            className="p-2 rounded-lg hover:bg-black/5 text-black/60 transition-colors"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <span className="text-[14px] font-medium text-[#1C1C1E] min-w-[140px] text-center">
                            {viewMode === 'week'
                                ? `${format(weekStart, 'MMM d')} – ${format(endOfWeek(currentDate, { weekStartsOn: 1 }), 'MMM d, yyyy')}`
                                : format(currentDate, 'MMMM yyyy')}
                        </span>
                        <button
                            onClick={next}
                            className="p-2 rounded-lg hover:bg-black/5 text-black/60 transition-colors"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>

            {viewMode === 'week' ? (
                <WeekView days={weekDays} events={events} goalColorMap={goalColorMap} />
            ) : (
                <MonthView currentDate={currentDate} events={events} goalColorMap={goalColorMap} />
            )}
        </div>
    );
}

function WeekView({
    days,
    events,
    goalColorMap,
}: {
    days: Date[];
    events: ReturnType<typeof useStore>['events'];
    goalColorMap: Map<string, string>;
}) {
    const totalMinutes = (WORK_END_HOUR - WORK_START_HOUR) * 60;

    return (
        <div className="flex flex-1 overflow-hidden border border-black/10 rounded-2xl bg-white">
            {/* Time gutter */}
            <div className="w-16 shrink-0 border-r border-black/5 pt-10">
                {HOURS.map((hour) => (
                    <div key={hour} className="h-[60px] flex items-start justify-end pr-3 pt-0.5">
                        <span className="text-[11px] text-black/30 font-medium">
                            {hour < 12 ? `${hour}am` : hour === 12 ? '12pm' : `${hour - 12}pm`}
                        </span>
                    </div>
                ))}
            </div>

            {/* Day columns */}
            <div className="flex flex-1 overflow-x-auto">
                {days.map((day) => {
                    const dayEvents = events.filter((ev) => {
                        try {
                            return isSameDay(parseISO(ev.start_time), day);
                        } catch {
                            return false;
                        }
                    });

                    return (
                        <div key={day.toISOString()} className="flex-1 min-w-[100px] border-r border-black/5 last:border-r-0 relative">
                            {/* Day header */}
                            <div className="h-10 flex flex-col items-center justify-center border-b border-black/5">
                                <span className="text-[11px] text-black/40 uppercase tracking-wide">
                                    {format(day, 'EEE')}
                                </span>
                                <span className={clsx(
                                    'text-[13px] font-semibold',
                                    isSameDay(day, new Date()) ? 'text-[#85D24E]' : 'text-[#1C1C1E]'
                                )}>
                                    {format(day, 'd')}
                                </span>
                            </div>

                            {/* Hour grid lines */}
                            <div className="relative" style={{ height: `${totalMinutes}px` }}>
                                {HOURS.map((hour) => (
                                    <div
                                        key={hour}
                                        className="absolute left-0 right-0 border-t border-black/5"
                                        style={{ top: `${(hour - WORK_START_HOUR) * 60}px` }}
                                    />
                                ))}

                                {/* Events */}
                                {dayEvents.map((ev) => {
                                    let startMin = 0;
                                    let durationMin = 30;
                                    try {
                                        const start = parseISO(ev.start_time);
                                        const end = parseISO(ev.end_time);
                                        startMin = (getHours(start) - WORK_START_HOUR) * 60 + getMinutes(start);
                                        durationMin = Math.max(
                                            30,
                                            (getHours(end) - getHours(start)) * 60 + (getMinutes(end) - getMinutes(start))
                                        );
                                    } catch {}

                                    const colorClass = ev.goal_id
                                        ? goalColorMap.get(ev.goal_id) ?? GOAL_COLORS[0]
                                        : GOAL_COLORS[0];

                                    return (
                                        <div
                                            key={ev.id}
                                            className={clsx(
                                                'absolute left-1 right-1 rounded-lg border-l-[3px] px-2 py-1 overflow-hidden cursor-default',
                                                colorClass
                                            )}
                                            style={{
                                                top: `${Math.max(0, startMin)}px`,
                                                height: `${Math.min(durationMin, totalMinutes - startMin)}px`,
                                            }}
                                            title={`${ev.title}\n${ev.goal_title ?? ''}`}
                                        >
                                            <p className="text-[11px] font-semibold text-white leading-tight truncate">
                                                {ev.title}
                                            </p>
                                            {ev.goal_title && (
                                                <p className="text-[10px] text-white/80 truncate">{ev.goal_title}</p>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function MonthView({
    currentDate,
    events,
    goalColorMap,
}: {
    currentDate: Date;
    events: ReturnType<typeof useStore>['events'];
    goalColorMap: Map<string, string>;
}) {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const weeks = eachWeekOfInterval({ start: monthStart, end: monthEnd }, { weekStartsOn: 1 });

    return (
        <div className="flex flex-col flex-1 border border-black/10 rounded-2xl overflow-hidden bg-white">
            {/* Day headers */}
            <div className="grid grid-cols-7 border-b border-black/10">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                    <div key={d} className="py-2 text-center text-[11px] font-semibold text-black/40 uppercase tracking-wide">
                        {d}
                    </div>
                ))}
            </div>

            {/* Weeks */}
            <div className="flex flex-col flex-1">
                {weeks.map((weekStart) => {
                    const days = eachDayOfInterval({
                        start: weekStart,
                        end: endOfWeek(weekStart, { weekStartsOn: 1 }),
                    });
                    return (
                        <div key={weekStart.toISOString()} className="grid grid-cols-7 flex-1 border-b border-black/5 last:border-b-0">
                            {days.map((day) => {
                                const dayEvents = events.filter((ev) => {
                                    try { return isSameDay(parseISO(ev.start_time), day); } catch { return false; }
                                });
                                const isCurrentMonth = day.getMonth() === currentDate.getMonth();

                                return (
                                    <div
                                        key={day.toISOString()}
                                        className={clsx(
                                            'p-1.5 border-r border-black/5 last:border-r-0 min-h-[80px]',
                                            !isCurrentMonth && 'opacity-30'
                                        )}
                                    >
                                        <span className={clsx(
                                            'text-[12px] font-medium inline-flex items-center justify-center w-6 h-6 rounded-full',
                                            isSameDay(day, new Date())
                                                ? 'bg-[#85D24E] text-white'
                                                : 'text-[#1C1C1E]'
                                        )}>
                                            {format(day, 'd')}
                                        </span>
                                        <div className="mt-1 flex flex-col gap-0.5">
                                            {dayEvents.slice(0, 3).map((ev) => {
                                                const colorClass = ev.goal_id
                                                    ? goalColorMap.get(ev.goal_id) ?? GOAL_COLORS[0]
                                                    : GOAL_COLORS[0];
                                                return (
                                                    <div
                                                        key={ev.id}
                                                        className={clsx(
                                                            'text-[10px] text-white font-medium rounded px-1 py-0.5 truncate',
                                                            colorClass.split(' ')[0]
                                                        )}
                                                        title={ev.title}
                                                    >
                                                        {ev.title}
                                                    </div>
                                                );
                                            })}
                                            {dayEvents.length > 3 && (
                                                <span className="text-[10px] text-black/40">+{dayEvents.length - 3} more</span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Add Calendar tab to Sidebar.tsx**

Open `src/components/Sidebar.tsx`. In the Library section, add a Calendar item after the Upcoming item:

Find this block:
```typescript
                    <SidebarItem 
                        icon={<Calendar className="w-4 h-4" />} 
                        label="Upcoming" 
                        active={activeView === 'upcoming'}
                        onClick={() => setActiveView('upcoming')}
                    />
                    <SidebarItem 
                        icon={<CheckSquare className="w-4 h-4" />} 
```

Replace with:
```typescript
                    <SidebarItem 
                        icon={<Calendar className="w-4 h-4" />} 
                        label="Upcoming" 
                        active={activeView === 'upcoming'}
                        onClick={() => setActiveView('upcoming')}
                    />
                    <SidebarItem 
                        icon={<CalendarDays className="w-4 h-4" />} 
                        label="Calendar" 
                        active={activeView === 'calendar'}
                        onClick={() => setActiveView('calendar')}
                    />
                    <SidebarItem 
                        icon={<CheckSquare className="w-4 h-4" />} 
```

Also add `CalendarDays` to the lucide-react import at the top:

```typescript
import { Library, Clock, Calendar, CalendarDays, CheckSquare, Target, Trash2, LogOut, Plus } from 'lucide-react';
```

- [ ] **Step 3: Update setActiveView in store to handle calendar**

The store already accepts `'calendar'` as a valid `ActiveView` type (added in Task 5). No changes needed — `setActiveView('calendar')` will work.

- [ ] **Step 4: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 5: Final Rust build**

```bash
cd src-tauri && cargo build 2>&1 | tail -10
```

Expected: `Finished` with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/CalendarView.tsx \
        src/components/Sidebar.tsx
git commit -m "feat: add CalendarView week/month component and Calendar sidebar tab"
```

---

## Self-Review

**Spec coverage check:**
- ✅ macOS menu bar icon — Task 2 (SystemTray in lib.rs)
- ✅ Spotlight-style voice popup — Tasks 3 + 6 (VoicePopup.tsx, tauri.conf.json)
- ✅ Live transcription + waveform — Task 6 (VoicePopup.tsx SpeechRecognition)
- ✅ Mic permission denied flow — Task 6 (onerror handler + open_mic_settings)
- ✅ Voice → plan → open main window — Task 7 (voice_capture_plan + navigate_to_goal)
- ✅ User persona onboarding — Task 8 (Onboarding.tsx, user_preferences table)
- ✅ AI planning with persona context — Task 7 (system_prompt includes work hours + days off)
- ✅ OpenAI function calling (not regex) — Task 4 (chat_with_tools)
- ✅ In-app calendar week + month view — Task 9 (CalendarView.tsx)
- ✅ CalendarProvider provision — Task 1 (get_events_in_range, add_event — LocalCalendarProvider behavior; Apple/Google stubbed via not-yet-implemented pattern)
- ✅ Events stored and queried — Tasks 1 + 7 (repository + voice_capture_plan inserts events)

**Placeholder scan:** None found. All steps have actual code.

**Type consistency check:**
- `UserPreferences` struct fields match across: model, repository, store interface, preferences command parameters
- `CalendarEvent` fields match across: model, repository SQL, store interface, CalendarView props
- `ToolCall { name, arguments }` used consistently across openai.rs and chat.rs
- `activeView: 'calendar'` added to type union in store — Sidebar and App.tsx both use `setActiveView('calendar')`
- `AppState.current_user_id` used consistently across auth.rs, preferences.rs, calendar.rs, voice.rs
