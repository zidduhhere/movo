import { useEffect, useRef, useCallback } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ArrowUp, Mic, MicOff, Loader2, Bot, User } from 'lucide-react';
import { setLiquidGlassEffect, GlassMaterialVariant } from 'tauri-plugin-liquid-glass-api';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { useStore } from '../store';
import { InteractiveQuestion } from './InteractiveQuestion';
import { parseAIMessage } from '../utils/messageParser';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const PROSE = 'prose prose-sm max-w-none text-white/90 prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-a:text-[#4D5AE8] prose-strong:text-white';

// Hide popup when it loses focus (user clicked elsewhere), unless we're loading
let _isLoading = false;
getCurrentWindow().onFocusChanged(({ payload: focused }) => {
    if (!focused && !_isLoading) getCurrentWindow().hide();
});

function TrayAIContent({ content, onSelect }: { content: string; onSelect: (val: string) => void }) {
    const parsed = parseAIMessage(content);
    if (parsed.type === 'interactive_question') {
        return (
            <div className="flex flex-col gap-2">
                {parsed.prefix && <div className={PROSE}><ReactMarkdown remarkPlugins={[remarkGfm]}>{parsed.prefix}</ReactMarkdown></div>}
                <InteractiveQuestion question={parsed.question} options={parsed.options} onSelect={onSelect} />
            </div>
        );
    }
    return <div className={PROSE}><ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown></div>;
}

export function TrayPopup() {
    const inputRef = useRef<HTMLInputElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const { globalMessages, sendGlobalMessage, isLoading, fetchGlobalMessages, preferences } = useStore();

    const { transcript, setTranscript, isListening, micError, toggleListening, stopListening } = useVoiceInput();

    // Apply glass effect and load messages on mount
    useEffect(() => {
        setLiquidGlassEffect({ variant: GlassMaterialVariant.Clear, cornerRadius: 16 }).catch(console.error);
        fetchGlobalMessages();
        const t = setTimeout(() => inputRef.current?.focus(), 100);
        return () => clearTimeout(t);
    }, []);

    // Sync the module-level flag so the focus handler doesn't dismiss during AI response
    useEffect(() => { _isLoading = isLoading; }, [isLoading]);

    // Scroll to bottom when messages change
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [globalMessages, isLoading]);

    // Refocus input after the AI finishes responding
    useEffect(() => {
        if (!isLoading) {
            inputRef.current?.focus();
        }
    }, [isLoading]);

    const handleSubmit = useCallback(async (e?: React.FormEvent) => {
        e?.preventDefault();
        const text = transcript.trim();
        if (!text || isLoading) return;

        stopListening();
        setTranscript('');
        await sendGlobalMessage(text);
    }, [transcript, isLoading, stopListening, setTranscript, sendGlobalMessage]);

    const handleOptionSelect = useCallback(async (option: string) => {
        if (isLoading) return;
        await sendGlobalMessage(option);
    }, [isLoading, sendGlobalMessage]);

    const canSubmit = transcript.trim().length > 0 && !isLoading;

    // Show only the last few messages in the compact popup
    const recentMessages = globalMessages.slice(-6);

    return (
        <div
            className="flex flex-col h-screen text-white rounded-2xl overflow-hidden font-sans"
            style={{ background: '#1c1c1e', boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08)' }}
        >
            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/8 shrink-0" data-tauri-drag-region>
                <img src="/logo.png" alt="Movo" className="w-5 h-5 object-contain" />
                <span className="text-[13px] font-semibold text-white/80">Movo</span>
                {isLoading && (
                    <span className="text-[11px] text-[#4D5AE8] flex items-center gap-1 ml-auto">
                        <span className="inline-block w-1.5 h-1.5 bg-[#4D5AE8] rounded-full animate-pulse" />
                        Thinking…
                    </span>
                )}
            </div>

            {/* Messages area */}
            <div className="flex-1 overflow-y-auto px-3 py-3">
                <div className="flex flex-col gap-3">
                    {recentMessages.length === 0 && !isLoading && (
                        <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
                            <div className="w-10 h-10 rounded-full bg-[#4D5AE8]/10 border border-[#4D5AE8]/30 flex items-center justify-center">
                                <Bot className="w-5 h-5 text-[#4D5AE8]" />
                            </div>
                            <p className="text-[12px] text-white/40">Ask me anything — I'll help you plan and execute.</p>
                        </div>
                    )}

                    {recentMessages.map((msg) => (
                        <div key={msg.id} className={`flex gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                            <div className={`w-6 h-6 rounded-full shrink-0 flex items-center justify-center mt-0.5 ${msg.role === 'user' ? 'bg-white/15' : 'bg-[#4D5AE8]/15 border border-[#4D5AE8]/30'}`}>
                                {msg.role === 'user' ? <User className="w-3 h-3 text-white/80" /> : <Bot className="w-3 h-3 text-[#4D5AE8]" />}
                            </div>
                            <div className={`rounded-xl px-3 py-2 text-[13px] leading-relaxed ${
                                msg.role === 'user'
                                    ? 'max-w-[80%] bg-white/15 text-white rounded-tr-sm'
                                    : 'flex-1 bg-white/8 border border-white/8 text-white/90 rounded-tl-sm'
                            }`}>
                                {msg.role === 'assistant'
                                    ? <TrayAIContent content={msg.content} onSelect={handleOptionSelect} />
                                    : <p className="whitespace-pre-wrap">{msg.content}</p>
                                }
                            </div>
                        </div>
                    ))}

                    {isLoading && (
                        <div className="flex gap-2">
                            <div className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center bg-[#4D5AE8]/15 border border-[#4D5AE8]/30">
                                <Bot className="w-3 h-3 text-[#4D5AE8]" />
                            </div>
                            <div className="bg-white/8 border border-white/8 rounded-xl rounded-tl-sm px-3 py-2">
                                <div className="flex items-center gap-1">
                                    <div className="w-1.5 h-1.5 bg-white/30 rounded-full animate-bounce [animation-delay:-0.3s]" />
                                    <div className="w-1.5 h-1.5 bg-white/30 rounded-full animate-bounce [animation-delay:-0.15s]" />
                                    <div className="w-1.5 h-1.5 bg-white/30 rounded-full animate-bounce" />
                                </div>
                            </div>
                        </div>
                    )}

                    <div ref={messagesEndRef} />
                </div>
            </div>

            {/* Input bar */}
            <form onSubmit={handleSubmit} className="shrink-0 flex items-center gap-2 px-3 py-3 border-t border-white/8">
                <input
                    ref={inputRef}
                    type="text"
                    value={transcript}
                    onChange={(e) => setTranscript(e.target.value)}
                    placeholder={isListening ? 'Listening…' : isLoading ? 'Thinking…' : 'What can I help you with?'}
                    disabled={isLoading}
                    className="flex-1 bg-white/8 border border-white/10 rounded-xl px-3 py-2.5 text-[14px] text-white placeholder-white/30 outline-none focus:border-[#4D5AE8]/50 focus:ring-1 focus:ring-[#4D5AE8]/20 transition-all disabled:opacity-50"
                />

                {/* Mic button */}
                {preferences?.voice_input_enabled !== false && (
                <button
                    type="button"
                    onClick={toggleListening}
                    disabled={isLoading}
                    title={micError ?? (isListening ? 'Stop listening' : 'Voice input')}
                    className={`shrink-0 p-2 rounded-lg transition-colors disabled:opacity-40 ${
                        micError
                            ? 'text-red-400'
                            : isListening
                            ? 'text-[#4D5AE8] bg-[#4D5AE8]/10 animate-pulse'
                            : 'text-white/40 hover:text-white/80'
                    }`}
                >
                    {micError ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>
                )}

                {/* Send button */}
                <button
                    type="submit"
                    disabled={!canSubmit}
                    className="w-8 h-8 rounded-lg bg-[#4D5AE8] hover:bg-[#4048C9] disabled:opacity-40 disabled:hover:bg-[#4D5AE8] flex items-center justify-center shrink-0 shadow-sm transition-all"
                >
                    {isLoading ? (
                        <Loader2 className="w-4 h-4 text-[#1c1c1e] animate-spin" />
                    ) : (
                        <ArrowUp className="w-5 h-5 text-[#1c1c1e] stroke-[2.5]" />
                    )}
                </button>
            </form>
        </div>
    );
}
