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

    // Idempotent column additions — SQLite errors if column already exists; we ignore those.
    let _ = conn.execute(
        "ALTER TABLE events ADD COLUMN user_id TEXT REFERENCES users(id)",
        [],
    );
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

    Ok(())
}
