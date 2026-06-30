import { useEffect } from 'react';
import { Play, Sparkles } from 'lucide-react';
import { useStore } from '../store';

export function NextActionWidget() {
    const { tasks, activeGoalId, activeView, nextAction, fetchNextAction, setFocusTask } = useStore();

    useEffect(() => {
        fetchNextAction();
    }, [tasks, fetchNextAction]);

    if (activeView === 'project' && !activeGoalId) return null;
    if (activeView !== 'all' && activeView !== 'project') return null;
    if (!nextAction) return null;

    return (
        <div className="w-full bg-white border border-[#E5E5EA] rounded-[16px] shadow-[0_8px_30px_rgba(0,0,0,0.04)] p-5 relative overflow-hidden">
            <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex gap-4">
                    <div className="shrink-0 w-12 h-12 bg-[#4D5AE8] rounded-full flex items-center justify-center shadow-sm">
                        <Sparkles className="w-6 h-6 text-white" />
                    </div>
                    <div className="flex flex-col justify-center">
                        <span className="text-[11px] font-semibold text-[#4D5AE8] uppercase tracking-wider mb-0.5">Next Best Action</span>
                        <h3 className="text-[16px] font-semibold text-[#1C1C1E] tracking-tight leading-tight">{nextAction.task.title}</h3>
                        <p className="text-[12px] text-[#8E8E93] mt-1">{nextAction.reason}</p>
                    </div>
                </div>

                <button
                    onClick={() => setFocusTask(nextAction.task.id)}
                    className="shrink-0 flex items-center gap-2 bg-[#4D5AE8] hover:bg-[#4048C9] text-white px-5 py-2.5 rounded-full text-[14px] font-medium transition-all shadow-md active:scale-95 focus:outline-none"
                >
                    <Play className="w-4 h-4 fill-current" />
                    Focus
                </button>
            </div>
        </div>
    );
}
