import { useState } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { useStore } from '../store';

export function AppSettingsDangerZone() {
    const { logout, deleteAccount } = useStore();
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const handleDelete = async () => {
        setDeleting(true);
        try {
            await deleteAccount();
        } finally {
            setDeleting(false);
            setConfirmDelete(false);
        }
    };

    return (
        <div className="flex flex-col gap-4 py-2 max-w-xs mx-auto">
            <div className="flex flex-col gap-1.5 p-4 rounded-xl border border-red-200 bg-red-50">
                <div className="flex items-center gap-2 mb-1">
                    <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                    <span className="text-[13px] font-semibold text-red-700">Danger Zone</span>
                </div>

                <button
                    type="button"
                    onClick={() => logout()}
                    className="w-full text-left px-3 py-2 rounded-lg text-[13px] font-medium text-red-700 bg-white border border-red-200 hover:bg-red-100 transition-colors"
                >
                    Sign Out
                </button>

                {!confirmDelete ? (
                    <button
                        type="button"
                        onClick={() => setConfirmDelete(true)}
                        className="w-full text-left px-3 py-2 rounded-lg text-[13px] font-medium text-red-700 bg-white border border-red-200 hover:bg-red-100 transition-colors flex items-center gap-2"
                    >
                        <Trash2 className="w-3.5 h-3.5 shrink-0" />
                        Delete Account
                    </button>
                ) : (
                    <div className="flex flex-col gap-2 p-3 bg-white rounded-lg border border-red-300">
                        <p className="text-[12px] text-red-800 font-medium">
                            This will permanently delete your account, all goals, tasks, and history. This cannot be undone.
                        </p>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => setConfirmDelete(false)}
                                className="flex-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-black/5 hover:bg-black/10 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleDelete}
                                disabled={deleting}
                                className="flex-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 transition-colors"
                            >
                                {deleting ? 'Deleting…' : 'Delete Forever'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
