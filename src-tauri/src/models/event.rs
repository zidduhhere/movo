use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Event {
    pub id: String,
    pub task_id: Option<String>,
    pub title: String,
    pub start_time: String,
    pub end_time: String,
    pub status: EventStatus,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum EventStatus {
    Scheduled,
    Completed,
    Skipped,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CalendarEvent {
    pub id: String,
    pub task_id: Option<String>,
    pub title: String,
    pub start_time: String,
    pub end_time: String,
    pub status: String,
    pub goal_id: Option<String>,
    pub goal_title: Option<String>,
}
