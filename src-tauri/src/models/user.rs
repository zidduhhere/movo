use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct User {
    pub id: String,
    pub email: String,
    pub name: String,
    // We intentionally do not serialize the password_hash when sending to frontend
    #[serde(skip_serializing)]
    pub password_hash: String,
    pub created_at: String,
    pub avatar_base64: Option<String>,
}
