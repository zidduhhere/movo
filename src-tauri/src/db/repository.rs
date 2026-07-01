use rusqlite::{Connection, Result, params};
use chrono::Utc;
use crate::models::{Goal, GoalStatus, Task, TaskStatus, User, ChatMessage, ChatRole, Event, EventStatus, UserPreferences, CalendarEvent};
use uuid::Uuid;

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

pub struct Repository<'a> {
    conn: &'a Connection,
}

impl<'a> Repository<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

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

        for user in user_iter {
            return Ok(Some(user?));
        }

        Ok(None)
    }

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

    pub fn create_goal(&self, user_id: &str, title: &str, description: Option<&str>, target_date: Option<&str>) -> Result<Goal> {
        let id = Uuid::new_v4().to_string();
        let status = "active";
        let created_at = chrono::Utc::now().to_rfc3339();

        self.conn.execute(
            "INSERT INTO goals (id, user_id, title, description, status, created_at, target_date)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, user_id, title, description, status, created_at, target_date],
        )?;

        Ok(Goal {
            id,
            user_id: user_id.to_string(),
            title: title.to_string(),
            description: description.map(|s| s.to_string()),
            status: GoalStatus::Active,
            created_at,
            target_date: target_date.map(|s| s.to_string()),
        })
    }

    pub fn delete_goal(&self, id: &str) -> Result<()> {
        // First delete associated tasks to maintain integrity (if no foreign key cascade)
        self.conn.execute("DELETE FROM tasks WHERE goal_id = ?1", params![id])?;
        self.conn.execute("DELETE FROM goals WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn delete_task(&self, id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM tasks WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn add_message(&self, goal_id: &str, role: ChatRole, content: &str) -> Result<ChatMessage> {
        let id = Uuid::new_v4().to_string();
        let created_at = chrono::Utc::now().to_rfc3339();
        
        self.conn.execute(
            "INSERT INTO chat_messages (id, goal_id, role, content, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, goal_id, role.to_string(), content, created_at],
        )?;
        
        Ok(ChatMessage {
            id,
            goal_id: goal_id.to_string(),
            role,
            content: content.to_string(),
            created_at,
        })
    }

    pub fn get_messages_for_goal(&self, goal_id: &str) -> Result<Vec<ChatMessage>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, goal_id, role, content, created_at FROM chat_messages WHERE goal_id = ?1 ORDER BY created_at ASC"
        )?;
        
        let message_iter = stmt.query_map(params![goal_id], |row| {
            let role_str: String = row.get(2)?;
            let role = role_str.parse().unwrap_or(ChatRole::User); // fallback safely
            
            Ok(ChatMessage {
                id: row.get(0)?,
                goal_id: row.get(1)?,
                role,
                content: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?;
        
        let mut messages = Vec::new();
        for msg in message_iter {
            messages.push(msg?);
        }
        
        Ok(messages)
    }

    pub fn get_active_goals(&self, user_id: &str) -> Result<Vec<Goal>> {
        let mut stmt = self.conn.prepare("SELECT id, user_id, title, description, status, created_at, target_date FROM goals WHERE status = 'active' AND user_id = ?1")?;
        let goal_iter = stmt.query_map(params![user_id], |row| {
            let status_str: String = row.get(4)?;
            let status = match status_str.as_str() {
                "active" => GoalStatus::Active,
                "completed" => GoalStatus::Completed,
                "archived" => GoalStatus::Archived,
                _ => GoalStatus::Active,
            };

            Ok(Goal {
                id: row.get(0)?,
                user_id: row.get(1)?,
                title: row.get(2)?,
                description: row.get(3)?,
                status,
                created_at: row.get(5)?,
                target_date: row.get(6)?,
            })
        })?;

        let mut goals = Vec::new();
        for goal in goal_iter {
            goals.push(goal?);
        }

        Ok(goals)
    }

    pub fn get_tasks_by_goal(&self, goal_id: &str) -> Result<Vec<Task>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, goal_id, title, description, status, effort_minutes, priority, created_at, deadline 
             FROM tasks WHERE goal_id = ?1"
        )?;
        let task_iter = stmt.query_map(params![goal_id], |row| {
            let status_str: String = row.get(4)?;
            let status = status_str.parse().unwrap_or(TaskStatus::Todo);

            Ok(Task {
                id: row.get(0)?,
                goal_id: row.get(1)?,
                title: row.get(2)?,
                description: row.get(3)?,
                status,
                effort_minutes: row.get(5)?,
                priority: row.get(6)?,
                created_at: row.get(7)?,
                deadline: row.get(8)?,
            })
        })?;

        let mut tasks = Vec::new();
        for task in task_iter {
            tasks.push(task?);
        }

        Ok(tasks)
    }

    pub fn get_all_tasks(&self, user_id: &str) -> Result<Vec<Task>> {
        let mut stmt = self.conn.prepare(
            "SELECT t.id, t.goal_id, t.title, t.description, t.status, t.effort_minutes, t.priority, t.created_at, t.deadline 
             FROM tasks t
             INNER JOIN goals g ON t.goal_id = g.id
             WHERE g.user_id = ?1
             ORDER BY t.created_at DESC"
        )?;
        let task_iter = stmt.query_map(params![user_id], |row| {
            let status_str: String = row.get(4)?;
            let status = status_str.parse().unwrap_or(TaskStatus::Todo);

            Ok(Task {
                id: row.get(0)?,
                goal_id: row.get(1)?,
                title: row.get(2)?,
                description: row.get(3)?,
                status,
                effort_minutes: row.get(5)?,
                priority: row.get(6)?,
                created_at: row.get(7)?,
                deadline: row.get(8)?,
            })
        })?;

        let mut tasks = Vec::new();
        for task in task_iter {
            tasks.push(task?);
        }

        Ok(tasks)
    }

    pub fn get_active_tasks_with_goals(&self, user_id: &str) -> Result<Vec<(Task, String)>> {
        let mut stmt = self.conn.prepare(
            "SELECT t.id, t.goal_id, t.title, t.description, t.status,
                    t.effort_minutes, t.priority, t.created_at, t.deadline,
                    g.title as goal_title
             FROM tasks t
             INNER JOIN goals g ON t.goal_id = g.id
             WHERE g.user_id = ?1 AND t.status IN ('todo', 'inprogress')
             ORDER BY t.priority ASC, t.deadline ASC
             LIMIT 30"
        )?;
        let iter = stmt.query_map(rusqlite::params![user_id], |row| {
            let status_str: String = row.get(4)?;
            let status = status_str.parse().unwrap_or(TaskStatus::Todo);
            let task = Task {
                id: row.get(0)?,
                goal_id: row.get(1)?,
                title: row.get(2)?,
                description: row.get(3)?,
                status,
                effort_minutes: row.get(5)?,
                priority: row.get(6)?,
                created_at: row.get(7)?,
                deadline: row.get(8)?,
            };
            let goal_title: String = row.get(9)?;
            Ok((task, goal_title))
        })?;
        let mut out = Vec::new();
        for row in iter { out.push(row?); }
        Ok(out)
    }

    pub fn add_task(&self, task: &Task) -> Result<()> {
        let status_str = task.status.to_string();

        self.conn.execute(
            "INSERT INTO tasks (id, goal_id, title, description, status, effort_minutes, priority, created_at, deadline)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                task.id,
                task.goal_id,
                task.title,
                task.description,
                status_str,
                task.effort_minutes,
                task.priority,
                task.created_at,
                task.deadline
            ],
        )?;

        Ok(())
    }

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
                user_id:                row.get(0)?,
                work_start:             row.get(1)?,
                work_end:               row.get(2)?,
                focus_block_mins:       row.get(3)?,
                days_off:               row.get(4)?,
                buffer_minutes:         row.get(5)?,
                focus_start:            row.get(6)?,
                focus_end:              row.get(7)?,
                notify_event_reminders: row.get(8)?,
                notify_deadlines:       row.get(9)?,
                notify_missed_sessions: row.get(10)?,
                ai_response_style:      row.get(11)?,
                ai_custom_instruction:  row.get(12)?,
                voice_input_enabled:    row.get(13)?,
            })
        })?;
        if let Some(row) = rows.next() { Ok(Some(row?)) } else { Ok(None) }
    }

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

    pub fn update_task_status(&self, id: &str, status: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE tasks SET status = ?1 WHERE id = ?2",
            params![status, id],
        )?;
        Ok(())
    }

    pub fn get_todos_for_user(&self, user_id: &str) -> Result<Vec<Task>> {
        let mut stmt = self.conn.prepare(
            "SELECT t.id, t.goal_id, t.title, t.description, t.status,
                    t.effort_minutes, t.priority, t.created_at, t.deadline
             FROM tasks t
             INNER JOIN goals g ON t.goal_id = g.id
             WHERE g.user_id = ?1 AND t.status IN ('todo', 'inprogress')
             ORDER BY t.priority ASC,
                      CASE WHEN t.deadline IS NULL THEN 1 ELSE 0 END,
                      t.deadline ASC"
        )?;
        let task_iter = stmt.query_map(params![user_id], |row| {
            let status_str: String = row.get(4)?;
            let status = status_str.parse().unwrap_or(TaskStatus::Todo);
            Ok(Task {
                id: row.get(0)?,
                goal_id: row.get(1)?,
                title: row.get(2)?,
                description: row.get(3)?,
                status,
                effort_minutes: row.get(5)?,
                priority: row.get(6)?,
                created_at: row.get(7)?,
                deadline: row.get(8)?,
            })
        })?;
        let mut tasks = Vec::new();
        for t in task_iter { tasks.push(t?); }
        Ok(tasks)
    }

    pub fn get_goal_task_counts(&self, user_id: &str) -> Result<Vec<(String, i64, i64)>> {
        let mut stmt = self.conn.prepare(
            "SELECT g.id,
                    SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END),
                    COUNT(t.id)
             FROM goals g
             LEFT JOIN tasks t ON t.goal_id = g.id
             WHERE g.user_id = ?1 AND g.status = 'active'
             GROUP BY g.id"
        )?;
        let rows = stmt.query_map(params![user_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?))
        })?;
        let mut out = Vec::new();
        for row in rows { out.push(row?); }
        Ok(out)
    }

    pub fn get_tasks_with_upcoming_deadlines(&self, user_id: &str) -> Result<Vec<Task>> {
        let mut stmt = self.conn.prepare(
            "SELECT t.id, t.goal_id, t.title, t.description, t.status,
                    t.effort_minutes, t.priority, t.created_at, t.deadline
             FROM tasks t
             INNER JOIN goals g ON t.goal_id = g.id
             WHERE g.user_id = ?1
               AND t.status = 'todo'
               AND t.deadline IS NOT NULL
               AND t.deadline BETWEEN date('now') AND date('now', '+1 day')"
        )?;
        let task_iter = stmt.query_map(params![user_id], |row| {
            let status_str: String = row.get(4)?;
            let status = status_str.parse().unwrap_or(TaskStatus::Todo);
            Ok(Task {
                id: row.get(0)?,
                goal_id: row.get(1)?,
                title: row.get(2)?,
                description: row.get(3)?,
                status,
                effort_minutes: row.get(5)?,
                priority: row.get(6)?,
                created_at: row.get(7)?,
                deadline: row.get(8)?,
            })
        })?;
        let mut tasks = Vec::new();
        for t in task_iter { tasks.push(t?); }
        Ok(tasks)
    }

    pub fn get_missed_sessions(&self, user_id: &str) -> Result<Vec<(Task, String)>> {
        let now = Utc::now().to_rfc3339();
        let mut stmt = self.conn.prepare(
            "SELECT t.id, t.goal_id, t.title, t.description, t.status,
                    t.effort_minutes, t.priority, t.created_at, t.deadline, g.title
             FROM events e
             INNER JOIN tasks t ON e.task_id = t.id
             INNER JOIN goals g ON t.goal_id = g.id
             WHERE g.user_id = ?1 AND e.end_time < ?2 AND t.status = 'todo'
             GROUP BY t.id
             LIMIT 5"
        )?;
        let iter = stmt.query_map(params![user_id, now], |row| {
            let status_str: String = row.get(4)?;
            let status = status_str.parse().unwrap_or(TaskStatus::Todo);
            Ok((Task {
                id: row.get(0)?,
                goal_id: row.get(1)?,
                title: row.get(2)?,
                description: row.get(3)?,
                status,
                effort_minutes: row.get(5)?,
                priority: row.get(6)?,
                created_at: row.get(7)?,
                deadline: row.get(8)?,
            }, row.get::<_, String>(9)?))
        })?;
        let mut out = Vec::new();
        for row in iter { out.push(row?); }
        Ok(out)
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
        // LEFT JOIN includes standalone events (task_id IS NULL, matched via e.user_id)
        // as well as task-linked events (matched via g.user_id).
        let mut stmt = self.conn.prepare(
            "SELECT e.id, e.task_id, e.title, e.start_time, e.end_time, e.status,
                    t.goal_id, g.title
             FROM events e
             LEFT JOIN tasks t ON e.task_id = t.id
             LEFT JOIN goals g ON t.goal_id = g.id
             WHERE (e.user_id = ?1 OR g.user_id = ?1)
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

    pub fn create_standalone_event(
        &self,
        user_id: &str,
        title: &str,
        start_time: &str,
        end_time: &str,
    ) -> Result<CalendarEvent> {
        let id = uuid::Uuid::new_v4().to_string();
        self.conn.execute(
            "INSERT INTO events (id, task_id, title, start_time, end_time, status, user_id)
             VALUES (?1, NULL, ?2, ?3, ?4, 'scheduled', ?5)",
            rusqlite::params![id, title, start_time, end_time, user_id],
        )?;
        Ok(CalendarEvent {
            id,
            task_id: None,
            title: title.to_string(),
            start_time: start_time.to_string(),
            end_time: end_time.to_string(),
            status: "scheduled".to_string(),
            goal_id: None,
            goal_title: None,
        })
    }

    pub fn get_tasks_for_scheduling(&self, goal_id: &str) -> Result<Vec<Task>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, goal_id, title, description, status,
                    effort_minutes, priority, created_at, deadline
             FROM tasks
             WHERE goal_id = ?1 AND status NOT IN ('completed', 'skipped', 'planned')
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

    pub fn get_or_create_global_goal(&self, user_id: &str) -> Result<String> {
        let goal_id = format!("__global_{}", user_id);
        self.conn.execute(
            "INSERT OR IGNORE INTO goals (id, user_id, title, status, created_at)
             VALUES (?1, ?2, '__global_chat__', 'archived', ?3)",
            params![goal_id, user_id, chrono::Utc::now().to_rfc3339()],
        )?;
        Ok(goal_id)
    }

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

    pub fn reschedule_task_event(
        &self,
        user_id: &str,
        task_id: &str,
        title: &str,
        new_start: &str,
        new_end: &str,
    ) -> Result<CalendarEvent> {
        let tx = self.conn.unchecked_transaction()?;
        self.conn.execute("DELETE FROM events WHERE task_id = ?1", params![task_id])?;
        let id = uuid::Uuid::new_v4().to_string();
        self.conn.execute(
            "INSERT INTO events (id, task_id, title, start_time, end_time, status, user_id)
             VALUES (?1, ?2, ?3, ?4, ?5, 'scheduled', ?6)",
            params![id, task_id, title, new_start, new_end, user_id],
        )?;
        tx.commit()?;
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
        let tx = self.conn.unchecked_transaction()?;
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
        tx.commit()?;
        Ok(created)
    }
}

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
            ..UserPreferences::default()
        };
        repo.save_user_preferences(&prefs).unwrap();
        let loaded = repo.get_user_preferences("u1").unwrap().unwrap();
        assert_eq!(loaded.buffer_minutes, 15);
        assert_eq!(loaded.focus_start, Some("09:00".to_string()));
        assert_eq!(loaded.focus_end, Some("11:00".to_string()));
    }

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

        conn.execute("PRAGMA foreign_keys = ON", []).unwrap();
        conn.execute(
            "INSERT INTO goals (id,user_id,title,status,created_at) VALUES ('g1','u1','Goal','active','2026-01-01')",
            [],
        ).unwrap();

        repo.delete_user("u1").unwrap();

        let gone = repo.get_user_by_email("a@b.com").unwrap();
        assert!(gone.is_none());

        let goal_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM goals WHERE id = 'g1'", [], |r| r.get(0)
        ).unwrap();
        assert_eq!(goal_count, 0);
    }

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
        conn.execute(
            "INSERT INTO tasks (id,goal_id,title,status,effort_minutes,priority,created_at) VALUES ('t3','g1','Task3','planned',60,1,'2026-01-01')",
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
}
