import { useState } from 'react';
import { useStore } from '../store';
import clsx from 'clsx';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const FOCUS_BLOCKS = [30, 60, 90, 120];

const DEFAULT_PREFS = {
    work_start: '09:00',
    work_end: '18:00',
    focus_block_mins: 60,
    days_off: 'Saturday,Sunday',
};

export function Onboarding() {
    const { savePreferences } = useStore();
    const [step, setStep] = useState(1);
    const [workStart, setWorkStart] = useState('09:00');
    const [workEnd, setWorkEnd] = useState('18:00');
    const [focusBlock, setFocusBlock] = useState(60);
    const [daysOff, setDaysOff] = useState<string[]>(['Saturday', 'Sunday']);

    function toggleDay(day: string) {
        setDaysOff((prev) =>
            prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
        );
    }

    async function handleFinish() {
        await savePreferences({
            work_start: workStart,
            work_end: workEnd,
            focus_block_mins: focusBlock,
            days_off: daysOff.join(','),
        });
    }

    async function handleSkip() {
        await savePreferences(DEFAULT_PREFS);
    }

    return (
        <div className="flex flex-col items-center justify-center w-full h-full bg-[#FAFAFA] px-8">
            <div className="w-full max-w-md">
                {/* Progress dots */}
                <div className="flex justify-center gap-2 mb-10">
                    {[1, 2, 3].map((s) => (
                        <div
                            key={s}
                            className={clsx(
                                'w-2 h-2 rounded-full transition-colors',
                                s === step ? 'bg-[#4D5AE8]' : s < step ? 'bg-[#4D5AE8]/50' : 'bg-black/10'
                            )}
                        />
                    ))}
                </div>

                {step === 1 && (
                    <div className="flex flex-col gap-6">
                        <div>
                            <h2 className="text-[22px] font-semibold text-[#1C1C1E] mb-1">When do you work?</h2>
                            <p className="text-[14px] text-black/50">Movo will schedule tasks only within these hours.</p>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="flex flex-col gap-1 flex-1">
                                <label className="text-[12px] font-medium text-black/50">Start</label>
                                <input
                                    type="time"
                                    value={workStart}
                                    onChange={(e) => setWorkStart(e.target.value)}
                                    className="px-3 py-2 rounded-xl border border-black/10 bg-white text-[14px] text-[#1C1C1E] outline-none focus:border-[#4D5AE8] focus:ring-2 focus:ring-[#4D5AE8]/20"
                                />
                            </div>
                            <span className="text-black/30 mt-5">→</span>
                            <div className="flex flex-col gap-1 flex-1">
                                <label className="text-[12px] font-medium text-black/50">End</label>
                                <input
                                    type="time"
                                    value={workEnd}
                                    onChange={(e) => setWorkEnd(e.target.value)}
                                    className="px-3 py-2 rounded-xl border border-black/10 bg-white text-[14px] text-[#1C1C1E] outline-none focus:border-[#4D5AE8] focus:ring-2 focus:ring-[#4D5AE8]/20"
                                />
                            </div>
                        </div>
                        <button
                            onClick={() => setStep(2)}
                            className="mt-4 py-3 bg-[#4D5AE8] text-white font-semibold rounded-xl hover:bg-[#4048C9] transition-colors"
                        >
                            Continue
                        </button>
                    </div>
                )}

                {step === 2 && (
                    <div className="flex flex-col gap-6">
                        <div>
                            <h2 className="text-[22px] font-semibold text-[#1C1C1E] mb-1">Ideal focus session?</h2>
                            <p className="text-[14px] text-black/50">Movo will schedule tasks in blocks of this length.</p>
                        </div>
                        <div className="flex gap-3 flex-wrap">
                            {FOCUS_BLOCKS.map((mins) => (
                                <button
                                    key={mins}
                                    onClick={() => setFocusBlock(mins)}
                                    className={clsx(
                                        'px-5 py-2.5 rounded-xl text-[14px] font-medium border transition-colors',
                                        focusBlock === mins
                                            ? 'bg-[#4D5AE8] text-white border-[#4D5AE8]'
                                            : 'bg-white text-black/70 border-black/10 hover:border-[#4D5AE8]/50'
                                    )}
                                >
                                    {mins < 60 ? `${mins} min` : `${mins / 60} hr${mins > 60 ? 's' : ''}`}
                                </button>
                            ))}
                        </div>
                        <div className="flex gap-3 mt-4">
                            <button
                                onClick={() => setStep(1)}
                                className="flex-1 py-3 bg-black/5 text-black/60 font-semibold rounded-xl hover:bg-black/10 transition-colors"
                            >
                                Back
                            </button>
                            <button
                                onClick={() => setStep(3)}
                                className="flex-1 py-3 bg-[#4D5AE8] text-white font-semibold rounded-xl hover:bg-[#4048C9] transition-colors"
                            >
                                Continue
                            </button>
                        </div>
                    </div>
                )}

                {step === 3 && (
                    <div className="flex flex-col gap-6">
                        <div>
                            <h2 className="text-[22px] font-semibold text-[#1C1C1E] mb-1">Days off?</h2>
                            <p className="text-[14px] text-black/50">Movo won't schedule anything on these days.</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {DAYS.map((day) => (
                                <button
                                    key={day}
                                    onClick={() => toggleDay(day)}
                                    className={clsx(
                                        'px-4 py-2 rounded-xl text-[13px] font-medium border transition-colors',
                                        daysOff.includes(day)
                                            ? 'bg-[#4D5AE8] text-white border-[#4D5AE8]'
                                            : 'bg-white text-black/70 border-black/10 hover:border-[#4D5AE8]/50'
                                    )}
                                >
                                    {day.slice(0, 3)}
                                </button>
                            ))}
                        </div>
                        <div className="flex gap-3 mt-4">
                            <button
                                onClick={() => setStep(2)}
                                className="flex-1 py-3 bg-black/5 text-black/60 font-semibold rounded-xl hover:bg-black/10 transition-colors"
                            >
                                Back
                            </button>
                            <button
                                onClick={handleFinish}
                                className="flex-1 py-3 bg-[#4D5AE8] text-white font-semibold rounded-xl hover:bg-[#4048C9] transition-colors"
                            >
                                Let's go →
                            </button>
                        </div>
                        <button
                            onClick={handleSkip}
                            className="text-[12px] text-black/30 hover:text-black/50 text-center transition-colors"
                        >
                            Skip — use defaults
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
