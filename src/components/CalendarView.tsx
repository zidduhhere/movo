import { useEffect, useState, useRef } from 'react';
import {
    startOfWeek, endOfWeek, eachDayOfInterval, format,
    addWeeks, subWeeks, parseISO, getHours, getMinutes,
    isSameDay, startOfMonth, endOfMonth, eachWeekOfInterval,
} from 'date-fns';
import { ChevronLeft, ChevronRight, X, AlertTriangle } from 'lucide-react';
import { useStore, CalendarEvent } from '../store';
import clsx from 'clsx';

const GOAL_COLORS = [
    'bg-[#4D5AE8]/80 border-[#4D5AE8]',
    'bg-blue-400/80 border-blue-500',
    'bg-purple-400/80 border-purple-500',
    'bg-orange-400/80 border-orange-500',
    'bg-pink-400/80 border-pink-500',
];

const WORK_START_HOUR = 8;
const WORK_END_HOUR = 20;
const HOURS = Array.from({ length: WORK_END_HOUR - WORK_START_HOUR }, (_, i) => WORK_START_HOUR + i);

type PendingEvent = {
    date: Date;
    startHour: number;
    startMinute: number;
    anchorX: number;
    anchorY: number;
};

export function CalendarView() {
    const { events, fetchEvents, createEvent, conflictEventIds } = useStore();
    const [currentDate, setCurrentDate] = useState(new Date());
    const [viewMode, setViewMode] = useState<'week' | 'month'>('week');
    const [pendingEvent, setPendingEvent] = useState<PendingEvent | null>(null);

    const goalColorMap = new Map<string, string>();
    let colorIndex = 0;
    for (const ev of events) {
        if (ev.goal_id && !goalColorMap.has(ev.goal_id)) {
            goalColorMap.set(ev.goal_id, GOAL_COLORS[colorIndex % GOAL_COLORS.length]);
            colorIndex++;
        }
    }

    useEffect(() => {
        const from = viewMode === 'week'
            ? startOfWeek(currentDate, { weekStartsOn: 1 })
            : startOfMonth(currentDate);
        const to = viewMode === 'week'
            ? endOfWeek(currentDate, { weekStartsOn: 1 })
            : endOfMonth(currentDate);
        fetchEvents(from.toISOString(), to.toISOString());
    }, [currentDate, viewMode, fetchEvents]);

    function prev() {
        setCurrentDate((d) => viewMode === 'week' ? subWeeks(d, 1) : new Date(d.getFullYear(), d.getMonth() - 1, 1));
    }
    function next() {
        setCurrentDate((d) => viewMode === 'week' ? addWeeks(d, 1) : new Date(d.getFullYear(), d.getMonth() + 1, 1));
    }

    const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
    const weekDays = eachDayOfInterval({ start: weekStart, end: endOfWeek(currentDate, { weekStartsOn: 1 }) });

    const handleSlotClick = (date: Date, startHour: number, startMinute: number, clientX: number, clientY: number) => {
        setPendingEvent({ date, startHour, startMinute, anchorX: clientX, anchorY: clientY });
    };

    const handleSaveEvent = async (title: string, startTime: string, endTime: string) => {
        try {
            await createEvent(title, startTime, endTime);
            setPendingEvent(null);
        } catch (err) {
            console.error('Failed to create event:', err);
        }
    };

    return (
        <div className="flex flex-col h-full relative">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-[28px] font-semibold tracking-tight text-[#1C1C1E]">Calendar</h1>
                <div className="flex items-center gap-3">
                    <div className="flex rounded-xl overflow-hidden border border-black/10">
                        <button
                            onClick={() => setViewMode('week')}
                            className={clsx('px-4 py-1.5 text-[13px] font-medium transition-colors',
                                viewMode === 'week' ? 'bg-[#4D5AE8] text-white' : 'bg-white text-black/60 hover:bg-black/5')}
                        >Week</button>
                        <button
                            onClick={() => setViewMode('month')}
                            className={clsx('px-4 py-1.5 text-[13px] font-medium transition-colors',
                                viewMode === 'month' ? 'bg-[#4D5AE8] text-white' : 'bg-white text-black/60 hover:bg-black/5')}
                        >Month</button>
                    </div>
                    <div className="flex items-center gap-1">
                        <button onClick={prev} className="p-2 rounded-lg hover:bg-black/5 text-black/60 transition-colors">
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <span className="text-[14px] font-medium text-[#1C1C1E] min-w-[140px] text-center">
                            {viewMode === 'week'
                                ? `${format(weekStart, 'MMM d')} – ${format(endOfWeek(currentDate, { weekStartsOn: 1 }), 'MMM d, yyyy')}`
                                : format(currentDate, 'MMMM yyyy')}
                        </span>
                        <button onClick={next} className="p-2 rounded-lg hover:bg-black/5 text-black/60 transition-colors">
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>

            {viewMode === 'week' ? (
                <WeekView days={weekDays} events={events} goalColorMap={goalColorMap} conflictEventIds={conflictEventIds} onSlotClick={handleSlotClick} />
            ) : (
                <MonthView currentDate={currentDate} events={events} goalColorMap={goalColorMap} conflictEventIds={conflictEventIds} onDayClick={handleSlotClick} />
            )}

            {/* Apple Calendar-style event creation popover */}
            {pendingEvent && (
                <>
                    <div className="fixed inset-0 z-[998]" onClick={() => setPendingEvent(null)} />
                    <EventCreatePopover
                        pending={pendingEvent}
                        onClose={() => setPendingEvent(null)}
                        onSave={handleSaveEvent}
                    />
                </>
            )}
        </div>
    );
}

// ─── Event Create Popover ────────────────────────────────────────────────────

function EventCreatePopover({
    pending,
    onClose,
    onSave,
}: {
    pending: PendingEvent;
    onClose: () => void;
    onSave: (title: string, startTime: string, endTime: string) => void;
}) {
    const [title, setTitle] = useState('');
    const [startH, setStartH] = useState(pending.startHour);
    const [startM, setStartM] = useState(pending.startMinute);
    const [endH, setEndH] = useState(Math.min(pending.startHour + 1, WORK_END_HOUR));
    const [endM, setEndM] = useState(pending.startMinute);
    const inputRef = useRef<HTMLInputElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);

    useEffect(() => { inputRef.current?.focus(); }, []);

    const pad = (n: number) => n.toString().padStart(2, '0');

    const toTimeValue = (h: number, m: number) => `${pad(h)}:${pad(m)}`;
    const fromTimeValue = (v: string): [number, number] => {
        const [h, m] = v.split(':').map(Number);
        return [h ?? 0, m ?? 0];
    };

    const handleSubmit = () => {
        if (!title.trim()) return;
        const d = new Date(pending.date);
        const start = new Date(d); start.setHours(startH, startM, 0, 0);
        const end = new Date(d); end.setHours(endH, endM, 0, 0);
        onSave(title.trim(), start.toISOString(), end.toISOString());
    };

    // Position near click, clamped to viewport
    const POPOVER_W = 300;
    const POPOVER_H = 220;
    const left = Math.min(pending.anchorX, (typeof window !== 'undefined' ? window.innerWidth : 1200) - POPOVER_W - 16);
    const top = Math.min(pending.anchorY, (typeof window !== 'undefined' ? window.innerHeight : 800) - POPOVER_H - 16);

    return (
        <div
            ref={popoverRef}
            style={{ position: 'fixed', left, top, zIndex: 999, width: POPOVER_W }}
            className="bg-white rounded-2xl shadow-2xl border border-black/10 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
        >
            {/* Header */}
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
                <span className="text-[13px] font-semibold text-[#1C1C1E]">New Event</span>
                <button onClick={onClose} className="p-1 rounded-full hover:bg-black/5 text-black/40 hover:text-black/70 transition-colors">
                    <X className="w-3.5 h-3.5" />
                </button>
            </div>

            {/* Title input */}
            <div className="px-4 pb-3">
                <input
                    ref={inputRef}
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSubmit();
                        if (e.key === 'Escape') onClose();
                    }}
                    placeholder="Event title"
                    className="w-full text-[15px] font-medium text-[#1C1C1E] placeholder-black/30 bg-[#F5F5F7] rounded-xl px-3 py-2 outline-none border border-transparent focus:border-[#4D5AE8] focus:ring-2 focus:ring-[#4D5AE8]/20 transition-all"
                />
            </div>

            {/* Date + Time */}
            <div className="px-4 pb-3">
                <div className="text-[11px] font-medium text-black/40 mb-2 uppercase tracking-wide">
                    {format(pending.date, 'EEEE, MMMM d, yyyy')}
                </div>
                <div className="flex items-center gap-2">
                    <input
                        type="time"
                        value={toTimeValue(startH, startM)}
                        onChange={(e) => { const [h, m] = fromTimeValue(e.target.value); setStartH(h); setStartM(m); }}
                        className="text-[13px] text-[#1C1C1E] bg-[#F5F5F7] rounded-lg px-2 py-1.5 outline-none border border-transparent focus:border-[#4D5AE8] transition-colors"
                    />
                    <span className="text-black/30 text-[13px]">→</span>
                    <input
                        type="time"
                        value={toTimeValue(endH, endM)}
                        onChange={(e) => { const [h, m] = fromTimeValue(e.target.value); setEndH(h); setEndM(m); }}
                        className="text-[13px] text-[#1C1C1E] bg-[#F5F5F7] rounded-lg px-2 py-1.5 outline-none border border-transparent focus:border-[#4D5AE8] transition-colors"
                    />
                </div>
            </div>

            {/* Buttons */}
            <div className="px-4 pb-4 flex items-center gap-2">
                <button
                    onClick={onClose}
                    className="flex-1 py-2 text-[13px] text-black/50 hover:text-black/70 font-medium transition-colors rounded-xl hover:bg-black/5"
                >
                    Cancel
                </button>
                <button
                    onClick={handleSubmit}
                    disabled={!title.trim()}
                    className="flex-1 py-2 bg-[#4D5AE8] hover:bg-[#4048C9] disabled:opacity-40 text-white text-[13px] font-semibold rounded-xl transition-colors"
                >
                    Add Event
                </button>
            </div>
        </div>
    );
}

// ─── Week View ───────────────────────────────────────────────────────────────

function WeekView({
    days, events, goalColorMap, conflictEventIds, onSlotClick,
}: {
    days: Date[];
    events: CalendarEvent[];
    goalColorMap: Map<string, string>;
    conflictEventIds: string[];
    onSlotClick: (date: Date, startHour: number, startMinute: number, clientX: number, clientY: number) => void;
}) {
    const totalMinutes = (WORK_END_HOUR - WORK_START_HOUR) * 60;

    return (
        <div className="flex flex-1 overflow-hidden border border-black/10 rounded-2xl bg-white">
            {/* Time gutter */}
            <div className="w-16 shrink-0 border-r border-black/5 pt-10">
                {HOURS.map((hour) => (
                    <div key={hour} className="h-[60px] flex items-start justify-end pr-3 pt-0.5">
                        <span className="text-[11px] text-black/30 font-medium">
                            {hour < 12 ? `${hour}am` : hour === 12 ? '12pm' : `${hour - 12}pm`}
                        </span>
                    </div>
                ))}
            </div>

            {/* Day columns */}
            <div className="flex flex-1 overflow-x-auto">
                {days.map((day) => {
                    const dayEvents = events.filter((ev) => {
                        try { return isSameDay(parseISO(ev.start_time), day); } catch { return false; }
                    });

                    return (
                        <div key={day.toISOString()} className="flex-1 min-w-[100px] border-r border-black/5 last:border-r-0 relative">
                            {/* Day header */}
                            <div className="h-10 flex flex-col items-center justify-center border-b border-black/5">
                                <span className="text-[11px] text-black/40 uppercase tracking-wide">{format(day, 'EEE')}</span>
                                <span className={clsx('text-[13px] font-semibold',
                                    isSameDay(day, new Date()) ? 'text-[#4D5AE8]' : 'text-[#1C1C1E]')}>
                                    {format(day, 'd')}
                                </span>
                            </div>

                            {/* Clickable time grid */}
                            <div
                                className="relative cursor-crosshair"
                                style={{ height: `${totalMinutes}px` }}
                                onClick={(e) => {
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const y = e.clientY - rect.top;
                                    const minuteOffset = Math.max(0, Math.floor(y));
                                    const rawHour = Math.floor(minuteOffset / 60) + WORK_START_HOUR;
                                    const hour = Math.min(rawHour, WORK_END_HOUR - 1);
                                    // Snap minutes to 15-min grid
                                    const minute = Math.round((minuteOffset % 60) / 15) * 15 % 60;
                                    onSlotClick(day, hour, minute, e.clientX, e.clientY);
                                }}
                            >
                                {HOURS.map((hour) => (
                                    <div key={hour}
                                        className="absolute left-0 right-0 border-t border-black/5 pointer-events-none"
                                        style={{ top: `${(hour - WORK_START_HOUR) * 60}px` }}
                                    />
                                ))}

                                {/* Events */}
                                {dayEvents.map((ev) => {
                                    let startMin = 0, durationMin = 30;
                                    try {
                                        const start = parseISO(ev.start_time);
                                        const end = parseISO(ev.end_time);
                                        startMin = (getHours(start) - WORK_START_HOUR) * 60 + getMinutes(start);
                                        durationMin = Math.max(30,
                                            (getHours(end) - getHours(start)) * 60 + (getMinutes(end) - getMinutes(start)));
                                    } catch {}

                                    const isConflict = conflictEventIds.includes(ev.id);
                                    const colorClass = isConflict
                                        ? 'bg-orange-400/90 border-orange-500'
                                        : ev.goal_id
                                            ? goalColorMap.get(ev.goal_id) ?? GOAL_COLORS[0]
                                            : GOAL_COLORS[0];

                                    return (
                                        <div
                                            key={ev.id}
                                            className={clsx(
                                                'absolute left-1 right-1 rounded-lg border-l-[3px] px-2 py-1 overflow-hidden cursor-default pointer-events-auto',
                                                colorClass,
                                                isConflict && 'ring-2 ring-orange-400 ring-offset-1'
                                            )}
                                            style={{
                                                top: `${Math.max(0, startMin)}px`,
                                                height: `${Math.min(durationMin, totalMinutes - startMin)}px`,
                                            }}
                                            title={isConflict ? `⚠️ CONFLICT: ${ev.title}` : `${ev.title}${ev.goal_title ? '\n' + ev.goal_title : ''}`}
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <div className="flex items-center gap-1">
                                                {isConflict && <AlertTriangle className="w-2.5 h-2.5 text-white shrink-0" />}
                                                <p className="text-[11px] font-semibold text-white leading-tight truncate">{ev.title}</p>
                                            </div>
                                            {ev.goal_title && <p className="text-[10px] text-white/80 truncate">{ev.goal_title}</p>}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ─── Month View ──────────────────────────────────────────────────────────────

function MonthView({
    currentDate, events, goalColorMap, conflictEventIds, onDayClick,
}: {
    currentDate: Date;
    events: CalendarEvent[];
    goalColorMap: Map<string, string>;
    conflictEventIds: string[];
    onDayClick: (date: Date, startHour: number, startMinute: number, clientX: number, clientY: number) => void;
}) {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const weeks = eachWeekOfInterval({ start: monthStart, end: monthEnd }, { weekStartsOn: 1 });

    return (
        <div className="flex flex-col flex-1 border border-black/10 rounded-2xl overflow-hidden bg-white">
            <div className="grid grid-cols-7 border-b border-black/10">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                    <div key={d} className="py-2 text-center text-[11px] font-semibold text-black/40 uppercase tracking-wide">{d}</div>
                ))}
            </div>

            <div className="flex flex-col flex-1">
                {weeks.map((weekStart) => {
                    const days = eachDayOfInterval({ start: weekStart, end: endOfWeek(weekStart, { weekStartsOn: 1 }) });
                    return (
                        <div key={weekStart.toISOString()} className="grid grid-cols-7 flex-1 border-b border-black/5 last:border-b-0">
                            {days.map((day) => {
                                const dayEvents = events.filter((ev) => {
                                    try { return isSameDay(parseISO(ev.start_time), day); } catch { return false; }
                                });
                                const isCurrentMonth = day.getMonth() === currentDate.getMonth();

                                return (
                                    <div
                                        key={day.toISOString()}
                                        onClick={(e) => {
                                            if (!isCurrentMonth) return;
                                            onDayClick(day, 9, 0, e.clientX, e.clientY);
                                        }}
                                        className={clsx(
                                            'p-1.5 border-r border-black/5 last:border-r-0 min-h-[80px] transition-colors',
                                            isCurrentMonth ? 'cursor-pointer hover:bg-[#4D5AE8]/5' : 'opacity-30 cursor-default'
                                        )}
                                    >
                                        <span className={clsx(
                                            'text-[12px] font-medium inline-flex items-center justify-center w-6 h-6 rounded-full',
                                            isSameDay(day, new Date()) ? 'bg-[#4D5AE8] text-white' : 'text-[#1C1C1E]'
                                        )}>
                                            {format(day, 'd')}
                                        </span>
                                        <div className="mt-1 flex flex-col gap-0.5">
                                            {dayEvents.slice(0, 3).map((ev) => {
                                                const isConflict = conflictEventIds.includes(ev.id);
                                                const colorClass = isConflict
                                                    ? 'bg-orange-400'
                                                    : (ev.goal_id ? goalColorMap.get(ev.goal_id) ?? GOAL_COLORS[0] : GOAL_COLORS[0]).split(' ')[0];
                                                return (
                                                    <div
                                                        key={ev.id}
                                                        onClick={(e) => e.stopPropagation()}
                                                        className={clsx('text-[10px] text-white font-medium rounded px-1 py-0.5 truncate cursor-default flex items-center gap-0.5', colorClass)}
                                                        title={isConflict ? `⚠️ CONFLICT: ${ev.title}` : ev.title}
                                                    >
                                                        {isConflict && <AlertTriangle className="w-2 h-2 shrink-0" />}
                                                        {ev.title}
                                                    </div>
                                                );
                                            })}
                                            {dayEvents.length > 3 && (
                                                <span className="text-[10px] text-black/40">+{dayEvents.length - 3} more</span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
