# Global Chat + Task Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-goal chat + plan_goal flow with two AI commands — global_chat (model creates projects via tool) and task_chat (model takes actions on a specific task).

**Architecture:** Two new Tauri async commands (`global_chat`, `task_chat`) each with their own tool set and system prompt, sharing `OpenAiProvider` and `Repository`. A per-user sentinel goal row (`__global_{user_id}`) stores global chat history in the existing `chat_messages` table. Task chat messages are in-memory (Zustand state), sent as `history` on each invocation. Calendar context is pre-loaded into the system prompt (next 4 weeks) rather than as a runtime tool — no Node.js server needed.

**Tech Stack:** Rust (Tauri 2, rusqlite, reqwest), TypeScript (React 19, Zustand), Tailwind CSS v4.

## Global Constraints

- Rust edition 2021; use existing `AppState`, `Repository`, `OpenAiProvider` patterns
- All Tauri commands must be registered in `src-tauri/src/lib.rs` invoke_handler
- Frontend state lives exclusively in `src/store/index.ts`; components never call `invoke` directly
- Use existing `parseAIMessage` / `InteractiveQuestion` for AI message rendering
- `get_active_goals` filters `status = 'active'`; sentinel goal uses `status = 'archived'` so it never appears in the sidebar
- Tailwind classes follow existing patterns: `text-[#85D24E]` green, `text-[#1C1C1E]` dark text, `border-black/8` borders

---

### Task 1: Repository — add new query methods

**Files:**
- Modify: `src-tauri/src/db/repository.rs`

**Interfaces:**
- Produces:
  - `Repository::get_or_create_global_goal(user_id: &str) -> Result<String>` → returns sentinel goal id `"__global_{user_id}"`
  - `Repository::get_task_with_goal_event(task_id: &str) -> Result<TaskContext>`
  - `Repository::reschedule_task_event(user_id, task_id, title, new_start, new_end) -> Result<CalendarEvent>`
  - `Repository::split_into_subtasks(task_id: &str, subtasks: &[SubtaskInput]) -> Result<Vec<Task>>`
  - `pub struct TaskContext { pub task: Task, pub goal_title: String, pub event: Option<CalendarEvent> }`
  - `pub struct SubtaskInput { pub title: String, pub effort_minutes: i32, pub priority: i32 }`

- [ ] **Step 1: Add `TaskContext` and `SubtaskInput` structs above `impl Repository`**

Add after the `use` imports at the top of `repository.rs`:

```rust
#[derive(Debug)]
pub struct TaskContext {
    pub task: Task,
    pub goal_title: String,
    pub event: Option<CalendarEvent>,
}

#[derive(Debug, serde::Deserialize)]
pub struct SubtaskInput {
    pub title: String,
    pub effort_minutes: i32,
    pub priority: i32,
}
```

- [ ] **Step 2: Add `get_or_create_global_goal` to `impl Repository`**

Add inside `impl Repository`:

```rust
pub fn get_or_create_global_goal(&self, user_id: &str) -> Result<String> {
    let goal_id = format!("__global_{}", user_id);
    self.conn.execute(
        "INSERT OR IGNORE INTO goals (id, user_id, title, status, created_at)
         VALUES (?1, ?2, '__global_chat__', 'archived', ?3)",
        params![goal_id, user_id, chrono::Utc::now().to_rfc3339()],
    )?;
    Ok(goal_id)
}
```

- [ ] **Step 3: Add `get_task_with_goal_event` to `impl Repository`**

```rust
pub fn get_task_with_goal_event(&self, task_id: &str) -> Result<TaskContext> {
    let (task, goal_title) = self.conn.query_row(
        "SELECT t.id, t.goal_id, t.title, t.description, t.status,
                t.effort_minutes, t.priority, t.created_at, t.deadline, g.title
         FROM tasks t
         INNER JOIN goals g ON t.goal_id = g.id
         WHERE t.id = ?1",
        params![task_id],
        |row| {
            let status_str: String = row.get(4)?;
            let status = status_str.parse().unwrap_or(TaskStatus::Todo);
            Ok((
                Task {
                    id: row.get(0)?,
                    goal_id: row.get(1)?,
                    title: row.get(2)?,
                    description: row.get(3)?,
                    status,
                    effort_minutes: row.get(5)?,
                    priority: row.get(6)?,
                    created_at: row.get(7)?,
                    deadline: row.get(8)?,
                },
                row.get::<_, String>(9)?,
            ))
        },
    )?;

    let mut stmt = self.conn.prepare(
        "SELECT id, task_id, title, start_time, end_time, status
         FROM events WHERE task_id = ?1 ORDER BY start_time DESC LIMIT 1",
    )?;
    let event = stmt
        .query_row(params![task_id], |row| {
            Ok(CalendarEvent {
                id: row.get(0)?,
                task_id: row.get(1)?,
                title: row.get(2)?,
                start_time: row.get(3)?,
                end_time: row.get(4)?,
                status: row.get(5)?,
                goal_id: None,
                goal_title: None,
            })
        })
        .ok();

    Ok(TaskContext { task, goal_title, event })
}
```

- [ ] **Step 4: Add `reschedule_task_event` to `impl Repository`**

```rust
pub fn reschedule_task_event(
    &self,
    user_id: &str,
    task_id: &str,
    title: &str,
    new_start: &str,
    new_end: &str,
) -> Result<CalendarEvent> {
    self.conn.execute("DELETE FROM events WHERE task_id = ?1", params![task_id])?;
    let id = uuid::Uuid::new_v4().to_string();
    self.conn.execute(
        "INSERT INTO events (id, task_id, title, start_time, end_time, status, user_id)
         VALUES (?1, ?2, ?3, ?4, ?5, 'scheduled', ?6)",
        params![id, task_id, title, new_start, new_end, user_id],
    )?;
    Ok(CalendarEvent {
        id,
        task_id: Some(task_id.to_string()),
        title: title.to_string(),
        start_time: new_start.to_string(),
        end_time: new_end.to_string(),
        status: "scheduled".to_string(),
        goal_id: None,
        goal_title: None,
    })
}
```

- [ ] **Step 5: Add `split_into_subtasks` to `impl Repository`**

```rust
pub fn split_into_subtasks(
    &self,
    task_id: &str,
    subtasks: &[SubtaskInput],
) -> Result<Vec<Task>> {
    let goal_id: String = self.conn.query_row(
        "SELECT goal_id FROM tasks WHERE id = ?1",
        params![task_id],
        |row| row.get(0),
    )?;
    self.conn.execute(
        "UPDATE tasks SET status = 'completed' WHERE id = ?1",
        params![task_id],
    )?;
    let mut created = Vec::new();
    for sub in subtasks {
        let new_task = Task {
            id: uuid::Uuid::new_v4().to_string(),
            goal_id: Some(goal_id.clone()),
            title: sub.title.clone(),
            description: None,
            status: TaskStatus::Todo,
            effort_minutes: sub.effort_minutes,
            priority: sub.priority,
            created_at: chrono::Utc::now().to_rfc3339(),
            deadline: None,
        };
        self.add_task(&new_task)?;
        created.push(new_task);
    }
    Ok(created)
}
```

- [ ] **Step 6: Add tests in `repository.rs` `#[cfg(test)]` block**

```rust
#[test]
fn get_or_create_global_goal_is_idempotent() {
    let conn = setup();
    conn.execute(
        "INSERT INTO users (id,email,name,password_hash,created_at) VALUES ('u1','a@b.com','A','x','2026-01-01')",
        [],
    ).unwrap();
    let repo = Repository::new(&conn);
    let id1 = repo.get_or_create_global_goal("u1").unwrap();
    let id2 = repo.get_or_create_global_goal("u1").unwrap();
    assert_eq!(id1, id2);
    assert_eq!(id1, "__global_u1");
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM goals WHERE id = '__global_u1'", [], |r| r.get(0)
    ).unwrap();
    assert_eq!(count, 1);
}

#[test]
fn reschedule_task_event_replaces_old_event() {
    let conn = setup();
    conn.execute("INSERT INTO users (id,email,name,password_hash,created_at) VALUES ('u1','a@b.com','A','x','2026-01-01')", []).unwrap();
    conn.execute("INSERT INTO goals (id,user_id,title,status,created_at) VALUES ('g1','u1','G','active','2026-01-01')", []).unwrap();
    conn.execute("INSERT INTO tasks (id,goal_id,title,status,effort_minutes,priority,created_at) VALUES ('t1','g1','Task','todo',60,1,'2026-01-01')", []).unwrap();
    let repo = Repository::new(&conn);
    repo.create_scheduled_event_for_task("u1", "t1", "Task", "2026-07-01T09:00:00Z", "2026-07-01T10:00:00Z").unwrap();
    repo.reschedule_task_event("u1", "t1", "Task", "2026-07-07T10:00:00Z", "2026-07-07T11:00:00Z").unwrap();
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM events WHERE task_id='t1'", [], |r| r.get(0)).unwrap();
    assert_eq!(count, 1);
    let start: String = conn.query_row("SELECT start_time FROM events WHERE task_id='t1'", [], |r| r.get(0)).unwrap();
    assert!(start.contains("2026-07-07"));
}

#[test]
fn split_into_subtasks_completes_original_and_creates_children() {
    let conn = setup();
    conn.execute("INSERT INTO users (id,email,name,password_hash,created_at) VALUES ('u1','a@b.com','A','x','2026-01-01')", []).unwrap();
    conn.execute("INSERT INTO goals (id,user_id,title,status,created_at) VALUES ('g1','u1','G','active','2026-01-01')", []).unwrap();
    conn.execute("INSERT INTO tasks (id,goal_id,title,status,effort_minutes,priority,created_at) VALUES ('t1','g1','Big Task','todo',120,1,'2026-01-01')", []).unwrap();
    let repo = Repository::new(&conn);
    let subs = vec![
        SubtaskInput { title: "Sub A".to_string(), effort_minutes: 60, priority: 1 },
        SubtaskInput { title: "Sub B".to_string(), effort_minutes: 60, priority: 2 },
    ];
    let created = repo.split_into_subtasks("t1", &subs).unwrap();
    assert_eq!(created.len(), 2);
    let status: String = conn.query_row("SELECT status FROM tasks WHERE id='t1'", [], |r| r.get(0)).unwrap();
    assert_eq!(status, "completed");
}
```

- [ ] **Step 7: Run tests**

```bash
cd src-tauri && cargo test db::repository
```

Expected: all new tests pass.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/db/repository.rs
git commit -m "feat(db): add global goal init, task context, reschedule, and split methods"
```

---

### Task 2: AI tool definitions

**Files:**
- Modify: `src-tauri/src/ai/openai.rs`

**Interfaces:**
- Produces:
  - `pub fn global_chat_tools() -> Value`
  - `pub fn task_chat_tools() -> Value`

- [ ] **Step 1: Replace `chat_tools()` with `global_chat_tools()` and add `task_chat_tools()`**

Replace the existing `chat_tools()` function and add the new one at the bottom of `openai.rs`:

```rust
/// Tool definitions for the global (project-creation) chat.
pub fn global_chat_tools() -> Value {
    json!([
        {
            "type": "function",
            "name": "create_project",
            "description": "Create a new goal/project when the user has clearly stated a trackable objective. Do NOT call this for casual greetings, vague ideas, or when clarification is still needed.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": { "type": "string" },
                    "description": { "type": ["string", "null"] },
                    "target_date": { "type": ["string", "null"], "description": "YYYY-MM-DD" }
                },
                "required": ["title"]
            }
        },
        {
            "type": "function",
            "name": "create_task",
            "description": "Create a task under an existing goal. Only call after create_project has been called and you have a goal_id.",
            "parameters": {
                "type": "object",
                "properties": {
                    "goal_id": { "type": "string" },
                    "title": { "type": "string" },
                    "description": { "type": ["string", "null"] },
                    "effort_minutes": { "type": "integer" },
                    "priority": { "type": "integer", "minimum": 1, "maximum": 5 },
                    "deadline": { "type": ["string", "null"], "description": "ISO 8601 e.g. 2026-07-15" }
                },
                "required": ["goal_id", "title", "effort_minutes", "priority"]
            }
        },
        {
            "type": "function",
            "name": "delete_task",
            "description": "Delete an existing task by its ID.",
            "parameters": {
                "type": "object",
                "properties": {
                    "task_id": { "type": "string" }
                },
                "required": ["task_id"]
            }
        },
        {
            "type": "function",
            "name": "add_to_calendar",
            "description": "Add a time block or event to the user's calendar. Check OCCUPIED SLOTS in the system prompt before scheduling.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": { "type": "string" },
                    "start_time": { "type": "string", "description": "ISO 8601 e.g. 2026-07-15T09:00:00Z" },
                    "end_time":   { "type": "string", "description": "ISO 8601 e.g. 2026-07-15T10:00:00Z" }
                },
                "required": ["title", "start_time", "end_time"]
            }
        }
    ])
}

/// Tool definitions for the per-task chat.
pub fn task_chat_tools() -> Value {
    json!([
        {
            "type": "function",
            "name": "reschedule_task",
            "description": "Move this task's calendar slot to a new time. Check OCCUPIED SLOTS before proposing a new time.",
            "parameters": {
                "type": "object",
                "properties": {
                    "new_start": { "type": "string", "description": "ISO 8601 e.g. 2026-07-07T10:00:00Z" },
                    "new_end":   { "type": "string", "description": "ISO 8601 e.g. 2026-07-07T11:00:00Z" }
                },
                "required": ["new_start", "new_end"]
            }
        },
        {
            "type": "function",
            "name": "complete_task",
            "description": "Mark this task as completed.",
            "parameters": { "type": "object", "properties": {} }
        },
        {
            "type": "function",
            "name": "split_task",
            "description": "Break this task into smaller subtasks. The original task will be marked completed and replaced with the subtasks.",
            "parameters": {
                "type": "object",
                "properties": {
                    "subtasks": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": { "type": "string" },
                                "effort_minutes": { "type": "integer" },
                                "priority": { "type": "integer", "minimum": 1, "maximum": 5 }
                            },
                            "required": ["title", "effort_minutes", "priority"]
                        }
                    }
                },
                "required": ["subtasks"]
            }
        }
    ])
}
```

- [ ] **Step 2: Compile check**

```bash
cd src-tauri && cargo build 2>&1 | grep -E "^error"
```

Expected: no errors (warnings about unused `chat_tools` are fine for now).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/ai/openai.rs
git commit -m "feat(ai): add global_chat_tools and task_chat_tools definitions"
```

---

### Task 3: `global_chat` and `get_global_chat_history` Tauri commands

**Files:**
- Create: `src-tauri/src/commands/global_chat.rs`
- Modify: `src-tauri/src/commands/mod.rs`

**Interfaces:**
- Consumes: `Repository::{get_or_create_global_goal, add_message, get_messages_for_goal, create_goal, add_task, delete_task, create_standalone_event, get_events_in_range, get_user_preferences}`, `OpenAiProvider::chat_with_tools`, `global_chat_tools()`
- Produces:
  - Tauri command `global_chat(content: String) -> Result<GlobalChatResponse, String>`
  - Tauri command `get_global_chat_history() -> Result<Vec<ChatMessage>, String>`
  - `pub struct GlobalChatResponse { pub message: ChatMessage, pub created_goal_ids: Vec<String> }`

- [ ] **Step 1: Create `src-tauri/src/commands/global_chat.rs`**

```rust
use std::sync::Mutex;
use tauri::{State, AppHandle, Emitter};
use rusqlite::Connection;
use chrono::{Utc, Duration};
use uuid::Uuid;
use serde_json::Value;

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

    // Ensure sentinel goal and save user message
    let (global_goal_id, messages, prefs, events) = {
        let conn = conn.lock().map_err(|e| e.to_string())?;
        let repo = Repository::new(&conn);
        let goal_id = repo.get_or_create_global_goal(&user_id).map_err(|e| e.to_string())?;
        repo.add_message(&goal_id, ChatRole::User, &content).map_err(|e| e.to_string())?;
        let messages = repo.get_messages_for_goal(&goal_id).map_err(|e| e.to_string())?;
        let prefs = repo.get_user_preferences(&user_id).map_err(|e| e.to_string())?.unwrap_or_default();
        let now = Utc::now();
        let four_weeks = now + Duration::weeks(4);
        let events = repo.get_events_in_range(&user_id, &now.to_rfc3339(), &four_weeks.to_rfc3339()).unwrap_or_default();
        (goal_id, messages, prefs, events)
    };

    let calendar_str = if events.is_empty() {
        "No upcoming events.".to_string()
    } else {
        events.iter().map(|e| {
            let label = e.goal_title.as_deref().map(|g| format!(" [{}]", g)).unwrap_or_default();
            format!("  • {} – {}: {}{}", &e.start_time[..10], &e.end_time[..10], e.title, label)
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
        today = Utc::now().format("%A, %B %d, %Y"),
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
        format!("Done! I've set that up for you.")
    } else {
        ai_text
    };

    let ai_message = {
        let conn = conn.lock().map_err(|e| e.to_string())?;
        let repo = Repository::new(&conn);
        repo.add_message(&global_goal_id, ChatRole::Assistant, &response_text)
            .map_err(|e| e.to_string())?
    };

    Ok(GlobalChatResponse { message: ai_message, created_goal_ids })
}
```

- [ ] **Step 2: Add `global_chat` module to `commands/mod.rs`**

Add to `src-tauri/src/commands/mod.rs`:

```rust
pub mod global_chat;
```

- [ ] **Step 3: Compile check**

```bash
cd src-tauri && cargo build 2>&1 | grep -E "^error"
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/global_chat.rs src-tauri/src/commands/mod.rs
git commit -m "feat(backend): add global_chat and get_global_chat_history commands"
```

---

### Task 4: `task_chat` Tauri command

**Files:**
- Create: `src-tauri/src/commands/task_chat.rs`
- Modify: `src-tauri/src/commands/mod.rs`

**Interfaces:**
- Consumes: `Repository::{get_task_with_goal_event, reschedule_task_event, update_task_status, split_into_subtasks, get_events_in_range, get_user_preferences}`, `OpenAiProvider::chat_with_tools`, `task_chat_tools()`, `SubtaskInput`
- Produces:
  - Tauri command `task_chat(task_id: String, content: String, history: Vec<HistoryMessage>) -> Result<TaskChatResponse, String>`
  - `pub struct TaskChatResponse { pub message: String, pub task_updated: bool }`
  - `pub struct HistoryMessage { pub role: String, pub content: String }`

- [ ] **Step 1: Create `src-tauri/src/commands/task_chat.rs`**

```rust
use std::sync::Mutex;
use tauri::{State, AppHandle, Emitter};
use rusqlite::Connection;
use chrono::{Utc, Duration};
use serde_json::Value;

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
        "Currently scheduled: {} – {}", &e.start_time[..16], &e.end_time[..16]
    )).unwrap_or_else(|| "Not yet scheduled.".to_string());

    let calendar_str = if events.is_empty() {
        "No upcoming events.".to_string()
    } else {
        events.iter().map(|e| {
            let label = e.goal_title.as_deref().map(|g| format!(" [{}]", g)).unwrap_or_default();
            format!("  • {} – {}: {}{}", &e.start_time[..10], &e.end_time[..10], e.title, label)
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
                    let _ = repo.update_task_status(&task_id, "completed");
                    task_updated = true;
                }
                "split_task" => {
                    if let Some(arr) = call.arguments["subtasks"].as_array() {
                        let subtasks: Vec<SubtaskInput> = arr.iter().filter_map(|v| {
                            serde_json::from_value(v.clone()).ok()
                        }).collect();
                        if !subtasks.is_empty() {
                            let _ = repo.split_into_subtasks(&task_id, &subtasks);
                            task_updated = true;
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
```

- [ ] **Step 2: Add `task_chat` module to `commands/mod.rs`**

Add to `src-tauri/src/commands/mod.rs`:

```rust
pub mod task_chat;
```

- [ ] **Step 3: Compile check**

```bash
cd src-tauri && cargo build 2>&1 | grep -E "^error"
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/task_chat.rs src-tauri/src/commands/mod.rs
git commit -m "feat(backend): add task_chat command"
```

---

### Task 5: Register new commands and retire old ones in `lib.rs`

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `commands::global_chat::{global_chat, get_global_chat_history}`, `commands::task_chat::task_chat`

- [ ] **Step 1: Add new commands to `invoke_handler!` and remove retired ones**

In `src-tauri/src/lib.rs`, find the `invoke_handler!` block and make these changes:

Remove these lines:
```rust
commands::chat::chat_with_ai,
commands::chat::get_chat_history,
commands::planner::plan_goal,
```

Add these lines:
```rust
commands::global_chat::global_chat,
commands::global_chat::get_global_chat_history,
commands::task_chat::task_chat,
```

The final handler list should include:
```rust
.invoke_handler(tauri::generate_handler![
    commands::goals::create_goal,
    commands::goals::get_active_goals,
    commands::goals::delete_goal,
    commands::tasks::get_tasks_by_goal,
    commands::tasks::get_all_tasks,
    commands::auth::register_user,
    commands::auth::login_user,
    commands::global_chat::global_chat,
    commands::global_chat::get_global_chat_history,
    commands::task_chat::task_chat,
    commands::preferences::get_user_preferences,
    commands::preferences::save_user_preferences,
    commands::calendar::get_events_in_range,
    commands::calendar::create_event,
    commands::voice::voice_capture_plan,
    commands::voice::open_mic_settings,
    commands::voice::open_privacy_settings,
    commands::notifications::check_and_send_notifications,
    commands::tray::get_tray_tasks,
    commands::tasks::update_task_status,
    commands::recommendations::get_next_action,
    commands::recommendations::get_goal_stats,
    commands::recommendations::check_missed_sessions,
    commands::schedule::schedule_goal,
])
```

- [ ] **Step 2: Full compile**

```bash
cd src-tauri && cargo build 2>&1 | grep -E "^error"
```

Expected: no errors. Warnings about unused `chat_with_ai` / `plan_goal` functions are fine.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(backend): register global_chat and task_chat, retire chat_with_ai and plan_goal"
```

---

### Task 6: Zustand store additions

**Files:**
- Modify: `src/store/index.ts`

**Interfaces:**
- Produces (new state):
  - `globalMessages: ChatMessage[]`
  - `taskMessages: Record<string, ChatMessage[]>`
  - `activeChatTaskId: string | null`
- Produces (new actions):
  - `fetchGlobalMessages: () => Promise<void>`
  - `sendGlobalMessage: (content: string) => Promise<void>`
  - `sendTaskMessage: (taskId: string, content: string) => Promise<void>`
  - `setActiveChatTaskId: (id: string | null) => void`

- [ ] **Step 1: Add new interfaces to `src/store/index.ts`**

After the existing `MissedSession` interface, add:

```typescript
export interface GlobalChatResponse {
    message: ChatMessage;
    created_goal_ids: string[];
}

export interface TaskChatResponse {
    message: string;
    task_updated: boolean;
}
```

- [ ] **Step 2: Add new state fields to `AppState` interface**

In the `interface AppState` block, add these fields:

```typescript
globalMessages: ChatMessage[];
taskMessages: Record<string, ChatMessage[]>;
activeChatTaskId: string | null;

fetchGlobalMessages: () => Promise<void>;
sendGlobalMessage: (content: string) => Promise<void>;
sendTaskMessage: (taskId: string, content: string) => Promise<void>;
setActiveChatTaskId: (id: string | null) => void;
```

- [ ] **Step 3: Add initial values in `create<AppState>((set, _get) => ({`**

Add after `focusTaskId: null,`:

```typescript
globalMessages: [],
taskMessages: {},
activeChatTaskId: null,
```

- [ ] **Step 4: Add action implementations**

Add after the `setFocusTask` implementation:

```typescript
fetchGlobalMessages: async () => {
    try {
        const messages = await invoke<ChatMessage[]>('get_global_chat_history');
        set({ globalMessages: messages });
    } catch { /* silent */ }
},

sendGlobalMessage: async (content) => {
    const tempMsg: ChatMessage = {
        id: 'temp-' + Date.now(),
        goal_id: 'global',
        role: 'user',
        content,
        created_at: new Date().toISOString(),
    };
    set(state => ({ globalMessages: [...state.globalMessages, tempMsg], isLoading: true }));
    try {
        const response = await invoke<GlobalChatResponse>('global_chat', { content });
        set(state => ({
            globalMessages: [
                ...state.globalMessages.filter(m => m.id !== tempMsg.id),
                { ...tempMsg, id: 'user-' + Date.now() },
                response.message,
            ],
            isLoading: false,
        }));
        if (response.created_goal_ids.length > 0) {
            useStore.getState().fetchGoals();
        }
    } catch (error: any) {
        set(state => ({
            globalMessages: state.globalMessages.filter(m => m.id !== tempMsg.id),
            isLoading: false,
            error: error.toString(),
        }));
    }
},

sendTaskMessage: async (taskId, content) => {
    const currentHistory = useStore.getState().taskMessages[taskId] ?? [];
    const tempMsg: ChatMessage = {
        id: 'temp-' + Date.now(),
        goal_id: taskId,
        role: 'user',
        content,
        created_at: new Date().toISOString(),
    };
    set(state => ({
        taskMessages: { ...state.taskMessages, [taskId]: [...(state.taskMessages[taskId] ?? []), tempMsg] },
        isLoading: true,
    }));
    try {
        const history = currentHistory.map(m => ({ role: m.role as string, content: m.content }));
        const response = await invoke<TaskChatResponse>('task_chat', { taskId, content, history });
        const aiMsg: ChatMessage = {
            id: 'ai-' + Date.now(),
            goal_id: taskId,
            role: 'assistant',
            content: response.message,
            created_at: new Date().toISOString(),
        };
        const confirmedUserMsg: ChatMessage = { ...tempMsg, id: 'user-' + Date.now() };
        set(state => ({
            taskMessages: {
                ...state.taskMessages,
                [taskId]: [
                    ...(state.taskMessages[taskId] ?? []).filter(m => m.id !== tempMsg.id),
                    confirmedUserMsg,
                    aiMsg,
                ],
            },
            isLoading: false,
        }));
        if (response.task_updated) {
            const { activeGoalId } = useStore.getState();
            if (activeGoalId) useStore.getState().fetchTasksForGoal(activeGoalId);
            useStore.getState().fetchNextAction();
        }
    } catch {
        set(state => ({
            taskMessages: { ...state.taskMessages, [taskId]: (state.taskMessages[taskId] ?? []).filter(m => m.id !== tempMsg.id) },
            isLoading: false,
        }));
    }
},

setActiveChatTaskId: (id) => set({ activeChatTaskId: id }),
```

- [ ] **Step 5: Call `fetchGlobalMessages` on login**

In the `login` action, after `_get().fetchPreferences();`, add:

```typescript
_get().fetchGlobalMessages();
```

Do the same in `register`.

- [ ] **Step 6: TypeScript check**

```bash
npm run build 2>&1 | grep -i "error"
```

Expected: no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add src/store/index.ts
git commit -m "feat(store): add globalMessages, taskMessages, and chat action implementations"
```

---

### Task 7: `GlobalChat` component

**Files:**
- Create: `src/components/GlobalChat.tsx`

**Interfaces:**
- Consumes: `useStore().{globalMessages, sendGlobalMessage, isLoading}`, `parseAIMessage`, `InteractiveQuestion`
- Produces: `export function GlobalChat()`

- [ ] **Step 1: Create `src/components/GlobalChat.tsx`**

```tsx
import { useState, useRef, useEffect } from 'react';
import { Send, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useStore } from '../store';
import { parseAIMessage } from '../utils/messageParser';
import { InteractiveQuestion } from './InteractiveQuestion';

const PROSE = 'prose prose-sm max-w-none text-[#1C1C1E] prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-a:text-[#85D24E]';

function AIMessageContent({ content, onSelect }: { content: string; onSelect: (val: string) => void }) {
    const parsed = parseAIMessage(content);
    if (parsed.type === 'interactive_question') {
        return (
            <div className="flex flex-col gap-3">
                {parsed.prefix && (
                    <div className={PROSE}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{parsed.prefix}</ReactMarkdown>
                    </div>
                )}
                <InteractiveQuestion question={parsed.question} options={parsed.options} onSelect={onSelect} />
            </div>
        );
    }
    return (
        <div className={PROSE}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
    );
}

export function GlobalChat() {
    const { globalMessages, sendGlobalMessage, isLoading } = useStore();
    const [input, setInput] = useState('');
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [globalMessages]);

    const handleSend = async () => {
        const text = input.trim();
        if (!text || isLoading) return;
        setInput('');
        await sendGlobalMessage(text);
    };

    return (
        <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto px-6 py-6 flex flex-col gap-4">
                {globalMessages.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full gap-3 text-center opacity-60">
                        <p className="text-[15px] font-semibold text-[#1C1C1E]">What are you working toward?</p>
                        <p className="text-[13px] text-black/40 max-w-xs">
                            Tell me about a goal, ask for help with your schedule, or just say hi.
                        </p>
                    </div>
                )}
                {globalMessages.map(msg => (
                    <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                        <div className={`max-w-[80%] px-4 py-3 rounded-2xl text-[13px] leading-relaxed ${
                            msg.role === 'user'
                                ? 'bg-[#85D24E] text-black rounded-br-sm'
                                : 'bg-white border border-black/8 shadow-sm rounded-bl-sm'
                        }`}>
                            {msg.role === 'assistant'
                                ? <AIMessageContent content={msg.content} onSelect={sendGlobalMessage} />
                                : <p>{msg.content}</p>}
                        </div>
                    </div>
                ))}
                {isLoading && (
                    <div className="flex gap-3">
                        <div className="px-4 py-3 rounded-2xl rounded-bl-sm bg-white border border-black/8 shadow-sm">
                            <Loader2 className="w-4 h-4 animate-spin text-black/30" />
                        </div>
                    </div>
                )}
                <div ref={bottomRef} />
            </div>

            <div className="px-6 py-4 border-t border-black/8 bg-white/50 backdrop-blur-sm">
                <div className="flex items-end gap-3 bg-white border border-black/10 rounded-2xl px-4 py-3 shadow-sm">
                    <textarea
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSend();
                            }
                        }}
                        placeholder="Tell me about a goal or ask anything..."
                        className="flex-1 resize-none bg-transparent text-[13px] text-[#1C1C1E] placeholder:text-black/30 focus:outline-none max-h-32 min-h-[20px]"
                        rows={1}
                    />
                    <button
                        onClick={handleSend}
                        disabled={!input.trim() || isLoading}
                        className="w-8 h-8 flex items-center justify-center rounded-full bg-[#85D24E] hover:bg-[#7bc248] disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0"
                    >
                        <Send className="w-3.5 h-3.5 text-black" />
                    </button>
                </div>
            </div>
        </div>
    );
}
```

- [ ] **Step 2: TypeScript check**

```bash
npm run build 2>&1 | grep -i "error"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/GlobalChat.tsx
git commit -m "feat(ui): add GlobalChat component"
```

---

### Task 8: `GoalDetailView` component

**Files:**
- Create: `src/components/GoalDetailView.tsx`

**Interfaces:**
- Consumes: `useStore().{tasks, goals, activeGoalId, completeTask, setActiveChatTaskId, setFocusTask}`
- Produces: `export function GoalDetailView()`

- [ ] **Step 1: Create `src/components/GoalDetailView.tsx`**

```tsx
import { CheckSquare2, MessageSquare, Calendar, Clock, Zap } from 'lucide-react';
import { useStore } from '../store';
import clsx from 'clsx';

export function GoalDetailView() {
    const { tasks, goals, activeGoalId, completeTask, setActiveChatTaskId, setFocusTask } = useStore();

    const goal = goals.find(g => g.id === activeGoalId);
    const goalTasks = tasks.filter(t => t.goal_id === activeGoalId);
    const todo = goalTasks.filter(t => t.status !== 'completed');
    const done = goalTasks.filter(t => t.status === 'completed');

    return (
        <div className="flex-1 overflow-y-auto p-8 pt-20">
            <div className="max-w-3xl mx-auto">
                {goal && (
                    <div className="mb-8">
                        <h1 className="text-[24px] font-semibold tracking-tight text-[#1C1C1E]">{goal.title}</h1>
                        {goal.target_date && (
                            <p className="text-[13px] text-black/40 mt-1 flex items-center gap-1">
                                <Calendar className="w-3.5 h-3.5" />
                                Due {goal.target_date.slice(0, 10)}
                            </p>
                        )}
                    </div>
                )}

                <div className="flex flex-col gap-2">
                    {todo.map(task => (
                        <div
                            key={task.id}
                            className="flex items-start gap-3 px-4 py-3 bg-white rounded-xl border border-black/8 shadow-sm hover:shadow-md transition-shadow"
                        >
                            <button
                                onClick={() => completeTask(task.id)}
                                className="w-4 h-4 rounded-sm border-2 border-black/25 mt-0.5 shrink-0 hover:border-[#85D24E] transition-colors"
                            />
                            <div className="flex-1 min-w-0">
                                <p className="text-[13px] font-medium text-[#1C1C1E]">{task.title}</p>
                                <div className="flex items-center gap-3 mt-1">
                                    {task.deadline && (
                                        <span className="flex items-center gap-1 text-[11px] text-black/40">
                                            <Calendar className="w-3 h-3" />
                                            {task.deadline.slice(0, 10)}
                                        </span>
                                    )}
                                    <span className="flex items-center gap-1 text-[11px] text-black/40">
                                        <Clock className="w-3 h-3" />
                                        {task.effort_minutes}m
                                    </span>
                                    <span className={clsx(
                                        'text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide',
                                        task.priority <= 2 ? 'bg-red-100 text-red-600'
                                        : task.priority === 3 ? 'bg-yellow-100 text-yellow-700'
                                        : 'bg-green-100 text-green-700'
                                    )}>
                                        P{task.priority}
                                    </span>
                                </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                                <button
                                    onClick={() => setFocusTask(task.id)}
                                    className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium text-black/40 hover:bg-black/5 hover:text-black/60 transition-colors"
                                    title="Start focus session"
                                >
                                    <Zap className="w-3.5 h-3.5" />
                                </button>
                                <button
                                    onClick={() => setActiveChatTaskId(task.id)}
                                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-black/40 hover:bg-black/5 hover:text-black/60 transition-colors"
                                >
                                    <MessageSquare className="w-3.5 h-3.5" />
                                    Chat
                                </button>
                            </div>
                        </div>
                    ))}

                    {done.length > 0 && (
                        <>
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-black/30 px-1 pt-4 pb-1">
                                Completed
                            </p>
                            {done.map(task => (
                                <div key={task.id} className="flex items-center gap-3 px-4 py-3 bg-black/3 rounded-xl opacity-60">
                                    <CheckSquare2 className="w-4 h-4 text-[#85D24E] shrink-0" />
                                    <p className="text-[13px] text-black/50 line-through">{task.title}</p>
                                </div>
                            ))}
                        </>
                    )}

                    {goalTasks.length === 0 && (
                        <div className="text-center py-16 text-black/40">
                            <p className="text-[14px]">No tasks yet.</p>
                            <p className="text-[12px] mt-1">Chat with Movo from the sidebar to create some.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
```

- [ ] **Step 2: TypeScript check**

```bash
npm run build 2>&1 | grep -i "error"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/GoalDetailView.tsx
git commit -m "feat(ui): add GoalDetailView component"
```

---

### Task 9: `TaskChatPanel` component

**Files:**
- Create: `src/components/TaskChatPanel.tsx`

**Interfaces:**
- Consumes: `useStore().{activeChatTaskId, taskMessages, sendTaskMessage, setActiveChatTaskId, tasks, isLoading}`, `parseAIMessage`, `InteractiveQuestion`
- Produces: `export function TaskChatPanel()`

- [ ] **Step 1: Create `src/components/TaskChatPanel.tsx`**

```tsx
import { useState, useRef, useEffect } from 'react';
import { X, Send, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useStore } from '../store';
import { parseAIMessage } from '../utils/messageParser';
import { InteractiveQuestion } from './InteractiveQuestion';

const PROSE = 'prose prose-sm max-w-none text-[#1C1C1E] prose-p:my-1.5 prose-ul:my-1.5 prose-li:my-0';

function AIMessageContent({ content, onSelect }: { content: string; onSelect: (val: string) => void }) {
    const parsed = parseAIMessage(content);
    if (parsed.type === 'interactive_question') {
        return (
            <div className="flex flex-col gap-2">
                {parsed.prefix && (
                    <div className={PROSE}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{parsed.prefix}</ReactMarkdown>
                    </div>
                )}
                <InteractiveQuestion question={parsed.question} options={parsed.options} onSelect={onSelect} />
            </div>
        );
    }
    return <div className={PROSE}><ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown></div>;
}

export function TaskChatPanel() {
    const {
        activeChatTaskId, taskMessages, sendTaskMessage,
        setActiveChatTaskId, tasks, isLoading,
    } = useStore();
    const [input, setInput] = useState('');
    const bottomRef = useRef<HTMLDivElement>(null);

    const task = tasks.find(t => t.id === activeChatTaskId);
    const messages = activeChatTaskId ? (taskMessages[activeChatTaskId] ?? []) : [];

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    useEffect(() => {
        setInput('');
    }, [activeChatTaskId]);

    if (!activeChatTaskId || !task) return null;

    const handleSend = async () => {
        const text = input.trim();
        if (!text || isLoading) return;
        setInput('');
        await sendTaskMessage(activeChatTaskId, text);
    };

    return (
        <div className="absolute inset-y-0 right-0 w-80 flex flex-col bg-white border-l border-black/8 shadow-2xl z-50">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-black/8">
                <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold text-[#1C1C1E] truncate">{task.title}</p>
                    <p className="text-[11px] text-black/40">Task assistant</p>
                </div>
                <button
                    onClick={() => setActiveChatTaskId(null)}
                    className="p-1.5 rounded-lg hover:bg-black/5 text-black/30 hover:text-black/60 transition-colors"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
                {messages.length === 0 && (
                    <p className="text-[12px] text-black/35 text-center mt-8 leading-relaxed">
                        Ask me to reschedule, complete, or break down this task.
                    </p>
                )}
                {messages.map(msg => (
                    <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : ''}`}>
                        <div className={`max-w-[90%] px-3 py-2.5 rounded-xl text-[12px] leading-relaxed ${
                            msg.role === 'user'
                                ? 'bg-[#85D24E] text-black rounded-br-sm'
                                : 'bg-black/5 rounded-bl-sm'
                        }`}>
                            {msg.role === 'assistant'
                                ? <AIMessageContent content={msg.content} onSelect={val => sendTaskMessage(activeChatTaskId, val)} />
                                : <p>{msg.content}</p>}
                        </div>
                    </div>
                ))}
                {isLoading && (
                    <div className="flex">
                        <div className="px-3 py-2.5 rounded-xl rounded-bl-sm bg-black/5">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-black/30" />
                        </div>
                    </div>
                )}
                <div ref={bottomRef} />
            </div>

            <div className="px-4 py-3 border-t border-black/8">
                <div className="flex items-end gap-2 bg-black/4 rounded-xl px-3 py-2.5">
                    <textarea
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSend();
                            }
                        }}
                        placeholder="Message..."
                        className="flex-1 resize-none bg-transparent text-[12px] text-[#1C1C1E] placeholder:text-black/30 focus:outline-none max-h-24 min-h-[16px]"
                        rows={1}
                    />
                    <button
                        onClick={handleSend}
                        disabled={!input.trim() || isLoading}
                        className="w-7 h-7 flex items-center justify-center rounded-full bg-[#85D24E] hover:bg-[#7bc248] disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0"
                    >
                        <Send className="w-3 h-3 text-black" />
                    </button>
                </div>
            </div>
        </div>
    );
}
```

- [ ] **Step 2: TypeScript check**

```bash
npm run build 2>&1 | grep -i "error"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/TaskChatPanel.tsx
git commit -m "feat(ui): add TaskChatPanel component"
```

---

### Task 10: Wire everything in `App.tsx`

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `GlobalChat`, `GoalDetailView`, `TaskChatPanel`, `useStore().{activeChatTaskId}`

- [ ] **Step 1: Add new imports to `App.tsx`**

Add these imports (remove `GoalChatView` import):

```tsx
import { GlobalChat } from './components/GlobalChat';
import { GoalDetailView } from './components/GoalDetailView';
import { TaskChatPanel } from './components/TaskChatPanel';
```

Remove:
```tsx
import { GoalChatView } from './components/GoalChatView';
```

- [ ] **Step 2: Add `activeChatTaskId` to the `useStore()` destructure**

In `App.tsx`, find the `useStore()` destructure block and add `activeChatTaskId`:

```tsx
const {
    user, preferences, preferencesLoaded, goals,
    toggleSidebar, isSidebarOpen, activeView,
    setActiveGoal, setActiveView,
    conflictAlert, setConflictAlert, dismissConflict,
    fetchEvents, setPendingTrayCapture,
    focusTaskId,
    missedSessions, fetchMissedSessions, dismissMissedSession,
    fetchNextAction, fetchGoalStats,
    activeChatTaskId,      // ← add this
} = useStore();
```

- [ ] **Step 3: Replace `GoalChatView` render with `GoalDetailView` + `TaskChatPanel`**

Find this block in `App.tsx`:

```tsx
} : activeView === 'project' ? (
  <AnimatePresence mode="wait">
    <motion.div key="project" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="w-full h-full">
      <GoalChatView />
    </motion.div>
  </AnimatePresence>
)
```

Replace with:

```tsx
} : activeView === 'project' ? (
  <AnimatePresence mode="wait">
    <motion.div key="project" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="w-full h-full flex relative">
      <GoalDetailView />
      {activeChatTaskId && <TaskChatPanel />}
    </motion.div>
  </AnimatePresence>
)
```

- [ ] **Step 4: Replace `EmptyState` with `GlobalChat` in the `new_project` / empty goals view**

Find this block in `App.tsx`:

```tsx
) : activeView === 'new_project' || goals.length === 0 ? (
  <>
    <div className="absolute top-0 left-0 right-0 h-[64px] flex items-center justify-between px-6 bg-transparent z-10 pointer-events-none">
      ...
    </div>
    <EmptyState />
  </>
```

Replace `<EmptyState />` with `<GlobalChat />`. Keep the top bar as-is. The full replacement:

```tsx
) : activeView === 'new_project' || goals.length === 0 ? (
  <>
    <div className="absolute top-0 left-0 right-0 h-[64px] flex items-center justify-between px-6 bg-transparent z-10 pointer-events-none">
      <div className="flex items-center gap-2 pointer-events-auto no-drag">
        <button onClick={toggleSidebar} className="p-2 rounded-full bg-white border border-[#E5E5E5] shadow-sm hover:bg-black/5 transition-colors text-[#2D2D2D] focus:outline-none flex items-center justify-center h-10 w-10">
          <PanelLeft className="w-4 h-4" />
        </button>
      </div>
      <div className="flex items-center gap-2 pointer-events-auto no-drag">
        <SettingsDropdown />
      </div>
    </div>
    <div className="flex-1 flex flex-col pt-[64px] overflow-hidden">
      <GlobalChat />
    </div>
  </>
```

- [ ] **Step 5: TypeScript check**

```bash
npm run build 2>&1 | grep -i "error"
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat(ui): wire GlobalChat, GoalDetailView, and TaskChatPanel into App"
```

---

## Post-Implementation Cleanup (optional, non-blocking)

These can be done in a follow-up:
- Delete `src/components/GoalChatView.tsx` (now unused)
- Delete `src/components/EmptyState.tsx` (replaced by GlobalChat)
- Delete `src/components/GoalCapture.tsx` (replaced by GlobalChat)
- Remove `commands::chat` and `commands::planner` Rust modules and their files once confirmed unused
