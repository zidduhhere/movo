use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
pub enum ChatRole {
    User,
    Assistant,
}

impl ToString for ChatRole {
    fn to_string(&self) -> String {
        match self {
            ChatRole::User => "user".to_string(),
            ChatRole::Assistant => "assistant".to_string(),
        }
    }
}

impl std::str::FromStr for ChatRole {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "user" => Ok(ChatRole::User),
            "assistant" => Ok(ChatRole::Assistant),
            _ => Err(format!("Invalid role: {}", s)),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub id: String,
    pub goal_id: String,
    pub role: ChatRole,
    pub content: String,
    pub created_at: String,
}
