use serde::{Deserialize, Serialize};
use std::str::FromStr;
use std::fmt;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus {
    Todo,
    Planned,
    InProgress,
    Completed,
    Blocked,
    Skipped,
    Deferred,
}

impl fmt::Display for TaskStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            TaskStatus::Todo       => "todo",
            TaskStatus::Planned    => "planned",
            TaskStatus::InProgress => "inprogress",
            TaskStatus::Completed  => "completed",
            TaskStatus::Blocked    => "blocked",
            TaskStatus::Skipped    => "skipped",
            TaskStatus::Deferred   => "deferred",
        };
        write!(f, "{}", s)
    }
}

impl FromStr for TaskStatus {
    type Err = ();
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(match s {
            "planned"    => TaskStatus::Planned,
            "inprogress" => TaskStatus::InProgress,
            "completed"  => TaskStatus::Completed,
            "blocked"    => TaskStatus::Blocked,
            "skipped"    => TaskStatus::Skipped,
            "deferred"   => TaskStatus::Deferred,
            _            => TaskStatus::Todo,
        })
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Task {
    pub id: String,
    pub goal_id: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub status: TaskStatus,
    pub effort_minutes: i32,
    pub priority: i32,
    pub created_at: String,
    pub deadline: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn status_roundtrip() {
        for (s, v) in &[
            ("todo",       TaskStatus::Todo),
            ("planned",    TaskStatus::Planned),
            ("inprogress", TaskStatus::InProgress),
            ("completed",  TaskStatus::Completed),
            ("blocked",    TaskStatus::Blocked),
            ("skipped",    TaskStatus::Skipped),
            ("deferred",   TaskStatus::Deferred),
        ] {
            assert_eq!(&v.to_string(), s);
            assert_eq!(&TaskStatus::from_str(s).unwrap(), v);
        }
    }
}
