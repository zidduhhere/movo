# Scheduling Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a deterministic scheduling engine that slots AI-generated tasks into the user's calendar, ordered by dynamic priority score, with a deadline-infeasibility suggestion.

**Architecture:** Greedy day-by-day slot finder in Rust (`scheduler/` module), triggered from the React frontend after the AI creates tasks, outputting `Event` rows in SQLite visible in CalendarView. Three modules — `priority.rs` (score & sort tasks), `conflict.rs` (free-slot arithmetic), `engine.rs` (orchestration) — plus a new Tauri command and a frontend trigger with deadline-suggestion banner.

**Tech Stack:** Rust, chrono 0.4.45, rusqlite 0.40.1, Tauri v2, React + TypeScript, Zustand

## Global Constraints

- All Rust files live under `src-tauri/src/`
- All frontend files live under `src/`
- SQLite migrations are idempotent — wrap `ALTER TABLE` in `let _ = conn.execute(...)` (error = column already exists, ignore)
- Task status DB strings: `"todo"`, `"planned"`, `"inprogress"`, `"completed"`, `"blocked"`, `"skipped"`, `"deferred"`
- Event times stored as RFC3339 UTC strings (matching existing `create_standalone_event` pattern)
- No new Cargo dependencies — use only crates already in `Cargo.toml`
- Follow existing `Repository<'a>` pattern: all DB access via `Repository::new(&conn)`

---

### Task 1: Extend TaskStatus — add variants + Display/FromStr

**Files:**
- Modify: `src-tauri/src/models/task.rs`
- Modify: `src-tauri/src/db/repository.rs` (lines touching `TaskStatus` match arms)

**Interfaces:**
- Produces: `TaskStatus::Planned`, `TaskStatus::Skipped`, `TaskStatus::Deferred` variants; `task.status.to_string()` returns the DB string; `"planned".parse::<TaskStatus>()` returns `Ok(TaskStatus::Planned)`

- [ ] **Step 1: Write the failing test in `models/task.rs`**

Add to the bottom of `src-tauri/src/models/task.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn status_roundtrip() {
        for (s, v) in &[
            ("todo",      TaskStatus::Todo),
            ("planned",   TaskStatus::Planned),
            ("inprogress",TaskStatus::InProgress),
            ("completed", TaskStatus::Completed),
            ("blocked",   TaskStatus::Blocked),
            ("skipped",   TaskStatus::Skipped),
            ("deferred",  TaskStatus::Deferred),
        ] {
            assert_eq!(&v.to_string(), s);
            assert_eq!(&TaskStatus::from_str(s).unwrap(), v);
        }
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd src-tauri && cargo test models::task::tests::status_roundtrip 2>&1 | tail -5
```
Expected: compile error — `Planned`, `Skipped`, `Deferred` not defined.

- [ ] **Step 3: Replace the `TaskStatus` enum and add impls in `models/task.rs`**

Replace the entire file content:

```rust
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use std::fmt;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus {
    Todo,
    Planned,
    InProgress,
    Completed,
    Blocked,
    Skipped,
    Deferred,
}

impl fmt::Display for TaskStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            TaskStatus::Todo      => "todo",
            TaskStatus::Planned   => "planned",
            TaskStatus::InProgress => "inprogress",
            TaskStatus::Completed => "completed",
            TaskStatus::Blocked   => "blocked",
            TaskStatus::Skipped   => "skipped",
            TaskStatus::Deferred  => "deferred",
        };
        write!(f, "{}", s)
    }
}

impl FromStr for TaskStatus {
    type Err = ();
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(match s {
            "planned"    => TaskStatus::Planned,
            "inprogress" => TaskStatus::InProgress,
            "completed"  => TaskStatus::Completed,
            "blocked"    => TaskStatus::Blocked,
            "skipped"    => TaskStatus::Skipped,
            "deferred"   => TaskStatus::Deferred,
            _            => TaskStatus::Todo,
        })
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Task {
    pub id: String,
    pub goal_id: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub status: TaskStatus,
    pub effort_minutes: i32,
    pub priority: i32,
    pub created_at: String,
    pub deadline: Option<String>,
}
```

- [ ] **Step 4: Fix all `TaskStatus` match arms in `db/repository.rs`**

Find every location that matches on `task.status` for insertion or parses a status string from a DB row. Replace them to use `task.status.to_string()` for writing and `status_str.parse().unwrap_or(TaskStatus::Todo)` for reading.

In `add_task` (around line 278), replace the `status_str` block:
```rust
// BEFORE:
let status_str = match task.status {
    TaskStatus::Todo => "todo",
    TaskStatus::InProgress => "inprogress",
    TaskStatus::Completed => "completed",
    TaskStatus::Blocked => "blocked",
};
// AFTER:
let status_str = task.status.to_string();
```

In every `query_map` closure that parses `status`, replace inline match with:
```rust
let status_str: String = row.get(4)?;  // column index may differ — check query
let status = status_str.parse().unwrap_or(TaskStatus::Todo);
```

Apply this to: `get_todos_for_user`, `get_tasks_with_upcoming_deadlines`, `get_missed_sessions`, and `get_tasks_by_goal`.

- [ ] **Step 5: Run test to verify it passes**

```bash
cd src-tauri && cargo test models::task::tests::status_roundtrip 2>&1 | tail -5
```
Expected: `test models::task::tests::status_roundtrip ... ok`

- [ ] **Step 6: Verify full build compiles**

```bash
cd src-tauri && cargo build 2>&1 | grep -E "^error" | head -10
```
Expected: no lines printed.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/models/task.rs src-tauri/src/db/repository.rs
git commit -m "feat(models): add Planned, Skipped, Deferred TaskStatus variants"
```

---

### Task 2: Extend UserPreferences + DB migration + repository read/write

**Files:**
- Modify: `src-tauri/src/models/user_preferences.rs`
- Modify: `src-tauri/src/db/migrations.rs`
- Modify: `src-tauri/src/db/repository.rs` (`get_user_preferences`, `save_user_preferences`)

**Interfaces:**
- Produces: `UserPreferences { buffer_minutes: i32, focus_start: Option<String>, focus_end: Option<String> }` with defaults `10`, `None`, `None`

- [ ] **Step 1: Write failing test in `db/repository.rs`**

Add at the bottom of `src-tauri/src/db/repository.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::run_migrations;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        conn
    }

    #[test]
    fn user_prefs_roundtrip_new_fields() {
        let conn = setup();
        let repo = Repository::new(&conn);
        conn.execute(
            "INSERT INTO users (id, email, name, password_hash, created_at) VALUES ('u1','a@b.com','A','x','2026-01-01')",
            [],
        ).unwrap();
        let prefs = UserPreferences {
            user_id: "u1".to_string(),
            work_start: "09:00".to_string(),
            work_end: "18:00".to_string(),
            focus_block_mins: 60,
            days_off: "Saturday,Sunday".to_string(),
            buffer_minutes: 15,
            focus_start: Some("09:00".to_string()),
            focus_end: Some("11:00".to_string()),
        };
        repo.save_user_preferences(&prefs).unwrap();
        let loaded = repo.get_user_preferences("u1").unwrap().unwrap();
        assert_eq!(loaded.buffer_minutes, 15);
        assert_eq!(loaded.focus_start, Some("09:00".to_string()));
        assert_eq!(loaded.focus_end, Some("11:00".to_string()));
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd src-tauri && cargo test db::repository::tests::user_prefs_roundtrip_new_fields 2>&1 | tail -5
```
Expected: compile error — `buffer_minutes` not a field.

- [ ] **Step 3: Extend `models/user_preferences.rs`**

Replace entire file:

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
        }
    }
}
```

- [ ] **Step 4: Add DB migration columns in `db/migrations.rs`**

Append three `let _ = conn.execute(...)` calls after the existing `user_id` column migration, still inside `run_migrations`:

```rust
let _ = conn.execute(
    "ALTER TABLE user_preferences ADD COLUMN buffer_minutes INTEGER NOT NULL DEFAULT 10",
    [],
);
let _ = conn.execute(
    "ALTER TABLE user_preferences ADD COLUMN focus_start TEXT",
    [],
);
let _ = conn.execute(
    "ALTER TABLE user_preferences ADD COLUMN focus_end TEXT",
    [],
);
```

- [ ] **Step 5: Update `get_user_preferences` in `db/repository.rs`**

Replace the method body:

```rust
pub fn get_user_preferences(&self, user_id: &str) -> Result<Option<UserPreferences>> {
    let mut stmt = self.conn.prepare(
        "SELECT user_id, work_start, work_end, focus_block_mins, days_off,
                COALESCE(buffer_minutes, 10), focus_start, focus_end
         FROM user_preferences WHERE user_id = ?1"
    )?;
    let mut rows = stmt.query_map([user_id], |row| {
        Ok(UserPreferences {
            user_id:          row.get(0)?,
            work_start:       row.get(1)?,
            work_end:         row.get(2)?,
            focus_block_mins: row.get(3)?,
            days_off:         row.get(4)?,
            buffer_minutes:   row.get(5)?,
            focus_start:      row.get(6)?,
            focus_end:        row.get(7)?,
        })
    })?;
    if let Some(row) = rows.next() { Ok(Some(row?)) } else { Ok(None) }
}
```

- [ ] **Step 6: Update `save_user_preferences` in `db/repository.rs`**

Replace the method body:

```rust
pub fn save_user_preferences(&self, prefs: &UserPreferences) -> Result<()> {
    self.conn.execute(
        "INSERT INTO user_preferences
           (user_id, work_start, work_end, focus_block_mins, days_off, buffer_minutes, focus_start, focus_end)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(user_id) DO UPDATE SET
           work_start       = excluded.work_start,
           work_end         = excluded.work_end,
           focus_block_mins = excluded.focus_block_mins,
           days_off         = excluded.days_off,
           buffer_minutes   = excluded.buffer_minutes,
           focus_start      = excluded.focus_start,
           focus_end        = excluded.focus_end",
        rusqlite::params![
            prefs.user_id, prefs.work_start, prefs.work_end,
            prefs.focus_block_mins, prefs.days_off,
            prefs.buffer_minutes, prefs.focus_start, prefs.focus_end,
        ],
    )?;
    Ok(())
}
```

- [ ] **Step 7: Run test to verify it passes**

```bash
cd src-tauri && cargo test db::repository::tests::user_prefs_roundtrip_new_fields 2>&1 | tail -5
```
Expected: `test db::repository::tests::user_prefs_roundtrip_new_fields ... ok`

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/models/user_preferences.rs src-tauri/src/db/migrations.rs src-tauri/src/db/repository.rs
git commit -m "feat(models): extend UserPreferences with buffer_minutes and focus window"
```

---

### Task 3: Priority module

**Files:**
- Create: `src-tauri/src/scheduler/priority.rs`
- Modify: `src-tauri/src/scheduler/mod.rs`
- Modify: `src-tauri/src/commands/recommendations.rs` (remove local `score_task` + `urgency_score`, import from `scheduler::priority`)

**Interfaces:**
- Produces: `scheduler::priority::score_task(task: &Task) -> f64`; `scheduler::priority::sort_by_priority(tasks: Vec<Task>) -> Vec<Task>`

- [ ] **Step 1: Write failing tests — create `src-tauri/src/scheduler/priority.rs`**

```rust
use crate::models::{Task, TaskStatus};
use chrono::Utc;

fn urgency_score(deadline: &Option<String>) -> f64 {
    todo!()
}

pub fn score_task(task: &Task) -> f64 {
    todo!()
}

pub fn sort_by_priority(mut tasks: Vec<Task>) -> Vec<Task> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task(id: &str, priority: i32, deadline_days: Option<i64>) -> Task {
        let deadline = deadline_days.map(|d| {
            (Utc::now().date_naive() + chrono::Duration::days(d))
                .format("%Y-%m-%d").to_string()
        });
        Task {
            id: id.to_string(), goal_id: None, title: id.to_string(),
            description: None, status: TaskStatus::Todo,
            effort_minutes: 60, priority,
            created_at: Utc::now().to_rfc3339(), deadline,
        }
    }

    #[test]
    fn overdue_scores_highest() {
        assert!(score_task(&task("a", 1, Some(-1))) > score_task(&task("b", 1, Some(7))));
    }

    #[test]
    fn higher_priority_number_scores_lower() {
        let p1 = task("a", 1, Some(7));
        let p3 = task("b", 3, Some(7));
        assert!(score_task(&p1) > score_task(&p3));
    }

    #[test]
    fn sort_places_urgent_first() {
        let sorted = sort_by_priority(vec![task("low", 3, Some(14)), task("urgent", 1, Some(1))]);
        assert_eq!(sorted[0].id, "urgent");
    }
}
```

- [ ] **Step 2: Add `pub mod priority;` to `scheduler/mod.rs`**

Replace entire `src-tauri/src/scheduler/mod.rs`:

```rust
pub mod engine;
pub mod conflict;
pub mod priority;
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd src-tauri && cargo test scheduler::priority::tests 2>&1 | tail -5
```
Expected: panics with "not yet implemented".

- [ ] **Step 4: Implement priority module**

Replace `scheduler/priority.rs` with the full implementation:

```rust
use crate::models::{Task, TaskStatus};
use chrono::Utc;

fn urgency_score(deadline: &Option<String>) -> f64 {
    let now = Utc::now().date_naive();
    let Some(dl_str) = deadline else { return 0.4 };
    let deadline_date =
        if let Ok(d) = chrono::NaiveDate::parse_from_str(dl_str, "%Y-%m-%d") { d }
        else if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(dl_str) { dt.date_naive() }
        else { return 0.4 };
    let days = (deadline_date - now).num_days();
    match days {
        d if d < 0 => 1.0,
        0           => 0.97,
        1           => 0.90,
        2..=3       => 0.75,
        4..=7       => 0.55,
        8..=14      => 0.35,
        _           => 0.20,
    }
}

pub fn score_task(task: &Task) -> f64 {
    let urgency        = urgency_score(&task.deadline);
    let priority_score = (6.0 - task.priority as f64) / 5.0;
    let effort_penalty = (task.effort_minutes as f64 / 240.0).min(0.3);
    urgency * priority_score * (1.0 - effort_penalty)
}

pub fn sort_by_priority(mut tasks: Vec<Task>) -> Vec<Task> {
    tasks.sort_by(|a, b| {
        score_task(b)
            .partial_cmp(&score_task(a))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    tasks
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task(id: &str, priority: i32, deadline_days: Option<i64>) -> Task {
        let deadline = deadline_days.map(|d| {
            (Utc::now().date_naive() + chrono::Duration::days(d))
                .format("%Y-%m-%d").to_string()
        });
        Task {
            id: id.to_string(), goal_id: None, title: id.to_string(),
            description: None, status: TaskStatus::Todo,
            effort_minutes: 60, priority,
            created_at: Utc::now().to_rfc3339(), deadline,
        }
    }

    #[test]
    fn overdue_scores_highest() {
        assert!(score_task(&task("a", 1, Some(-1))) > score_task(&task("b", 1, Some(7))));
    }

    #[test]
    fn higher_priority_number_scores_lower() {
        let p1 = task("a", 1, Some(7));
        let p3 = task("b", 3, Some(7));
        assert!(score_task(&p1) > score_task(&p3));
    }

    #[test]
    fn sort_places_urgent_first() {
        let sorted = sort_by_priority(vec![task("low", 3, Some(14)), task("urgent", 1, Some(1))]);
        assert_eq!(sorted[0].id, "urgent");
    }
}
```

- [ ] **Step 5: Update `recommendations.rs` to import from priority**

Remove the local `urgency_score` and `score_task` functions from `commands/recommendations.rs`. Add at the top:

```rust
use crate::scheduler::priority::score_task;
```

Remove the local `fn urgency_score(...)` and `fn score_task(...)` definitions from that file. The `build_reason` function stays in recommendations (it uses urgency logic but only for display, not scoring).

- [ ] **Step 6: Run tests**

```bash
cd src-tauri && cargo test scheduler::priority::tests 2>&1 | tail -8
```
Expected: all 3 tests pass.

- [ ] **Step 7: Verify full build**

```bash
cd src-tauri && cargo build 2>&1 | grep "^error" | head -10
```
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/scheduler/priority.rs src-tauri/src/scheduler/mod.rs src-tauri/src/commands/recommendations.rs
git commit -m "feat(scheduler): add priority module with score_task and sort_by_priority"
```

---

### Task 4: Conflict detection module

**Files:**
- Create: `src-tauri/src/scheduler/conflict.rs`
- Modify: `src-tauri/src/scheduler/mod.rs`

**Interfaces:**
- Produces: `FreeSlot { start: NaiveDateTime, end: NaiveDateTime }`; `day_free_slots(date, work_start, work_end, focus_start, focus_end, occupied, buffer_mins) -> Vec<FreeSlot>`; `find_slot(slots, duration_mins) -> Option<(NaiveDateTime, NaiveDateTime)>`

- [ ] **Step 1: Create `scheduler/conflict.rs` with tests first**

```rust
use chrono::{NaiveDate, NaiveDateTime, NaiveTime, Duration};

#[derive(Debug, Clone, PartialEq)]
pub struct FreeSlot {
    pub start: NaiveDateTime,
    pub end:   NaiveDateTime,
}

pub fn day_free_slots(
    date:        NaiveDate,
    work_start:  NaiveTime,
    work_end:    NaiveTime,
    focus_start: Option<NaiveTime>,
    focus_end:   Option<NaiveTime>,
    occupied:    &[(NaiveDateTime, NaiveDateTime)],
    buffer_mins: i32,
) -> Vec<FreeSlot> {
    todo!()
}

pub fn find_slot(slots: &[FreeSlot], duration_mins: i32) -> Option<(NaiveDateTime, NaiveDateTime)> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date() -> NaiveDate { NaiveDate::from_ymd_opt(2026, 7, 7).unwrap() }
    fn t(h: u32, m: u32) -> NaiveTime { NaiveTime::from_hms_opt(h, m, 0).unwrap() }
    fn dt(h: u32, m: u32) -> NaiveDateTime { date().and_time(t(h, m)) }

    #[test]
    fn empty_day_is_one_big_slot() {
        let slots = day_free_slots(date(), t(9,0), t(18,0), None, None, &[], 0);
        assert_eq!(slots.len(), 1);
        assert_eq!(slots[0].start, dt(9,0));
        assert_eq!(slots[0].end,   dt(18,0));
    }

    #[test]
    fn occupied_block_splits_day() {
        let occ = vec![(dt(10,0), dt(11,0))];
        let slots = day_free_slots(date(), t(9,0), t(18,0), None, None, &occ, 0);
        assert_eq!(slots.len(), 2);
        assert_eq!(slots[0].end,   dt(10,0));
        assert_eq!(slots[1].start, dt(11,0));
    }

    #[test]
    fn buffer_shrinks_next_available() {
        let occ = vec![(dt(10,0), dt(11,0))];
        let slots = day_free_slots(date(), t(9,0), t(18,0), None, None, &occ, 10);
        assert_eq!(slots[1].start, dt(11,10));
    }

    #[test]
    fn find_slot_none_when_too_short() {
        let slots = vec![FreeSlot { start: dt(9,0), end: dt(9,30) }];
        assert!(find_slot(&slots, 60).is_none());
    }

    #[test]
    fn find_slot_returns_first_fitting() {
        let slots = vec![
            FreeSlot { start: dt(9,0),  end: dt(9,30) },
            FreeSlot { start: dt(10,0), end: dt(12,0) },
        ];
        let (s, e) = find_slot(&slots, 60).unwrap();
        assert_eq!(s, dt(10,0));
        assert_eq!(e, dt(11,0));
    }
}
```

- [ ] **Step 2: Add `pub mod conflict;` to `scheduler/mod.rs`**

```rust
pub mod engine;
pub mod conflict;
pub mod priority;
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd src-tauri && cargo test scheduler::conflict::tests 2>&1 | tail -5
```
Expected: panics on `todo!()`.

- [ ] **Step 4: Implement `day_free_slots` and `find_slot`**

Replace the two `todo!()` bodies:

```rust
pub fn day_free_slots(
    date:        NaiveDate,
    work_start:  NaiveTime,
    work_end:    NaiveTime,
    focus_start: Option<NaiveTime>,
    focus_end:   Option<NaiveTime>,
    occupied:    &[(NaiveDateTime, NaiveDateTime)],
    buffer_mins: i32,
) -> Vec<FreeSlot> {
    let day_start = date.and_time(work_start);
    let day_end   = date.and_time(work_end);

    // Clip and buffer occupied blocks to the work window
    let mut blocks: Vec<(NaiveDateTime, NaiveDateTime)> = occupied
        .iter()
        .filter(|(s, e)| *e > day_start && *s < day_end)
        .map(|(s, e)| {
            let s2 = (*s).max(day_start);
            let e2 = (*e + Duration::minutes(buffer_mins as i64)).min(day_end);
            (s2, e2)
        })
        .collect();
    blocks.sort_by_key(|(s, _)| *s);

    // Compute gaps
    let mut slots = Vec::new();
    let mut cursor = day_start;
    for (bs, be) in &blocks {
        if cursor < *bs { slots.push(FreeSlot { start: cursor, end: *bs }); }
        if *be > cursor  { cursor = *be; }
    }
    if cursor < day_end { slots.push(FreeSlot { start: cursor, end: day_end }); }

    // Focus window: put matching slots first
    if let (Some(fs), Some(fe)) = (focus_start, focus_end) {
        let fs_dt = date.and_time(fs);
        let fe_dt = date.and_time(fe);
        let (focus, other): (Vec<_>, Vec<_>) = slots
            .into_iter()
            .partition(|s| s.start >= fs_dt && s.end <= fe_dt);
        let mut result = focus;
        result.extend(other);
        return result;
    }

    slots
}

pub fn find_slot(slots: &[FreeSlot], duration_mins: i32) -> Option<(NaiveDateTime, NaiveDateTime)> {
    let dur = Duration::minutes(duration_mins as i64);
    slots.iter().find_map(|s| {
        if s.end - s.start >= dur { Some((s.start, s.start + dur)) } else { None }
    })
}
```

- [ ] **Step 5: Run tests**

```bash
cd src-tauri && cargo test scheduler::conflict::tests 2>&1 | tail -8
```
Expected: all 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/scheduler/conflict.rs src-tauri/src/scheduler/mod.rs
git commit -m "feat(scheduler): add conflict module with free-slot computation"
```

---

### Task 5: Repository additions for scheduling

**Files:**
- Modify: `src-tauri/src/db/repository.rs` (add 2 new methods)

**Interfaces:**
- Produces: `repo.get_tasks_for_scheduling(goal_id: &str) -> Result<Vec<Task>>`; `repo.create_scheduled_event_for_task(user_id, task_id, title, start_time, end_time) -> Result<()>`

- [ ] **Step 1: Write failing tests**

Add inside the existing `#[cfg(test)] mod tests` block in `db/repository.rs`:

```rust
#[test]
fn get_tasks_for_scheduling_excludes_completed() {
    let conn = setup();
    let repo = Repository::new(&conn);
    conn.execute(
        "INSERT INTO users (id,email,name,password_hash,created_at) VALUES ('u1','a@b.com','A','x','2026-01-01')",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO goals (id,user_id,title,status,created_at) VALUES ('g1','u1','Goal','active','2026-01-01')",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO tasks (id,goal_id,title,status,effort_minutes,priority,created_at) VALUES ('t1','g1','Task1','todo',60,1,'2026-01-01')",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO tasks (id,goal_id,title,status,effort_minutes,priority,created_at) VALUES ('t2','g1','Task2','completed',60,1,'2026-01-01')",
        [],
    ).unwrap();
    let tasks = repo.get_tasks_for_scheduling("g1").unwrap();
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0].id, "t1");
}

#[test]
fn create_scheduled_event_for_task_inserts_row() {
    let conn = setup();
    let repo = Repository::new(&conn);
    conn.execute(
        "INSERT INTO users (id,email,name,password_hash,created_at) VALUES ('u1','a@b.com','A','x','2026-01-01')",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO goals (id,user_id,title,status,created_at) VALUES ('g1','u1','Goal','active','2026-01-01')",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO tasks (id,goal_id,title,status,effort_minutes,priority,created_at) VALUES ('t1','g1','Do the thing','todo',60,1,'2026-01-01')",
        [],
    ).unwrap();
    repo.create_scheduled_event_for_task(
        "u1", "t1", "Do the thing",
        "2026-07-07T09:00:00+00:00",
        "2026-07-07T10:00:00+00:00",
    ).unwrap();
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM events WHERE task_id = 't1'", [], |r| r.get(0)
    ).unwrap();
    assert_eq!(count, 1);
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd src-tauri && cargo test db::repository::tests::get_tasks_for_scheduling 2>&1 | tail -5
```
Expected: compile error — method does not exist.

- [ ] **Step 3: Implement methods in `db/repository.rs`**

Add these two methods inside `impl<'a> Repository<'a>`:

```rust
pub fn get_tasks_for_scheduling(&self, goal_id: &str) -> Result<Vec<Task>> {
    let mut stmt = self.conn.prepare(
        "SELECT id, goal_id, title, description, status,
                effort_minutes, priority, created_at, deadline
         FROM tasks
         WHERE goal_id = ?1 AND status NOT IN ('completed', 'skipped')
         ORDER BY created_at ASC"
    )?;
    let iter = stmt.query_map(rusqlite::params![goal_id], |row| {
        let status_str: String = row.get(4)?;
        Ok(Task {
            id:             row.get(0)?,
            goal_id:        row.get(1)?,
            title:          row.get(2)?,
            description:    row.get(3)?,
            status:         status_str.parse().unwrap_or(TaskStatus::Todo),
            effort_minutes: row.get(5)?,
            priority:       row.get(6)?,
            created_at:     row.get(7)?,
            deadline:       row.get(8)?,
        })
    })?;
    let mut tasks = Vec::new();
    for t in iter { tasks.push(t?); }
    Ok(tasks)
}

pub fn create_scheduled_event_for_task(
    &self,
    user_id:    &str,
    task_id:    &str,
    title:      &str,
    start_time: &str,
    end_time:   &str,
) -> Result<()> {
    let id = uuid::Uuid::new_v4().to_string();
    self.conn.execute(
        "INSERT INTO events (id, task_id, title, start_time, end_time, status, user_id)
         VALUES (?1, ?2, ?3, ?4, ?5, 'scheduled', ?6)",
        rusqlite::params![id, task_id, title, start_time, end_time, user_id],
    )?;
    Ok(())
}
```

- [ ] **Step 4: Run tests**

```bash
cd src-tauri && cargo test db::repository::tests 2>&1 | tail -10
```
Expected: all repository tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db/repository.rs
git commit -m "feat(db): add get_tasks_for_scheduling and create_scheduled_event_for_task"
```

---

### Task 6: Scheduling engine

**Files:**
- Create: `src-tauri/src/scheduler/engine.rs`
- Modify: `src-tauri/src/scheduler/mod.rs`

**Interfaces:**
- Consumes: `scheduler::priority::sort_by_priority`; `scheduler::conflict::{day_free_slots, find_slot}`; `Repository::get_tasks_for_scheduling`, `::create_scheduled_event_for_task`, `::get_events_in_range`, `::update_task_status`, `::get_user_preferences`
- Produces: `pub struct ScheduleResult { pub scheduled_count: usize, pub infeasible: bool, pub suggested_deadline: Option<String> }`; `pub fn schedule_goal(goal_id: &str, conn: &Connection) -> Result<ScheduleResult, String>`

- [ ] **Step 1: Write failing test**

Create `src-tauri/src/scheduler/engine.rs` with test only:

```rust
use rusqlite::Connection;
use serde::{Serialize, Deserialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct ScheduleResult {
    pub scheduled_count:    usize,
    pub infeasible:         bool,
    pub suggested_deadline: Option<String>,
}

pub fn schedule_goal(goal_id: &str, conn: &Connection) -> Result<ScheduleResult, String> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::run_migrations;
    use chrono::Utc;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        conn
    }

    #[test]
    fn schedules_tasks_within_deadline() {
        let conn = setup();
        // Seed user, goal (deadline in 7 days), 2 tasks of 60 min each
        conn.execute(
            "INSERT INTO users (id,email,name,password_hash,created_at) VALUES ('u1','a@b.com','A','x','2026-01-01')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO user_preferences (user_id,work_start,work_end,focus_block_mins,days_off)
             VALUES ('u1','09:00','18:00',60,'')",
            [],
        ).unwrap();
        let deadline = (Utc::now().date_naive() + chrono::Duration::days(7))
            .format("%Y-%m-%d").to_string();
        conn.execute(
            &format!("INSERT INTO goals (id,user_id,title,status,created_at,target_date) VALUES ('g1','u1','Goal','active','2026-01-01','{}')", deadline),
            [],
        ).unwrap();
        for (i, title) in ["Task A", "Task B"].iter().enumerate() {
            conn.execute(
                &format!("INSERT INTO tasks (id,goal_id,title,status,effort_minutes,priority,created_at) VALUES ('t{}','g1','{}','todo',60,1,'2026-01-0{}')", i+1, title, i+1),
                [],
            ).unwrap();
        }

        let result = schedule_goal("g1", &conn).unwrap();
        assert_eq!(result.scheduled_count, 2);
        assert!(!result.infeasible);

        // Events should be created
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM events WHERE task_id IN ('t1','t2')", [], |r| r.get(0)
        ).unwrap();
        assert_eq!(count, 2);

        // Task statuses should be 'planned'
        let statuses: Vec<String> = {
            let mut stmt = conn.prepare("SELECT status FROM tasks WHERE goal_id='g1' ORDER BY created_at").unwrap();
            stmt.query_map([], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect()
        };
        assert!(statuses.iter().all(|s| s == "planned"));
    }
}
```

- [ ] **Step 2: Add `pub mod engine;` to `scheduler/mod.rs`**

```rust
pub mod engine;
pub mod conflict;
pub mod priority;
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd src-tauri && cargo test scheduler::engine::tests::schedules_tasks_within_deadline 2>&1 | tail -5
```
Expected: panics on `todo!()`.

- [ ] **Step 4: Implement `schedule_goal`**

Replace the `todo!()` in `engine.rs`:

```rust
use chrono::{NaiveDate, NaiveTime, NaiveDateTime, Duration, Utc, TimeZone};
use rusqlite::Connection;
use serde::{Serialize, Deserialize};
use crate::db::repository::Repository;
use crate::scheduler::priority::sort_by_priority;
use crate::scheduler::conflict::{day_free_slots, find_slot};

#[derive(Debug, Serialize, Deserialize)]
pub struct ScheduleResult {
    pub scheduled_count:    usize,
    pub infeasible:         bool,
    pub suggested_deadline: Option<String>,
}

pub fn schedule_goal(goal_id: &str, conn: &Connection) -> Result<ScheduleResult, String> {
    // 1. Load goal metadata
    let (user_id, target_date_str): (String, Option<String>) = conn
        .query_row(
            "SELECT user_id, target_date FROM goals WHERE id = ?1",
            rusqlite::params![goal_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    let repo = Repository::new(conn);

    // 2. Load preferences
    let prefs = repo.get_user_preferences(&user_id)
        .map_err(|e| e.to_string())?
        .unwrap_or_default();

    // 3. Load and sort tasks by priority score
    let raw_tasks = repo.get_tasks_for_scheduling(goal_id)
        .map_err(|e| e.to_string())?;
    if raw_tasks.is_empty() {
        return Ok(ScheduleResult { scheduled_count: 0, infeasible: false, suggested_deadline: None });
    }
    let mut tasks = sort_by_priority(raw_tasks).into_iter();

    // 4. Parse scheduling params
    let work_start = NaiveTime::parse_from_str(&prefs.work_start, "%H:%M")
        .unwrap_or_else(|_| NaiveTime::from_hms_opt(9, 0, 0).unwrap());
    let work_end = NaiveTime::parse_from_str(&prefs.work_end, "%H:%M")
        .unwrap_or_else(|_| NaiveTime::from_hms_opt(18, 0, 0).unwrap());
    let focus_start = prefs.focus_start.as_deref()
        .and_then(|s| NaiveTime::parse_from_str(s, "%H:%M").ok());
    let focus_end = prefs.focus_end.as_deref()
        .and_then(|s| NaiveTime::parse_from_str(s, "%H:%M").ok());
    let days_off: Vec<String> = prefs.days_off.split(',')
        .map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();

    let today = Utc::now().date_naive();
    let deadline = target_date_str.as_deref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        .unwrap_or_else(|| today + Duration::days(14));
    let horizon = deadline + Duration::days(60);

    // 5. Greedy slot loop
    let mut scheduled_count = 0;
    let mut current_task = tasks.next();
    let mut current_date = today;
    let mut day_extra: Vec<(NaiveDateTime, NaiveDateTime)> = Vec::new();
    let mut latest_scheduled_date: Option<NaiveDate> = None;

    while let Some(ref task) = current_task {
        if current_date > horizon { break; }

        // Skip days off
        let weekday = current_date.format("%A").to_string();
        if days_off.contains(&weekday) {
            current_date += Duration::days(1);
            day_extra.clear();
            continue;
        }

        // Load events for this calendar day from DB
        let day_start_utc = Utc.from_utc_datetime(&current_date.and_time(NaiveTime::from_hms_opt(0,0,0).unwrap()));
        let day_end_utc   = Utc.from_utc_datetime(&current_date.and_time(NaiveTime::from_hms_opt(23,59,59).unwrap()));
        let db_events = repo.get_events_in_range(
            &user_id,
            &day_start_utc.to_rfc3339(),
            &day_end_utc.to_rfc3339(),
        ).map_err(|e| e.to_string())?;

        // Parse to NaiveDateTime occupied blocks
        let mut occupied: Vec<(NaiveDateTime, NaiveDateTime)> = db_events.iter()
            .filter_map(|e| {
                let s = chrono::DateTime::parse_from_rfc3339(&e.start_time).ok()?;
                let en = chrono::DateTime::parse_from_rfc3339(&e.end_time).ok()?;
                Some((s.naive_utc(), en.naive_utc()))
            })
            .collect();
        occupied.extend(day_extra.iter().cloned());

        let free_slots = day_free_slots(
            current_date, work_start, work_end, focus_start, focus_end,
            &occupied, prefs.buffer_minutes,
        );

        if let Some((slot_start, slot_end)) = find_slot(&free_slots, task.effort_minutes) {
            // Track intra-day bookings so subsequent tasks on same day avoid this slot
            day_extra.push((slot_start, slot_end));

            let start_rfc = Utc.from_utc_datetime(&slot_start).to_rfc3339();
            let end_rfc   = Utc.from_utc_datetime(&slot_end).to_rfc3339();

            repo.create_scheduled_event_for_task(
                &user_id, &task.id, &task.title, &start_rfc, &end_rfc,
            ).map_err(|e| e.to_string())?;

            repo.update_task_status(&task.id, "planned")
                .map_err(|e| e.to_string())?;

            latest_scheduled_date = Some(
                match latest_scheduled_date {
                    Some(prev) if slot_end.date() > prev => slot_end.date(),
                    Some(prev) => prev,
                    None => slot_end.date(),
                }
            );
            scheduled_count += 1;
            current_task = tasks.next();
            // Do NOT advance date — try to fit next task on the same day
        } else {
            // No slot today; move to next day
            current_date += Duration::days(1);
            day_extra.clear();
        }
    }

    let infeasible = current_task.is_some()
        || latest_scheduled_date.map(|d| d > deadline).unwrap_or(false);

    let suggested_deadline = if infeasible {
        latest_scheduled_date.map(|d| d.format("%Y-%m-%d").to_string())
    } else {
        None
    };

    Ok(ScheduleResult { scheduled_count, infeasible, suggested_deadline })
}
```

- [ ] **Step 5: Run test**

```bash
cd src-tauri && cargo test scheduler::engine::tests::schedules_tasks_within_deadline 2>&1 | tail -8
```
Expected: `test scheduler::engine::tests::schedules_tasks_within_deadline ... ok`

- [ ] **Step 6: Run all scheduler tests**

```bash
cd src-tauri && cargo test scheduler:: 2>&1 | tail -12
```
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/scheduler/engine.rs src-tauri/src/scheduler/mod.rs
git commit -m "feat(scheduler): implement schedule_goal greedy engine"
```

---

### Task 7: Tauri command + lib.rs registration

**Files:**
- Modify: `src-tauri/src/commands/schedule.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `scheduler::engine::{schedule_goal, ScheduleResult}`
- Produces: Tauri command `schedule_goal(goal_id: String) -> Result<ScheduleResult, String>` callable from frontend as `invoke('schedule_goal', { goalId })`

- [ ] **Step 1: Replace stub in `commands/schedule.rs`**

```rust
use tauri::State;
use std::sync::Mutex;
use rusqlite::Connection;
use crate::scheduler::engine::{schedule_goal as run_scheduler, ScheduleResult};

#[tauri::command]
pub fn schedule_goal(
    goal_id: String,
    conn: State<'_, Mutex<Connection>>,
) -> Result<ScheduleResult, String> {
    let conn_guard = conn.lock().map_err(|e| e.to_string())?;
    run_scheduler(&goal_id, &conn_guard)
}
```

- [ ] **Step 2: Register command in `lib.rs`**

In `lib.rs`, add `commands::schedule::schedule_goal` to the `tauri::generate_handler![]` macro. It should appear alongside the other commands:

```rust
commands::schedule::schedule_goal,
```

- [ ] **Step 3: Build to verify**

```bash
cd src-tauri && cargo build 2>&1 | grep "^error" | head -10
```
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/schedule.rs src-tauri/src/lib.rs
git commit -m "feat(commands): expose schedule_goal as Tauri command"
```

---

### Task 8: Frontend trigger + deadline suggestion banner

**Files:**
- Modify: `src/components/GoalChatView.tsx`

**Interfaces:**
- Consumes: Tauri command `schedule_goal(goalId)` returning `{ scheduled_count: number; infeasible: boolean; suggested_deadline: string | null }`
- Produces: auto-scheduling after first task batch; dismissible deadline-suggestion banner

- [ ] **Step 1: Add ScheduleResult type and scheduling state to `GoalChatView.tsx`**

At the top of the file, add the import and type:

```tsx
import { invoke } from '@tauri-apps/api/core';

interface ScheduleResult {
  scheduled_count: number;
  infeasible: boolean;
  suggested_deadline: string | null;
}
```

Inside the main `GoalChatView` component (where other `useState` calls live), add:

```tsx
const [scheduleResult, setScheduleResult] = useState<ScheduleResult | null>(null);
const [scheduleBannerDismissed, setScheduleBannerDismissed] = useState(false);
const hasScheduledRef = useRef(false);
```

- [ ] **Step 2: Add scheduling trigger after sendMessage**

Locate the `doSend` function. After `await sendMessage(...)` succeeds, add the scheduling trigger:

```tsx
const doSend = async (text: string) => {
    if (!text.trim() || !activeGoalId || isTyping) return;
    setIsTyping(true);
    try {
        await sendMessage(activeGoalId, text.trim());
        // Trigger scheduling once after the first task batch is created
        if (!hasScheduledRef.current && tasks.length > 0) {
            hasScheduledRef.current = true;
            try {
                const result = await invoke<ScheduleResult>('schedule_goal', { goalId: activeGoalId });
                setScheduleResult(result);
            } catch (err) {
                console.error('Scheduling failed:', err);
            }
        }
    } finally {
        setIsTyping(false);
    }
};
```

- [ ] **Step 3: Reset scheduling state when activeGoalId changes**

Add a `useEffect` that resets `hasScheduledRef` and clears the banner when the user switches goals:

```tsx
useEffect(() => {
    hasScheduledRef.current = false;
    setScheduleResult(null);
    setScheduleBannerDismissed(false);
}, [activeGoalId]);
```

- [ ] **Step 4: Render the deadline suggestion banner**

Locate the Messages section in the JSX (the `<div className="flex-1 overflow-y-auto">` block). Just before the messages list, add:

```tsx
{scheduleResult?.infeasible && !scheduleBannerDismissed && (
    <div className="mx-6 mt-4 flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-sm">
        <span className="text-amber-800">
            ⚠️ Not enough free time before your deadline.
            {scheduleResult.suggested_deadline && (
                <> Earliest completion: <strong>{scheduleResult.suggested_deadline}</strong>.</>
            )}
        </span>
        <button
            onClick={() => setScheduleBannerDismissed(true)}
            className="shrink-0 text-amber-600 hover:text-amber-800 font-medium transition-colors"
        >
            Dismiss
        </button>
    </div>
)}
```

- [ ] **Step 5: Also trigger scheduling after interactive question answer**

Find where `doSend` is called after a user selects an option in `InteractiveQuestion` (look for `onSelect={...}` in the JSX). It calls `doSend(val)` already — no change needed since `doSend` now handles the scheduling trigger.

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd /Users/aleenajaison/Documents/projects/opensource/movo && npx tsc --noEmit 2>&1 | head -20
```
Expected: no output (or existing non-scheduling-related errors only).

- [ ] **Step 7: Commit**

```bash
git add src/components/GoalChatView.tsx
git commit -m "feat(frontend): trigger scheduling after task creation, show deadline banner"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Dynamic Priority Calculator before scheduling | Task 3 (priority.rs) + Task 6 (engine sorts before slotting) |
| Greedy day-by-day slot finder | Task 6 |
| Respect work_start / work_end | Task 6 (engine parses prefs) |
| Skip days_off | Task 6 |
| Avoid existing calendar events | Task 6 (get_events_in_range per day) |
| buffer_minutes between events | Task 2 (model) + Task 4 (conflict.rs) + Task 6 |
| Focus window preference | Task 2 (model) + Task 4 (conflict.rs reorders slots) + Task 6 |
| One task = one contiguous Event block | Task 6 (find_slot returns exact duration) |
| TaskStatus: Planned, Skipped, Deferred | Task 1 |
| Deadline-infeasibility detection | Task 6 (infeasible flag) |
| Suggested alternative deadline | Task 6 + Task 8 (banner) |
| Frontend trigger after task creation | Task 8 |
| `schedule_goal` Tauri command | Task 7 |

All spec requirements covered. No placeholders in any task.
