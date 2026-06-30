import { useState, useRef, useEffect, useCallback } from 'react';
import { Bot, User, Send, Loader2, X } from 'lucide-react';
import { useStore } from '../store';
import clsx from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const PROSE = 'prose prose-sm max-w-none text-[#1C1C1E] prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-a:text-[#4D5AE8]';

interface Props {
    taskId: string;
    taskTitle: string;
    onClose: () => void;
}

export function TaskChatPanel({ taskId, taskTitle, onClose }: Props) {
    const [input, setInput] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const { taskMessages, sendTaskMessage, isLoading } = useStore();
    const messages = taskMessages[taskId] ?? [];

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isLoading]);

    const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInput(e.target.value);
        const el = e.target;
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    }, []);

    const handleSend = async () => {
        const msg = input.trim();
        if (!msg || isLoading) return;
        setInput('');
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
        await sendTaskMessage(taskId, msg);
    };

    return (
        <div className="w-80 h-full flex flex-col border-l border-black/8 bg-white/90 backdrop-blur-sm">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-black/8 shrink-0">
                <div className="flex-1 min-w-0 pr-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-black/40">Task Chat</p>
                    <p className="text-[13px] font-semibold text-[#1C1C1E] truncate">{taskTitle}</p>
                </div>
                <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-black/5 text-black/40 hover:text-black/70 transition-colors shrink-0">
                    <X className="w-4 h-4" />
                </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-3 py-4">
                <div className="flex flex-col gap-4">
                    {messages.length === 0 && !isLoading && (
                        <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-[#4D5AE8]/10 border border-[#4D5AE8]/30 flex items-center justify-center">
                                <Bot className="w-5 h-5 text-[#4D5AE8]" />
                            </div>
                            <p className="text-[12px] text-black/40">Ask me anything about this task — reschedule, split it, or mark it done.</p>
                        </div>
                    )}

                    {messages.map((msg) => (
                        <div key={msg.id} className={clsx('flex gap-2', msg.role === 'user' ? 'flex-row-reverse' : 'flex-row')}>
                            <div className={clsx('w-6 h-6 rounded-full shrink-0 flex items-center justify-center mt-0.5', msg.role === 'user' ? 'bg-[#1C1C1E] text-white' : 'bg-[#4D5AE8]/10 border border-[#4D5AE8]/30')}>
                                {msg.role === 'user' ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3 text-[#4D5AE8]" />}
                            </div>
                            <div className={clsx(
                                'rounded-xl px-3 py-2 text-[13px] leading-relaxed',
                                msg.role === 'user'
                                    ? 'max-w-[85%] bg-[#1C1C1E] text-white rounded-tr-sm'
                                    : 'flex-1 bg-white border border-black/8 text-[#1C1C1E] rounded-tl-sm shadow-sm'
                            )}>
                                {msg.role === 'assistant'
                                    ? <div className={PROSE}><ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown></div>
                                    : <p className="whitespace-pre-wrap">{msg.content}</p>
                                }
                            </div>
                        </div>
                    ))}

                    {isLoading && (
                        <div className="flex gap-2">
                            <div className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center bg-[#4D5AE8]/10 border border-[#4D5AE8]/30">
                                <Bot className="w-3 h-3 text-[#4D5AE8]" />
                            </div>
                            <div className="bg-white border border-black/8 rounded-xl rounded-tl-sm px-3 py-2 shadow-sm">
                                <div className="flex items-center gap-1">
                                    <div className="w-1.5 h-1.5 bg-black/30 rounded-full animate-bounce [animation-delay:-0.3s]" />
                                    <div className="w-1.5 h-1.5 bg-black/30 rounded-full animate-bounce [animation-delay:-0.15s]" />
                                    <div className="w-1.5 h-1.5 bg-black/30 rounded-full animate-bounce" />
                                </div>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>
            </div>

            {/* Input */}
            <div className="shrink-0 px-3 py-3 border-t border-black/8">
                <div className="flex items-end gap-2 bg-white border border-black/12 rounded-xl px-3 py-2 shadow-sm focus-within:border-[#4D5AE8] focus-within:ring-1 focus-within:ring-[#4D5AE8]/20 transition-all">
                    <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={handleInput}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                        placeholder="Ask about this task…"
                        rows={1}
                        className="flex-1 bg-transparent text-[13px] text-[#1C1C1E] placeholder-black/30 outline-none resize-none leading-relaxed min-h-[20px] py-0.5"
                        style={{ height: 'auto' }}
                        disabled={isLoading}
                    />
                    <button onClick={handleSend} disabled={!input.trim() || isLoading} className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-[#1C1C1E] hover:bg-black disabled:opacity-30 transition-all mb-0.5">
                        {isLoading ? <Loader2 className="w-3.5 h-3.5 text-white animate-spin" /> : <Send className="w-3 h-3 text-white ml-0.5" />}
                    </button>
                </div>
            </div>
        </div>
    );
}
