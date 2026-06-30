import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export interface Goal {
    id: string;
    title: string;
    description?: string;
    status: string;
    created_at: string;
    target_date?: string;
}

export interface Task {
    id: string;
    goal_id?: string;
    title: string;
    description?: string;
    status: string;
    effort_minutes: number;
    priority: number;
    created_at: string;
    deadline?: string;
}

export interface ChatMessage {
    id: string;
    goal_id: string;
    role: 'user' | 'assistant';
    content: string;
    created_at: string;
}

export interface User {
    id: string;
    email: string;
    name: string;
    created_at: string;
}

export interface UserPreferences {
    user_id: string;
    work_start: string;
    work_end: string;
    focus_block_mins: number;
    days_off: string;
}

export interface CalendarEvent {
    id: string;
    task_id?: string;
    title: string;
    start_time: string;
    end_time: string;
    status: string;
    goal_id?: string;
    goal_title?: string;
}

type ActiveView = 'all' | 'recent' | 'upcoming' | 'completed' | 'project' | 'new_project' | 'calendar';

export interface ConflictInfo {
    task_title: string;
    deadline: string;
    conflicting_events: CalendarEvent[];
}

export interface NextAction {
    task: {
        id: string;
        goal_id?: string;
        title: string;
        description?: string;
        priority: number;
        effort_minutes: number;
        deadline?: string;
        score: number;
    };
    reason: string;
}

export interface GoalStat {
    goal_id: string;
    completed: number;
    total: number;
}

export interface MissedSession {
    task_id: string;
    task_title: string;
    goal_id: string;
    goal_title: string;
}

export interface GlobalChatResponse {
    message: ChatMessage;
    created_goal_ids: string[];
}

export interface TaskChatResponse {
    message: string;
    task_updated: boolean;
}

interface AppState {
    user: User | null;
    goals: Goal[];
    tasks: Task[];
    messages: ChatMessage[];
    preferences: UserPreferences | null;
    preferencesLoaded: boolean;
    events: CalendarEvent[];
    activeGoalId: string | null;
    activeView: ActiveView;
    isLoading: boolean;
    isLoadingMessages: boolean;
    error: string | null;
    isSidebarOpen: boolean;
    planStarted: boolean;
    conflictAlert: ConflictInfo | null;
    conflictEventIds: string[];
    pendingTrayCapture: string | null;
    nextAction: NextAction | null;
    goalStats: Record<string, GoalStat>;
    missedSessions: MissedSession[];
    focusTaskId: string | null;
    globalMessages: ChatMessage[];
    taskMessages: Record<string, ChatMessage[]>;
    activeChatTaskId: string | null;

    login: (email: string, password: string) => Promise<void>;
    register: (email: string, name: string, password: string) => Promise<void>;
    logout: () => void;
    fetchGoals: () => Promise<void>;
    fetchTasksForGoal: (goalId: string) => Promise<void>;
    fetchAllTasks: () => Promise<void>;
    createGoal: (title: string, description?: string, targetDate?: string) => Promise<Goal>;
    deleteGoal: (id: string) => Promise<void>;
    planGoal: (goalId: string) => Promise<void>;
    fetchMessages: (goalId: string) => Promise<void>;
    sendMessage: (goalId: string, content: string) => Promise<void>;
    setActiveGoal: (id: string | null) => void;
    setActiveView: (view: ActiveView) => void;
    toggleSidebar: () => void;
    fetchPreferences: () => Promise<void>;
    savePreferences: (prefs: Omit<UserPreferences, 'user_id'>) => Promise<void>;
    fetchEvents: (from: string, to: string) => Promise<void>;
    createEvent: (title: string, startTime: string, endTime: string) => Promise<CalendarEvent>;
    clearPlanStarted: () => void;
    setConflictAlert: (info: ConflictInfo | null) => void;
    dismissConflict: () => void;
    setPendingTrayCapture: (text: string | null) => void;
    completeTask: (id: string) => Promise<void>;
    fetchNextAction: () => Promise<void>;
    fetchGoalStats: () => Promise<void>;
    fetchMissedSessions: () => Promise<void>;
    dismissMissedSession: (taskId: string) => void;
    setFocusTask: (id: string | null) => void;
    fetchGlobalMessages: () => Promise<void>;
    sendGlobalMessage: (content: string) => Promise<void>;
    sendTaskMessage: (taskId: string, content: string) => Promise<void>;
    setActiveChatTaskId: (id: string | null) => void;
}

export const useStore = create<AppState>((set, _get) => ({
    user: null,
    goals: [],
    tasks: [],
    messages: [],
    preferences: null,
    preferencesLoaded: false,
    events: [],
    activeGoalId: null,
    activeView: 'all',
    isLoading: false,
    isLoadingMessages: false,
    error: null,
    isSidebarOpen: false,
    planStarted: false,
    conflictAlert: null,
    conflictEventIds: [],
    pendingTrayCapture: null,
    nextAction: null,
    goalStats: {},
    missedSessions: [],
    focusTaskId: null,
    globalMessages: [],
    taskMessages: {},
    activeChatTaskId: null,

    login: async (email, password) => {
        set({ isLoading: true, error: null });
        try {
            const user = await invoke<User>('login_user', { email, password });
            set({ user, isLoading: false });
            _get().fetchGoals();
            _get().fetchPreferences();
            _get().fetchGlobalMessages();
        } catch (error: any) {
            set({ error: error.toString(), isLoading: false });
            throw error;
        }
    },

    register: async (email, name, password) => {
        set({ isLoading: true, error: null });
        try {
            const user = await invoke<User>('register_user', { email, name, password });
            set({ user, isLoading: false });
            _get().fetchGoals();
            _get().fetchPreferences();
            _get().fetchGlobalMessages();
        } catch (error: any) {
            set({ error: error.toString(), isLoading: false });
            throw error;
        }
    },

    logout: () => {
        set({ user: null, goals: [], tasks: [], activeGoalId: null, preferences: null, preferencesLoaded: false, events: [] });
    },

    toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),

    fetchGoals: async () => {
        const user = _get().user;
        if (!user) return;
        set({ isLoading: true, error: null });
        try {
            const goals = await invoke<Goal[]>('get_active_goals', { userId: user.id });
            set({ goals, isLoading: false });
        } catch (error: any) {
            set({ error: error.toString(), isLoading: false });
        }
    },

    fetchTasksForGoal: async (goalId) => {
        set({ isLoading: true, error: null });
        try {
            const tasks: Task[] = await invoke('get_tasks_by_goal', { goalId });
            set({ tasks, isLoading: false });
        } catch (error) {
            set({ error: error as string, isLoading: false });
        }
    },

    fetchAllTasks: async () => {
        const user = _get().user;
        if (!user) return;
        set({ isLoading: true, error: null });
        try {
            const tasks: Task[] = await invoke('get_all_tasks', { userId: user.id });
            set({ tasks, isLoading: false });
        } catch (error) {
            set({ error: error as string, isLoading: false });
        }
    },

    createGoal: async (title, description, targetDate) => {
        const user = _get().user;
        if (!user) throw new Error('Not logged in');
        set({ isLoading: true, error: null });
        try {
            const newGoal = await invoke<Goal>('create_goal', { userId: user.id, title, description, targetDate });
            set((state) => ({ goals: [...state.goals, newGoal], isLoading: false }));
            return newGoal;
        } catch (error: any) {
            set({ error: error.toString(), isLoading: false });
            throw error;
        }
    },

    deleteGoal: async (id) => {
        set({ isLoading: true, error: null });
        try {
            await invoke('delete_goal', { id });
            set((state) => {
                const newGoals = state.goals.filter((g) => g.id !== id);
                return {
                    goals: newGoals,
                    isLoading: false,
                    activeGoalId: state.activeGoalId === id ? null : state.activeGoalId,
                    activeView: (state.activeGoalId === id ? 'all' : state.activeView) as ActiveView,
                };
            });
            if (useStore.getState().activeView === 'all') {
                useStore.getState().fetchAllTasks();
            }
        } catch (error: any) {
            set({ error: error.toString(), isLoading: false });
            throw error;
        }
    },

    planGoal: async (goalId) => {
        set({ isLoading: true, error: null });
        try {
            const newTasks = await invoke<Task[]>('plan_goal', { goalId });
            set((state) => ({ tasks: [...state.tasks, ...newTasks], isLoading: false, planStarted: true }));
        } catch (error: any) {
            set({ error: error.toString(), isLoading: false });
            throw error;
        }
    },

    fetchMessages: async (goalId) => {
        set({ isLoadingMessages: true });
        try {
            const messages = await invoke<ChatMessage[]>('get_chat_history', { goalId });
            set({ messages, isLoadingMessages: false });
        } catch (error: any) {
            console.error('Failed to fetch messages:', error);
            set({ isLoadingMessages: false });
        }
    },

    sendMessage: async (goalId, content) => {
        const tempMsg: ChatMessage = {
            id: 'temp-' + Date.now(),
            goal_id: goalId,
            role: 'user',
            content,
            created_at: new Date().toISOString(),
        };
        set((state) => ({ messages: [...state.messages, tempMsg] }));
        try {
            const response = await invoke<{ message: ChatMessage; tasks: Task[] }>('chat_with_ai', { goalId, content });
            set({ tasks: response.tasks });
            await useStore.getState().fetchMessages(goalId);
        } catch (error: any) {
            set((state) => ({ messages: state.messages.filter((m) => m.id !== tempMsg.id) }));
            throw error;
        }
    },

    setActiveGoal: (id) => {
        set({ activeGoalId: id, activeView: 'project' });
        if (id) {
            useStore.getState().fetchTasksForGoal(id);
        }
    },

    setActiveView: (view) => {
        set({ activeView: view, activeGoalId: null });
        if (view === 'all') {
            useStore.getState().fetchAllTasks();
        }
    },

    fetchPreferences: async () => {
        try {
            const prefs = await invoke<UserPreferences | null>('get_user_preferences');
            set({ preferences: prefs, preferencesLoaded: true });
        } catch {
            set({ preferences: null, preferencesLoaded: true });
        }
    },

    savePreferences: async (prefs) => {
        await invoke<UserPreferences>('save_user_preferences', {
            workStart: prefs.work_start,
            workEnd: prefs.work_end,
            focusBlockMins: prefs.focus_block_mins,
            daysOff: prefs.days_off,
        });
        await useStore.getState().fetchPreferences();
    },

    fetchEvents: async (from, to) => {
        try {
            const events = await invoke<CalendarEvent[]>('get_events_in_range', { from, to });
            set({ events });
        } catch (error) {
            console.error('Failed to fetch events:', error);
        }
    },

    createEvent: async (title, startTime, endTime) => {
        const event = await invoke<CalendarEvent>('create_event', { title, startTime, endTime });
        set((state) => ({ events: [...state.events, event] }));
        return event;
    },

    clearPlanStarted: () => set({ planStarted: false }),

    setConflictAlert: (info) => set({
        conflictAlert: info,
        conflictEventIds: info ? info.conflicting_events.map(e => e.id) : [],
    }),

    dismissConflict: () => set({ conflictAlert: null, conflictEventIds: [] }),

    setPendingTrayCapture: (text) => set({ pendingTrayCapture: text }),

    completeTask: async (id) => {
        // Optimistic update
        set((state) => ({
            tasks: state.tasks.map(t => t.id === id ? { ...t, status: 'completed' } : t),
        }));
        try {
            await invoke('update_task_status', { id, status: 'completed' });
            // Refresh next action after completion
            useStore.getState().fetchNextAction();
        } catch (err) {
            // Revert on failure
            set((state) => ({
                tasks: state.tasks.map(t => t.id === id ? { ...t, status: 'todo' } : t),
            }));
            throw err;
        }
    },

    fetchNextAction: async () => {
        try {
            const nextAction = await invoke<NextAction | null>('get_next_action');
            set({ nextAction });
        } catch {
            // Silently fail — widget just won't show
        }
    },

    fetchGoalStats: async () => {
        try {
            const stats = await invoke<GoalStat[]>('get_goal_stats');
            const map: Record<string, GoalStat> = {};
            for (const s of stats) map[s.goal_id] = s;
            set({ goalStats: map });
        } catch { /* silent */ }
    },

    fetchMissedSessions: async () => {
        try {
            const sessions = await invoke<MissedSession[]>('check_missed_sessions');
            set({ missedSessions: sessions });
        } catch { /* silent */ }
    },

    dismissMissedSession: (taskId) => {
        set((state) => ({ missedSessions: state.missedSessions.filter(s => s.task_id !== taskId) }));
    },

    setFocusTask: (id) => set({ focusTaskId: id }),

    fetchGlobalMessages: async () => {
        try {
            const messages = await invoke<ChatMessage[]>('get_global_chat_history');
            set({ globalMessages: messages });
        } catch { /* silent */ }
    },

    sendGlobalMessage: async (content) => {
        const tempMsg: ChatMessage = {
            id: 'temp-' + Date.now(),
            goal_id: 'global',
            role: 'user',
            content,
            created_at: new Date().toISOString(),
        };
        set(state => ({ globalMessages: [...state.globalMessages, tempMsg], isLoading: true }));
        try {
            const response = await invoke<GlobalChatResponse>('global_chat', { content });
            set(state => ({
                globalMessages: [
                    ...state.globalMessages.filter(m => m.id !== tempMsg.id),
                    { ...tempMsg, id: 'user-' + Date.now() },
                    response.message,
                ],
                isLoading: false,
            }));
            if (response.created_goal_ids.length > 0) {
                useStore.getState().fetchGoals();
            }
        } catch (error: any) {
            set(state => ({
                globalMessages: state.globalMessages.filter(m => m.id !== tempMsg.id),
                isLoading: false,
                error: error.toString(),
            }));
        }
    },

    sendTaskMessage: async (taskId, content) => {
        const currentHistory = useStore.getState().taskMessages[taskId] ?? [];
        const tempMsg: ChatMessage = {
            id: 'temp-' + Date.now(),
            goal_id: taskId,
            role: 'user',
            content,
            created_at: new Date().toISOString(),
        };
        set(state => ({
            taskMessages: { ...state.taskMessages, [taskId]: [...(state.taskMessages[taskId] ?? []), tempMsg] },
            isLoading: true,
        }));
        try {
            const history = currentHistory.map(m => ({ role: m.role as string, content: m.content }));
            const response = await invoke<TaskChatResponse>('task_chat', { taskId, content, history });
            const aiMsg: ChatMessage = {
                id: 'ai-' + Date.now(),
                goal_id: taskId,
                role: 'assistant',
                content: response.message,
                created_at: new Date().toISOString(),
            };
            const confirmedUserMsg: ChatMessage = { ...tempMsg, id: 'user-' + Date.now() };
            set(state => ({
                taskMessages: {
                    ...state.taskMessages,
                    [taskId]: [
                        ...(state.taskMessages[taskId] ?? []).filter(m => m.id !== tempMsg.id),
                        confirmedUserMsg,
                        aiMsg,
                    ],
                },
                isLoading: false,
            }));
            if (response.task_updated) {
                const { activeGoalId } = useStore.getState();
                if (activeGoalId) useStore.getState().fetchTasksForGoal(activeGoalId);
                useStore.getState().fetchNextAction();
            }
        } catch {
            set(state => ({
                taskMessages: {
                    ...state.taskMessages,
                    [taskId]: (state.taskMessages[taskId] ?? []).filter(m => m.id !== tempMsg.id),
                },
                isLoading: false,
            }));
        }
    },

    setActiveChatTaskId: (id) => set({ activeChatTaskId: id }),
}));
