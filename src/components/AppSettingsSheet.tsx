import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, useState } from 'react';
import { X, User as UserIcon, Clock, Sparkles, ShieldAlert } from 'lucide-react';
import { useStore } from '../store';
import { AppSettingsDangerZone } from './AppSettingsDangerZone';

interface AppSettingsSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

type TabId = 'profile' | 'work' | 'ai' | 'danger';

const TABS: { id: TabId; label: string; icon: typeof UserIcon }[] = [
    { id: 'profile', label: 'Profile', icon: UserIcon },
    { id: 'work', label: 'Work', icon: Clock },
    { id: 'ai', label: 'AI & App', icon: Sparkles },
    { id: 'danger', label: 'Danger Zone', icon: ShieldAlert },
];

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function ProfileTab() {
    const { user, updateProfile } = useStore();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [name, setName] = useState(user?.name ?? '');
    const [avatar, setAvatar] = useState<string | undefined>(user?.avatar_base64);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setName(user?.name ?? '');
        setAvatar(user?.avatar_base64);
    }, [user?.name, user?.avatar_base64]);

    const initials = name
        ? name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()
        : '?';

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => setAvatar(reader.result as string);
        reader.readAsDataURL(file);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await updateProfile(name, avatar);
        } finally {
            setSaving(false);
        }
    };

    const dirty = name !== (user?.name ?? '') || avatar !== user?.avatar_base64;

    return (
        <div className="flex flex-col items-center py-4">
            <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="relative w-20 h-20 rounded-full mb-4 group"
            >
                {avatar ? (
                    <img src={avatar} alt="Avatar" className="w-20 h-20 rounded-full object-cover shadow-md" />
                ) : (
                    <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-[#4D5AE8] to-[#3B44A8] shadow-md flex items-center justify-center text-white text-2xl font-semibold">
                        {initials}
                    </div>
                )}
                <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[11px] font-medium">
                    Change
                </div>
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />

            <div className="w-full max-w-xs flex flex-col gap-3">
                <label className="flex flex-col gap-1 text-left">
                    <span className="text-[11px] font-medium text-black/50">Name</span>
                    <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="border border-black/10 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#4D5AE8]/50 focus:ring-1 focus:ring-[#4D5AE8]/20"
                    />
                </label>
                <label className="flex flex-col gap-1 text-left">
                    <span className="text-[11px] font-medium text-black/50">Email</span>
                    <input
                        value={user?.email ?? ''}
                        disabled
                        className="border border-black/10 rounded-lg px-3 py-2 text-[13px] bg-black/5 text-black/50"
                    />
                </label>
                <button
                    type="button"
                    disabled={!dirty || saving}
                    onClick={handleSave}
                    className="mt-1 bg-[#1C1C1E] hover:bg-black disabled:opacity-30 text-white text-[13px] font-medium rounded-lg py-2 transition-colors"
                >
                    {saving ? 'Saving…' : 'Save Profile'}
                </button>
            </div>
        </div>
    );
}

function WorkTab() {
    const { preferences, preferencesLoaded, fetchPreferences, savePreferences } = useStore();
    const [workStart, setWorkStart] = useState('09:00');
    const [workEnd, setWorkEnd] = useState('18:00');
    const [focusBlockMins, setFocusBlockMins] = useState(60);
    const [bufferMinutes, setBufferMinutes] = useState(10);
    const [daysOff, setDaysOff] = useState<string[]>(['Saturday', 'Sunday']);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!preferencesLoaded) fetchPreferences();
    }, [preferencesLoaded, fetchPreferences]);

    useEffect(() => {
        if (!preferences) return;
        setWorkStart(preferences.work_start);
        setWorkEnd(preferences.work_end);
        setFocusBlockMins(preferences.focus_block_mins);
        setBufferMinutes(preferences.buffer_minutes);
        setDaysOff(preferences.days_off ? preferences.days_off.split(',') : []);
    }, [preferences]);

    const toggleDay = (day: string) => {
        setDaysOff((prev) => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await savePreferences({
                work_start: workStart,
                work_end: workEnd,
                focus_block_mins: focusBlockMins,
                days_off: daysOff.join(','),
                buffer_minutes: bufferMinutes,
                focus_start: preferences?.focus_start,
                focus_end: preferences?.focus_end,
                notify_event_reminders: preferences?.notify_event_reminders ?? true,
                notify_deadlines: preferences?.notify_deadlines ?? true,
                notify_missed_sessions: preferences?.notify_missed_sessions ?? true,
                ai_response_style: preferences?.ai_response_style ?? 'detailed',
                ai_custom_instruction: preferences?.ai_custom_instruction,
                voice_input_enabled: preferences?.voice_input_enabled ?? true,
            });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex flex-col gap-4 py-2 max-w-xs mx-auto">
            <div className="flex gap-3">
                <label className="flex flex-col gap-1 flex-1 text-left">
                    <span className="text-[11px] font-medium text-black/50">Work start</span>
                    <input type="time" value={workStart} onChange={(e) => setWorkStart(e.target.value)}
                        className="border border-black/10 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#4D5AE8]/50" />
                </label>
                <label className="flex flex-col gap-1 flex-1 text-left">
                    <span className="text-[11px] font-medium text-black/50">Work end</span>
                    <input type="time" value={workEnd} onChange={(e) => setWorkEnd(e.target.value)}
                        className="border border-black/10 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#4D5AE8]/50" />
                </label>
            </div>

            <label className="flex flex-col gap-1 text-left">
                <span className="text-[11px] font-medium text-black/50">Focus block length (minutes)</span>
                <input type="number" min={15} step={5} value={focusBlockMins}
                    onChange={(e) => setFocusBlockMins(Number(e.target.value))}
                    className="border border-black/10 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#4D5AE8]/50" />
            </label>

            <label className="flex flex-col gap-1 text-left">
                <span className="text-[11px] font-medium text-black/50">Buffer between tasks (minutes)</span>
                <input type="number" min={0} step={5} value={bufferMinutes}
                    onChange={(e) => setBufferMinutes(Number(e.target.value))}
                    className="border border-black/10 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#4D5AE8]/50" />
            </label>

            <div className="flex flex-col gap-1 text-left">
                <span className="text-[11px] font-medium text-black/50">Days off</span>
                <div className="flex flex-wrap gap-1.5">
                    {DAYS.map((day) => (
                        <button
                            key={day}
                            type="button"
                            onClick={() => toggleDay(day)}
                            className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                                daysOff.includes(day) ? 'bg-[#4D5AE8] text-white' : 'bg-black/5 text-black/60 hover:bg-black/10'
                            }`}
                        >
                            {day.slice(0, 3)}
                        </button>
                    ))}
                </div>
            </div>

            <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="mt-1 bg-[#1C1C1E] hover:bg-black disabled:opacity-30 text-white text-[13px] font-medium rounded-lg py-2 transition-colors"
            >
                {saving ? 'Saving…' : 'Save Work Preferences'}
            </button>
        </div>
    );
}

function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
    return (
        <div className="flex items-center justify-between py-2 border-b border-black/5 last:border-0">
            <span className="text-[13px] text-black/70">{label}</span>
            <button
                type="button"
                onClick={() => onChange(!value)}
                className={`relative w-9 h-5 rounded-full transition-colors ${value ? 'bg-[#4D5AE8]' : 'bg-black/15'}`}
            >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${value ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </button>
        </div>
    );
}

function AiAppTab() {
    const { preferences, preferencesLoaded, fetchPreferences, savePreferences } = useStore();
    const [responseStyle, setResponseStyle] = useState<'concise' | 'detailed'>('detailed');
    const [customInstruction, setCustomInstruction] = useState('');
    const [notifyEvents, setNotifyEvents] = useState(true);
    const [notifyDeadlines, setNotifyDeadlines] = useState(true);
    const [notifyMissed, setNotifyMissed] = useState(true);
    const [voiceEnabled, setVoiceEnabled] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!preferencesLoaded) fetchPreferences();
    }, [preferencesLoaded, fetchPreferences]);

    useEffect(() => {
        if (!preferences) return;
        setResponseStyle(preferences.ai_response_style ?? 'detailed');
        setCustomInstruction(preferences.ai_custom_instruction ?? '');
        setNotifyEvents(preferences.notify_event_reminders ?? true);
        setNotifyDeadlines(preferences.notify_deadlines ?? true);
        setNotifyMissed(preferences.notify_missed_sessions ?? true);
        setVoiceEnabled(preferences.voice_input_enabled ?? true);
    }, [preferences]);

    const handleSave = async () => {
        setSaving(true);
        try {
            await savePreferences({
                work_start: preferences?.work_start ?? '09:00',
                work_end: preferences?.work_end ?? '18:00',
                focus_block_mins: preferences?.focus_block_mins ?? 60,
                days_off: preferences?.days_off ?? 'Saturday,Sunday',
                buffer_minutes: preferences?.buffer_minutes ?? 10,
                focus_start: preferences?.focus_start,
                focus_end: preferences?.focus_end,
                notify_event_reminders: notifyEvents,
                notify_deadlines: notifyDeadlines,
                notify_missed_sessions: notifyMissed,
                ai_response_style: responseStyle,
                ai_custom_instruction: customInstruction.trim() || undefined,
                voice_input_enabled: voiceEnabled,
            });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex flex-col gap-4 py-2 max-w-xs mx-auto">
            <div className="flex flex-col gap-1 text-left">
                <span className="text-[11px] font-medium text-black/50">AI Response Style</span>
                <div className="flex gap-2">
                    {(['detailed', 'concise'] as const).map((style) => (
                        <button
                            key={style}
                            type="button"
                            onClick={() => setResponseStyle(style)}
                            className={`flex-1 py-2 rounded-lg text-[12px] font-medium border transition-colors capitalize ${
                                responseStyle === style
                                    ? 'bg-[#1C1C1E] text-white border-transparent'
                                    : 'bg-white border-black/10 text-black/60 hover:bg-black/5'
                            }`}
                        >
                            {style}
                        </button>
                    ))}
                </div>
            </div>

            <label className="flex flex-col gap-1 text-left">
                <span className="text-[11px] font-medium text-black/50">Custom AI Instruction (optional)</span>
                <textarea
                    value={customInstruction}
                    onChange={(e) => setCustomInstruction(e.target.value)}
                    rows={3}
                    placeholder="E.g. Always suggest a 5-min warmup before heavy tasks."
                    className="border border-black/10 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#4D5AE8]/50 resize-none"
                />
            </label>

            <div className="flex flex-col border border-black/8 rounded-lg px-3 bg-white">
                <span className="text-[11px] font-medium text-black/50 pt-2 pb-1">Notifications</span>
                <Toggle value={notifyEvents} onChange={setNotifyEvents} label="Event reminders" />
                <Toggle value={notifyDeadlines} onChange={setNotifyDeadlines} label="Deadline alerts" />
                <Toggle value={notifyMissed} onChange={setNotifyMissed} label="Missed session alerts" />
                <span className="text-[11px] font-medium text-black/50 pt-2 pb-1">Features</span>
                <Toggle value={voiceEnabled} onChange={setVoiceEnabled} label="Voice input" />
            </div>

            <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="mt-1 bg-[#1C1C1E] hover:bg-black disabled:opacity-30 text-white text-[13px] font-medium rounded-lg py-2 transition-colors"
            >
                {saving ? 'Saving…' : 'Save AI & App Preferences'}
            </button>
        </div>
    );
}

export function AppSettingsSheet({ open, onOpenChange }: AppSettingsSheetProps) {
    const [activeTab, setActiveTab] = useState<TabId>('profile');

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 animate-in fade-in duration-200" />

                <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl h-[520px] bg-white/80 backdrop-blur-3xl rounded-[10px] shadow-[0_20px_60px_rgba(0,0,0,0.2)] border border-black/10 z-50 animate-in fade-in zoom-in-95 duration-200 overflow-hidden flex flex-col">

                    <div className="flex items-center justify-between px-4 py-3 border-b border-black/5 bg-white/50 shrink-0">
                        <Dialog.Title className="text-[13px] font-semibold text-black/80">Account Settings</Dialog.Title>
                        <Dialog.Close asChild>
                            <button className="flex items-center justify-center w-6 h-6 rounded hover:bg-black/5 transition-colors focus:outline-none">
                                <X className="w-4 h-4 text-black/50" />
                            </button>
                        </Dialog.Close>
                    </div>

                    <div className="flex flex-1 min-h-0">
                        {/* Left sidebar nav */}
                        <div className="w-36 shrink-0 border-r border-black/5 bg-white/40 p-2 flex flex-col gap-0.5">
                            {TABS.map(({ id, label, icon: Icon }) => (
                                <button
                                    key={id}
                                    type="button"
                                    onClick={() => setActiveTab(id)}
                                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] font-medium transition-colors text-left w-full ${
                                        activeTab === id
                                            ? id === 'danger' ? 'bg-red-100 text-red-700' : 'bg-[#4D5AE8]/10 text-[#4D5AE8]'
                                            : id === 'danger' ? 'text-red-500 hover:bg-red-50' : 'text-black/50 hover:bg-black/5'
                                    }`}
                                >
                                    <Icon className="w-3.5 h-3.5 shrink-0" />
                                    {label}
                                </button>
                            ))}
                        </div>

                        {/* Tab content */}
                        <div className="flex-1 overflow-y-auto px-6 py-4">
                            {activeTab === 'profile' && <ProfileTab />}
                            {activeTab === 'work' && <WorkTab />}
                            {activeTab === 'ai' && <AiAppTab />}
                            {activeTab === 'danger' && <AppSettingsDangerZone />}
                        </div>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
