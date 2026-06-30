import { useState } from 'react';
import { useStore } from '../store';
import { Sparkles, Loader2 } from 'lucide-react';

export function GoalCapture() {
    const [title, setTitle] = useState('');
    const [isPlanning, setIsPlanning] = useState(false);
    
    const { createGoal, planGoal } = useStore();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim() || isPlanning) return;

        try {
            setIsPlanning(true);
            const goal = await createGoal(title, undefined);
            await planGoal(goal.id);
            setTitle('');
        } catch (error) {
            console.error("Failed to capture goal", error);
        } finally {
            setIsPlanning(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="w-full flex justify-center">
            <div className="flex items-center gap-2 w-full max-w-[400px] bg-black/5 border border-black/10 rounded-[8px] px-3 py-1.5 shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)] focus-within:ring-2 focus-within:ring-[#85D24E]/20 focus-within:border-[#85D24E] transition-all">
                {isPlanning ? (
                    <Loader2 className="w-3.5 h-3.5 text-black/50 animate-spin" />
                ) : (
                    <Sparkles className="w-3.5 h-3.5 text-black/40" />
                )}
                
                <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Plan a goal or ask what's next..."
                    className="flex-1 bg-transparent border-none outline-none text-[13px] text-black placeholder-black/40"
                    disabled={isPlanning}
                />
            </div>
        </form>
    );
}


