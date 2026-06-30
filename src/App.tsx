import { useEffect, useCallback, useState } from 'react';
import { setLiquidGlassEffect, GlassMaterialVariant } from 'tauri-plugin-liquid-glass-api';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { TaskList } from './components/TaskList';
import { SettingsDropdown } from './components/SettingsDropdown';
import { Sidebar } from './components/Sidebar';
import { NextActionWidget } from './components/NextActionWidget';
import { Auth } from './components/Auth';
import { EmptyState } from './components/EmptyState';
import { GoalChatView } from './components/GoalChatView';
import { FocusSession } from './components/FocusSession';
import { CommandPalette } from './components/CommandPalette';
import { Onboarding } from './components/Onboarding';
import { CalendarView } from './components/CalendarView';
import { useStore, ConflictInfo } from './store';
import { PanelLeft, Plus, AlertTriangle, X, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';

function App() {
  const {
    user, preferences, preferencesLoaded, goals,
    toggleSidebar, isSidebarOpen, activeView,
    setActiveGoal, setActiveView,
    conflictAlert, setConflictAlert, dismissConflict,
    fetchEvents, setPendingTrayCapture,
    focusTaskId,
    missedSessions, fetchMissedSessions, dismissMissedSession,
    fetchNextAction, fetchGoalStats,
  } = useStore();

  const [showCommandPalette, setShowCommandPalette] = useState(false);

  useEffect(() => {
    setLiquidGlassEffect({ variant: GlassMaterialVariant.Clear }).catch(console.error);
  }, []);

  // Fetch initial data when user logs in
  useEffect(() => {
    if (!user) return;
    fetchNextAction();
    fetchGoalStats();
    fetchMissedSessions();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const unlisten = listen<string>('navigate_to_goal', (event) => {
      setActiveGoal(event.payload);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [user]);

  const refreshCalendar = useCallback(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const end   = new Date(now.getFullYear(), now.getMonth() + 2, 1).toISOString();
    fetchEvents(start, end);
  }, [fetchEvents]);

  useEffect(() => {
    if (!user) return;
    const unlisten = listen('calendar_updated', refreshCalendar);
    return () => { unlisten.then((fn) => fn()); };
  }, [user, refreshCalendar]);

  useEffect(() => {
    if (!user) return;
    const unlisten = listen<ConflictInfo>('calendar_conflict', (event) => {
      setConflictAlert(event.payload);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [user, setConflictAlert]);

  useEffect(() => {
    if (!user) return;
    const unlisten = listen<string>('tray_quick_chat', (event) => {
      setPendingTrayCapture(event.payload);
      setActiveView('new_project');
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [user, setPendingTrayCapture, setActiveView]);

  // Poll notifications every 60s (also handles deadline alerts + daily summary)
  useEffect(() => {
    if (!user) return;
    const poll = () => invoke('check_and_send_notifications').catch(console.error);
    poll();
    const id = setInterval(poll, 60_000);
    return () => clearInterval(id);
  }, [user]);

  // ⌘K command palette
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette(v => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (!user) {
    return (
      <div className="flex h-screen w-screen text-black font-sans bg-transparent titlebar">
        <Auth />
      </div>
    );
  }

  if (!preferencesLoaded) {
    return <div className="flex h-screen w-screen bg-transparent" />;
  }

  if (preferences === null) {
    return (
      <div className="flex h-screen w-screen text-black font-sans bg-transparent titlebar">
        <Onboarding />
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen text-black font-sans bg-transparent titlebar">

      {/* Focus Session overlay */}
      {focusTaskId && <FocusSession />}

      {/* ⌘K Command Palette */}
      {showCommandPalette && <CommandPalette onClose={() => setShowCommandPalette(false)} />}

      <Sidebar />

      <div className="flex-1 h-full flex flex-col bg-[#FAFAFA] relative overflow-hidden no-drag border-l border-black/10">

        {/* Missed session banners */}
        {missedSessions.map(session => (
          <div key={session.task_id} className="flex items-center gap-3 px-5 py-2.5 bg-blue-50 border-b border-blue-200 text-[13px]">
            <RefreshCw className="w-3.5 h-3.5 text-blue-500 shrink-0" />
            <span className="flex-1 text-blue-800">
              You missed a session for <span className="font-semibold">"{session.task_title}"</span> — want to reschedule?
            </span>
            <button
              onClick={() => {
                dismissMissedSession(session.task_id);
                setActiveGoal(session.goal_id);
                setPendingTrayCapture(`Please reschedule the task "${session.task_title}"`);
              }}
              className="text-[12px] font-semibold text-blue-600 hover:text-blue-800 underline underline-offset-2 shrink-0"
            >
              Reschedule
            </button>
            <button
              onClick={() => dismissMissedSession(session.task_id)}
              className="p-1 rounded-full hover:bg-blue-100 text-blue-400 shrink-0"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}

        {/* Calendar conflict banner */}
        {conflictAlert && (
          <div className="flex items-center gap-3 px-5 py-3 bg-orange-50 border-b border-orange-200 shadow-sm z-[60]">
            <AlertTriangle className="w-4 h-4 text-orange-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-[13px] font-semibold text-orange-800">Schedule conflict: </span>
              <span className="text-[13px] text-orange-700">
                "{conflictAlert.task_title}" (deadline {conflictAlert.deadline.slice(0, 10)}) overlaps with{' '}
                {conflictAlert.conflicting_events.map(e => `"${e.title}"`).join(', ')}.
              </span>
            </div>
            <button onClick={() => { dismissConflict(); setActiveView('calendar'); }} className="shrink-0 text-[12px] font-semibold text-orange-600 hover:text-orange-800 underline underline-offset-2">
              View Calendar
            </button>
            <button onClick={dismissConflict} className="shrink-0 p-1 rounded-full hover:bg-orange-100 text-orange-400">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {activeView === 'calendar' ? (
          <>
            <div className="absolute top-0 left-0 right-0 h-[64px] flex items-center justify-between px-6 bg-transparent z-10 pointer-events-none">
              <div className="flex items-center gap-2 pointer-events-auto no-drag">
                <button onClick={toggleSidebar} className="p-2 rounded-full bg-white border border-[#E5E5E5] shadow-sm hover:bg-black/5 transition-colors text-[#2D2D2D] focus:outline-none flex items-center justify-center h-10 w-10">
                  <PanelLeft className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center pointer-events-auto no-drag">
                <SettingsDropdown />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-8 pt-20 flex flex-col relative z-0">
              <CalendarView />
            </div>
          </>
        ) : activeView === 'new_project' || goals.length === 0 ? (
          <>
            <div className="absolute top-0 left-0 right-0 h-[64px] flex items-center justify-between px-6 bg-transparent z-10 pointer-events-none">
              <div className="flex items-center gap-2 pointer-events-auto no-drag">
                <button onClick={toggleSidebar} className="p-2 rounded-full bg-white border border-[#E5E5E5] shadow-sm hover:bg-black/5 transition-colors text-[#2D2D2D] focus:outline-none flex items-center justify-center h-10 w-10">
                  <PanelLeft className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-2 pointer-events-auto no-drag">
                <SettingsDropdown />
              </div>
            </div>
            <EmptyState />
          </>
        ) : activeView === 'project' ? (
          <AnimatePresence mode="wait">
            <motion.div key="project" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="w-full h-full">
              <GoalChatView />
            </motion.div>
          </AnimatePresence>
        ) : (
          <>
            <div className={clsx("absolute top-0 left-0 right-0 h-[64px] flex items-center justify-between px-6 bg-transparent z-10 pointer-events-none", !isSidebarOpen && "pl-24")}>
              <div className="flex items-center gap-2 pointer-events-auto">
                <button onClick={toggleSidebar} className="p-2 rounded-full bg-white border border-[#E5E5E5] shadow-sm hover:bg-black/5 transition-colors text-[#2D2D2D] focus:outline-none flex items-center justify-center h-10 w-10">
                  <PanelLeft className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-2 pointer-events-auto">
                <button
                  onClick={() => setActiveView('new_project')}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-[#85D24E] hover:bg-[#7bc248] text-black text-[13px] font-semibold shadow-sm transition-colors focus:outline-none"
                >
                  <Plus className="w-4 h-4" />
                  New Goal
                </button>
                <SettingsDropdown />
              </div>
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key="today"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 overflow-y-auto p-8 pt-20 flex flex-col items-center relative z-0"
              >
                <div className="w-full max-w-3xl mb-8">
                  <h1 className="text-[28px] font-semibold tracking-tight text-[#1C1C1E]">
                    {activeView === 'completed' ? 'Completed' :
                     activeView === 'recent' ? 'Recent' :
                     activeView === 'upcoming' ? 'Upcoming' : 'Today'}
                  </h1>
                </div>
                {activeView === 'all' && (
                  <div className="w-full max-w-3xl mb-8">
                    <NextActionWidget />
                  </div>
                )}
                <div className="w-full max-w-3xl pb-24">
                  <TaskList />
                </div>
              </motion.div>
            </AnimatePresence>
          </>
        )}
      </div>
    </div>
  );
}

export default App;
