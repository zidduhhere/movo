use crate::models::{Task, TaskStatus};
use chrono::Utc;

fn urgency_score(deadline: &Option<String>) -> f64 {
    let now = Utc::now().date_naive();
    let Some(dl_str) = deadline else { return 0.4 };
    let deadline_date =
        if let Ok(d) = chrono::NaiveDate::parse_from_str(dl_str, "%Y-%m-%d") { d }
        else if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(dl_str) { dt.date_naive() }
        else { return 0.4 };
    let days = (deadline_date - now).num_days();
    match days {
        d if d < 0 => 1.0,
        0           => 0.97,
        1           => 0.90,
        2..=3       => 0.75,
        4..=7       => 0.55,
        8..=14      => 0.35,
        _           => 0.20,
    }
}

pub fn score_task(task: &Task) -> f64 {
    let urgency        = urgency_score(&task.deadline);
    let priority_score = (6.0 - task.priority as f64) / 5.0;
    let effort_penalty = (task.effort_minutes as f64 / 240.0).min(0.3);
    urgency * priority_score * (1.0 - effort_penalty)
}

pub fn sort_by_priority(mut tasks: Vec<Task>) -> Vec<Task> {
    tasks.sort_by(|a, b| {
        score_task(b)
            .partial_cmp(&score_task(a))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    tasks
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task(id: &str, priority: i32, deadline_days: Option<i64>) -> Task {
        let deadline = deadline_days.map(|d| {
            (Utc::now().date_naive() + chrono::Duration::days(d))
                .format("%Y-%m-%d").to_string()
        });
        Task {
            id: id.to_string(), goal_id: None, title: id.to_string(),
            description: None, status: TaskStatus::Todo,
            effort_minutes: 60, priority,
            created_at: Utc::now().to_rfc3339(), deadline,
        }
    }

    #[test]
    fn overdue_scores_highest() {
        assert!(score_task(&task("a", 1, Some(-1))) > score_task(&task("b", 1, Some(7))));
    }

    #[test]
    fn higher_priority_number_scores_lower() {
        let p1 = task("a", 1, Some(7));
        let p3 = task("b", 3, Some(7));
        assert!(score_task(&p1) > score_task(&p3));
    }

    #[test]
    fn sort_places_urgent_first() {
        let sorted = sort_by_priority(vec![task("low", 3, Some(14)), task("urgent", 1, Some(1))]);
        assert_eq!(sorted[0].id, "urgent");
    }
}
