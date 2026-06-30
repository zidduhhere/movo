import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Settings, LogOut, User, Link } from 'lucide-react';
import { useState } from 'react';
import { AppSettingsSheet } from './AppSettingsSheet';

export function SettingsDropdown() {
    const [sheetOpen, setSheetOpen] = useState(false);

    return (
        <>
            <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                    <button className="flex items-center justify-center w-8 h-8 rounded-md hover:bg-black/5 active:bg-black/10 transition-colors no-drag focus:outline-none">
                        <Settings className="w-5 h-5 text-black/60" />
                    </button>
                </DropdownMenu.Trigger>

                <DropdownMenu.Portal>
                    <DropdownMenu.Content 
                        className="min-w-[220px] bg-white/70 backdrop-blur-3xl rounded-xl p-1 shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-black/10 animate-in fade-in zoom-in-95 duration-100" 
                        sideOffset={8}
                        align="end"
                    >
                        <DropdownMenu.Item 
                            className="flex items-center gap-2 px-3 py-1.5 text-[13px] text-black outline-none rounded-md cursor-default focus:bg-[#007AFF] focus:text-white transition-colors"
                            onSelect={() => setSheetOpen(true)}
                        >
                            <User className="w-4 h-4" />
                            Account Settings...
                        </DropdownMenu.Item>
                        
                        <DropdownMenu.Item className="flex items-center gap-2 px-3 py-1.5 text-[13px] text-black outline-none rounded-md cursor-default focus:bg-[#007AFF] focus:text-white transition-colors">
                            <Link className="w-4 h-4" />
                            Integrations
                        </DropdownMenu.Item>

                        <DropdownMenu.Separator className="h-px bg-black/10 my-1 mx-1" />
                        
                        <DropdownMenu.Item className="flex items-center gap-2 px-3 py-1.5 text-[13px] text-black outline-none rounded-md cursor-default focus:bg-[#007AFF] focus:text-white transition-colors">
                            <LogOut className="w-4 h-4" />
                            Quit Movo
                        </DropdownMenu.Item>
                    </DropdownMenu.Content>
                </DropdownMenu.Portal>
            </DropdownMenu.Root>

            <AppSettingsSheet open={sheetOpen} onOpenChange={setSheetOpen} />
        </>
    );
}
