import { useState, useRef, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useVoiceInput } from '../hooks/useVoiceInput';

interface ScheduleResult {
  scheduled_count: number;
  infeasible: boolean;
  suggested_deadline: string | null;
}
import { Bot, User, Send, ListTodo, ChevronRight, Loader2, PanelLeft, Plus, CheckSquare2, Paperclip, Mic } from 'lucide-react';
import { useStore } from '../store';
import { SettingsDropdown } from './SettingsDropdown';
import clsx from 'clsx';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { InteractiveQuestion } from './InteractiveQuestion';
import { parseAIMessage } from '../utils/messageParser';

// ── Prose class shared across markdown blocks ─────────────────────────────────
const PROSE = 'prose prose-sm max-w-none text-[#1C1C1E] prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-a:text-[#4D5AE8]';

// ── Message renderer: detects interactive_question JSON and renders it as UI ──

function AIMessageContent({ content, onSelect }: { content: string; onSelect: (val: string) => void }) {
    const parsed = parseAIMessage(content);

    if (parsed.type === 'interactive_question') {
        return (
            <div className="flex flex-col gap-3">
                {parsed.prefix && <div className={PROSE}><ReactMarkdown remarkPlugins={[remarkGfm]}>{parsed.prefix}</ReactMarkdown></div>}
                <InteractiveQuestion question={parsed.question} options={parsed.options} onSelect={onSelect} />
            </div>
        );
    }

    return <div className={PROSE}><ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown></div>;
}

// ── Task Panel ────────────────────────────────────────────────────────────────

function TaskPanel({ onClose }: { onClose: () => void }) {
    const { tasks } = useStore();
    const todo = tasks.filter(t => t.status === 'todo' || t.status === 'inprogress');
    const done = tasks.filter(t => t.status === 'completed');

    return (
        <div className="w-72 h-full flex flex-col border-l border-black/8 bg-white/60 backdrop-blur-sm">
            <div className="flex items-center justify-between px-4 py-4 border-b border-black/8">
                <span className="text-[13px] font-semibold text-[#1C1C1E]">Tasks</span>
                <button onClick={onClose} className="p-1 rounded-lg hover:bg-black/5 text-black/40 hover:text-black/70 transition-colors">
                    <ChevronRight className="w-4 h-4" />
                </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-1.5">
                {todo.length === 0 && done.length === 0 && (
                    <p className="text-center text-[12px] text-black/40 mt-8 italic">
                        No tasks yet — chat with your Chief of Staff to create some.
                    </p>
                )}
                {todo.map(t => (
                    <div key={t.id} className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-white border border-black/8 shadow-sm">
                        <div className="w-3.5 h-3.5 rounded-sm border-2 border-black/30 mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                            <p className="text-[12px] font-medium text-[#1C1C1E] leading-snug truncate">{t.title}</p>
                            {t.deadline && <p className="text-[10px] text-black/40 mt-0.5">{t.deadline.slice(0, 10)}</p>}
                        </div>
                        <span className={clsx(
                            'text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide shrink-0',
                            t.priority <= 2 ? 'bg-red-100 text-red-600' : t.priority === 3 ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'
                        )}>P{t.priority}</span>
                    </div>
                ))}
                {done.length > 0 && <p className="text-[10px] font-semibold uppercase tracking-wider text-black/30 px-1 pt-2">Completed</p>}
                {done.map(t => (
                    <div key={t.id} className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-black/3 opacity-60">
                        <CheckSquare2 className="w-3.5 h-3.5 text-[#4D5AE8] mt-0.5 shrink-0" />
                        <p className="text-[12px] text-black/50 line-through leading-snug truncate">{t.title}</p>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── Main GoalChatView ─────────────────────────────────────────────────────────

export function GoalChatView() {
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [showTasks, setShowTasks] = useState(false);
    const [scheduleResult, setScheduleResult] = useState<ScheduleResult | null>(null);
    const [scheduleBannerDismissed, setScheduleBannerDismissed] = useState(false);
    const hasScheduledRef = useRef(false);

    const { isListening, toggleListening } = useVoiceInput({
        onTranscript: (text) => setInput(text),
    });

    const { activeGoalId, goals, tasks, messages, isLoadingMessages, fetchMessages, sendMessage, isSidebarOpen, toggleSidebar, setActiveView } = useStore();
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const goal = goals.find(g => g.id === activeGoalId);

    useEffect(() => {
        if (activeGoalId) fetchMessages(activeGoalId);
    }, [activeGoalId, fetchMessages]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isTyping]);

    useEffect(() => {
        hasScheduledRef.current = false;
        setScheduleResult(null);
        setScheduleBannerDismissed(false);
    }, [activeGoalId]);

    const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInput(e.target.value);
        const el = e.target;
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 160) + 'px';
    }, []);

    const doSend = async (text: string) => {
        if (!text.trim() || !activeGoalId || isTyping) return;
        setIsTyping(true);
        try {
            await sendMessage(activeGoalId, text.trim());
            // Trigger scheduling once after the first task batch is created
            if (!hasScheduledRef.current && useStore.getState().tasks.filter(t => t.goal_id === activeGoalId).length > 0) {
                hasScheduledRef.current = true;
                try {
                    const result = await invoke<ScheduleResult>('schedule_goal', { goalId: activeGoalId });
                    setScheduleResult(result);
                } catch (err) {
                    console.error('Scheduling failed:', err);
                }
            }
        } finally {
            setIsTyping(false);
        }
    };

    const handleSend = () => {
        const msg = input.trim();
        if (!msg) return;
        setInput('');
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
        doSend(msg);
    };

    const taskCount = tasks.filter(t => t.status !== 'completed').length;

    return (
        <div className="flex flex-1 h-full overflow-hidden">
            <div className="flex flex-col flex-1 h-full overflow-hidden">

                {/* Toolbar */}
                <div className={clsx('shrink-0 h-[76px] pt-4 flex items-center justify-between px-5 border-b border-black/8 bg-white/60 backdrop-blur-sm', !isSidebarOpen && 'pl-20')}>
                    <div className="flex items-center gap-3 pointer-events-auto no-drag">
                        <button onClick={toggleSidebar} className="p-2 rounded-full hover:bg-black/5 text-black/40 hover:text-black/70 transition-colors">
                            <PanelLeft className="w-4 h-4" />
                        </button>
                        <div>
                            <h1 className="text-[14px] font-semibold text-[#1C1C1E] leading-tight truncate max-w-[300px]">{goal?.title ?? 'Project'}</h1>
                            {isTyping
                                ? <p className="text-[11px] text-[#4D5AE8] flex items-center gap-1">
                                    <span className="inline-block w-1.5 h-1.5 bg-[#4D5AE8] rounded-full animate-pulse" />
                                    Thinking…
                                  </p>
                                : <p className="text-[11px] text-black/40">Chief of Staff</p>
                            }
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={() => setActiveView('new_project')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#4D5AE8] hover:bg-[#4048C9] text-white text-[12px] font-semibold shadow-sm transition-colors">
                            <Plus className="w-3.5 h-3.5" />New Goal
                        </button>
                        <button
                            onClick={() => setShowTasks(v => !v)}
                            className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors', showTasks ? 'bg-[#1C1C1E] text-white border-transparent' : 'bg-white border-black/10 text-black/70 hover:bg-black/5')}
                        >
                            <ListTodo className="w-3.5 h-3.5" />
                            Tasks{taskCount > 0 && <span className={clsx('ml-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full', showTasks ? 'bg-white/20 text-white' : 'bg-[#4D5AE8]/20 text-[#3B44A8]')}>{taskCount}</span>}
                        </button>
                        <SettingsDropdown />
                    </div>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto">
                    <div className="max-w-[720px] mx-auto px-6 py-8 flex flex-col gap-6">
                        {/* Loading skeleton while fetching initial messages */}
                        {isLoadingMessages && messages.length === 0 && (
                            <div className="flex flex-col gap-6 py-4">
                                {[120, 80, 200].map((w, i) => (
                                    <div key={i} className="flex gap-3">
                                        <div className="w-8 h-8 rounded-full bg-black/8 shrink-0 animate-pulse" />
                                        <div className="flex flex-col gap-2 flex-1">
                                            <div className="h-4 rounded-lg bg-black/8 animate-pulse" style={{ width: `${w}px` }} />
                                            {w > 100 && <div className="h-4 rounded-lg bg-black/6 animate-pulse" style={{ width: `${w - 40}px` }} />}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {messages.length === 0 && !isTyping && !isLoadingMessages && (
                            <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
                                <div className="w-14 h-14 rounded-full bg-[#4D5AE8]/10 border border-[#4D5AE8]/30 flex items-center justify-center">
                                    <Bot className="w-7 h-7 text-[#4D5AE8]" />
                                </div>
                                <div>
                                    <p className="text-[15px] font-semibold text-[#1C1C1E]">Chief of Staff ready</p>
                                    <p className="text-[13px] text-black/40 mt-1">Tell me what you want to accomplish.</p>
                                </div>
                            </div>
                        )}

                        {scheduleResult?.infeasible && !scheduleBannerDismissed && (
                            <div className="mx-6 mt-4 flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-sm">
                                <span className="text-amber-800">
                                    ⚠️ Not enough free time before your deadline.
                                    {scheduleResult.suggested_deadline && (
                                        <> Earliest completion: <strong>{scheduleResult.suggested_deadline}</strong>.</>
                                    )}
                                </span>
                                <button
                                    onClick={() => setScheduleBannerDismissed(true)}
                                    className="shrink-0 text-amber-600 hover:text-amber-800 font-medium transition-colors"
                                >
                                    Dismiss
                                </button>
                            </div>
                        )}

                        {messages.map((msg) => (
                            <div key={msg.id} className={clsx('flex gap-3', msg.role === 'user' ? 'flex-row-reverse' : 'flex-row')}>
                                <div className={clsx('w-8 h-8 rounded-full shrink-0 flex items-center justify-center mt-0.5', msg.role === 'user' ? 'bg-[#1C1C1E] text-white' : 'bg-[#4D5AE8]/10 border border-[#4D5AE8]/30')}>
                                    {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4 text-[#4D5AE8]" />}
                                </div>
                                <div className={clsx(
                                    'rounded-2xl px-4 py-3 text-[14px] leading-relaxed',
                                    msg.role === 'user'
                                        ? 'max-w-[75%] bg-[#1C1C1E] text-white rounded-tr-sm'
                                        : 'flex-1 bg-white border border-black/8 text-[#1C1C1E] rounded-tl-sm shadow-sm'
                                )}>
                                    {msg.role === 'assistant'
                                        ? <AIMessageContent content={msg.content} onSelect={doSend} />
                                        : <p className="whitespace-pre-wrap">{msg.content}</p>
                                    }
                                </div>
                            </div>
                        ))}

                        {isTyping && (
                            <div className="flex gap-3">
                                <div className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center bg-[#4D5AE8]/10 border border-[#4D5AE8]/30">
                                    <Bot className="w-4 h-4 text-[#4D5AE8]" />
                                </div>
                                <div className="bg-white border border-black/8 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-2 h-2 bg-black/30 rounded-full animate-bounce [animation-delay:-0.3s]" />
                                        <div className="w-2 h-2 bg-black/30 rounded-full animate-bounce [animation-delay:-0.15s]" />
                                        <div className="w-2 h-2 bg-black/30 rounded-full animate-bounce" />
                                    </div>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>
                </div>

                {/* Input Bar */}
                <div className="shrink-0 px-6 py-4 border-t border-black/8 bg-white/80 backdrop-blur-sm">
                    <div className="max-w-[720px] mx-auto">
                        <motion.div layoutId="chat-input-bar" className="flex items-end gap-3 bg-white border border-black/12 rounded-2xl px-4 py-3 shadow-[0_8px_30px_rgba(0,0,0,0.06)] focus-within:border-[#4D5AE8] focus-within:ring-2 focus-within:ring-[#4D5AE8]/20 transition-all">
                            <button type="button" className="shrink-0 p-1.5 rounded-full hover:bg-black/5 text-black/40 hover:text-[#1C1C1E] transition-colors mb-0.5">
                                <Paperclip className="w-5 h-5" />
                            </button>
                            <textarea
                                ref={textareaRef}
                                value={input}
                                onChange={handleInput}
                                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                                placeholder="Message Chief of Staff..."
                                rows={1}
                                className="flex-1 bg-transparent text-[14px] text-[#1C1C1E] placeholder-black/30 outline-none resize-none leading-relaxed min-h-[24px] py-1.5"
                                style={{ height: 'auto' }}
                                disabled={isTyping}
                            />
                            {input.trim() ? (
                                <button onClick={handleSend} disabled={isTyping} className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-[#1C1C1E] hover:bg-black disabled:opacity-30 transition-all mb-0.5">
                                    {isTyping ? <Loader2 className="w-4 h-4 text-white animate-spin" /> : <Send className="w-3.5 h-3.5 text-white ml-0.5" />}
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    onClick={toggleListening}
                                    className={clsx(
                                        'shrink-0 p-1.5 rounded-full transition-colors mb-0.5',
                                        isListening
                                            ? 'text-[#4D5AE8] bg-[#4D5AE8]/10 animate-pulse'
                                            : 'text-black/40 hover:text-[#1C1C1E] hover:bg-black/5'
                                    )}
                                    title={isListening ? 'Stop listening' : 'Voice input'}
                                >
                                    <Mic className="w-5 h-5" />
                                </button>
                            )}
                        </motion.div>
                        <p className="text-center text-[10px] text-black/25 mt-2">Enter to send · Shift+Enter for new line</p>
                    </div>
                </div>
            </div>

            {showTasks && <TaskPanel onClose={() => setShowTasks(false)} />}
        </div>
    );
}
