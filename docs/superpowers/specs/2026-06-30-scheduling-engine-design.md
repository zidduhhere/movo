# Scheduling Engine — Design Spec

**Date:** 2026-06-30
**Status:** Approved

---

## Overview

Implement the deterministic Scheduling Engine described in Movo's AI Execution Engine spec. The engine takes tasks produced by the conversational AI planner, orders them by dynamic priority score, and slots each one into the user's calendar as a concrete `Event` row. Three previously stubbed modules (`scheduler/engine.rs`, `scheduler/priority.rs`, `scheduler/conflict.rs`) are filled in. Three model gaps are closed: `TaskStatus` gains `Planned`, `Skipped`, `Deferred`; `UserPreferences` gains `buffer_minutes`, `focus_start`, `focus_end`.

---

## Architecture

```
chat_with_ai() → creates Task rows (status: Todo)
        │
        │  frontend detects first task batch
        ▼
schedule_goal(goal_id)   [new Tauri command]
        │
        ├─ 1. Load tasks for goal (status != Completed)
        ├─ 2. Score & sort via priority.rs (deadline + priority + effort)
        ├─ 3. Load UserPreferences (work hours, days off, buffer_minutes, focus window)
        ├─ 4. Load existing Events for the scheduling horizon
        │
        └─ 5. For each task in priority order:
                a. Walk days from today → goal target_date
                b. Skip days_off, respect work_start/work_end and focus window
                c. Subtract existing events + buffer_minutes gaps
                d. Find first free slot ≥ effort_minutes
                e. Create Event (task_id, start_time, end_time, status: Scheduled)
                f. Set Task status → Planned
                g. If no slot found before deadline → collect as infeasible
        │
        └─ 6. Return ScheduleResult
                • scheduled_count
                • infeasible: bool
                • suggested_deadline: Option<NaiveDate>  (earliest date all tasks fit)
```

---

## Module Contracts

### `scheduler/priority.rs`

```rust
pub fn score_task(task: &Task) -> f64
// Returns 0.0–1.0. Higher = schedule sooner.
// Factors: deadline proximity (dominant), task.priority inverse, effort penalty.
// Reuses the scoring logic from recommendations.rs (do not duplicate).

pub fn sort_by_priority(tasks: Vec<Task>) -> Vec<Task>
// Stable sort descending by score_task. Preserves creation order on ties.
```

### `scheduler/conflict.rs`

```rust
pub struct FreeSlot {
    pub start: NaiveDateTime,
    pub end:   NaiveDateTime,
}

pub fn day_free_slots(
    date:            NaiveDate,
    work_start:      NaiveTime,
    work_end:        NaiveTime,
    focus_start:     Option<NaiveTime>,  // prefer slots within focus window
    focus_end:       Option<NaiveTime>,
    occupied:        &[(NaiveDateTime, NaiveDateTime)],
    buffer_mins:     i32,
) -> Vec<FreeSlot>
// Returns free windows for `date` sorted by start time.
// Focus window slots are returned first; non-focus slots appended after.
// buffer_mins is subtracted from the end of each occupied block before computing gaps.

pub fn find_slot(
    slots:        &[FreeSlot],
    duration_mins: i32,
) -> Option<(NaiveDateTime, NaiveDateTime)>
// Returns (start, end) of the first slot that fits duration_mins.
```

### `scheduler/engine.rs`

```rust
pub struct ScheduleResult {
    pub scheduled_count:     usize,
    pub infeasible:          bool,
    pub suggested_deadline:  Option<NaiveDate>,
}

pub fn schedule_goal(
    goal_id: &str,
    conn:    &Connection,
) -> Result<ScheduleResult, String>
// Entry point. Loads prefs, tasks, events. Runs the greedy slot loop.
// Creates Event rows and updates Task.status to Planned for each placed task.
// If deadline is None, defaults to today + 14 days.
```

### `commands/schedule.rs` (new Tauri command)

```rust
#[tauri::command]
pub fn schedule_goal(
    goal_id:   String,
    conn:      State<'_, Mutex<Connection>>,
    app_state: State<'_, AppState>,
) -> Result<ScheduleResult, String>
```

---

## Data Model Changes

### `models/task.rs` — extend `TaskStatus`

```rust
pub enum TaskStatus {
    Todo,
    Planned,    // new — scheduled, waiting to be started
    InProgress,
    Completed,
    Blocked,
    Skipped,    // new — user explicitly skipped
    Deferred,   // new — pushed to a later date by replanning
}
```

### `models/user_preferences.rs` — extend `UserPreferences`

```rust
pub struct UserPreferences {
    // existing fields unchanged
    pub user_id:         String,
    pub work_start:      String,   // "09:00"
    pub work_end:        String,   // "18:00"
    pub focus_block_mins: i32,
    pub days_off:        String,   // "Saturday,Sunday"
    // new fields
    pub buffer_minutes:  i32,            // default 10
    pub focus_start:     Option<String>, // e.g. "09:00" — start of preferred focus window
    pub focus_end:       Option<String>, // e.g. "11:00" — end of preferred focus window
}
```

### DB migration (run in `db/connection.rs` `init_db`)

```sql
ALTER TABLE user_preferences ADD COLUMN buffer_minutes INTEGER NOT NULL DEFAULT 10;
ALTER TABLE user_preferences ADD COLUMN focus_start TEXT;
ALTER TABLE user_preferences ADD COLUMN focus_end TEXT;
```

SQLite `ALTER TABLE ADD COLUMN` is safe on existing databases. Wrap each in `IF NOT EXISTS` guard via checking `PRAGMA table_info`.

---

## Repository Changes

Add to `db/repository.rs`:

```rust
pub fn get_tasks_for_scheduling(&self, goal_id: &str) -> Result<Vec<Task>>
// Returns tasks WHERE goal_id = ? AND status NOT IN ('completed') ORDER BY created_at ASC

pub fn create_scheduled_event(
    &self, user_id: &str, goal_id: &str, task_id: &str,
    title: &str, start_time: &str, end_time: &str,
) -> Result<Event>
// Inserts into events table with status = 'scheduled', linked to task_id and goal_id

pub fn get_events_for_goal(&self, goal_id: &str) -> Result<Vec<Event>>
// Returns all events WHERE goal_id = ? for conflict checking within same goal
```

---

## Frontend Integration

### Trigger

In `GoalChatView.tsx` (or `ProjectChat.tsx`), after `chat_with_ai` returns a non-empty `tasks` array for the first time, invoke `schedule_goal(goal_id)`. Do not re-invoke on subsequent chat turns unless tasks change. Track with a ref: `hasScheduled`.

### Deadline Suggestion Banner

If `ScheduleResult.infeasible === true`, render a dismissible banner below the task list:

```
⚠️ Not enough free time before your deadline.
   Earliest feasible completion: [suggested_deadline].
   [Update deadline]  [Dismiss]
```

"Update deadline" opens the goal edit flow. "Dismiss" hides the banner for that session.

---

## Out of Scope

- Adaptive replanning (reschedule on missed tasks) — Phase 2
- Behavioral learning (preferred hours from history) — Phase 2
- Drag-to-reschedule in CalendarView — Phase 2
- Exposing `buffer_minutes` / focus window in Settings UI — Phase 2 (defaults only for now)
