import { useEffect } from 'react';
import { useStore } from '../store';
import clsx from 'clsx';
import { Library, Clock, Calendar, CalendarDays, CheckSquare, Target, Trash2, LogOut, Plus, MessageSquare } from 'lucide-react';
import { confirm } from '@tauri-apps/plugin-dialog';

export function Sidebar() {
    const { user, goals, fetchGoals, activeGoalId, setActiveGoal, isSidebarOpen, activeView, setActiveView, deleteGoal, logout, goalStats, fetchGoalStats } = useStore();

    useEffect(() => {
        fetchGoals();
        fetchGoalStats();
    }, [fetchGoals, fetchGoalStats]);

    if (!isSidebarOpen) return null;

    return (
        <div className="w-[260px] h-full flex flex-col pt-12 pb-4 bg-white/40 backdrop-blur-2xl border-r border-white/50 select-none no-drag overflow-hidden">
            
            <div className="flex-1 overflow-y-auto px-3 flex flex-col gap-6 pt-4">
                
                {/* Chat with Movo */}
                <button
                    onClick={() => setActiveView('new_project')}
                    className={clsx(
                        'flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-[13px] font-semibold transition-colors',
                        activeView === 'new_project'
                            ? 'bg-[#85D24E] text-black shadow-sm'
                            : 'bg-white/10 text-white hover:bg-white/20'
                    )}
                >
                    <MessageSquare className="w-4 h-4 shrink-0" />
                    Chat with Movo
                </button>

                {/* Library Section */}
                <div className="flex flex-col gap-0.5">
                    <div className="px-2 mb-1 flex items-center">
                        <span className="text-[11px] font-semibold text-white/50 uppercase tracking-wider">Library</span>
                    </div>
                    
                    <SidebarItem 
                        icon={<Library className="w-4 h-4" />} 
                        label="All Goals" 
                        active={activeView === 'all'}
                        onClick={() => setActiveView('all')}
                    />
                    <SidebarItem 
                        icon={<Clock className="w-4 h-4" />} 
                        label="Recent" 
                        active={activeView === 'recent'}
                        onClick={() => setActiveView('recent')}
                    />
                    <SidebarItem
                        icon={<Calendar className="w-4 h-4" />}
                        label="Upcoming"
                        active={activeView === 'upcoming'}
                        onClick={() => setActiveView('upcoming')}
                    />
                    <SidebarItem
                        icon={<CalendarDays className="w-4 h-4" />}
                        label="Calendar"
                        active={activeView === 'calendar'}
                        onClick={() => setActiveView('calendar')}
                    />
                    <SidebarItem
                        icon={<CheckSquare className="w-4 h-4" />}
                        label="Completed" 
                        active={activeView === 'completed'}
                        onClick={() => setActiveView('completed')}
                    />
                </div>

                {/* Projects/Goals Section */}
                <div className="flex flex-col gap-0.5">
                    <div className="px-2 mb-1 flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-white/50 uppercase tracking-wider">Projects</span>
                        <button
                            onClick={() => setActiveView('new_project')}
                            className="p-1 rounded hover:bg-white/10 text-white/50 hover:text-white transition-colors"
                            title="New Project"
                        >
                            <Plus className="w-3.5 h-3.5" />
                        </button>
                    </div>
                    
                    {goals.map((goal) => {
                        const stat = goalStats[goal.id];
                        const pct = stat && stat.total > 0 ? stat.completed / stat.total : 0;
                        const isActive = activeGoalId === goal.id;
                        return (
                            <div
                                key={goal.id}
                                onClick={() => setActiveGoal(goal.id)}
                                className={clsx(
                                    "group flex flex-col gap-1 px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors text-[13px] font-medium",
                                    isActive ? "bg-[#85D24E] text-black shadow-sm" : "hover:bg-white/10 text-white/80 hover:text-white"
                                )}
                            >
                                <div className="flex items-center justify-between gap-2.5">
                                    <div className="flex items-center gap-2.5 overflow-hidden">
                                        <Target className={clsx("w-4 h-4 shrink-0", isActive ? "text-black opacity-90" : "text-[#85D24E] opacity-80")} />
                                        <span className="truncate">{goal.title}</span>
                                    </div>
                                    <button
                                        onClick={async (e) => {
                                            e.stopPropagation();
                                            const confirmed = await confirm(
                                                'Are you sure you want to delete this project? This action cannot be undone and all tasks will be removed.',
                                                { title: 'Delete Project?', kind: 'warning' }
                                            );
                                            if (confirmed) await deleteGoal(goal.id);
                                        }}
                                        className={clsx(
                                            "p-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity shrink-0",
                                            isActive ? "hover:bg-white/20 text-white" : "hover:bg-white/10 text-white/50"
                                        )}
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                                {stat && stat.total > 0 && (
                                    <div className="flex items-center gap-2 pl-6">
                                        <div className={clsx("flex-1 h-1 rounded-full overflow-hidden", isActive ? "bg-black/20" : "bg-white/10")}>
                                            <div
                                                className={clsx("h-full rounded-full transition-all", isActive ? "bg-black/60" : "bg-[#85D24E]")}
                                                style={{ width: `${pct * 100}%` }}
                                            />
                                        </div>
                                        <span className={clsx("text-[10px] shrink-0", isActive ? "text-black/50" : "text-white/40")}>
                                            {stat.completed}/{stat.total}
                                        </span>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                    
                    {goals.length === 0 && (
                        <div className="px-3 py-2 text-[12px] text-white/50 italic">
                            No projects yet.
                        </div>
                    )}
                </div>
                
            </div>

            {/* Footer / User Actions */}
            {user && (
                <div className="px-3 pb-4 pt-4 mt-auto border-t border-white/10">
                    <div className="flex items-center justify-between group px-2 py-2 rounded-xl hover:bg-white/10 transition-colors cursor-pointer">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-[13px] font-semibold text-white/90">
                                {user.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
                            </div>
                            <span className="text-[14px] font-semibold text-white/90 truncate max-w-[120px]">
                                {user.name}
                            </span>
                        </div>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                logout();
                            }}
                            className="p-1.5 rounded-lg text-white/50 hover:text-[#FF3B30] hover:bg-white/10 transition-colors opacity-0 group-hover:opacity-100"
                            title="Logout"
                        >
                            <LogOut className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

// Reusable Sidebar Item
function SidebarItem({ icon, label, active = false, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick?: () => void }) {
    return (
        <div 
            onClick={onClick}
            className={clsx(
                "flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors text-[13px] font-medium",
                active ? "bg-[#85D24E] text-black shadow-sm" : "hover:bg-white/10 text-white/80 hover:text-white"
            )}
        >
            <div className={clsx("opacity-80 shrink-0", active ? "text-black" : "text-[#85D24E]")}>{icon}</div>
            <span className="truncate">{label}</span>
        </div>
    );
}
