# Account Settings Redesign

## Goal

Replace the current minimal `AppSettingsSheet` (name/email display only) with a
full account settings screen: editable profile with avatar upload, work
scheduling preferences (already used server-side but never exposed in UI),
AI/app preferences, and a sign-out/delete-account danger zone.

## Data model

`users` table — add one nullable column:
- `avatar_base64 TEXT` — uploaded image stored as a data URL. No file storage
  or new plugin needed; the existing sqlite row is sufficient.

`user_preferences` table — add columns via idempotent `ALTER TABLE ADD COLUMN`
(same pattern as the existing `buffer_minutes` migration):
- `notify_missed_sessions BOOLEAN NOT NULL DEFAULT 1`
- `notify_deadlines BOOLEAN NOT NULL DEFAULT 1`
- `notify_event_reminders BOOLEAN NOT NULL DEFAULT 1`
- `ai_response_style TEXT NOT NULL DEFAULT 'detailed'` — `'concise' | 'detailed'`
- `ai_custom_instruction TEXT` — nullable, free text appended to the system prompt
- `voice_input_enabled BOOLEAN NOT NULL DEFAULT 1`

No new tables. Existing `ON DELETE CASCADE` FKs (goals → tasks → events/chat_messages,
user_preferences → users) mean deleting a user row cascades cleanly; confirmed
`PRAGMA foreign_keys = ON` is already set in `db/connection.rs`.

## Backend commands (`src-tauri/src/commands`)

**New:**
- `update_user_profile(name: String, avatar_base64: Option<String>) -> Result<User, String>`
  — updates `users.name` / `avatar_base64`, returns the updated `User`.
- `delete_account() -> Result<(), String>` — deletes the `users` row for the
  current session (cascades everywhere), clears `AppState.current_user_id`.

**Extended:**
- `save_user_preferences` gains 6 new optional params (all default to the
  column defaults above so existing call sites don't break):
  `notify_missed_sessions`, `notify_deadlines`, `notify_event_reminders`,
  `ai_response_style`, `ai_custom_instruction`, `voice_input_enabled`.
- `Repository::get_user_preferences` / `save_user_preferences` read/write the
  new columns (`COALESCE(..., <default>)` on read for pre-migration rows).

**Gated behavior:**
- `check_and_send_notifications` (`commands/notifications.rs`) reads
  preferences once at the top and skips each block when its toggle is off:
  - event-reminder block (5-min-before) ↔ `notify_event_reminders`
  - deadline-alert block ↔ `notify_deadlines`
  - daily-summary block stays **always on, ungated** (explicit decision)
- `check_missed_sessions` (`commands/recommendations.rs`) returns an empty
  list early when `notify_missed_sessions` is false.
- `global_chat.rs` / `task_chat.rs` system prompt: append
  `ai_custom_instruction` if set, and adjust tone instructions based on
  `ai_response_style` (`concise` → explicit "keep responses short" line).

## Frontend (`src/components/AppSettingsSheet.tsx`)

Redesign as a tabbed Radix `Dialog` (same visual language: white/blur/rounded,
matching the rest of the app). Tab rail: **Profile · Work · AI & App · Danger Zone**.

- **Profile**: avatar (click → `<input type="file">` + `FileReader` → base64
  data URL, no new Tauri plugin required), editable name field + Save,
  read-only email.
- **Work**: work start/end time pickers, days-off multi-select, focus block
  minutes, buffer minutes. All currently backend-only (`UserPreferences`),
  now exposed for the first time.
- **AI & App**: 3 notification toggles (event reminders / deadlines /
  missed-session recs), response-style radio (concise/detailed), optional
  custom-instruction textarea, voice-input toggle.
- **Danger Zone**: "Sign Out" (wires the existing but never-hooked-up
  `logout()` store action), "Delete Account" behind a type-your-email-to-confirm
  dialog before calling `delete_account`.

Store (`src/store/index.ts`) additions:
- `updateProfile(name: string, avatarBase64?: string): Promise<void>`
- `deleteAccount(): Promise<void>` — calls the command, then resets state and
  triggers the same logout/sign-out UI flow.
- `savePreferences` extended to send/receive the 6 new fields; `User` and
  `UserPreferences` TS interfaces gain the corresponding fields.
- Voice-input toggle gates the mic buttons in `GlobalChat`, `GoalChatView`,
  `TrayPopup`, `EmptyState`. The native tray menu "🎤 Voice Input" item is
  **out of scope** — rebuilding the native menu reactively on a preference
  change is a separate, heavier concern; noted as a deliberate limitation.

## Out of scope (explicit decisions made during design)

- Dark theme / appearance preference — not requested.
- Real-time sync of preferences across multiple open windows — not requested,
  existing app has no such mechanism for anything else either.
- Gating the native tray menu voice-input item — see above.
