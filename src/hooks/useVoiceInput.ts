import { useState, useRef, useCallback } from 'react';

interface UseVoiceInputOptions {
    onTranscript?: (text: string) => void;
}

export function useVoiceInput({ onTranscript }: UseVoiceInputOptions = {}) {
    const [transcript, setTranscript] = useState('');
    const [isListening, setIsListening] = useState(false);
    const [micError, setMicError] = useState<string | null>(null);
    const recognitionRef = useRef<SpeechRecognition | null>(null);

    const startListening = useCallback(() => {
        const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SR) {
            setMicError('Speech recognition not available.');
            return;
        }

        const recognition: SpeechRecognition = new SR();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event: SpeechRecognitionEvent) => {
            let full = '';
            for (let i = 0; i < event.results.length; i++) {
                full += event.results[i][0].transcript;
            }
            setTranscript(full);
            onTranscript?.(full);
        };

        recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
            if (event.error === 'not-allowed') {
                setMicError('Microphone access denied.');
            } else {
                setMicError('Could not start microphone.');
            }
            setIsListening(false);
        };

        recognition.onend = () => setIsListening(false);

        recognitionRef.current = recognition;
        try {
            recognition.start();
            setIsListening(true);
            setMicError(null);
        } catch {
            setMicError('Could not start microphone.');
        }
    }, [onTranscript]);

    const stopListening = useCallback(() => {
        recognitionRef.current?.stop();
        setIsListening(false);
    }, []);

    const toggleListening = useCallback(() => {
        if (isListening) {
            stopListening();
        } else {
            startListening();
        }
    }, [isListening, startListening, stopListening]);

    const reset = useCallback(() => {
        stopListening();
        setTranscript('');
        setMicError(null);
    }, [stopListening]);

    return { transcript, setTranscript, isListening, micError, startListening, stopListening, toggleListening, reset };
}
