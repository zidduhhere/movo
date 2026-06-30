import { useEffect, useState, useRef } from 'react';
import { X, Check, Plus } from 'lucide-react';
import { useStore } from '../store';

export function FocusSession() {
    const { tasks, focusTaskId, setFocusTask, completeTask, preferences } = useStore();
    const task = tasks.find(t => t.id === focusTaskId);
    const defaultMinutes = preferences?.focus_block_mins ?? 25;

    const [secondsLeft, setSecondsLeft] = useState(defaultMinutes * 60);
    const [isRunning, setIsRunning] = useState(true);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        setSecondsLeft(defaultMinutes * 60);
    }, [defaultMinutes]);

    useEffect(() => {
        if (isRunning) {
            intervalRef.current = setInterval(() => {
                setSecondsLeft(s => {
                    if (s <= 1) {
                        clearInterval(intervalRef.current!);
                        setIsRunning(false);
                        return 0;
                    }
                    return s - 1;
                });
            }, 1000);
        } else {
            if (intervalRef.current) clearInterval(intervalRef.current);
        }
        return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }, [isRunning]);

    const mins = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
    const secs = String(secondsLeft % 60).padStart(2, '0');
    const totalSecs = defaultMinutes * 60;
    const progress = 1 - secondsLeft / totalSecs;

    const handleDone = async () => {
        if (focusTaskId) await completeTask(focusTaskId);
        setFocusTask(null);
    };

    const handleExtend = () => {
        setSecondsLeft(s => s + 10 * 60);
        setIsRunning(true);
    };

    if (!task) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-white rounded-3xl shadow-2xl p-10 flex flex-col items-center gap-6 w-full max-w-md mx-4">
                {/* Close */}
                <button
                    onClick={() => setFocusTask(null)}
                    className="self-end p-2 rounded-full hover:bg-black/5 text-black/40 hover:text-black/70 transition-colors"
                >
                    <X className="w-4 h-4" />
                </button>

                {/* Label */}
                <div className="text-center">
                    <p className="text-[11px] font-semibold text-[#85D24E] uppercase tracking-wider mb-1">Focus Session</p>
                    <h2 className="text-[20px] font-semibold text-[#1C1C1E] leading-tight">{task.title}</h2>
                </div>

                {/* Timer ring */}
                <div className="relative w-44 h-44">
                    <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                        <circle cx="50" cy="50" r="44" fill="none" stroke="#E5E5EA" strokeWidth="8" />
                        <circle
                            cx="50" cy="50" r="44"
                            fill="none"
                            stroke="#85D24E"
                            strokeWidth="8"
                            strokeLinecap="round"
                            strokeDasharray={`${2 * Math.PI * 44}`}
                            strokeDashoffset={`${2 * Math.PI * 44 * (1 - progress)}`}
                            className="transition-all duration-1000"
                        />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-[36px] font-bold text-[#1C1C1E] tabular-nums tracking-tight">
                            {mins}:{secs}
                        </span>
                    </div>
                </div>

                {/* Actions */}
                <div className="flex gap-3 w-full">
                    <button
                        onClick={handleExtend}
                        className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl border border-[#E5E5EA] text-[14px] font-medium text-[#1C1C1E] hover:bg-black/5 transition-colors"
                    >
                        <Plus className="w-4 h-4" />
                        +10 min
                    </button>
                    <button
                        onClick={handleDone}
                        className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-[#85D24E] hover:bg-[#78C245] text-[14px] font-semibold text-[#1C1C1E] transition-colors shadow-md"
                    >
                        <Check className="w-4 h-4" />
                        Done
                    </button>
                </div>

                {secondsLeft === 0 && (
                    <p className="text-[13px] text-[#85D24E] font-medium animate-pulse">Time's up! Great work 🎉</p>
                )}
            </div>
        </div>
    );
}
