import { useState, useRef, useEffect } from 'react';
import { Send, ArrowRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import clsx from 'clsx';

interface Props {
    question: string;
    options: string[];
    prefix?: string;
    onSelect: (option: string) => void;
}

function isOtherOption(opt: string) {
    return /other/i.test(opt);
}

export function InteractiveQuestion({ question, options, prefix, onSelect }: Props) {
    const [expandedOther, setExpandedOther] = useState<string | null>(null);
    const [otherText, setOtherText] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (expandedOther !== null) {
            inputRef.current?.focus();
        }
    }, [expandedOther]);

    const handleOptionClick = (opt: string) => {
        if (isOtherOption(opt)) {
            setExpandedOther(opt);
            setOtherText('');
        } else {
            onSelect(opt);
        }
    };

    const submitOther = () => {
        const val = otherText.trim();
        if (!val) return;
        onSelect(val);
        setExpandedOther(null);
        setOtherText('');
    };

    return (
        <div className="flex flex-col gap-4 mt-2 mb-2">
            {prefix && (
                <div className="prose prose-sm max-w-none prose-p:my-1 text-[#1C1C1E]">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{prefix}</ReactMarkdown>
                </div>
            )}

            <div className="text-[16px] font-semibold text-[#1C1C1E] tracking-tight">
                {question}
            </div>

            <div className="flex flex-col gap-2.5">
                {options.map((opt, i) => {
                    const isExpanded = expandedOther === opt;

                    if (isExpanded) {
                        return (
                            <div key={i} className="flex items-center gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
                                <input
                                    ref={inputRef}
                                    type="text"
                                    value={otherText}
                                    onChange={(e) => setOtherText(e.target.value)}
                                    onKeyDown={(e) => { 
                                        if (e.key === 'Enter') submitOther(); 
                                        if (e.key === 'Escape') { setExpandedOther(null); setOtherText(''); } 
                                    }}
                                    placeholder="Please describe..."
                                    className="flex-1 px-4 py-3 rounded-xl border border-[#4D5AE8]/50 bg-white text-[14px] text-[#1C1C1E] outline-none focus:border-[#4D5AE8] focus:ring-4 focus:ring-[#4D5AE8]/10 transition-all placeholder-black/30 shadow-sm"
                                />
                                <button
                                    onClick={submitOther}
                                    disabled={!otherText.trim()}
                                    className="w-11 h-11 flex items-center justify-center shrink-0 rounded-xl bg-[#4D5AE8] hover:bg-[#4048C9] disabled:opacity-40 disabled:hover:bg-[#4D5AE8] transition-colors shadow-sm"
                                >
                                    <Send className="w-4 h-4 text-white ml-0.5" />
                                </button>
                            </div>
                        );
                    }

                    return (
                        <button
                            key={i}
                            onClick={() => handleOptionClick(opt)}
                            className={clsx(
                                "group relative w-full text-left px-4 py-3.5 rounded-xl border transition-all duration-200 ease-out overflow-hidden flex items-center justify-between",
                                "bg-white border-black/8 hover:border-[#4D5AE8]/60 hover:bg-[#4D5AE8]/[0.03] hover:shadow-sm"
                            )}
                        >
                            <span className="relative z-10 text-[14px] text-[#1C1C1E]/80 font-medium group-hover:text-[#1C1C1E] group-hover:translate-x-0.5 transition-transform duration-200">
                                {opt}
                            </span>
                            
                            <ArrowRight className="w-4 h-4 text-[#4D5AE8] opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200" />
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
