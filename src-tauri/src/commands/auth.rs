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

#[tauri::command]
pub fn update_user_profile(
    name: String,
    avatar_base64: Option<String>,
    conn: State<'_, Mutex<Connection>>,
    app_state: State<'_, AppState>,
) -> Result<User, String> {
    let user_id = app_state.current_user_id.lock().map_err(|e| e.to_string())?
        .clone().ok_or("Not logged in")?;
    let conn = conn.lock().map_err(|e| e.to_string())?;
    let repo = Repository::new(&conn);
    repo.update_user_profile(&user_id, &name, avatar_base64.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_account(
    conn: State<'_, Mutex<Connection>>,
    app_state: State<'_, AppState>,
) -> Result<(), String> {
    let user_id = app_state.current_user_id.lock().map_err(|e| e.to_string())?
        .clone().ok_or("Not logged in")?;
    {
        let conn = conn.lock().map_err(|e| e.to_string())?;
        let repo = Repository::new(&conn);
        repo.delete_user(&user_id).map_err(|e| e.to_string())?;
    }
    *app_state.current_user_id.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

#[tauri::command]
pub fn logout_session(app_state: State<'_, AppState>) -> Result<(), String> {
    *app_state.current_user_id.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}
