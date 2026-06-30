# Movo — Voice Capture, AI Planning, Calendar View Design

**Date:** 2026-06-28
**Status:** Approved

---

## Overview

Extend Movo with three interconnected features: a macOS menu bar voice capture popup (Spotlight-style), an enhanced AI planning pipeline with user persona awareness, and an in-app calendar view. AI provider stays OpenAI. Voice uses macOS native Speech Recognition via WebKit's `SpeechRecognition` API.

---

## Architecture

```
macOS Menu Bar Icon (Tauri SystemTray)
        │ click
        ▼
Voice Popup Window (secondary Tauri window, 400×100px, frameless)
  - SpeechRecognition API (Apple's engine via WebKit)
  - Live transcription + waveform animation
  - "Plan it →" confirm / Escape to dismiss
        │ confirm
        ▼
Tauri command: voice_capture_plan(text)
  - Creates Goal in SQLite
  - Loads user_preferences + existing deadlines + occupied slots
  - Calls OpenAI with structured tool calls
  - Writes Tasks + Events to SQLite
  - Opens/focuses main window, sets active goal
        │
        ▼
Main App Window
  - New goal selected, tasks listed, ProjectChat open
  - Calendar View tab (week/month grid of Events)
  - Enhanced ProjectChat uses persona + deadline context
```

---

## 1. Menu Bar + Voice Popup

- Tauri `SystemTray` registered at app startup with Movo icon
- Click opens secondary window (`voice_popup`) declared in `tauri.conf.json` with `visible: false`
- Window: 400×100px, frameless, `always_on_top: true`, liquid glass effect
- UI: mic icon + live transcription text + waveform bars + "Plan it →" button
- Listening starts automatically on window open
- Mic permission flow:
  - First use: macOS native dialog via WebKit (`NSMicrophoneUsageDescription` in Info.plist)
  - Previously denied: Tauri Rust command fires `NSAlert` with "Open Settings" button → opens `x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone`
- Keyboard: Enter submits, Escape closes
- Click outside closes popup

---

## 2. AI Planning Pipeline

### Entry points
- Voice popup → `voice_capture_plan(text)` command
- In-app chat → `chat_with_ai` command (enhanced)

### Context loaded per request
- `user_preferences`: work hours, focus block length, days off
- Existing tasks with deadlines for the active goal
- Existing events (occupied time slots)

### OpenAI tool calls (replacing `<tool>` regex)
Three tools defined in the request `tools` array:
- `create_goal(title, description, target_date)`
- `create_task(title, description, effort_minutes, priority, deadline)`
- `schedule_event(task_id, start_time, end_time)`

Response parsed from `tool_calls` array — no regex, no fragile string parsing.

### Dynamic replanning
`replan_goal(goal_id)` command: detects overdue tasks, re-runs planning pipeline with prompt instructing AI to reschedule remaining tasks to still meet the deadline.

---

## 3. User Persona Onboarding

Shown once after first login. Three steps:

1. **Work Hours** — start/end time pickers (default 9:00–18:00)
2. **Focus Block** — chip selector: 30 / 60 / 90 / 120 min (default 60)
3. **Days Off** — day toggle chips, Sat+Sun pre-selected

"Skip for now" applies defaults. Editable later via AppSettingsSheet.

### New DB table
```sql
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY,
  work_start TEXT NOT NULL DEFAULT '09:00',
  work_end TEXT NOT NULL DEFAULT '18:00',
  focus_block_mins INTEGER NOT NULL DEFAULT 60,
  days_off TEXT NOT NULL DEFAULT 'Saturday,Sunday',
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

Commands: `get_user_preferences(user_id)`, `save_user_preferences(user_id, prefs)`

---

## 4. In-App Calendar View

New `calendar` view added to Sidebar and `activeView` state.

### Week view (default)
- 7-column grid, rows = hours (work hours only, e.g. 9am–6pm)
- Events from `events` SQLite table rendered as colored blocks
- Color-coded by goal
- Click event → task detail panel
- Prev/next week navigation

### Month view (toggle)
- Compact grid, dot indicators per day showing event count
- Click day → expands to show events for that day

### Calendar Provider trait (Rust)
```rust
trait CalendarProvider: Send + Sync {
    async fn fetch_events(&self, from: DateTime<Utc>, to: DateTime<Utc>) -> Result<Vec<Event>, String>;
    async fn push_event(&self, event: &Event) -> Result<String, String>;
}

struct LocalCalendarProvider; // implemented — reads/writes SQLite
struct AppleCalendarProvider; // stubbed — returns Err("not yet implemented")
struct GoogleCalendarProvider; // stubbed — returns Err("not yet implemented")
```

---

## Technology Decisions

| Concern | Decision |
|---|---|
| AI provider | OpenAI (existing `openai.rs`, no change to auth) |
| Voice capture | Web `SpeechRecognition` API (Apple engine via WebKit) |
| Menu bar | Tauri `SystemTray` |
| Voice popup | Secondary Tauri window, React |
| Mic permission denied | `objc2` crate, `NSAlert` + open System Settings URL |
| Tool calling | OpenAI `tools` array + `tool_calls` response parsing |
| Calendar external sync | `CalendarProvider` trait, stubbed for Phase 2 |

---

## Out of Scope (Phase 2)

- Apple Calendar EventKit integration
- Google Calendar OAuth + sync
- Wake word activation
- Whisper offline transcription
