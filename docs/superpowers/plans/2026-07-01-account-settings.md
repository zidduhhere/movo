# Account Settings Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the minimal `AppSettingsSheet` (name/email display only) with a full account settings screen — editable profile with avatar upload, work-scheduling preferences, AI/app preferences with real backend gating, and a sign-out/delete-account danger zone.

**Architecture:** Extend two existing SQLite tables (`users`, `user_preferences`) with new nullable/defaulted columns via idempotent `ALTER TABLE`. Add two new Tauri commands (`update_user_profile`, `delete_account`) and one small one (`logout_session`), extend `save_user_preferences`/`get_user_preferences` with the new fields, and gate three existing notification/recommendation code paths on the new toggles. On the frontend, rewrite `AppSettingsSheet.tsx` as a 4-tab dialog (Profile / Work / AI & App / Danger Zone) and extend the Zustand store to match.

**Tech Stack:** Rust (Tauri v2, rusqlite, serde), React + TypeScript (Zustand, Radix Dialog, Tailwind, lucide-react).

## Global Constraints

- New DB columns use the existing idempotent `ALTER TABLE ... ADD COLUMN` pattern in `src-tauri/src/db/migrations.rs` (errors ignored via `let _ =`) — never a destructive migration.
- All new/changed Rust structs keep `#[derive(Debug, Serialize, Deserialize, Clone)]` matching existing models.
- Frontend has no test runner configured (no vitest/jest) — verification is `tsc --noEmit` (via `npm run build`) plus manual run-through in the dev app. Do not add a test framework as part of this plan.
- Avatar storage is a base64 data URL string in the DB — no file storage, no new Tauri plugin.
- Voice-input gating only touches `GlobalChat.tsx` and `TrayPopup.tsx` — `GoalChatView.tsx` and `EmptyState.tsx` are confirmed dead code (not imported anywhere) and must not be touched.
- Daily-summary notifications stay always-on/ungated — only event reminders, deadline alerts, and missed-session recs get toggles.
- Native tray menu "🎤 Voice Input" item is explicitly out of scope.

---

### Task 1: DB schema, models, and repository CRUD for new fields

**Files:**
- Modify: `src-tauri/src/db/migrations.rs`
- Modify: `src-tauri/src/models/user.rs`
- Modify: `src-tauri/src/models/user_preferences.rs`
- Modify: `src-tauri/src/db/repository.rs` (methods: `get_user_preferences`, `save_user_preferences`; add `update_user_profile`, `delete_user`)
- Test: `src-tauri/src/db/repository.rs` (`mod tests` block, same file)

**Interfaces:**
- Produces (used by Task 2 commands):
  - `User { id: String, email: String, name: String, password_hash: String (skip_serializing), created_at: String, avatar_base64: Option<String> }`
  - `UserPreferences` gains: `notify_event_reminders: bool`, `notify_deadlines: bool`, `notify_missed_sessions: bool`, `ai_response_style: String`, `ai_custom_instruction: Option<String>`, `voice_input_enabled: bool`
  - `Repository::update_user_profile(&self, user_id: &str, name: &str, avatar_base64: Option<&str>) -> rusqlite::Result<User>`
  - `Repository::delete_user(&self, user_id: &str) -> rusqlite::Result<()>`

- [ ] **Step 1: Add the new columns to migrations**

Edit `src-tauri/src/db/migrations.rs`. Insert these lines right after the existing `focus_end` idempotent-add block (after line 84, before the closing `Ok(())`):

```rust
    let _ = conn.execute(
        "ALTER TABLE users ADD COLUMN avatar_base64 TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE user_preferences ADD COLUMN notify_event_reminders INTEGER NOT NULL DEFAULT 1",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE user_preferences ADD COLUMN notify_deadlines INTEGER NOT NULL DEFAULT 1",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE user_preferences ADD COLUMN notify_missed_sessions INTEGER NOT NULL DEFAULT 1",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE user_preferences ADD COLUMN ai_response_style TEXT NOT NULL DEFAULT 'detailed'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE user_preferences ADD COLUMN ai_custom_instruction TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE user_preferences ADD COLUMN voice_input_enabled INTEGER NOT NULL DEFAULT 1",
        [],
    );
```

- [ ] **Step 2: Update the `User` model**

Replace the full contents of `src-tauri/src/models/user.rs` with:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct User {
    pub id: String,
    pub email: String,
    pub name: String,
    // We intentionally do not serialize the password_hash when sending to frontend
    #[serde(skip_serializing)]
    pub password_hash: String,
    pub created_at: String,
    pub avatar_base64: Option<String>,
}
```

- [ ] **Step 3: Update the `UserPreferences` model**

Replace the full contents of `src-tauri/src/models/user_preferences.rs` with:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UserPreferences {
    pub user_id: String,
    pub work_start: String,
    pub work_end: String,
    pub focus_block_mins: i32,
    pub days_off: String,
    pub buffer_minutes: i32,
    pub focus_start: Option<String>,
    pub focus_end: Option<String>,
    pub notify_event_reminders: bool,
    pub notify_deadlines: bool,
    pub notify_missed_sessions: bool,
    pub ai_response_style: String,
    pub ai_custom_instruction: Option<String>,
    pub voice_input_enabled: bool,
}

impl Default for UserPreferences {
    fn default() -> Self {
        Self {
            user_id: String::new(),
            work_start: "09:00".to_string(),
            work_end: "18:00".to_string(),
            focus_block_mins: 60,
            days_off: "Saturday,Sunday".to_string(),
            buffer_minutes: 10,
            focus_start: None,
            focus_end: None,
            notify_event_reminders: true,
            notify_deadlines: true,
            notify_missed_sessions: true,
            ai_response_style: "detailed".to_string(),
            ai_custom_instruction: None,
            voice_input_enabled: true,
        }
    }
}
```

- [ ] **Step 4: Update `Repository::create_user` and `get_user_by_email` for the new `User` field**

In `src-tauri/src/db/repository.rs`, replace the `create_user` method body (currently around line 29-44):

```rust
    pub fn create_user(&self, email: &str, name: &str, password_hash: &str) -> Result<User> {
        let id = Uuid::new_v4().to_string();
        let created_at = chrono::Utc::now().to_rfc3339();

        self.conn.execute(
            "INSERT INTO users (id, email, name, password_hash, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, email, name, password_hash, created_at],
        )?;

        Ok(User {
            id,
            email: email.to_string(),
            name: name.to_string(),
            password_hash: password_hash.to_string(),
            created_at,
            avatar_base64: None,
        })
    }
```

Replace `get_user_by_email` (currently around line 48-63) — add `avatar_base64` to the `SELECT` and the row mapping:

```rust
    pub fn get_user_by_email(&self, email: &str) -> Result<Option<User>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, email, name, password_hash, created_at, avatar_base64 FROM users WHERE email = ?1"
        )?;

        let user_iter = stmt.query_map(params![email], |row| {
            Ok(User {
                id: row.get(0)?,
                email: row.get(1)?,
                name: row.get(2)?,
                password_hash: row.get(3)?,
                created_at: row.get(4)?,
                avatar_base64: row.get(5)?,
            })
        })?;

        let mut users = user_iter;
        if let Some(user) = users.next() { Ok(Some(user?)) } else { Ok(None) }
    }
```

(Keep the rest of that function as-is if it differs slightly — only the `SELECT` columns and the `Ok(User { ... })` construction change; preserve the existing `query_map`/iteration control flow.)

- [ ] **Step 5: Add `update_user_profile` and `delete_user` to `Repository`**

Add these two methods to `impl<'a> Repository<'a>` in `src-tauri/src/db/repository.rs`, right after `get_user_by_email`:

```rust
    pub fn update_user_profile(&self, user_id: &str, name: &str, avatar_base64: Option<&str>) -> Result<User> {
        self.conn.execute(
            "UPDATE users SET name = ?1, avatar_base64 = ?2 WHERE id = ?3",
            params![name, avatar_base64, user_id],
        )?;
        let mut stmt = self.conn.prepare(
            "SELECT id, email, name, password_hash, created_at, avatar_base64 FROM users WHERE id = ?1"
        )?;
        stmt.query_row(params![user_id], |row| {
            Ok(User {
                id: row.get(0)?,
                email: row.get(1)?,
                name: row.get(2)?,
                password_hash: row.get(3)?,
                created_at: row.get(4)?,
                avatar_base64: row.get(5)?,
            })
        })
    }

    pub fn delete_user(&self, user_id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM users WHERE id = ?1", params![user_id])?;
        Ok(())
    }
```

- [ ] **Step 6: Update `get_user_preferences` and `save_user_preferences` for the new columns**

Replace `get_user_preferences` (currently around line 297-315 in `src-tauri/src/db/repository.rs`):

```rust
    pub fn get_user_preferences(&self, user_id: &str) -> Result<Option<UserPreferences>> {
        let mut stmt = self.conn.prepare(
            "SELECT user_id, work_start, work_end, focus_block_mins, days_off,
                    COALESCE(buffer_minutes, 10), focus_start, focus_end,
                    COALESCE(notify_event_reminders, 1), COALESCE(notify_deadlines, 1),
                    COALESCE(notify_missed_sessions, 1), COALESCE(ai_response_style, 'detailed'),
                    ai_custom_instruction, COALESCE(voice_input_enabled, 1)
             FROM user_preferences WHERE user_id = ?1"
        )?;
        let mut rows = stmt.query_map([user_id], |row| {
            Ok(UserPreferences {
                user_id:                  row.get(0)?,
                work_start:               row.get(1)?,
                work_end:                 row.get(2)?,
                focus_block_mins:         row.get(3)?,
                days_off:                 row.get(4)?,
                buffer_minutes:           row.get(5)?,
                focus_start:              row.get(6)?,
                focus_end:                row.get(7)?,
                notify_event_reminders:   row.get(8)?,
                notify_deadlines:         row.get(9)?,
                notify_missed_sessions:   row.get(10)?,
                ai_response_style:        row.get(11)?,
                ai_custom_instruction:    row.get(12)?,
                voice_input_enabled:      row.get(13)?,
            })
        })?;
        if let Some(row) = rows.next() { Ok(Some(row?)) } else { Ok(None) }
    }
```

Replace `save_user_preferences` (currently around line 317-335):

```rust
    pub fn save_user_preferences(&self, prefs: &UserPreferences) -> Result<()> {
        self.conn.execute(
            "INSERT INTO user_preferences
               (user_id, work_start, work_end, focus_block_mins, days_off, buffer_minutes,
                focus_start, focus_end, notify_event_reminders, notify_deadlines,
                notify_missed_sessions, ai_response_style, ai_custom_instruction, voice_input_enabled)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
             ON CONFLICT(user_id) DO UPDATE SET
               work_start              = excluded.work_start,
               work_end                = excluded.work_end,
               focus_block_mins        = excluded.focus_block_mins,
               days_off                = excluded.days_off,
               buffer_minutes          = excluded.buffer_minutes,
               focus_start             = excluded.focus_start,
               focus_end               = excluded.focus_end,
               notify_event_reminders  = excluded.notify_event_reminders,
               notify_deadlines        = excluded.notify_deadlines,
               notify_missed_sessions  = excluded.notify_missed_sessions,
               ai_response_style       = excluded.ai_response_style,
               ai_custom_instruction   = excluded.ai_custom_instruction,
               voice_input_enabled     = excluded.voice_input_enabled",
            rusqlite::params![
                prefs.user_id, prefs.work_start, prefs.work_end,
                prefs.focus_block_mins, prefs.days_off,
                prefs.buffer_minutes, prefs.focus_start, prefs.focus_end,
                prefs.notify_event_reminders, prefs.notify_deadlines,
                prefs.notify_missed_sessions, prefs.ai_response_style,
                prefs.ai_custom_instruction, prefs.voice_input_enabled,
            ],
        )?;
        Ok(())
    }
```

- [ ] **Step 7: Write the failing tests**

Add these two tests to the `mod tests` block at the bottom of `src-tauri/src/db/repository.rs` (after the existing `user_prefs_roundtrip_new_fields` test):

```rust
    #[test]
    fn user_prefs_roundtrip_settings_fields() {
        let conn = setup();
        let repo = Repository::new(&conn);
        conn.execute(
            "INSERT INTO users (id, email, name, password_hash, created_at) VALUES ('u1','a@b.com','A','x','2026-01-01')",
            [],
        ).unwrap();
        let mut prefs = UserPreferences::default();
        prefs.user_id = "u1".to_string();
        prefs.notify_event_reminders = false;
        prefs.notify_deadlines = false;
        prefs.notify_missed_sessions = true;
        prefs.ai_response_style = "concise".to_string();
        prefs.ai_custom_instruction = Some("Always suggest a 5-min warmup task.".to_string());
        prefs.voice_input_enabled = false;
        repo.save_user_preferences(&prefs).unwrap();

        let loaded = repo.get_user_preferences("u1").unwrap().unwrap();
        assert_eq!(loaded.notify_event_reminders, false);
        assert_eq!(loaded.notify_deadlines, false);
        assert_eq!(loaded.notify_missed_sessions, true);
        assert_eq!(loaded.ai_response_style, "concise");
        assert_eq!(loaded.ai_custom_instruction, Some("Always suggest a 5-min warmup task.".to_string()));
        assert_eq!(loaded.voice_input_enabled, false);
    }

    #[test]
    fn update_user_profile_and_delete_user() {
        let conn = setup();
        let repo = Repository::new(&conn);
        conn.execute(
            "INSERT INTO users (id, email, name, password_hash, created_at) VALUES ('u1','a@b.com','Old Name','x','2026-01-01')",
            [],
        ).unwrap();

        let updated = repo.update_user_profile("u1", "New Name", Some("data:image/png;base64,abc123")).unwrap();
        assert_eq!(updated.name, "New Name");
        assert_eq!(updated.avatar_base64, Some("data:image/png;base64,abc123".to_string()));

        conn.execute(
            "INSERT INTO goals (id,user_id,title,status,created_at) VALUES ('g1','u1','Goal','active','2026-01-01')",
            [],
        ).unwrap();

        repo.delete_user("u1").unwrap();

        let gone = repo.get_user_by_email("a@b.com").unwrap();
        assert!(gone.is_none());

        // Cascade: the goal row should be gone too (ON DELETE CASCADE, foreign_keys=ON
        // is set in db/connection.rs — this in-memory test connection has it enabled
        // by rusqlite's default of following whatever PRAGMA the test issues; verify directly).
        conn.execute("PRAGMA foreign_keys = ON", []).unwrap();
        // Re-run delete on a fresh row to confirm cascade with the pragma explicitly on:
        conn.execute(
            "INSERT INTO users (id, email, name, password_hash, created_at) VALUES ('u2','c@d.com','B','x','2026-01-01')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO goals (id,user_id,title,status,created_at) VALUES ('g2','u2','Goal2','active','2026-01-01')",
            [],
        ).unwrap();
        repo.delete_user("u2").unwrap();
        let goal_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM goals WHERE id = 'g2'", [], |r| r.get(0)
        ).unwrap();
        assert_eq!(goal_count, 0);
    }
```

- [ ] **Step 8: Run the tests to verify they fail (compile error expected — fields don't exist yet if steps above were skipped; if steps 1-6 were done first, these should pass)**

Run: `cd src-tauri && cargo test --lib db::repository::tests -- --nocapture`
Expected: if you did steps 1-6 first (as ordered above), this should already PASS. If you implement test-first instead, expect a compile error referencing missing struct fields (`notify_event_reminders`, etc.) or missing methods (`update_user_profile`, `delete_user`).

- [ ] **Step 9: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test --lib db::repository::tests -- --nocapture`
Expected: all tests PASS, including `user_prefs_roundtrip_settings_fields` and `update_user_profile_and_delete_user`.

- [ ] **Step 10: Commit**

```bash
git add src-tauri/src/db/migrations.rs src-tauri/src/models/user.rs src-tauri/src/models/user_preferences.rs src-tauri/src/db/repository.rs
git commit -m "feat(db): add avatar and app-preference columns with repository CRUD"
```

---

### Task 2: New and extended Tauri commands (profile, delete account, logout, preferences)

**Files:**
- Modify: `src-tauri/src/commands/auth.rs`
- Modify: `src-tauri/src/commands/preferences.rs`
- Modify: `src-tauri/src/lib.rs` (register new commands in `invoke_handler`)

**Interfaces:**
- Consumes: `Repository::update_user_profile`, `Repository::delete_user` (Task 1), `AppState.current_user_id: Mutex<Option<String>>` (existing, `src-tauri/src/lib.rs:14`)
- Produces:
  - `update_user_profile(name: String, avatar_base64: Option<String>) -> Result<User, String>`
  - `delete_account() -> Result<(), String>`
  - `logout_session() -> Result<(), String>`
  - `save_user_preferences(work_start, work_end, focus_block_mins, days_off, buffer_minutes, focus_start, focus_end, notify_event_reminders, notify_deadlines, notify_missed_sessions, ai_response_style, ai_custom_instruction, voice_input_enabled) -> Result<UserPreferences, String>`

- [ ] **Step 1: Add `update_user_profile`, `delete_account`, `logout_session` commands**

Append to the end of `src-tauri/src/commands/auth.rs`:

```rust
#[tauri::command]
pub fn update_user_profile(
    name: String,
    avatar_base64: Option<String>,
    conn: State<'_, Mutex<Connection>>,
    app_state: State<'_, AppState>,
) -> Result<User, String> {
    let user_id = app_state.current_user_id.lock().map_err(|e| e.to_string())?
        .clone().ok_or("Not logged in")?;
    let conn = conn.lock().map_err(|e| e.to_string())?;
    let repo = Repository::new(&conn);
    repo.update_user_profile(&user_id, &name, avatar_base64.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_account(
    conn: State<'_, Mutex<Connection>>,
    app_state: State<'_, AppState>,
) -> Result<(), String> {
    let user_id = app_state.current_user_id.lock().map_err(|e| e.to_string())?
        .clone().ok_or("Not logged in")?;
    {
        let conn = conn.lock().map_err(|e| e.to_string())?;
        let repo = Repository::new(&conn);
        repo.delete_user(&user_id).map_err(|e| e.to_string())?;
    }
    *app_state.current_user_id.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

#[tauri::command]
pub fn logout_session(app_state: State<'_, AppState>) -> Result<(), String> {
    *app_state.current_user_id.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}
```

- [ ] **Step 2: Extend `save_user_preferences` command with the new fields**

Replace the `save_user_preferences` function in `src-tauri/src/commands/preferences.rs` (the whole function, currently lines 23-43):

```rust
#[tauri::command]
pub fn save_user_preferences(
    work_start: String,
    work_end: String,
    focus_block_mins: i32,
    days_off: String,
    buffer_minutes: Option<i32>,
    focus_start: Option<String>,
    focus_end: Option<String>,
    notify_event_reminders: Option<bool>,
    notify_deadlines: Option<bool>,
    notify_missed_sessions: Option<bool>,
    ai_response_style: Option<String>,
    ai_custom_instruction: Option<String>,
    voice_input_enabled: Option<bool>,
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
        buffer_minutes: buffer_minutes.unwrap_or(10),
        focus_start,
        focus_end,
        notify_event_reminders: notify_event_reminders.unwrap_or(true),
        notify_deadlines: notify_deadlines.unwrap_or(true),
        notify_missed_sessions: notify_missed_sessions.unwrap_or(true),
        ai_response_style: ai_response_style.unwrap_or_else(|| "detailed".to_string()),
        ai_custom_instruction,
        voice_input_enabled: voice_input_enabled.unwrap_or(true),
    };
    let conn = conn.lock().map_err(|e| e.to_string())?;
    let repo = Repository::new(&conn);
    repo.save_user_preferences(&prefs).map_err(|e| e.to_string())?;
    Ok(prefs)
}
```

- [ ] **Step 3: Register the new commands in `lib.rs`**

In `src-tauri/src/lib.rs`, inside the `tauri::generate_handler![...]` list (currently ends around line 149 with `commands::schedule::schedule_goal,`), add these three lines right after `commands::auth::login_user,`:

```rust
            commands::auth::login_user,
            commands::auth::update_user_profile,
            commands::auth::delete_account,
            commands::auth::logout_session,
```

- [ ] **Step 4: Verify it compiles**

Run: `cd src-tauri && cargo build 2>&1 | tail -30`
Expected: `Finished` with no errors (warnings about unused imports elsewhere are pre-existing and fine).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/auth.rs src-tauri/src/commands/preferences.rs src-tauri/src/lib.rs
git commit -m "feat(commands): add update_user_profile, delete_account, logout_session commands"
```

---

### Task 3: AI response style and custom instruction in chat prompts

**Files:**
- Modify: `src-tauri/src/ai/openai.rs`
- Modify: `src-tauri/src/commands/global_chat.rs`
- Modify: `src-tauri/src/commands/task_chat.rs`
- Test: `src-tauri/src/ai/openai.rs` (`mod tests` — new module in this file, none exists yet)

**Interfaces:**
- Consumes: `UserPreferences { ai_response_style, ai_custom_instruction, .. }` (Task 1)
- Produces: `pub fn preference_prompt_suffix(prefs: &UserPreferences) -> String` (used by both chat commands)

- [ ] **Step 1: Write the failing test**

Add to the bottom of `src-tauri/src/ai/openai.rs` (new file-level test module — there's no existing one in this file):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::UserPreferences;

    #[test]
    fn preference_prompt_suffix_concise_style() {
        let mut prefs = UserPreferences::default();
        prefs.ai_response_style = "concise".to_string();
        let suffix = preference_prompt_suffix(&prefs);
        assert!(suffix.contains("concise"), "expected concise instruction, got: {suffix}");
    }

    #[test]
    fn preference_prompt_suffix_detailed_style_is_empty_style_line() {
        let prefs = UserPreferences::default();
        let suffix = preference_prompt_suffix(&prefs);
        assert!(!suffix.to_lowercase().contains("keep replies short"));
    }

    #[test]
    fn preference_prompt_suffix_includes_custom_instruction() {
        let mut prefs = UserPreferences::default();
        prefs.ai_custom_instruction = Some("Always mention deep work blocks.".to_string());
        let suffix = preference_prompt_suffix(&prefs);
        assert!(suffix.contains("Always mention deep work blocks."));
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd src-tauri && cargo test --lib ai::openai::tests -- --nocapture`
Expected: FAIL with "cannot find function `preference_prompt_suffix`"

- [ ] **Step 3: Implement `preference_prompt_suffix`**

Add this function to `src-tauri/src/ai/openai.rs`, right after the `extract_tool_calls` function and before `impl OpenAiProvider`:

```rust
use crate::models::UserPreferences;

/// Builds a system-prompt suffix from the user's response-style and custom-instruction
/// preferences. Returns an empty string when both are at their defaults.
pub fn preference_prompt_suffix(prefs: &UserPreferences) -> String {
    let mut suffix = String::new();
    if prefs.ai_response_style == "concise" {
        suffix.push_str("\n\nRESPONSE STYLE: Keep replies short and to the point — 1-3 sentences unless a list or table is required.");
    }
    if let Some(instruction) = prefs.ai_custom_instruction.as_deref() {
        if !instruction.trim().is_empty() {
            suffix.push_str(&format!("\n\nUSER CUSTOM INSTRUCTION: {}", instruction.trim()));
        }
    }
    suffix
}
```

Add `use crate::models::UserPreferences;` near the top of the file with the other `use` statements instead of inline if that reads more consistently with the file's existing style (check the top of `src-tauri/src/ai/openai.rs` — it currently has `use crate::models::ChatMessage;`; change that line to `use crate::models::{ChatMessage, UserPreferences};` and remove the inline `use` added above).

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd src-tauri && cargo test --lib ai::openai::tests -- --nocapture`
Expected: all 3 tests PASS.

- [ ] **Step 5: Wire the suffix into `global_chat.rs`**

In `src-tauri/src/commands/global_chat.rs`, find the `system_prompt` construction (the `format!(...)` call whose result is bound to `let system_prompt = ...`). Immediately after that `let system_prompt = format!(...)` statement (before `let ai = OpenAiProvider::new()?;`), add:

```rust
    let system_prompt = format!("{}{}", system_prompt, crate::ai::openai::preference_prompt_suffix(&prefs));
```

(`prefs` is already in scope in this function from the earlier `let (global_goal_id, messages, prefs, events) = { ... };` block.)

- [ ] **Step 6: Wire the suffix into `task_chat.rs`**

In `src-tauri/src/commands/task_chat.rs`, immediately after the `let system_prompt = format!(...)` statement (before `// Build message history for the AI`), add:

```rust
    let system_prompt = format!("{}{}", system_prompt, crate::ai::openai::preference_prompt_suffix(&prefs));
```

(`prefs` is already in scope from the earlier `let (ctx, prefs, events) = { ... };` block.)

- [ ] **Step 7: Verify it compiles**

Run: `cd src-tauri && cargo build 2>&1 | tail -30`
Expected: `Finished` with no errors.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/ai/openai.rs src-tauri/src/commands/global_chat.rs src-tauri/src/commands/task_chat.rs
git commit -m "feat(ai): honor response-style and custom-instruction preferences in chat prompts"
```

---

### Task 4: Gate notifications and missed-session recs on the new toggles

**Files:**
- Modify: `src-tauri/src/commands/notifications.rs`
- Modify: `src-tauri/src/commands/recommendations.rs`

**Interfaces:**
- Consumes: `Repository::get_user_preferences` (existing), `UserPreferences.notify_event_reminders/notify_deadlines/notify_missed_sessions` (Task 1)

- [ ] **Step 1: Read preferences once at the top of `check_and_send_notifications`**

In `src-tauri/src/commands/notifications.rs`, right after the existing `let user_id = { ... }.ok_or("Not logged in")?;` block and before `let now = Utc::now();`, add:

```rust
    let prefs = {
        let conn_guard = conn.lock().map_err(|e| e.to_string())?;
        let repo = Repository::new(&conn_guard);
        repo.get_user_preferences(&user_id).map_err(|e| e.to_string())?.unwrap_or_default()
    };
```

- [ ] **Step 2: Gate the event-reminder block**

Wrap the existing event-reminder section — from `let events = { ... };` through the `for event in to_notify { ... }` loop (everything up to, but not including, the `// ── Deadline alerts` comment) — in an `if prefs.notify_event_reminders { ... }`. Concretely, change:

```rust
    // Fetch events starting in the next 5 minutes
    let events = {
```

to:

```rust
    // Fetch events starting in the next 5 minutes
    if prefs.notify_event_reminders {
    let events = {
```

and change the line right before `// ── Deadline alerts: tasks due within the next 24 hours ───────────────────` from nothing to a closing brace on its own line:

```rust
    }

    // ── Deadline alerts: tasks due within the next 24 hours ───────────────────
```

(This wraps event-fetching, filtering, and the notify loop in the `if` block; `sent` stays declared before the block since it's `let mut sent = 0;` which already exists before this section — confirm it's declared before the `if` you're adding, not inside it.)

- [ ] **Step 3: Gate the deadline-alert block**

Change:

```rust
    // ── Deadline alerts: tasks due within the next 24 hours ───────────────────
    let deadline_tasks = {
```

to:

```rust
    // ── Deadline alerts: tasks due within the next 24 hours ───────────────────
    if prefs.notify_deadlines {
    let deadline_tasks = {
```

and add a closing `}` right before the `// ── Daily summary: once per calendar day ──────────────────────────────────` comment:

```rust
    }

    // ── Daily summary: once per calendar day ──────────────────────────────────
```

- [ ] **Step 4: Gate `check_missed_sessions`**

In `src-tauri/src/commands/recommendations.rs`, in the `check_missed_sessions` function, right after the `user_id` is resolved and before `let conn_guard = conn.lock()...`, add an early return when the toggle is off:

```rust
    {
        let conn_guard = conn.lock().map_err(|e| e.to_string())?;
        let repo = Repository::new(&conn_guard);
        let prefs = repo.get_user_preferences(&user_id).map_err(|e| e.to_string())?.unwrap_or_default();
        if !prefs.notify_missed_sessions {
            return Ok(Vec::new());
        }
    }

```

placed immediately before the existing `let conn_guard = conn.lock().map_err(|e| e.to_string())?;` line that's already there for `get_missed_sessions` — i.e. this is a new preliminary block using a separate short-lived lock, followed by the existing code unchanged.

- [ ] **Step 5: Verify it compiles**

Run: `cd src-tauri && cargo build 2>&1 | tail -30`
Expected: `Finished` with no errors.

- [ ] **Step 6: Manual verification (no automated test — these functions require live Tauri State and a running notification system)**

This will be exercised end-to-end in Task 9's manual verification pass. No standalone test here; the gating logic is a straightforward `if` around existing, already-tested-by-usage code.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands/notifications.rs src-tauri/src/commands/recommendations.rs
git commit -m "feat(notifications): gate event reminders, deadline alerts, and missed-session recs on preferences"
```

---

### Task 5: Frontend store — types and actions

**Files:**
- Modify: `src/store/index.ts`

**Interfaces:**
- Consumes: Tauri commands `update_user_profile`, `delete_account`, `logout_session`, extended `save_user_preferences` (Task 2)
- Produces:
  - `User` gains `avatar_base64?: string`
  - `UserPreferences` gains `notify_event_reminders: boolean`, `notify_deadlines: boolean`, `notify_missed_sessions: boolean`, `ai_response_style: 'concise' | 'detailed'`, `ai_custom_instruction?: string`, `voice_input_enabled: boolean`
  - `updateProfile: (name: string, avatarBase64?: string) => Promise<void>`
  - `deleteAccount: () => Promise<void>`
  - `logout: () => Promise<void>` (changed from sync `() => void` to async, now also calls the backend)

- [ ] **Step 1: Extend the `User` interface**

In `src/store/index.ts`, replace the `User` interface (currently lines 33-38):

```typescript
export interface User {
    id: string;
    email: string;
    name: string;
    created_at: string;
    avatar_base64?: string;
}
```

- [ ] **Step 2: Extend the `UserPreferences` interface**

Replace the `UserPreferences` interface (currently lines 40-46):

```typescript
export interface UserPreferences {
    user_id: string;
    work_start: string;
    work_end: string;
    focus_block_mins: number;
    days_off: string;
    buffer_minutes: number;
    focus_start?: string;
    focus_end?: string;
    notify_event_reminders: boolean;
    notify_deadlines: boolean;
    notify_missed_sessions: boolean;
    ai_response_style: 'concise' | 'detailed';
    ai_custom_instruction?: string;
    voice_input_enabled: boolean;
}
```

(Note: `buffer_minutes`, `focus_start`, `focus_end` were not previously in this TS interface even though the Rust struct had them — check the current file content before replacing to confirm exact current field list, and keep any fields already present that aren't shown in the snippet above.)

- [ ] **Step 3: Change `logout` from a sync action to an async one that also clears the backend session**

In the `AppState` interface (`src/store/index.ts`), change:

```typescript
    logout: () => void;
```

to:

```typescript
    logout: () => Promise<void>;
    updateProfile: (name: string, avatarBase64?: string) => Promise<void>;
    deleteAccount: () => Promise<void>;
```

- [ ] **Step 4: Update the `logout` implementation and add `updateProfile`/`deleteAccount`**

Replace the `logout` action body (currently around line 227):

```typescript
    logout: async () => {
        try {
            await invoke('logout_session');
        } catch { /* best effort */ }
        set({ user: null, goals: [], tasks: [], activeGoalId: null, preferences: null, preferencesLoaded: false, events: [] });
    },
```

Add these two new actions right after `logout` (same object literal, comma-separated):

```typescript
    updateProfile: async (name, avatarBase64) => {
        const updated = await invoke<User>('update_user_profile', { name, avatarBase64 });
        set({ user: updated });
    },

    deleteAccount: async () => {
        await invoke('delete_account');
        set({ user: null, goals: [], tasks: [], activeGoalId: null, preferences: null, preferencesLoaded: false, events: [] });
    },
```

- [ ] **Step 5: Extend `savePreferences` to send/receive the new fields**

Replace the `savePreferences` action (currently around lines 367-375):

```typescript
    savePreferences: async (prefs) => {
        await invoke<UserPreferences>('save_user_preferences', {
            workStart: prefs.work_start,
            workEnd: prefs.work_end,
            focusBlockMins: prefs.focus_block_mins,
            daysOff: prefs.days_off,
            bufferMinutes: prefs.buffer_minutes,
            focusStart: prefs.focus_start,
            focusEnd: prefs.focus_end,
            notifyEventReminders: prefs.notify_event_reminders,
            notifyDeadlines: prefs.notify_deadlines,
            notifyMissedSessions: prefs.notify_missed_sessions,
            aiResponseStyle: prefs.ai_response_style,
            aiCustomInstruction: prefs.ai_custom_instruction,
            voiceInputEnabled: prefs.voice_input_enabled,
        });
        await useStore.getState().fetchPreferences();
    },
```

- [ ] **Step 6: Update the one existing call site of `logout()` for the new async signature**

In `src/components/SettingsDropdown.tsx`, the `onSelect` handler currently does:

```typescript
                            onSelect={() => {
                                import('../store').then(({ useStore }) => {
                                    useStore.getState().logout();
                                });
                            }}
```

This still works unchanged since `.logout()` returning a Promise that isn't awaited is harmless here (fire-and-forget was already the pattern). No change needed in this file for Task 5 — confirmed compatible, leave as-is.

- [ ] **Step 7: Type-check**

Run: `cd /Users/aleenajaison/Documents/opensource/movo && npx tsc --noEmit 2>&1 | head -60`
Expected: no new errors introduced by these changes. (Any pre-existing unrelated errors are not this task's concern — but there should be none currently per prior session notes; if any appear referencing lines touched in this task, fix them.)

- [ ] **Step 8: Commit**

```bash
git add src/store/index.ts
git commit -m "feat(store): extend User/UserPreferences types, add updateProfile/deleteAccount, wire logout to backend"
```

---

### Task 6: AppSettingsSheet — tab shell, Profile tab, Work tab

**Files:**
- Modify: `src/components/AppSettingsSheet.tsx` (full rewrite)

**Interfaces:**
- Consumes: `useStore()` → `user`, `preferences`, `preferencesLoaded`, `fetchPreferences`, `savePreferences`, `updateProfile` (Task 5)

- [ ] **Step 1: Replace `AppSettingsSheet.tsx` with the tab shell + Profile + Work tabs**

Replace the entire contents of `src/components/AppSettingsSheet.tsx`:

```tsx
import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, useState } from 'react';
import { X, User as UserIcon, Clock, Sparkles, ShieldAlert } from 'lucide-react';
import { useStore } from '../store';
import { AppSettingsDangerZone } from './AppSettingsDangerZone';

interface AppSettingsSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

type TabId = 'profile' | 'work' | 'ai' | 'danger';

const TABS: { id: TabId; label: string; icon: typeof UserIcon }[] = [
    { id: 'profile', label: 'Profile', icon: UserIcon },
    { id: 'work', label: 'Work', icon: Clock },
    { id: 'ai', label: 'AI & App', icon: Sparkles },
    { id: 'danger', label: 'Danger Zone', icon: ShieldAlert },
];

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function ProfileTab() {
    const { user, updateProfile } = useStore();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [name, setName] = useState(user?.name ?? '');
    const [avatar, setAvatar] = useState(user?.avatar_base64);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setName(user?.name ?? '');
        setAvatar(user?.avatar_base64);
    }, [user?.name, user?.avatar_base64]);

    const initials = name
        ? name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()
        : '?';

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => setAvatar(reader.result as string);
        reader.readAsDataURL(file);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await updateProfile(name, avatar);
        } finally {
            setSaving(false);
        }
    };

    const dirty = name !== (user?.name ?? '') || avatar !== user?.avatar_base64;

    return (
        <div className="flex flex-col items-center py-4">
            <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="relative w-20 h-20 rounded-full mb-4 group"
            >
                {avatar ? (
                    <img src={avatar} alt="Avatar" className="w-20 h-20 rounded-full object-cover shadow-md" />
                ) : (
                    <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-[#4D5AE8] to-[#3B44A8] shadow-md flex items-center justify-center text-white text-2xl font-semibold">
                        {initials}
                    </div>
                )}
                <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[11px] font-medium">
                    Change
                </div>
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />

            <div className="w-full max-w-xs flex flex-col gap-3">
                <label className="flex flex-col gap-1 text-left">
                    <span className="text-[11px] font-medium text-black/50">Name</span>
                    <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="border border-black/10 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#4D5AE8]/50 focus:ring-1 focus:ring-[#4D5AE8]/20"
                    />
                </label>
                <label className="flex flex-col gap-1 text-left">
                    <span className="text-[11px] font-medium text-black/50">Email</span>
                    <input
                        value={user?.email ?? ''}
                        disabled
                        className="border border-black/10 rounded-lg px-3 py-2 text-[13px] bg-black/5 text-black/50"
                    />
                </label>
                <button
                    type="button"
                    disabled={!dirty || saving}
                    onClick={handleSave}
                    className="mt-1 bg-[#1C1C1E] hover:bg-black disabled:opacity-30 text-white text-[13px] font-medium rounded-lg py-2 transition-colors"
                >
                    {saving ? 'Saving…' : 'Save Profile'}
                </button>
            </div>
        </div>
    );
}

function WorkTab() {
    const { preferences, preferencesLoaded, fetchPreferences, savePreferences } = useStore();
    const [workStart, setWorkStart] = useState('09:00');
    const [workEnd, setWorkEnd] = useState('18:00');
    const [focusBlockMins, setFocusBlockMins] = useState(60);
    const [bufferMinutes, setBufferMinutes] = useState(10);
    const [daysOff, setDaysOff] = useState<string[]>(['Saturday', 'Sunday']);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!preferencesLoaded) fetchPreferences();
    }, [preferencesLoaded, fetchPreferences]);

    useEffect(() => {
        if (!preferences) return;
        setWorkStart(preferences.work_start);
        setWorkEnd(preferences.work_end);
        setFocusBlockMins(preferences.focus_block_mins);
        setBufferMinutes(preferences.buffer_minutes);
        setDaysOff(preferences.days_off ? preferences.days_off.split(',') : []);
    }, [preferences]);

    const toggleDay = (day: string) => {
        setDaysOff((prev) => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await savePreferences({
                work_start: workStart,
                work_end: workEnd,
                focus_block_mins: focusBlockMins,
                days_off: daysOff.join(','),
                buffer_minutes: bufferMinutes,
                focus_start: preferences?.focus_start,
                focus_end: preferences?.focus_end,
                notify_event_reminders: preferences?.notify_event_reminders ?? true,
                notify_deadlines: preferences?.notify_deadlines ?? true,
                notify_missed_sessions: preferences?.notify_missed_sessions ?? true,
                ai_response_style: preferences?.ai_response_style ?? 'detailed',
                ai_custom_instruction: preferences?.ai_custom_instruction,
                voice_input_enabled: preferences?.voice_input_enabled ?? true,
            });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex flex-col gap-4 py-2 max-w-xs mx-auto">
            <div className="flex gap-3">
                <label className="flex flex-col gap-1 flex-1 text-left">
                    <span className="text-[11px] font-medium text-black/50">Work start</span>
                    <input type="time" value={workStart} onChange={(e) => setWorkStart(e.target.value)}
                        className="border border-black/10 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#4D5AE8]/50" />
                </label>
                <label className="flex flex-col gap-1 flex-1 text-left">
                    <span className="text-[11px] font-medium text-black/50">Work end</span>
                    <input type="time" value={workEnd} onChange={(e) => setWorkEnd(e.target.value)}
                        className="border border-black/10 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#4D5AE8]/50" />
                </label>
            </div>

            <label className="flex flex-col gap-1 text-left">
                <span className="text-[11px] font-medium text-black/50">Focus block length (minutes)</span>
                <input type="number" min={15} step={5} value={focusBlockMins}
                    onChange={(e) => setFocusBlockMins(Number(e.target.value))}
                    className="border border-black/10 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#4D5AE8]/50" />
            </label>

            <label className="flex flex-col gap-1 text-left">
                <span className="text-[11px] font-medium text-black/50">Buffer between tasks (minutes)</span>
                <input type="number" min={0} step={5} value={bufferMinutes}
                    onChange={(e) => setBufferMinutes(Number(e.target.value))}
                    className="border border-black/10 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#4D5AE8]/50" />
            </label>

            <div className="flex flex-col gap-1 text-left">
                <span className="text-[11px] font-medium text-black/50">Days off</span>
                <div className="flex flex-wrap gap-1.5">
                    {DAYS.map((day) => (
                        <button
                            key={day}
                            type="button"
                            onClick={() => toggleDay(day)}
                            className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                                daysOff.includes(day) ? 'bg-[#4D5AE8] text-white' : 'bg-black/5 text-black/60 hover:bg-black/10'
                            }`}
                        >
                            {day.slice(0, 3)}
                        </button>
                    ))}
                </div>
            </div>

            <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="mt-1 bg-[#1C1C1E] hover:bg-black disabled:opacity-30 text-white text-[13px] font-medium rounded-lg py-2 transition-colors"
            >
                {saving ? 'Saving…' : 'Save Work Preferences'}
            </button>
        </div>
    );
}

export function AppSettingsSheet({ open, onOpenChange }: AppSettingsSheetProps) {
    const [activeTab, setActiveTab] = useState<TabId>('profile');

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 animate-in fade-in duration-200" />

                <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl h-[520px] bg-white/80 backdrop-blur-3xl rounded-[10px] shadow-[0_20px_60px_rgba(0,0,0,0.2)] border border-black/10 z-50 animate-in fade-in zoom-in-95 duration-200 overflow-hidden flex flex-col">

                    <div className="flex items-center justify-between px-4 py-3 border-b border-black/5 bg-white/50 shrink-0">
                        <Dialog.Title className="text-[13px] font-semibold text-black/80">Account Settings</Dialog.Title>
                        <Dialog.Close asChild>
                            <button className="flex items-center justify-center w-6 h-6 rounded hover:bg-black/5 transition-colors focus:outline-none">
                                <X className="w-4 h-4 text-black/50" />
                            </button>
                        </Dialog.Close>
                    </div>

                    <div className="flex flex-1 min-h-0">
                        <div className="w-36 shrink-0 border-r border-black/5 bg-white/40 p-2 flex flex-col gap-0.5">
                            {TABS.map(({ id, label, icon: Icon }) => (
                                <button
                                    key={id}
                                    onClick={() => setActiveTab(id)}
                                    className={`flex items-center gap-2 px-2.5 py-2 rounded-md text-[12.5px] font-medium text-left transition-colors ${
                                        activeTab === id ? 'bg-[#4D5AE8]/10 text-[#4D5AE8]' : 'text-black/60 hover:bg-black/5'
                                    }`}
                                >
                                    <Icon className="w-3.5 h-3.5" />
                                    {label}
                                </button>
                            ))}
                        </div>

                        <div className="flex-1 min-w-0 overflow-y-auto p-6">
                            {activeTab === 'profile' && <ProfileTab />}
                            {activeTab === 'work' && <WorkTab />}
                            {activeTab === 'ai' && <div className="text-center text-black/40 text-[12px] py-10">AI & App tab — added in the next task.</div>}
                            {activeTab === 'danger' && <AppSettingsDangerZone onClose={() => onOpenChange(false)} />}
                        </div>
                    </div>

                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
```

Note: this step references `AppSettingsDangerZone`, created in Task 7. For this task's compile check, temporarily comment out the `import` and the `{activeTab === 'danger' && ...}` line, replacing it with a placeholder `<div>` — OR do this task's compile-check step after Task 7's file exists. **Do the latter**: implement this step, then proceed directly to Task 7 before running the type-check in Step 2 below, since Task 6 and 7 together form one working component. Do not run `tsc` until both tasks' files exist.

- [ ] **Step 2: (Deferred) Type-check — see Task 7, Step 4, which covers both tasks' output together.**

- [ ] **Step 3: Commit is deferred to the end of Task 7 (one component, one coherent commit).**

---

### Task 7: AppSettingsSheet — AI & App tab, Danger Zone tab

**Files:**
- Modify: `src/components/AppSettingsSheet.tsx` (fill in the AI & App tab; remove the placeholder div)
- Create: `src/components/AppSettingsDangerZone.tsx`

**Interfaces:**
- Consumes: `useStore()` → `preferences`, `savePreferences`, `logout`, `deleteAccount`, `user` (Task 5); `ProfileTab`/`WorkTab`/tab shell from Task 6

- [ ] **Step 1: Create the Danger Zone component**

Create `src/components/AppSettingsDangerZone.tsx`:

```tsx
import { useState } from 'react';
import { useStore } from '../store';

export function AppSettingsDangerZone({ onClose }: { onClose: () => void }) {
    const { user, logout, deleteAccount } = useStore();
    const [confirmText, setConfirmText] = useState('');
    const [deleting, setDeleting] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);

    const handleSignOut = async () => {
        await logout();
        onClose();
    };

    const handleDelete = async () => {
        setDeleting(true);
        try {
            await deleteAccount();
            onClose();
        } finally {
            setDeleting(false);
        }
    };

    const canDelete = confirmText.trim().toLowerCase() === (user?.email ?? '').toLowerCase();

    return (
        <div className="flex flex-col gap-6 max-w-xs mx-auto py-2">
            <div className="flex flex-col gap-2">
                <h4 className="text-[12px] font-semibold text-black/70">Sign Out</h4>
                <p className="text-[11px] text-black/40">You can sign back in any time with your email and password.</p>
                <button
                    type="button"
                    onClick={handleSignOut}
                    className="bg-black/5 hover:bg-black/10 text-black/80 text-[13px] font-medium rounded-lg py-2 transition-colors"
                >
                    Sign Out
                </button>
            </div>

            <div className="flex flex-col gap-2 pt-4 border-t border-black/5">
                <h4 className="text-[12px] font-semibold text-red-600">Delete Account</h4>
                <p className="text-[11px] text-black/40">
                    Permanently deletes your account and all goals, tasks, events, and chat history. This cannot be undone.
                </p>
                {!showConfirm ? (
                    <button
                        type="button"
                        onClick={() => setShowConfirm(true)}
                        className="bg-red-50 hover:bg-red-100 text-red-600 text-[13px] font-medium rounded-lg py-2 transition-colors"
                    >
                        Delete Account…
                    </button>
                ) : (
                    <div className="flex flex-col gap-2">
                        <label className="flex flex-col gap-1 text-left">
                            <span className="text-[11px] text-black/50">Type your email ({user?.email}) to confirm</span>
                            <input
                                value={confirmText}
                                onChange={(e) => setConfirmText(e.target.value)}
                                className="border border-red-200 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-red-400 focus:ring-1 focus:ring-red-200"
                            />
                        </label>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => { setShowConfirm(false); setConfirmText(''); }}
                                className="flex-1 bg-black/5 hover:bg-black/10 text-black/70 text-[13px] font-medium rounded-lg py-2 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={!canDelete || deleting}
                                onClick={handleDelete}
                                className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-30 text-white text-[13px] font-medium rounded-lg py-2 transition-colors"
                            >
                                {deleting ? 'Deleting…' : 'Delete Forever'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Fill in the AI & App tab in `AppSettingsSheet.tsx`**

Add this `AiAppTab` function to `src/components/AppSettingsSheet.tsx`, right after the `WorkTab` function (before `export function AppSettingsSheet`):

```tsx
function AiAppTab() {
    const { preferences, preferencesLoaded, fetchPreferences, savePreferences } = useStore();
    const [notifyEventReminders, setNotifyEventReminders] = useState(true);
    const [notifyDeadlines, setNotifyDeadlines] = useState(true);
    const [notifyMissedSessions, setNotifyMissedSessions] = useState(true);
    const [responseStyle, setResponseStyle] = useState<'concise' | 'detailed'>('detailed');
    const [customInstruction, setCustomInstruction] = useState('');
    const [voiceInputEnabled, setVoiceInputEnabled] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!preferencesLoaded) fetchPreferences();
    }, [preferencesLoaded, fetchPreferences]);

    useEffect(() => {
        if (!preferences) return;
        setNotifyEventReminders(preferences.notify_event_reminders);
        setNotifyDeadlines(preferences.notify_deadlines);
        setNotifyMissedSessions(preferences.notify_missed_sessions);
        setResponseStyle(preferences.ai_response_style);
        setCustomInstruction(preferences.ai_custom_instruction ?? '');
        setVoiceInputEnabled(preferences.voice_input_enabled);
    }, [preferences]);

    const handleSave = async () => {
        setSaving(true);
        try {
            await savePreferences({
                work_start: preferences?.work_start ?? '09:00',
                work_end: preferences?.work_end ?? '18:00',
                focus_block_mins: preferences?.focus_block_mins ?? 60,
                days_off: preferences?.days_off ?? 'Saturday,Sunday',
                buffer_minutes: preferences?.buffer_minutes ?? 10,
                focus_start: preferences?.focus_start,
                focus_end: preferences?.focus_end,
                notify_event_reminders: notifyEventReminders,
                notify_deadlines: notifyDeadlines,
                notify_missed_sessions: notifyMissedSessions,
                ai_response_style: responseStyle,
                ai_custom_instruction: customInstruction.trim() || undefined,
                voice_input_enabled: voiceInputEnabled,
            });
        } finally {
            setSaving(false);
        }
    };

    const Toggle = ({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description: string }) => (
        <label className="flex items-start justify-between gap-3 py-1.5 cursor-pointer">
            <div className="flex flex-col text-left">
                <span className="text-[12.5px] font-medium text-black/80">{label}</span>
                <span className="text-[11px] text-black/40">{description}</span>
            </div>
            <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                className="mt-1 w-4 h-4 accent-[#4D5AE8] shrink-0"
            />
        </label>
    );

    return (
        <div className="flex flex-col gap-5 max-w-xs mx-auto py-2">
            <div className="flex flex-col gap-1">
                <h4 className="text-[11px] font-semibold text-black/50 uppercase tracking-wide">Notifications</h4>
                <Toggle checked={notifyEventReminders} onChange={setNotifyEventReminders}
                    label="Event reminders" description="Notify 5 minutes before scheduled events" />
                <Toggle checked={notifyDeadlines} onChange={setNotifyDeadlines}
                    label="Deadline alerts" description="Notify when a task deadline is within 24 hours" />
                <Toggle checked={notifyMissedSessions} onChange={setNotifyMissedSessions}
                    label="Missed-session recommendations" description="Show recommendations for sessions you missed" />
            </div>

            <div className="flex flex-col gap-2 pt-3 border-t border-black/5">
                <h4 className="text-[11px] font-semibold text-black/50 uppercase tracking-wide">AI Response Style</h4>
                <div className="flex gap-2">
                    {(['detailed', 'concise'] as const).map((style) => (
                        <button
                            key={style}
                            type="button"
                            onClick={() => setResponseStyle(style)}
                            className={`flex-1 px-3 py-2 rounded-lg text-[12px] font-medium capitalize transition-colors ${
                                responseStyle === style ? 'bg-[#4D5AE8] text-white' : 'bg-black/5 text-black/60 hover:bg-black/10'
                            }`}
                        >
                            {style}
                        </button>
                    ))}
                </div>
                <textarea
                    value={customInstruction}
                    onChange={(e) => setCustomInstruction(e.target.value)}
                    placeholder="Optional: custom instruction for the AI (e.g. \"Always suggest a 5-minute warmup task\")"
                    rows={3}
                    className="border border-black/10 rounded-lg px-3 py-2 text-[12px] outline-none focus:border-[#4D5AE8]/50 focus:ring-1 focus:ring-[#4D5AE8]/20 resize-none"
                />
            </div>

            <div className="pt-3 border-t border-black/5">
                <Toggle checked={voiceInputEnabled} onChange={setVoiceInputEnabled}
                    label="Voice input" description="Show the microphone button in chat" />
            </div>

            <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="mt-1 bg-[#1C1C1E] hover:bg-black disabled:opacity-30 text-white text-[13px] font-medium rounded-lg py-2 transition-colors"
            >
                {saving ? 'Saving…' : 'Save AI & App Preferences'}
            </button>
        </div>
    );
}
```

Then replace the placeholder line in the tab body:

```tsx
                            {activeTab === 'ai' && <div className="text-center text-black/40 text-[12px] py-10">AI & App tab — added in the next task.</div>}
```

with:

```tsx
                            {activeTab === 'ai' && <AiAppTab />}
```

- [ ] **Step 3: Add the `AppSettingsDangerZone` import if not already present**

Confirm `src/components/AppSettingsSheet.tsx` has `import { AppSettingsDangerZone } from './AppSettingsDangerZone';` near the top (it was added in Task 6 Step 1 already — just verify it's there and uncommented).

- [ ] **Step 4: Type-check both tasks' output together**

Run: `cd /Users/aleenajaison/Documents/opensource/movo && npx tsc --noEmit 2>&1 | head -80`
Expected: no errors in `AppSettingsSheet.tsx`, `AppSettingsDangerZone.tsx`, or `store/index.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/components/AppSettingsSheet.tsx src/components/AppSettingsDangerZone.tsx
git commit -m "feat(settings): rewrite Account Settings as a 4-tab screen (Profile, Work, AI & App, Danger Zone)"
```

---

### Task 8: Voice-input toggle gating in GlobalChat and TrayPopup

**Files:**
- Modify: `src/components/GlobalChat.tsx`
- Modify: `src/components/TrayPopup.tsx`

**Interfaces:**
- Consumes: `useStore()` → `preferences: UserPreferences | null`, `preferencesLoaded: boolean`, `fetchPreferences: () => Promise<void>` (Task 5)

- [ ] **Step 1: Gate the mic button in `GlobalChat.tsx`**

In `src/components/GlobalChat.tsx`, the destructure at the top of `export function GlobalChat()` currently reads:

```typescript
    const { globalMessages, sendGlobalMessage, isLoading, isSidebarOpen, toggleSidebar, fetchGoals,
            pendingTrayCapture, setPendingTrayCapture } = useStore();
```

Change it to also pull `preferences`:

```typescript
    const { globalMessages, sendGlobalMessage, isLoading, isSidebarOpen, toggleSidebar, fetchGoals,
            pendingTrayCapture, setPendingTrayCapture, preferences } = useStore();
```

Then find the mic button block (the `else` branch rendering `<Mic className="w-5 h-5" />`, currently around line 178-190):

```tsx
                        ) : (
                            <button
                                type="button"
                                onClick={toggleListening}
                                className={clsx(
                                    'shrink-0 p-1.5 rounded-full transition-colors mb-0.5',
                                    isListening
                                        ? 'text-[#4D5AE8] bg-[#4D5AE8]/10 animate-pulse'
                                        : 'text-black/40 hover:text-[#1C1C1E] hover:bg-black/5'
                                )}
                            >
                                <Mic className="w-5 h-5" />
                            </button>
                        )}
```

Change the condition guarding the whole `{input.trim() ? (...) : (...)}` ternary so it only renders the mic button when voice input is enabled (default to enabled while preferences are still loading, i.e. `preferences?.voice_input_enabled !== false`):

```tsx
                        ) : preferences?.voice_input_enabled !== false ? (
                            <button
                                type="button"
                                onClick={toggleListening}
                                className={clsx(
                                    'shrink-0 p-1.5 rounded-full transition-colors mb-0.5',
                                    isListening
                                        ? 'text-[#4D5AE8] bg-[#4D5AE8]/10 animate-pulse'
                                        : 'text-black/40 hover:text-[#1C1C1E] hover:bg-black/5'
                                )}
                            >
                                <Mic className="w-5 h-5" />
                            </button>
                        ) : null}
```

- [ ] **Step 2: Fetch preferences and gate the mic button in `TrayPopup.tsx`**

In `src/components/TrayPopup.tsx`, change the destructure (currently):

```typescript
    const { globalMessages, sendGlobalMessage, isLoading, fetchGlobalMessages } = useStore();
```

to:

```typescript
    const { globalMessages, sendGlobalMessage, isLoading, fetchGlobalMessages, preferences, preferencesLoaded, fetchPreferences } = useStore();
```

In the mount `useEffect` that currently calls `fetchGlobalMessages()` (the one starting with `setLiquidGlassEffect(...)`), add a preferences fetch alongside it:

```typescript
    useEffect(() => {
        setLiquidGlassEffect({ variant: GlassMaterialVariant.Clear, cornerRadius: 16 }).catch(console.error);
        fetchGlobalMessages();
        if (!preferencesLoaded) fetchPreferences();
        const t = setTimeout(() => inputRef.current?.focus(), 100);
```

(keep the rest of that effect body — the `setTimeout` and whatever follows it — unchanged; only the `if (!preferencesLoaded) fetchPreferences();` line is new, and add `preferencesLoaded, fetchPreferences` to that effect's dependency array if one is declared at the end of the `useEffect(...)` call.)

Then wrap the mic `<button>` (currently unconditionally rendered, shown in the earlier read around line 162-177) so it only renders when enabled:

```tsx
                {/* Mic button */}
                {preferences?.voice_input_enabled !== false && (
                    <button
                        type="button"
                        onClick={toggleListening}
                        disabled={isLoading}
                        title={micError ?? (isListening ? 'Stop listening' : 'Voice input')}
                        className={`shrink-0 p-2 rounded-lg transition-colors disabled:opacity-40 ${
                            micError
                                ? 'text-red-400'
                                : isListening
                                ? 'text-[#4D5AE8] bg-[#4D5AE8]/10 animate-pulse'
                                : 'text-white/40 hover:text-white/80'
                        }`}
                    >
                        {micError ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                    </button>
                )}
```

- [ ] **Step 3: Type-check**

Run: `cd /Users/aleenajaison/Documents/opensource/movo && npx tsc --noEmit 2>&1 | head -60`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/GlobalChat.tsx src/components/TrayPopup.tsx
git commit -m "feat(voice): gate mic button visibility on the voice_input_enabled preference"
```

---

### Task 9: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Run backend tests**

Run: `cd src-tauri && cargo test 2>&1 | tail -40`
Expected: all tests pass, including the new ones from Tasks 1 and 3.

- [ ] **Step 2: Run frontend type-check**

Run: `cd /Users/aleenajaison/Documents/opensource/movo && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Start the dev app**

Run: `cd /Users/aleenajaison/Documents/opensource/movo && npm run tauri dev` (run in background/separate terminal — this blocks)

- [ ] **Step 4: Manually walk through the new screen**

With the app running and logged in:
1. Open the settings dropdown (gear icon) → "Account Settings…" — sheet opens on the Profile tab.
2. Click the avatar, pick an image file → avatar preview updates immediately. Change the name field → "Save Profile" enables → click it → confirm the header name near the avatar and (if visible elsewhere in the app, e.g. initials in the dropdown) updates.
3. Switch to the Work tab → change work hours / days off / focus block / buffer → Save → close and reopen the sheet → confirm values persisted (re-fetches from backend).
4. Switch to AI & App tab → toggle a notification off, set response style to "Concise", type a custom instruction → Save. Send a message in the global chat and confirm the reply is noticeably shorter/terser than before.
5. Toggle "Voice input" off → Save → confirm the mic button disappears from the global chat input bar. Open the tray popup (global shortcut or tray icon) → confirm its mic button is also gone. Toggle back on and confirm it reappears in both places.
6. Danger Zone tab → click "Sign Out" → confirm you're returned to the login screen. Log back in.
7. Danger Zone tab → click "Delete Account…" → type a wrong string → confirm the "Delete Forever" button stays disabled. Type the correct email → button enables → click it (use a disposable test account for this, not your primary one) → confirm you're logged out and a fresh registration with the same email succeeds (proving the row was actually deleted).

- [ ] **Step 5: Report results**

No commit for this task — it's a verification pass. If any manual check fails, return to the relevant task above, fix, re-run that task's own verification, then re-run this checklist from the failing step.
