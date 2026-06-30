# Design: Global Chat + Task Chat with Tool-Based AI

**Date:** 2026-06-30
**Status:** Approved

## Summary

Replace the current project-creation flow and per-goal chat with two distinct AI chat surfaces:
- **Global chat** — a persistent, free-form AI chat where the model decides when to create projects and tasks
- **Task chat** — a scoped chat panel per task where the model can take actions on that specific task

The model gets `get_calendar_events` as a read tool in both contexts, enabling calendar-aware scheduling without a separate server.

---

## Architecture

Two new Tauri commands replace `chat_with_ai` and retire `plan_goal`:

| Command | Signature | Purpose |
|---|---|---|
| `global_chat` | `(content: String)` | Free-form AI chat; AI creates goals/tasks via tools |
| `task_chat` | `(task_id: String, content: String)` | Scoped chat for one task; AI takes task actions |

Both use `OpenAiProvider` with tool-calling. They share `db::repository::Repository` and the `get_calendar_events` query logic but have separate tool definitions and system prompts.

### Global Chat Tools

| Tool | Description |
|---|---|
| `create_project(title, description, target_date?)` | Creates a goal in DB; emits `goal_created` event to frontend |
| `get_calendar_events(from, to)` | Queries SQLite for events in range; returns as tool result |
| `create_task(goal_id, title, description?, effort_minutes, priority, deadline?)` | Creates a task under an existing goal |
| `add_to_calendar(title, start_time, end_time)` | Creates a standalone calendar event |
| `delete_task(task_id)` | Deletes a task |

### Task Chat Tools

| Tool | Description |
|---|---|
| `get_task_context()` | Returns full task details, parent goal, and current calendar event |
| `get_calendar_events(from, to)` | Same as global — reads events in range |
| `reschedule_task(task_id, new_start, new_end)` | Deletes old calendar event, creates new one, emits `calendar_updated` |
| `complete_task(task_id)` | Marks task status `completed` |
| `split_task(task_id, subtasks[{title, effort_minutes, priority}])` | Creates new tasks under the same goal |

---

## Data Flow

### Global chat — scheduling a new goal

```
User: "I need to launch my portfolio by July 15"
  → AI calls get_calendar_events("2026-06-30", "2026-07-15")
  → Rust queries SQLite, returns occupied slots as tool result
  → AI analyzes gaps against user work hours/days off
  → AI calls create_project("Portfolio Launch", "...", "2026-07-15")
  → Rust creates goal row, emits goal_created → sidebar updates
  → AI calls create_task(...) × N with deadlines avoiding busy slots
  → AI responds in thread: "Created 'Portfolio Launch' with 4 tasks..."
```

### Task chat — reschedule

```
User: "Move this to next week, I'm busy Thursday"
  → AI calls get_task_context()           — task + current calendar event
  → AI calls get_calendar_events(...)     — next week's occupied slots
  → AI calls reschedule_task(id, new_start, new_end)
  → Rust deletes old event, inserts new, emits calendar_updated
  → AI responds: "Rescheduled to Monday July 7, 10–11am"
```

### `get_calendar_events` — tool result format

```json
[
  { "id": "...", "title": "...", "start_time": "2026-07-01T10:00:00Z", "end_time": "2026-07-01T11:00:00Z", "task_id": "...", "goal_title": "..." }
]
```

The AI receives this as a tool result and uses it to reason about free slots. No Node.js server is needed — Rust owns the data.

---

## Frontend Changes

### 1. Global chat replaces EmptyState / GoalCapture

- `new_project` view → replaced by `GlobalChat` component
- Standard chat input + scrollable message thread
- When AI calls `create_project`, frontend receives `goal_created` event, adds goal to sidebar, continues the same thread
- `GoalCapture` and `EmptyState` components are retired

### 2. Sidebar goal items open GoalDetailView

- Clicking a goal sets `activeView: 'project'` and `activeGoalId`
- `GoalDetailView` renders the task list for that goal (replaces `GoalChatView` which mixed chat + tasks)
- Each task row shows: title, status badge, effort, deadline, and a "Chat" button
- `GoalChatView` is retired

### 3. In-task chat as a slide-in panel

- Clicking "Chat" on a task opens a right-side panel: `TaskChatPanel`
- Panel contains a scoped message thread + input, calls `task_chat` Tauri command
- Panel has a close button; closing preserves the task list view
- Panel is aware of `task_id` only — no cross-goal data

### Zustand store additions

```ts
globalMessages: ChatMessage[]
taskMessages: Record<string, ChatMessage[]>   // keyed by task_id
sendGlobalMessage: (content: string) => Promise<void>
sendTaskMessage: (taskId: string, content: string) => Promise<void>
activeChatTaskId: string | null
setActiveChatTaskId: (id: string | null) => void
```

---

## System Prompts

### Global chat
- Identity: "Movo — AI Chief of Staff"
- Context injected: today's date, user work hours/days off, goals list
- Calendar context: NOT pre-loaded — AI calls `get_calendar_events` when it needs it
- Personality: conversational, asks one question at a time, calls `create_project` only when user intent is clearly a trackable goal

### Task chat
- Identity: "Movo — Task Assistant"
- Context injected: task title, description, deadline, effort, status, parent goal title, current calendar event if any
- Calendar context: NOT pre-loaded — AI calls `get_calendar_events` when it needs it
- Personality: focused, action-oriented, stays on topic of this task only

---

## DB Changes

None required. All needed data is already in the schema. The `global_chat` command uses `user_id` from `AppState.current_user_id` (set at login) instead of requiring it from a `goal_id` lookup.

---

## Commands Retired

- `chat_with_ai` — replaced by `global_chat` + `task_chat`
- `plan_goal` — retired; AI plans via `create_task` tool calls in global chat

Both can be removed from `invoke_handler!` in `lib.rs` once the new commands are in place.
