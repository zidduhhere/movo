import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Mic, MicOff, Send, Loader2 } from 'lucide-react';

declare global {
    interface SpeechRecognition extends EventTarget {
        continuous: boolean;
        interimResults: boolean;
        lang: string;
        onresult: ((event: SpeechRecognitionEvent) => void) | null;
        onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
        onend: (() => void) | null;
        start(): void;
        stop(): void;
        abort(): void;
    }

    interface SpeechRecognitionEvent extends Event {
        readonly results: SpeechRecognitionResultList;
        readonly resultIndex: number;
    }

    interface SpeechRecognitionErrorEvent extends Event {
        readonly error: string;
        readonly message: string;
    }

    interface Window {
        SpeechRecognition: new () => SpeechRecognition;
        webkitSpeechRecognition: new () => SpeechRecognition;
    }
}

export function VoicePopup() {
    const [transcript, setTranscript] = useState('');
    const [isListening, setIsListening] = useState(false);
    const [isPlanning, setIsPlanning] = useState(false);
    const isPlanningRef = useRef(false);
    const [micError, setMicError] = useState<string | null>(null);
    const recognitionRef = useRef<SpeechRecognition | null>(null);
    const win = getCurrentWindow();

    useEffect(() => {
        // Start listening when the window actually becomes visible/focused.
        // Do NOT call startListening() here — Tauri loads all windows at startup
        // (even hidden ones), so mounting triggers the OS speech-recognition TCC
        // check and crashes the process before the user ever sees the popup.
        const unlistenPromise = win.onFocusChanged(({ payload: focused }) => {
            if (focused) {
                startListening();
            } else if (!isPlanningRef.current) {
                recognitionRef.current?.stop();
                win.hide();
            }
        });

        return () => {
            unlistenPromise.then((fn) => fn());
            recognitionRef.current?.stop();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function startListening() {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) {
            setMicError('Speech recognition not available in this browser.');
            return;
        }

        const recognition = new SR();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event: SpeechRecognitionEvent) => {
            let fullTranscript = '';
            for (let i = 0; i < event.results.length; i++) {
                fullTranscript += event.results[i][0].transcript;
            }
            setTranscript(fullTranscript);
        };

        recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
            if (event.error === 'not-allowed') {
                setMicError('Microphone access denied.');
                setIsListening(false);
            }
        };

        recognition.onend = () => {
            setIsListening(false);
        };

        recognitionRef.current = recognition;

        try {
            recognition.start();
            setIsListening(true);
            setMicError(null);
        } catch {
            setMicError('Could not start microphone.');
        }
    }

    async function handlePlan() {
        const text = transcript.trim();
        if (!text) return;

        recognitionRef.current?.stop();
        setIsPlanning(true);
        isPlanningRef.current = true;

        try {
            await invoke('voice_capture_plan', { text });
            setTranscript('');
            win.hide();
        } catch (err) {
            console.error('Planning failed:', err);
        } finally {
            setIsPlanning(false);
            isPlanningRef.current = false;
        }
    }

    async function handleOpenSettings() {
        await invoke('open_mic_settings');
    }

    function handleKeyDown(e: React.KeyboardEvent) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handlePlan();
        }
        if (e.key === 'Escape') {
            win.hide();
        }
    }

    return (
        <div
            className="w-full h-full flex items-center gap-3 px-4 bg-white/80 backdrop-blur-2xl rounded-2xl shadow-2xl border border-white/60"
            onKeyDown={handleKeyDown}
            tabIndex={-1}
        >
            {/* Mic icon */}
            <div className="shrink-0">
                {micError ? (
                    <MicOff className="w-5 h-5 text-red-400" />
                ) : isListening ? (
                    <Mic className="w-5 h-5 text-[#4D5AE8] animate-pulse" />
                ) : (
                    <Mic className="w-5 h-5 text-gray-400" />
                )}
            </div>

            {/* Input / transcript */}
            <div className="flex-1 min-w-0">
                {micError ? (
                    <div className="flex flex-col gap-1">
                        <span className="text-[12px] text-red-500">{micError}</span>
                        <button
                            onClick={handleOpenSettings}
                            className="text-[11px] text-[#4D5AE8] underline text-left"
                        >
                            Open Microphone Settings →
                        </button>
                    </div>
                ) : (
                    <input
                        autoFocus
                        type="text"
                        value={transcript}
                        onChange={(e) => setTranscript(e.target.value)}
                        placeholder={isListening ? 'Listening…' : 'Type or speak your goal…'}
                        className="w-full bg-transparent text-[14px] text-gray-800 placeholder:text-gray-400 outline-none"
                    />
                )}
            </div>

            {/* Waveform animation while listening */}
            {isListening && !micError && (
                <div className="shrink-0 flex items-center gap-[2px] h-5">
                    {[0, 1, 2, 3, 4].map((i) => (
                        <div
                            key={i}
                            className="w-[3px] bg-[#4D5AE8] rounded-full animate-bounce"
                            style={{
                                height: `${8 + (i % 3) * 4}px`,
                                animationDelay: `${i * 0.1}s`,
                                animationDuration: '0.6s',
                            }}
                        />
                    ))}
                </div>
            )}

            {/* Plan button */}
            <button
                onClick={handlePlan}
                disabled={!transcript.trim() || isPlanning}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-[#4D5AE8] text-white text-[13px] font-medium rounded-xl hover:bg-[#4048C9] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
                {isPlanning ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                    <Send className="w-3.5 h-3.5" />
                )}
                Plan it
            </button>
        </div>
    );
}
