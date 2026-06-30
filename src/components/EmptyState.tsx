import { useState, useEffect } from 'react';
import { useStore } from '../store';
import { Mic, MicOff, Loader2, Paperclip, ListTodo, Calendar } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { motion } from 'framer-motion';
import { useVoiceInput } from '../hooks/useVoiceInput';

export function EmptyState() {
    const [title, setTitle] = useState('');
    const [isPlanning, setIsPlanning] = useState(false);
    const [planningStatus, setPlanningStatus] = useState<string>('Initializing...');

    const { user, createGoal, planGoal, tasks } = useStore();

    const { isListening, micError, toggleListening, stopListening } = useVoiceInput({
        onTranscript: (text) => setTitle(text),
    });

    const activeTasksCount = tasks.filter(t => t.status === 'todo' || t.status === 'inprogress').length;

    useEffect(() => {
        let unlisten: (() => void) | undefined;
        
        async function setupListener() {
            unlisten = await listen<string>('planning-status', (event) => {
                setPlanningStatus(event.payload);
            });
        }
        setupListener();
        
        return () => {
            if (unlisten) unlisten();
        };
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim() || isPlanning) return;
        stopListening();

        try {
            setIsPlanning(true);
            setPlanningStatus('Analyzing objective...');
            const goal = await createGoal(title, undefined);
            await planGoal(goal.id);
            
            // On success, set the new goal as active and navigate to it!
            useStore.getState().setActiveGoal(goal.id);
            setTitle('');
        } catch (error) {
            console.error("Failed to capture goal", error);
            alert("Failed to plan goal: " + error);
        } finally {
            setIsPlanning(false);
        }
    };

    // Calculate greeting based on time of day
    const getGreeting = () => {
        const hour = new Date().getHours();
        if (hour < 12) return 'Good morning';
        if (hour < 17) return 'Good afternoon';
        return 'Good evening';
    };

    const firstName = user?.name?.split(' ')[0] || '';

    return (
        <div className="flex-1 h-full flex flex-col items-center justify-center relative p-12 bg-transparent z-20 no-drag">
            <div className="w-full max-w-2xl text-center mb-12">
               <h1 className="text-[48px] md:text-[56px] font-bold tracking-tight mb-3 text-[#1C1C1E]">
                   {getGreeting()}{firstName ? `, ${firstName}` : ''}.
               </h1>
               <h2 className="text-[24px] md:text-[28px] font-medium text-black/40">What would you like to accomplish today?</h2>
            </div>

            <form onSubmit={handleSubmit} className="w-full flex flex-col items-center justify-center relative">
                <motion.div 
                    layoutId="chat-input-bar"
                    className={`relative flex items-center gap-3 w-full max-w-[700px] bg-white border border-[#E5E5EA] rounded-full px-6 py-4 shadow-[0_8px_30px_rgba(0,0,0,0.04)] transition-all duration-300 focus-within:border-[#4D5AE8] focus-within:ring-2 focus-within:ring-[#4D5AE8]/20 ${isPlanning ? 'opacity-80 scale-[0.98]' : 'hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)]'}`}
                >
                    <button 
                        type="button"
                        className="p-2 rounded-full hover:bg-black/5 text-[#8E8E93] hover:text-[#1C1C1E] transition-colors focus:outline-none"
                        disabled={isPlanning}
                    >
                        <Paperclip className="w-5 h-5" />
                    </button>
                    
                    <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder={isListening ? 'Listening…' : 'Plan my weekend, launch a startup...'}
                        className="flex-1 bg-transparent border-none outline-none text-[16px] md:text-[18px] text-[#2D2D2D] placeholder-[#A0A0A0] focus:ring-0"
                        disabled={isPlanning}
                        autoFocus
                    />

                    <button
                        type="button"
                        onClick={toggleListening}
                        disabled={isPlanning}
                        title={micError ?? (isListening ? 'Stop listening' : 'Voice input')}
                        className={`p-1.5 rounded-full transition-colors focus:outline-none ${
                            micError
                                ? 'text-red-400'
                                : isListening
                                ? 'text-[#4D5AE8] bg-[#4D5AE8]/10 animate-pulse'
                                : 'text-[#8E8E93] hover:text-[#1C1C1E] hover:bg-black/5'
                        }`}
                    >
                        {micError ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                    </button>
                </motion.div>
                
                {/* Interactive Thinking Phase Indicator */}
                <div className={`absolute top-full left-0 right-0 mt-8 flex flex-col items-center justify-center transition-all duration-500 ${isPlanning ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}>
                    <div className="flex items-center gap-3 bg-white/80 border border-[#E5E5EA] px-5 py-2.5 rounded-full shadow-sm">
                        <Loader2 className="w-4 h-4 text-[#007AFF] animate-spin" />
                        <span className="text-[13px] font-medium text-[#1C1C1E] animate-pulse">{planningStatus}</span>
                    </div>
                </div>
            </form>

            {/* Activities Today Indicators */}
            <div className={`mt-16 flex gap-4 transition-all duration-700 delay-300 ${isPlanning ? 'opacity-0 translate-y-4 pointer-events-none' : 'opacity-100 translate-y-0'}`}>
                <div className="flex items-center gap-3.5 px-6 py-4 rounded-2xl bg-white border border-black/5 shadow-[0_2px_15px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_20px_rgba(0,0,0,0.06)] transition-all cursor-pointer">
                    <div className="w-11 h-11 rounded-full bg-[#4D5AE8]/15 flex items-center justify-center">
                        <ListTodo className="w-5 h-5 text-[#3B44A8]" />
                    </div>
                    <div className="text-left pr-2">
                        <p className="text-[12px] text-black/40 font-medium uppercase tracking-wider mb-0.5">Today's Focus</p>
                        <p className="text-[15px] font-semibold text-[#1C1C1E]">{activeTasksCount} action items</p>
                    </div>
                </div>
                <div className="flex items-center gap-3.5 px-6 py-4 rounded-2xl bg-white border border-black/5 shadow-[0_2px_15px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_20px_rgba(0,0,0,0.06)] transition-all cursor-pointer">
                    <div className="w-11 h-11 rounded-full bg-blue-500/10 flex items-center justify-center">
                        <Calendar className="w-5 h-5 text-blue-500" />
                    </div>
                    <div className="text-left pr-2">
                        <p className="text-[12px] text-black/40 font-medium uppercase tracking-wider mb-0.5">Schedule</p>
                        <p className="text-[15px] font-semibold text-[#1C1C1E]">View Calendar</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
