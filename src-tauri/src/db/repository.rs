use rusqlite::{Connection, Result, params};
use chrono::Utc;
use crate::models::{Goal, GoalStatus, Task, TaskStatus, User, ChatMessage, ChatRole, Event, EventStatus, UserPreferences, CalendarEvent};
use uuid::Uuid;

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
        })
    }

    pub fn get_user_by_email(&self, email: &str) -> Result<Option<User>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, email, name, password_hash, created_at FROM users WHERE email = ?1"
        )?;
        
        let user_iter = stmt.query_map(params![email], |row| {
            Ok(User {
                id: row.get(0)?,
                email: row.get(1)?,
                name: row.get(2)?,
                password_hash: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?;

        for user in user_iter {
            return Ok(Some(user?));
        }

        Ok(None)
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
        };
        repo.save_user_preferences(&prefs).unwrap();
        let loaded = repo.get_user_preferences("u1").unwrap().unwrap();
        assert_eq!(loaded.buffer_minutes, 15);
        assert_eq!(loaded.focus_start, Some("09:00".to_string()));
        assert_eq!(loaded.focus_end, Some("11:00".to_string()));
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
}
