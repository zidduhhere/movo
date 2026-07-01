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
    pub notify_event_reminders: bool,
    pub notify_deadlines: bool,
    pub notify_missed_sessions: bool,
    pub ai_response_style: String,
    pub ai_custom_instruction: Option<String>,
    pub voice_input_enabled: bool,
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
            notify_event_reminders: true,
            notify_deadlines: true,
            notify_missed_sessions: true,
            ai_response_style: "detailed".to_string(),
            ai_custom_instruction: None,
            voice_input_enabled: true,
        }
    }
}
