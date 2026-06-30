use rusqlite::{Connection, Result};

use tauri::AppHandle;
use tauri::Manager;

pub fn init_db(app_handle: &AppHandle) -> Result<Connection> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .expect("Failed to get app data dir");
    
    if !app_dir.exists() {
        std::fs::create_dir_all(&app_dir).expect("Failed to create app data dir");
    }

    let db_path = app_dir.join("movo.db");
    let conn = Connection::open(db_path)?;

    // Enable foreign keys
    conn.execute("PRAGMA foreign_keys = ON;", [])?;

    // Run migrations
    super::migrations::run_migrations(&conn)?;

    Ok(conn)
}
