import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { Clock, CheckCircle2, Circle } from 'lucide-react';
import clsx from 'clsx';

export function TaskList() {
    const { tasks, activeGoalId, activeView, fetchTasksForGoal, fetchAllTasks, isLoading, completeTask, setFocusTask } = useStore();
    const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null);
    const [completing, setCompleting] = useState<string | null>(null);

    useEffect(() => {
        if (activeView === 'project' && activeGoalId) {
            fetchTasksForGoal(activeGoalId);
        } else {
            fetchAllTasks();
        }
    }, [activeGoalId, activeView, fetchTasksForGoal, fetchAllTasks]);

    if (activeView === 'project' && !activeGoalId) return null;

    const now = new Date();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const displayTasks = (() => {
        switch (activeView) {
            case 'recent':
                return tasks
                    .filter(t => t.status !== 'completed' && new Date(t.created_at) >= fourteenDaysAgo)
                    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
            case 'upcoming':
                return tasks
                    .filter(t => t.status !== 'completed' && t.deadline && new Date(t.deadline) >= now)
                    .sort((a, b) => new Date(a.deadline!).getTime() - new Date(b.deadline!).getTime());
            case 'completed':
                return tasks
                    .filter(t => t.status === 'completed')
                    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
            default:
                return tasks
                    .filter(t => t.status !== 'completed')
                    .sort((a, b) => (a.priority ?? 3) - (b.priority ?? 3));
        }
    })();

    const handleComplete = async (id: string) => {
        setCompleting(id);
        try {
            await completeTask(id);
        } finally {
            setCompleting(null);
        }
    };

    return (
        <div className="w-full flex flex-col">
            {displayTasks.map((task) => {
                const isDone = task.status === 'completed';
                const isCompletingNow = completing === task.id;
                return (
                    <div
                        key={task.id}
                        className={clsx(
                            'flex items-start gap-3 py-3 border-b border-[#E5E5EA] group transition-opacity duration-300',
                            (isDone || isCompletingNow) && 'opacity-50'
                        )}
                        onMouseEnter={() => setHoveredTaskId(task.id)}
                        onMouseLeave={() => setHoveredTaskId(null)}
                    >
                        <button
                            onClick={() => !isDone && handleComplete(task.id)}
                            disabled={isDone || isCompletingNow}
                            className="mt-0.5 text-black/20 hover:text-[#85D24E] transition-colors focus:outline-none disabled:cursor-default"
                        >
                            {isDone
                                ? <CheckCircle2 className="w-5 h-5 text-[#85D24E]" strokeWidth={1.5} />
                                : <Circle className="w-5 h-5" strokeWidth={1.5} />
                            }
                        </button>

                        <div className="flex-1 min-w-0">
                            <div className="flex items-baseline justify-between">
                                <h5 className={clsx(
                                    'font-medium text-[14px] truncate',
                                    isDone ? 'line-through text-[#8E8E93]' : 'text-[#1C1C1E]'
                                )}>
                                    {task.title}
                                </h5>
                                {hoveredTaskId === task.id && !isDone && (
                                    <button
                                        onClick={() => setFocusTask(task.id)}
                                        className="text-[11px] font-medium text-[#85D24E] hover:text-[#78C245] uppercase tracking-wider ml-4 shrink-0"
                                    >
                                        Start
                                    </button>
                                )}
                            </div>
                            {task.description && (
                                <p className="text-[13px] text-[#8E8E93] line-clamp-2 mt-0.5">{task.description}</p>
                            )}
                            <div className="flex items-center gap-3 mt-1.5 text-[12px] text-[#8E8E93]">
                                <span className="flex items-center gap-1">
                                    <Clock className="w-3.5 h-3.5" />
                                    {task.effort_minutes} min
                                </span>
                                {task.deadline && (
                                    <span className={clsx(
                                        'font-medium',
                                        new Date(task.deadline) < now ? 'text-red-500' : 'text-[#8E8E93]'
                                    )}>
                                        Due {task.deadline.slice(0, 10)}
                                    </span>
                                )}
                                <span className={clsx(
                                    'text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide',
                                    task.priority <= 2 ? 'bg-red-100 text-red-600' : task.priority === 3 ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'
                                )}>
                                    P{task.priority}
                                </span>
                            </div>
                        </div>
                    </div>
                );
            })}

            {displayTasks.length === 0 && !isLoading && (
                <p className="text-[#8E8E93] text-[13px] py-8 text-center">
                    {activeView === 'completed' ? 'No completed tasks yet.' :
                     activeView === 'upcoming' ? 'No tasks with upcoming deadlines.' :
                     activeView === 'recent' ? 'No tasks created in the last 7 days.' :
                     'No tasks planned yet.'}
                </p>
            )}
            {isLoading && displayTasks.length === 0 && (
                <p className="text-[#8E8E93] text-[13px] py-4 text-center animate-pulse">Loading tasks...</p>
            )}
        </div>
    );
}
