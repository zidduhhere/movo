use tauri::State;
use std::sync::Mutex;
use rusqlite::Connection;
use bcrypt::{hash, verify, DEFAULT_COST};

use crate::db::repository::Repository;
use crate::models::User;
use crate::AppState;

#[tauri::command]
pub fn register_user(
    email: &str,
    name: &str,
    password: &str,
    conn: State<'_, Mutex<Connection>>,
    app_state: State<'_, AppState>,
) -> Result<User, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    let repo = Repository::new(&conn);

    let password_hash = hash(password, DEFAULT_COST)
        .map_err(|e| format!("Failed to hash password: {}", e))?;

    let user = repo.create_user(email, name, &password_hash)
        .map_err(|e| format!("Failed to register user: {}", e))?;

    *app_state.current_user_id.lock().map_err(|e| e.to_string())? = Some(user.id.clone());
    Ok(user)
}

#[tauri::command]
pub fn login_user(
    email: &str,
    password: &str,
    conn: State<'_, Mutex<Connection>>,
    app_state: State<'_, AppState>,
) -> Result<User, String> {
    let conn = conn.lock().map_err(|e| e.to_string())?;
    let repo = Repository::new(&conn);

    let user = repo.get_user_by_email(email)
        .map_err(|e| format!("Database error: {}", e))?;

    match user {
        Some(user) => {
            let valid = verify(password, &user.password_hash)
                .map_err(|e| format!("Auth error: {}", e))?;
            if valid {
                *app_state.current_user_id.lock().map_err(|e| e.to_string())? =
                    Some(user.id.clone());
                Ok(user)
            } else {
                Err("Invalid email or password".to_string())
            }
        }
        None => Err("Invalid email or password".to_string()),
    }
}
