use chrono::{NaiveDate, NaiveDateTime, NaiveTime, Duration};

#[derive(Debug, Clone, PartialEq)]
pub struct FreeSlot {
    pub start: NaiveDateTime,
    pub end:   NaiveDateTime,
}

pub fn day_free_slots(
    date:        NaiveDate,
    work_start:  NaiveTime,
    work_end:    NaiveTime,
    focus_start: Option<NaiveTime>,
    focus_end:   Option<NaiveTime>,
    occupied:    &[(NaiveDateTime, NaiveDateTime)],
    buffer_mins: i32,
) -> Vec<FreeSlot> {
    let day_start = date.and_time(work_start);
    let day_end   = date.and_time(work_end);

    // Clip and buffer occupied blocks to the work window
    let mut blocks: Vec<(NaiveDateTime, NaiveDateTime)> = occupied
        .iter()
        .filter(|(s, e)| *e > day_start && *s < day_end)
        .map(|(s, e)| {
            let s2 = (*s).max(day_start);
            let e2 = (*e + Duration::minutes(buffer_mins as i64)).min(day_end);
            (s2, e2)
        })
        .collect();
    blocks.sort_by_key(|(s, _)| *s);

    // Compute gaps
    let mut slots = Vec::new();
    let mut cursor = day_start;
    for (bs, be) in &blocks {
        if cursor < *bs { slots.push(FreeSlot { start: cursor, end: *bs }); }
        if *be > cursor  { cursor = *be; }
    }
    if cursor < day_end { slots.push(FreeSlot { start: cursor, end: day_end }); }

    // Focus window: put matching slots first
    if let (Some(fs), Some(fe)) = (focus_start, focus_end) {
        let fs_dt = date.and_time(fs);
        let fe_dt = date.and_time(fe);
        let (focus, other): (Vec<_>, Vec<_>) = slots
            .into_iter()
            .partition(|s| s.start >= fs_dt && s.end <= fe_dt);
        let mut result = focus;
        result.extend(other);
        return result;
    }

    slots
}

pub fn find_slot(slots: &[FreeSlot], duration_mins: i32) -> Option<(NaiveDateTime, NaiveDateTime)> {
    let dur = Duration::minutes(duration_mins as i64);
    slots.iter().find_map(|s| {
        if s.end - s.start >= dur { Some((s.start, s.start + dur)) } else { None }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date() -> NaiveDate { NaiveDate::from_ymd_opt(2026, 7, 7).unwrap() }
    fn t(h: u32, m: u32) -> NaiveTime { NaiveTime::from_hms_opt(h, m, 0).unwrap() }
    fn dt(h: u32, m: u32) -> NaiveDateTime { date().and_time(t(h, m)) }

    #[test]
    fn empty_day_is_one_big_slot() {
        let slots = day_free_slots(date(), t(9,0), t(18,0), None, None, &[], 0);
        assert_eq!(slots.len(), 1);
        assert_eq!(slots[0].start, dt(9,0));
        assert_eq!(slots[0].end,   dt(18,0));
    }

    #[test]
    fn occupied_block_splits_day() {
        let occ = vec![(dt(10,0), dt(11,0))];
        let slots = day_free_slots(date(), t(9,0), t(18,0), None, None, &occ, 0);
        assert_eq!(slots.len(), 2);
        assert_eq!(slots[0].end,   dt(10,0));
        assert_eq!(slots[1].start, dt(11,0));
    }

    #[test]
    fn buffer_shrinks_next_available() {
        let occ = vec![(dt(10,0), dt(11,0))];
        let slots = day_free_slots(date(), t(9,0), t(18,0), None, None, &occ, 10);
        assert_eq!(slots[1].start, dt(11,10));
    }

    #[test]
    fn find_slot_none_when_too_short() {
        let slots = vec![FreeSlot { start: dt(9,0), end: dt(9,30) }];
        assert!(find_slot(&slots, 60).is_none());
    }

    #[test]
    fn find_slot_returns_first_fitting() {
        let slots = vec![
            FreeSlot { start: dt(9,0),  end: dt(9,30) },
            FreeSlot { start: dt(10,0), end: dt(12,0) },
        ];
        let (s, e) = find_slot(&slots, 60).unwrap();
        assert_eq!(s, dt(10,0));
        assert_eq!(e, dt(11,0));
    }
}
