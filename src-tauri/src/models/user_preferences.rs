use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UserPreferences {
    pub user_id: String,
    pub work_start: String,
    pub work_end: String,
    pub focus_block_mins: i32,
    pub days_off: String,
    pub buffer_minutes: i32,
    pub focus_start: Option<String>,
    pub focus_end: Option<String>,
}

impl Default for UserPreferences {
    fn default() -> Self {
        Self {
            user_id: String::new(),
            work_start: "09:00".to_string(),
            work_end: "18:00".to_string(),
            focus_block_mins: 60,
            days_off: "Saturday,Sunday".to_string(),
            buffer_minutes: 10,
            focus_start: None,
            focus_end: None,
        }
    }
}
