import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Plus, Play } from 'lucide-react';
import { useStore } from '../store';

interface CommandPaletteProps {
    onClose: () => void;
}

const COMMANDS = [
    { id: 'new_goal', icon: <Plus className="w-4 h-4" />, label: 'New Goal', description: 'Start planning a new goal' },
    { id: 'focus', icon: <Play className="w-4 h-4" />, label: 'Start Focus Session', description: 'Focus on your next best action' },
    { id: 'calendar', icon: <CalendarDays className="w-4 h-4" />, label: 'View Calendar', description: 'Open the calendar view' },
];

export function CommandPalette({ onClose }: CommandPaletteProps) {
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const { setActiveView, nextAction, setFocusTask } = useStore();

    useEffect(() => { inputRef.current?.focus(); }, []);

    const filtered = COMMANDS.filter(c =>
        c.label.toLowerCase().includes(query.toLowerCase()) ||
        c.description.toLowerCase().includes(query.toLowerCase())
    );

    const execute = (id: string) => {
        onClose();
        if (id === 'new_goal') setActiveView('new_project');
        else if (id === 'focus' && nextAction) setFocusTask(nextAction.task.id);
        else if (id === 'calendar') setActiveView('calendar');
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, filtered.length - 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
        else if (e.key === 'Enter') { if (filtered[selected]) execute(filtered[selected].id); }
        else if (e.key === 'Escape') onClose();
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[20vh] bg-black/40 backdrop-blur-sm" onClick={onClose}>
            <div
                className="w-full max-w-[560px] mx-4 bg-white rounded-2xl shadow-2xl border border-black/8 overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                <input
                    ref={inputRef}
                    value={query}
                    onChange={e => { setQuery(e.target.value); setSelected(0); }}
                    onKeyDown={handleKeyDown}
                    placeholder="Search commands…"
                    className="w-full px-5 py-4 text-[16px] text-[#1C1C1E] placeholder-black/30 outline-none border-b border-black/8"
                />
                <div className="py-2 max-h-72 overflow-y-auto">
                    {filtered.length === 0 && (
                        <p className="text-center text-[13px] text-black/40 py-8">No commands found.</p>
                    )}
                    {filtered.map((cmd, i) => (
                        <button
                            key={cmd.id}
                            onClick={() => execute(cmd.id)}
                            className={`w-full flex items-center gap-3 px-5 py-3 text-left transition-colors ${i === selected ? 'bg-[#4D5AE8]/10' : 'hover:bg-black/4'}`}
                        >
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${i === selected ? 'bg-[#4D5AE8] text-white' : 'bg-black/6 text-black/50'}`}>
                                {cmd.icon}
                            </div>
                            <div>
                                <p className="text-[14px] font-medium text-[#1C1C1E]">{cmd.label}</p>
                                <p className="text-[12px] text-black/40">{cmd.description}</p>
                            </div>
                        </button>
                    ))}
                </div>
                <div className="px-5 py-2.5 border-t border-black/8 flex gap-4">
                    <span className="text-[11px] text-black/30">↑↓ navigate</span>
                    <span className="text-[11px] text-black/30">↵ select</span>
                    <span className="text-[11px] text-black/30">esc close</span>
                </div>
            </div>
        </div>
    );
}
