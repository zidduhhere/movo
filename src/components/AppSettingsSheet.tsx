import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

interface AppSettingsSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function AppSettingsSheet({ open, onOpenChange }: AppSettingsSheetProps) {
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                {/* Native macOS backdrop is usually dark or subtly blurred */}
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
                            <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-blue-500 to-purple-500 shadow-md mb-4 flex items-center justify-center text-white text-2xl font-semibold">
                                A
                            </div>
                            <h3 className="text-lg font-medium text-black">Alex</h3>
                            <p className="text-sm text-black/50">Free Tier</p>
                        </div>
                        
                        <div className="space-y-4">
                            <div className="flex items-center justify-between py-2 border-b border-black/5">
                                <span className="text-[13px] text-black/70">Sync Data</span>
                                <button className="text-[13px] bg-white border border-black/10 shadow-sm rounded px-3 py-1 text-black font-medium hover:bg-black/[0.02]">
                                    Enable
                                </button>
                            </div>
                        </div>
                    </div>

                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
