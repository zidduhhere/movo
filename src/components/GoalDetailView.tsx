import { useEffect } from 'react';
import { PanelLeft, Plus, MessageCircle, CheckSquare2, Clock, Flag, AlertTriangle, X } from 'lucide-react';
import { useStore } from '../store';
import { SettingsDropdown } from './SettingsDropdown';
import { TaskChatPanel } from './TaskChatPanel';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';

function statusLabel(status: string) {
    switch (status) {
        case 'completed': return { text: 'Done', cls: 'bg-green-100 text-green-700' };
        case 'inprogress': return { text: 'In Progress', cls: 'bg-blue-100 text-blue-700' };
        default: return { text: 'To Do', cls: 'bg-black/8 text-black/50' };
    }
}

function priorityColor(p: number) {
    if (p <= 2) return 'text-red-500';
    if (p === 3) return 'text-amber-500';
    return 'text-black/30';
}

export function GoalDetailView() {
    const {
        activeGoalId, goals, tasks,
        fetchTasksForGoal,
        isSidebarOpen, toggleSidebar,
        setActiveView,
        activeChatTaskId, setActiveChatTaskId,
        scheduleResults, dismissScheduleResult,
    } = useStore();

    const goal = goals.find(g => g.id === activeGoalId);
    const goalTasks = tasks.filter(t => t.goal_id === activeGoalId);
    const activeChatTask = goalTasks.find(t => t.id === activeChatTaskId);
    const scheduleResult = activeGoalId ? scheduleResults[activeGoalId] : undefined;

    useEffect(() => {
        if (activeGoalId) fetchTasksForGoal(activeGoalId);
    }, [activeGoalId, fetchTasksForGoal]);

    return (
        <div className="flex flex-1 h-full overflow-hidden">
            {/* Main content */}
            <div className="flex flex-col flex-1 h-full overflow-hidden">
                {/* Toolbar */}
                <div className={clsx('shrink-0 h-[76px] pt-4 flex items-center justify-between px-5 border-b border-black/8 bg-white/60 backdrop-blur-sm', !isSidebarOpen && 'pl-20')}>
                    <div className="flex items-center gap-3 pointer-events-auto no-drag">
                        <button onClick={toggleSidebar} className="p-2 rounded-full bg-white border border-[#E5E5E5] shadow-sm hover:bg-black/5 transition-colors text-[#2D2D2D] focus:outline-none flex items-center justify-center h-9 w-9">
                            <PanelLeft className="w-4 h-4" />
                        </button>
                        <div>
                            <h1 className="text-[14px] font-semibold text-[#1C1C1E] leading-tight truncate max-w-[300px]">{goal?.title ?? 'Goal'}</h1>
                            <p className="text-[11px] text-black/40">{goalTasks.filter(t => t.status !== 'completed').length} tasks remaining</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setActiveView('new_project')}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#4D5AE8] hover:bg-[#4048C9] text-white text-[12px] font-semibold shadow-sm transition-colors"
                        >
                            <Plus className="w-3.5 h-3.5" />New Goal
                        </button>
                        <SettingsDropdown />
                    </div>
                </div>

                {/* Task list */}
                <div className="flex-1 overflow-y-auto">
                    <div className="max-w-[720px] mx-auto px-6 py-8">
                        {scheduleResult?.infeasible && (
                            <div className="mb-6 flex items-start gap-3 bg-amber-50 border border-amber-200/60 rounded-xl px-4 py-3 relative">
                                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                                <div className="flex-1 pr-6">
                                    <p className="text-[13px] font-semibold text-amber-900">Not enough free time before your deadline.</p>
                                    <p className="text-[13px] text-amber-700/80 mt-0.5">
                                        Earliest feasible completion: <strong>{scheduleResult.suggested_deadline || 'Unknown'}</strong>.
                                    </p>
                                    <div className="mt-2 flex gap-3">
                                        <button
                                            onClick={() => { if (activeGoalId) dismissScheduleResult(activeGoalId); }}
                                            className="text-[12px] font-semibold text-amber-700 hover:text-amber-900 transition-colors"
                                        >
                                            Dismiss
                                        </button>
                                    </div>
                                </div>
                                <button
                                    onClick={() => { if (activeGoalId) dismissScheduleResult(activeGoalId); }}
                                    className="absolute top-3 right-3 text-amber-500 hover:text-amber-700 transition-colors"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        )}

                        {goalTasks.length === 0 && (
                            <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
                                <p className="text-[15px] font-semibold text-[#1C1C1E]">No tasks yet</p>
                                <p className="text-[13px] text-black/40">Use the global chat to ask your Chief of Staff to create tasks for this goal.</p>
                            </div>
                        )}

                        <div className="flex flex-col gap-3">
                            {goalTasks.map(task => {
                                const badge = statusLabel(task.status);
                                const isActiveChat = activeChatTaskId === task.id;
                                return (
                                    <div
                                        key={task.id}
                                        className={clsx(
                                            'flex items-center gap-4 px-4 py-3.5 rounded-2xl bg-white border shadow-sm transition-all',
                                            isActiveChat ? 'border-[#4D5AE8] ring-1 ring-[#4D5AE8]/30' : 'border-black/8'
                                        )}
                                    >
                                        {/* Status icon */}
                                        <div className="shrink-0">
                                            {task.status === 'completed'
                                                ? <CheckSquare2 className="w-4 h-4 text-[#4D5AE8]" />
                                                : <div className="w-4 h-4 rounded-sm border-2 border-black/20" />
                                            }
                                        </div>

                                        {/* Title + meta */}
                                        <div className="flex-1 min-w-0">
                                            <p className={clsx('text-[14px] font-medium leading-snug', task.status === 'completed' ? 'line-through text-black/40' : 'text-[#1C1C1E]')}>
                                                {task.title}
                                            </p>
                                            <div className="flex items-center gap-3 mt-1">
                                                <span className={clsx('text-[10px] font-semibold px-2 py-0.5 rounded-full', badge.cls)}>{badge.text}</span>
                                                {task.effort_minutes > 0 && (
                                                    <span className="flex items-center gap-1 text-[11px] text-black/40">
                                                        <Clock className="w-3 h-3" />
                                                        {task.effort_minutes}m
                                                    </span>
                                                )}
                                                {task.deadline && (
                                                    <span className="text-[11px] text-black/40">{task.deadline.slice(0, 10)}</span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Priority + Chat button */}
                                        <div className="flex items-center gap-2 shrink-0">
                                            <Flag className={clsx('w-3.5 h-3.5', priorityColor(task.priority))} />
                                            <button
                                                onClick={() => setActiveChatTaskId(isActiveChat ? null : task.id)}
                                                className={clsx(
                                                    'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors',
                                                    isActiveChat
                                                        ? 'bg-[#4D5AE8] text-white border-transparent'
                                                        : 'bg-white border-black/10 text-black/60 hover:bg-black/5'
                                                )}
                                            >
                                                <MessageCircle className="w-3.5 h-3.5" />
                                                Chat
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>

            {/* Task chat slide-in panel */}
            <AnimatePresence>
                {activeChatTaskId && activeChatTask && (
                    <motion.div
                        key="task-chat-panel"
                        initial={{ x: 320, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ x: 320, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                        className="h-full"
                    >
                        <TaskChatPanel
                            taskId={activeChatTaskId}
                            taskTitle={activeChatTask.title}
                            onClose={() => setActiveChatTaskId(null)}
                        />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
