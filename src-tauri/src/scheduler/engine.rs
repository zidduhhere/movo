use chrono::{NaiveDate, NaiveTime, NaiveDateTime, Duration, Utc, TimeZone};
use rusqlite::Connection;
use serde::{Serialize, Deserialize};
use crate::db::repository::Repository;
use crate::scheduler::priority::sort_by_priority;
use crate::scheduler::conflict::{day_free_slots, find_slot};

#[derive(Debug, Serialize, Deserialize)]
pub struct ScheduleResult {
    pub scheduled_count:    usize,
    pub infeasible:         bool,
    pub suggested_deadline: Option<String>,
}

pub fn schedule_goal(goal_id: &str, conn: &Connection) -> Result<ScheduleResult, String> {
    // 1. Load goal metadata
    let (user_id, target_date_str): (String, Option<String>) = conn
        .query_row(
            "SELECT user_id, target_date FROM goals WHERE id = ?1",
            rusqlite::params![goal_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    let repo = Repository::new(conn);

    // 2. Load preferences
    let prefs = repo.get_user_preferences(&user_id)
        .map_err(|e| e.to_string())?
        .unwrap_or_default();

    // 3. Load and sort tasks by priority score
    let raw_tasks = repo.get_tasks_for_scheduling(goal_id)
        .map_err(|e| e.to_string())?;
    if raw_tasks.is_empty() {
        return Ok(ScheduleResult { scheduled_count: 0, infeasible: false, suggested_deadline: None });
    }
    let mut tasks = sort_by_priority(raw_tasks).into_iter();

    // 4. Parse scheduling params
    let work_start = NaiveTime::parse_from_str(&prefs.work_start, "%H:%M")
        .unwrap_or_else(|_| NaiveTime::from_hms_opt(9, 0, 0).unwrap());
    let work_end = NaiveTime::parse_from_str(&prefs.work_end, "%H:%M")
        .unwrap_or_else(|_| NaiveTime::from_hms_opt(18, 0, 0).unwrap());
    let focus_start = prefs.focus_start.as_deref()
        .and_then(|s| NaiveTime::parse_from_str(s, "%H:%M").ok());
    let focus_end = prefs.focus_end.as_deref()
        .and_then(|s| NaiveTime::parse_from_str(s, "%H:%M").ok());
    let days_off: Vec<String> = prefs.days_off.split(',')
        .map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();

    let today = Utc::now().date_naive();
    let deadline = target_date_str.as_deref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        .unwrap_or_else(|| today + Duration::days(14));
    let horizon = deadline + Duration::days(60);

    // 5. Greedy slot loop
    let mut scheduled_count = 0;
    let mut current_task = tasks.next();
    let mut current_date = today;
    let mut day_extra: Vec<(NaiveDateTime, NaiveDateTime)> = Vec::new();
    let mut latest_scheduled_date: Option<NaiveDate> = None;

    while let Some(ref task) = current_task {
        if current_date > horizon { break; }

        // Skip days off
        let weekday = current_date.format("%A").to_string();
        if days_off.contains(&weekday) {
            current_date += Duration::days(1);
            day_extra.clear();
            continue;
        }

        // Load events for this calendar day from DB
        let day_start_utc = Utc.from_utc_datetime(&current_date.and_time(NaiveTime::from_hms_opt(0,0,0).unwrap()));
        let day_end_utc   = Utc.from_utc_datetime(&current_date.and_time(NaiveTime::from_hms_opt(23,59,59).unwrap()));
        let db_events = repo.get_events_in_range(
            &user_id,
            &day_start_utc.to_rfc3339(),
            &day_end_utc.to_rfc3339(),
        ).map_err(|e| e.to_string())?;

        // Parse to NaiveDateTime occupied blocks
        let mut occupied: Vec<(NaiveDateTime, NaiveDateTime)> = db_events.iter()
            .filter_map(|e| {
                let s = chrono::DateTime::parse_from_rfc3339(&e.start_time).ok()?;
                let en = chrono::DateTime::parse_from_rfc3339(&e.end_time).ok()?;
                Some((s.naive_utc(), en.naive_utc()))
            })
            .collect();
        occupied.extend(day_extra.iter().cloned());

        let free_slots = day_free_slots(
            current_date, work_start, work_end, focus_start, focus_end,
            &occupied, prefs.buffer_minutes,
        );

        if let Some((slot_start, slot_end)) = find_slot(&free_slots, task.effort_minutes) {
            // Track intra-day bookings so subsequent tasks on same day avoid this slot
            day_extra.push((slot_start, slot_end));

            let start_rfc = Utc.from_utc_datetime(&slot_start).to_rfc3339();
            let end_rfc   = Utc.from_utc_datetime(&slot_end).to_rfc3339();

            repo.create_scheduled_event_for_task(
                &user_id, &task.id, &task.title, &start_rfc, &end_rfc,
            ).map_err(|e| e.to_string())?;

            repo.update_task_status(&task.id, "planned")
                .map_err(|e| e.to_string())?;

            latest_scheduled_date = Some(
                match latest_scheduled_date {
                    Some(prev) if slot_end.date() > prev => slot_end.date(),
                    Some(prev) => prev,
                    None => slot_end.date(),
                }
            );
            scheduled_count += 1;
            current_task = tasks.next();
            // Do NOT advance date — try to fit next task on the same day
        } else {
            // No slot today; move to next day
            current_date += Duration::days(1);
            day_extra.clear();
        }
    }

    let infeasible = current_task.is_some()
        || latest_scheduled_date.map(|d| d > deadline).unwrap_or(false);

    let suggested_deadline = if infeasible {
        latest_scheduled_date.map(|d| d.format("%Y-%m-%d").to_string())
    } else {
        None
    };

    Ok(ScheduleResult { scheduled_count, infeasible, suggested_deadline })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::run_migrations;
    use chrono::Utc;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        conn
    }

    #[test]
    fn schedules_tasks_within_deadline() {
        let conn = setup();
        // Seed user, goal (deadline in 7 days), 2 tasks of 60 min each
        conn.execute(
            "INSERT INTO users (id,email,name,password_hash,created_at) VALUES ('u1','a@b.com','A','x','2026-01-01')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO user_preferences (user_id,work_start,work_end,focus_block_mins,days_off)
             VALUES ('u1','09:00','18:00',60,'')",
            [],
        ).unwrap();
        let deadline = (Utc::now().date_naive() + chrono::Duration::days(7))
            .format("%Y-%m-%d").to_string();
        conn.execute(
            &format!("INSERT INTO goals (id,user_id,title,status,created_at,target_date) VALUES ('g1','u1','Goal','active','2026-01-01','{}')", deadline),
            [],
        ).unwrap();
        for (i, title) in ["Task A", "Task B"].iter().enumerate() {
            conn.execute(
                &format!("INSERT INTO tasks (id,goal_id,title,status,effort_minutes,priority,created_at) VALUES ('t{}','g1','{}','todo',60,1,'2026-01-0{}')", i+1, title, i+1),
                [],
            ).unwrap();
        }

        let result = schedule_goal("g1", &conn).unwrap();
        assert_eq!(result.scheduled_count, 2);
        assert!(!result.infeasible);

        // Events should be created
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM events WHERE task_id IN ('t1','t2')", [], |r| r.get(0)
        ).unwrap();
        assert_eq!(count, 2);

        // Task statuses should be 'planned'
        let statuses: Vec<String> = {
            let mut stmt = conn.prepare("SELECT status FROM tasks WHERE goal_id='g1' ORDER BY created_at").unwrap();
            stmt.query_map([], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect()
        };
        assert!(statuses.iter().all(|s| s == "planned"));
    }
}
