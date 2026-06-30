import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useStore } from '../store';

interface AppSettingsSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function AppSettingsSheet({ open, onOpenChange }: AppSettingsSheetProps) {
    const { user } = useStore();
    const initials = user?.name
        ? user.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()
        : '?';

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 animate-in fade-in duration-200" />

                <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-white/80 backdrop-blur-3xl rounded-[10px] shadow-[0_20px_60px_rgba(0,0,0,0.2)] border border-black/10 z-50 animate-in fade-in zoom-in-95 duration-200 overflow-hidden">

                    <div className="flex items-center justify-between px-4 py-3 border-b border-black/5 bg-white/50">
                        <Dialog.Title className="text-[13px] font-semibold text-black/80">Account Settings</Dialog.Title>
                        <Dialog.Close asChild>
                            <button className="flex items-center justify-center w-6 h-6 rounded hover:bg-black/5 transition-colors focus:outline-none">
                                <X className="w-4 h-4 text-black/50" />
                            </button>
                        </Dialog.Close>
                    </div>

                    <div className="p-6">
                        <div className="flex flex-col items-center justify-center py-6">
                            <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-[#4D5AE8] to-[#3B44A8] shadow-md mb-4 flex items-center justify-center text-white text-2xl font-semibold">
                                {initials}
                            </div>
                            <h3 className="text-lg font-medium text-black">{user?.name ?? '—'}</h3>
                            <p className="text-sm text-black/50">{user?.email ?? ''}</p>
                        </div>
                    </div>

                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
