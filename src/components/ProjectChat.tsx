import { useState, useRef, useEffect, ReactNode } from 'react';
import { Send, Bot, Paperclip, Mic } from 'lucide-react';
import { useStore } from '../store';
import clsx from 'clsx';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { parseAIMessage } from '../utils/messageParser';
import { InteractiveQuestion } from './InteractiveQuestion';

export function ProjectChat({ children }: { children?: ReactNode }) {
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);

    const { activeGoalId, messages, fetchMessages, sendMessage, planStarted, clearPlanStarted } = useStore();
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (planStarted && activeGoalId) {
            clearPlanStarted();
            fetchMessages(activeGoalId);
        }
    }, [planStarted, activeGoalId, clearPlanStarted, fetchMessages]);

    useEffect(() => {
        if (activeGoalId) fetchMessages(activeGoalId);
    }, [activeGoalId, fetchMessages]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isTyping]);

    if (!activeGoalId) return null;

    const doSend = async (text: string) => {
        if (!text.trim() || !activeGoalId || isTyping) return;
        setIsTyping(true);
        try {
            await sendMessage(activeGoalId, text.trim());
        } finally {
            setIsTyping(false);
        }
    };

    const handleSend = async () => {
        const msg = input.trim();
        setInput('');
        await doSend(msg);
    };

    return (
        <div className="flex-1 w-full h-full flex flex-col relative bg-[#FAFAFA]">
            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto px-8 pt-20 pb-36 flex flex-col items-center">
                {children}

                <div className="w-full max-w-3xl flex flex-col space-y-6 mt-8">
                    {messages.length === 0 && (
                        <div className="text-center text-gray-400 text-sm py-10">
                            Your AI Chief of Staff is ready — ask anything about this goal.
                        </div>
                    )}

                    {messages.map((msg) => {
                        if (msg.role === 'assistant') {
                            const parsed = parseAIMessage(msg.content);
                            const isInteractive = parsed.type === 'interactive_question';

                            return (
                                <div key={msg.id} className={clsx('flex flex-col self-start', isInteractive ? 'w-full max-w-[600px]' : 'max-w-[85%] items-start')}>
                                    <div className="flex items-center gap-2 mb-2 text-[#4D5AE8]">
                                        <Bot className="w-4 h-4" />
                                        <span className="font-semibold text-xs text-gray-500 uppercase tracking-wider">Chief of Staff</span>
                                    </div>
                                    <div className={clsx(
                                        'rounded-2xl px-5 py-4 text-[15px] leading-relaxed w-full',
                                        'bg-white text-gray-800 rounded-bl-sm border border-gray-200 shadow-sm',
                                        !isInteractive && 'prose prose-sm max-w-none prose-p:my-1 prose-a:text-[#4D5AE8]'
                                    )}>
                                        {isInteractive ? (
                                            <InteractiveQuestion
                                                question={parsed.question}
                                                options={parsed.options}
                                                prefix={parsed.prefix}
                                                onSelect={(opt) => doSend(opt)}
                                            />
                                        ) : (
                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                {msg.content}
                                            </ReactMarkdown>
                                        )}
                                    </div>
                                </div>
                            );
                        }

                        return (
                            <div key={msg.id} className="flex flex-col self-end items-end max-w-[85%]">
                                <div className="rounded-2xl px-5 py-3.5 text-[15px] leading-relaxed bg-gray-100 text-gray-800 rounded-br-sm">
                                    <div className="whitespace-pre-wrap">{msg.content}</div>
                                </div>
                            </div>
                        );
                    })}

                    {isTyping && (
                        <div className="flex flex-col self-start max-w-[85%]">
                            <div className="flex items-center gap-2 mb-2 text-[#4D5AE8]">
                                <Bot className="w-4 h-4" />
                                <span className="font-semibold text-xs text-gray-500 uppercase tracking-wider">Chief of Staff</span>
                            </div>
                            <div className="flex self-start gap-1.5 p-4 bg-white rounded-2xl rounded-bl-sm border border-gray-200 shadow-sm">
                                <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce [animation-delay:-0.3s]" />
                                <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce [animation-delay:-0.15s]" />
                                <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" />
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} className="h-4" />
                </div>
            </div>

            {/* Bottom Fixed Input Box */}
            <div className="absolute bottom-0 left-0 right-0 p-8 pt-4 bg-gradient-to-t from-[#FAFAFA] via-[#FAFAFA]/90 to-transparent flex justify-center pointer-events-none">
                <motion.div
                    layoutId="chat-input-bar"
                    className="relative flex items-center gap-3 w-full max-w-[700px] bg-white border border-[#E5E5EA] rounded-full px-5 py-3.5 shadow-[0_8px_30px_rgba(0,0,0,0.06)] focus-within:border-[#4D5AE8] focus-within:ring-2 focus-within:ring-[#4D5AE8]/20 transition-all pointer-events-auto"
                >
                    <button type="button" className="p-1.5 rounded-full hover:bg-black/5 text-[#8E8E93] hover:text-[#1C1C1E] transition-colors focus:outline-none">
                        <Paperclip className="w-5 h-5" />
                    </button>

                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                        placeholder="Ask AI to update tasks, brainstorm ideas..."
                        className="flex-1 bg-transparent border-none outline-none text-[15px] text-[#2D2D2D] placeholder-[#A0A0A0]"
                        autoFocus
                    />

                    {input.trim() ? (
                        <button
                            onClick={handleSend}
                            disabled={isTyping}
                            className="p-1.5 bg-[#4D5AE8] text-white rounded-full hover:bg-[#4048C9] disabled:opacity-50 transition-colors shadow-sm focus:outline-none"
                        >
                            <Send className="w-4 h-4 ml-0.5" />
                        </button>
                    ) : (
                        <button type="button" className="p-1.5 rounded-full hover:bg-black/5 text-[#8E8E93] hover:text-[#1C1C1E] transition-colors focus:outline-none">
                            <Mic className="w-5 h-5" />
                        </button>
                    )}
                </motion.div>
            </div>
        </div>
    );
}
