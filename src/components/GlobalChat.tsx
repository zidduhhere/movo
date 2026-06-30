import { useState, useRef, useEffect, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Bot, User, Send, Loader2, Mic } from 'lucide-react';
import { useStore } from '../store';
import { SettingsDropdown } from './SettingsDropdown';
import { InteractiveQuestion } from './InteractiveQuestion';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { parseAIMessage } from '../utils/messageParser';
import clsx from 'clsx';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const PROSE = 'prose prose-sm max-w-none text-[#1C1C1E] prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-a:text-[#85D24E]';

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

export function GlobalChat() {
    const [input, setInput] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const { globalMessages, sendGlobalMessage, isLoading, isSidebarOpen, fetchGoals } = useStore();

    const { isListening, toggleListening } = useVoiceInput({
        onTranscript: (text) => setInput(text),
    });

    useEffect(() => {
        const unlisten = listen('goal_created', () => {
            fetchGoals();
        });
        return () => { unlisten.then((fn) => fn()); };
    }, [fetchGoals]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [globalMessages, isLoading]);

    const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInput(e.target.value);
        const el = e.target;
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 160) + 'px';
    }, []);

    const handleSend = useCallback(async (text?: string) => {
        const msg = (text ?? input).trim();
        if (!msg || isLoading) return;
        setInput('');
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
        await sendGlobalMessage(msg);
    }, [input, isLoading, sendGlobalMessage]);

    return (
        <div className="flex flex-col flex-1 h-full overflow-hidden">
            {/* Toolbar */}
            <div className={clsx('shrink-0 h-[76px] pt-4 flex items-center justify-between px-5 border-b border-black/8 bg-white/60 backdrop-blur-sm', !isSidebarOpen && 'pl-20')}>
                <div className="flex items-center gap-3 pointer-events-auto no-drag">
                    <div>
                        <h1 className="text-[14px] font-semibold text-[#1C1C1E] leading-tight">Movo</h1>
                        {isLoading
                            ? <p className="text-[11px] text-[#85D24E] flex items-center gap-1">
                                <span className="inline-block w-1.5 h-1.5 bg-[#85D24E] rounded-full animate-pulse" />
                                Thinking…
                              </p>
                            : <p className="text-[11px] text-black/40">AI Chief of Staff</p>
                        }
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <SettingsDropdown />
                </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto">
                <div className="max-w-[720px] mx-auto px-6 py-8 flex flex-col gap-6">
                    {globalMessages.length === 0 && !isLoading && (
                        <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
                            <div className="w-14 h-14 rounded-full bg-[#85D24E]/10 border border-[#85D24E]/30 flex items-center justify-center">
                                <Bot className="w-7 h-7 text-[#85D24E]" />
                            </div>
                            <div>
                                <p className="text-[15px] font-semibold text-[#1C1C1E]">What are you working toward?</p>
                                <p className="text-[13px] text-black/40 mt-1">Tell me your goal and I'll help you break it down.</p>
                            </div>
                        </div>
                    )}

                    {globalMessages.map((msg) => (
                        <div key={msg.id} className={clsx('flex gap-3', msg.role === 'user' ? 'flex-row-reverse' : 'flex-row')}>
                            <div className={clsx('w-8 h-8 rounded-full shrink-0 flex items-center justify-center mt-0.5', msg.role === 'user' ? 'bg-[#1C1C1E] text-white' : 'bg-[#85D24E]/10 border border-[#85D24E]/30')}>
                                {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4 text-[#85D24E]" />}
                            </div>
                            <div className={clsx(
                                'rounded-2xl px-4 py-3 text-[14px] leading-relaxed',
                                msg.role === 'user'
                                    ? 'max-w-[75%] bg-[#1C1C1E] text-white rounded-tr-sm'
                                    : 'flex-1 bg-white border border-black/8 text-[#1C1C1E] rounded-tl-sm shadow-sm'
                            )}>
                                {msg.role === 'assistant'
                                    ? <AIMessageContent content={msg.content} onSelect={handleSend} />
                                    : <p className="whitespace-pre-wrap">{msg.content}</p>
                                }
                            </div>
                        </div>
                    ))}

                    {isLoading && (
                        <div className="flex gap-3">
                            <div className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center bg-[#85D24E]/10 border border-[#85D24E]/30">
                                <Bot className="w-4 h-4 text-[#85D24E]" />
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
                    <motion.div layoutId="global-chat-input" className="flex items-end gap-3 bg-white border border-black/12 rounded-2xl px-4 py-3 shadow-[0_8px_30px_rgba(0,0,0,0.06)] focus-within:border-[#85D24E] focus-within:ring-2 focus-within:ring-[#85D24E]/20 transition-all">
                        <textarea
                            ref={textareaRef}
                            value={input}
                            onChange={handleInput}
                            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                            placeholder="What do you want to accomplish?"
                            rows={1}
                            className="flex-1 bg-transparent text-[14px] text-[#1C1C1E] placeholder-black/30 outline-none resize-none leading-relaxed min-h-[24px] py-1.5"
                            style={{ height: 'auto' }}
                            disabled={isLoading}
                        />
                        {input.trim() ? (
                            <button onClick={() => handleSend()} disabled={isLoading} className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-[#1C1C1E] hover:bg-black disabled:opacity-30 transition-all mb-0.5">
                                {isLoading ? <Loader2 className="w-4 h-4 text-white animate-spin" /> : <Send className="w-3.5 h-3.5 text-white ml-0.5" />}
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={toggleListening}
                                className={clsx(
                                    'shrink-0 p-1.5 rounded-full transition-colors mb-0.5',
                                    isListening
                                        ? 'text-[#85D24E] bg-[#85D24E]/10 animate-pulse'
                                        : 'text-black/40 hover:text-[#1C1C1E] hover:bg-black/5'
                                )}
                            >
                                <Mic className="w-5 h-5" />
                            </button>
                        )}
                    </motion.div>
                    <p className="text-center text-[10px] text-black/25 mt-2">Enter to send · Shift+Enter for new line</p>
                </div>
            </div>
        </div>
    );
}
