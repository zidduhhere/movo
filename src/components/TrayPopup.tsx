import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { getAllWindows, getCurrentWindow } from '@tauri-apps/api/window';
import { Sparkles, ArrowUp, ChevronDown, Mic, MicOff, Loader2, Check } from 'lucide-react';
import { setLiquidGlassEffect, GlassMaterialVariant } from 'tauri-plugin-liquid-glass-api';
import { useVoiceInput } from '../hooks/useVoiceInput';

type Mode = 'new_chat' | 'plan_goal';

const MODE_LABELS: Record<Mode, string> = {
    new_chat: 'New Chat',
    plan_goal: 'Plan as Goal',
};

// Hide popup when it loses focus (user clicked elsewhere), unless we're planning
let _isPlanning = false;
getCurrentWindow().onFocusChanged(({ payload: focused }) => {
    if (!focused && !_isPlanning) getCurrentWindow().hide();
});

async function showMainWindow() {
    const windows = await getAllWindows();
    const main = windows.find(w => w.label === 'main');
    if (main) {
        await main.show();
        await main.setFocus();
    }
}

export function TrayPopup() {
    const inputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const [mode, setMode] = useState<Mode>('new_chat');
    const [showDropdown, setShowDropdown] = useState(false);
    const [showBanner, setShowBanner] = useState(true);
    const [isPlanning, setIsPlanning] = useState(false);
    const [planError, setPlanError] = useState<string | null>(null);
    const [planDone, setPlanDone] = useState(false);

    const { transcript, setTranscript, isListening, micError, toggleListening, stopListening } = useVoiceInput();

    useEffect(() => {
        setLiquidGlassEffect({ variant: GlassMaterialVariant.Clear, cornerRadius: 16 }).catch(console.error);
        const t = setTimeout(() => inputRef.current?.focus(), 100);
        return () => clearTimeout(t);
    }, []);

    // Keep module-level flag in sync so the focus-change handler can read it
    useEffect(() => { _isPlanning = isPlanning; }, [isPlanning]);

    // Close dropdown on outside click
    useEffect(() => {
        if (!showDropdown) return;
        const handler = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setShowDropdown(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [showDropdown]);

    const handleSubmit = async (e?: React.FormEvent) => {
        e?.preventDefault();
        const text = transcript.trim();
        if (!text || isPlanning) return;

        stopListening();
        setPlanError(null);

        if (mode === 'new_chat') {
            await emit('tray_quick_chat', text);
            await showMainWindow();
            await getCurrentWindow().hide();
            setTranscript('');
            return;
        }

        // plan_goal mode
        setIsPlanning(true);
        try {
            await invoke('voice_capture_plan', { text });
            setPlanDone(true);
            setTranscript('');
            // main window is shown by the backend; hide popup after brief flash
            setTimeout(() => {
                setPlanDone(false);
                getCurrentWindow().hide();
            }, 800);
        } catch (err: any) {
            setPlanError(typeof err === 'string' ? err : 'Planning failed. Make sure you are logged in.');
        } finally {
            setIsPlanning(false);
        }
    };

    const selectMode = (m: Mode) => {
        setMode(m);
        setShowDropdown(false);
        inputRef.current?.focus();
    };

    const openPrivacy = async (section: string) => {
        await invoke('open_privacy_settings', { section });
    };

    const canSubmit = transcript.trim().length > 0 && !isPlanning;

    return (
        <div
            className="flex flex-col h-screen text-white rounded-2xl overflow-hidden font-sans"
            style={{ background: '#1c1c1e', boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08)' }}
            data-tauri-drag-region
        >
            {/* Top Input Section */}
            <form onSubmit={handleSubmit} className="flex-1 flex items-center gap-3 px-5 py-4 relative" data-tauri-drag-region>
                {/* Logo */}
                <div className="shrink-0 flex items-center justify-center">
                    <Sparkles className="w-7 h-7 text-[#85D24E]" fill="currentColor" />
                </div>

                {/* Input */}
                <input
                    ref={inputRef}
                    type="text"
                    value={transcript}
                    onChange={(e) => setTranscript(e.target.value)}
                    placeholder={isListening ? 'Listening…' : isPlanning ? 'Planning…' : 'What can I help you with today?'}
                    disabled={isPlanning}
                    className="flex-1 bg-transparent border-none outline-none text-[16px] text-white placeholder-white/40 focus:ring-0 ml-1 disabled:opacity-60"
                />

                {/* Mic button */}
                <button
                    type="button"
                    onClick={toggleListening}
                    disabled={isPlanning}
                    title={micError ?? (isListening ? 'Stop listening' : 'Voice input')}
                    className={`shrink-0 p-1.5 rounded-lg transition-colors disabled:opacity-40 ${
                        micError
                            ? 'text-red-400'
                            : isListening
                            ? 'text-[#85D24E] bg-[#85D24E]/10 animate-pulse'
                            : 'text-white/40 hover:text-white/80'
                    }`}
                >
                    {micError ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>

                {/* Mode dropdown */}
                <div ref={dropdownRef} className="relative shrink-0">
                    <button
                        type="button"
                        onClick={() => setShowDropdown(v => !v)}
                        className="flex items-center gap-1.5 text-[13px] font-medium text-white/60 hover:text-white transition-colors mr-1"
                    >
                        {MODE_LABELS[mode]} <ChevronDown className={`w-4 h-4 opacity-70 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
                    </button>

                    {showDropdown && (
                        <div className="absolute right-0 bottom-full mb-2 bg-[#2c2c2e] border border-white/10 rounded-xl shadow-2xl overflow-hidden min-w-[160px] z-50">
                            {(Object.entries(MODE_LABELS) as [Mode, string][]).map(([key, label]) => (
                                <button
                                    key={key}
                                    type="button"
                                    onClick={() => selectMode(key)}
                                    className="flex items-center justify-between w-full px-4 py-2.5 text-[13px] text-white/80 hover:bg-white/5 hover:text-white transition-colors text-left"
                                >
                                    {label}
                                    {mode === key && <Check className="w-3.5 h-3.5 text-[#85D24E]" />}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Submit button */}
                <button
                    type="submit"
                    disabled={!canSubmit}
                    className="w-8 h-8 rounded-lg bg-[#85D24E] hover:bg-[#7bc248] disabled:opacity-50 disabled:hover:bg-[#85D24E] flex items-center justify-center shrink-0 shadow-sm transition-all"
                >
                    {isPlanning ? (
                        <Loader2 className="w-4 h-4 text-[#1c1c1e] animate-spin" />
                    ) : planDone ? (
                        <Check className="w-4 h-4 text-[#1c1c1e]" />
                    ) : (
                        <ArrowUp className="w-5 h-5 text-[#1c1c1e] stroke-[2.5]" />
                    )}
                </button>
            </form>

            {/* Plan error */}
            {planError && (
                <div className="px-5 py-2 bg-red-900/30 border-t border-red-500/20 text-[12px] text-red-300">
                    {planError}
                </div>
            )}

            {/* Bottom Permission Banner */}
            {showBanner && (
                <div className="flex items-center justify-between px-5 py-3.5 bg-[#252528] border-t border-white/5">
                    <div className="flex flex-col justify-center">
                        <span className="text-[13px] font-semibold text-white tracking-wide">
                            Quickly share content with Movo
                        </span>
                        <span className="text-[12px] text-white/50 mt-0.5">
                            Needs additional permission
                        </span>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => openPrivacy('Privacy_ScreenCapture')}
                            className="px-3.5 py-1.5 rounded-lg border border-white/10 bg-transparent text-[12px] font-medium text-white/90 hover:bg-white/5 hover:border-white/20 transition-all"
                        >
                            Turn on screenshots
                        </button>
                        <button
                            onClick={() => openPrivacy('Privacy_FilesAndFolders')}
                            className="px-3.5 py-1.5 rounded-lg border border-white/10 bg-transparent text-[12px] font-medium text-white/90 hover:bg-white/5 hover:border-white/20 transition-all"
                        >
                            Turn on file sharing
                        </button>
                        <button
                            onClick={() => setShowBanner(false)}
                            className="px-3.5 py-1.5 rounded-lg border border-white/10 bg-transparent text-[12px] font-medium text-white/50 hover:bg-white/5 hover:border-white/20 hover:text-white/90 transition-all"
                        >
                            Not now
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
