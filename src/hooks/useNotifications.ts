import { createContext, useCallback, useContext, useRef, useState, useMemo } from "react";
import { createElement, type ReactNode } from "react";

export type NotificationType = "info" | "success" | "warning";

export interface Notification {
  id: string;
  type: NotificationType;
  message: string;
  timestamp: number;
  visible: boolean;
  busy?: boolean;
  autoDismissMs?: number;
}

interface NotificationActions {
  addNotification: (opts: {
    id: string;
    type: NotificationType;
    message: string;
    busy?: boolean;
    autoDismissMs?: number;
  }) => void;
  dismissNotification: (id: string) => void;
  removeNotification: (id: string) => void;
  replaceNotification: (
    id: string,
    updates: { type?: NotificationType; message?: string; busy?: boolean; autoDismissMs?: number }
  ) => void;
  clearHistory: () => void;
}

interface NotificationContextValue {
  notifications: Notification[];
  actions: NotificationActions;
}

const NotificationContext = createContext<NotificationContextValue>({
  notifications: [],
  actions: {
    addNotification: () => {},
    dismissNotification: () => {},
    removeNotification: () => {},
    replaceNotification: () => {},
    clearHistory: () => {},
  },
});

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const clearTimer = useCallback((id: string) => {
    const existing = timersRef.current.get(id);
    if (existing) {
      clearTimeout(existing);
      timersRef.current.delete(id);
    }
  }, []);

  const startTimer = useCallback(
    (id: string, ms: number) => {
      clearTimer(id);
      const timer = setTimeout(() => {
        timersRef.current.delete(id);
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? { ...n, visible: false } : n))
        );
      }, ms);
      timersRef.current.set(id, timer);
    },
    [clearTimer]
  );

  const addNotification = useCallback(
    (opts: { id: string; type: NotificationType; message: string; busy?: boolean; autoDismissMs?: number }) => {
      setNotifications((prev) => {
        const idx = prev.findIndex((n) => n.id === opts.id);
        const entry: Notification = {
          id: opts.id,
          type: opts.type,
          message: opts.message,
          timestamp: Date.now(),
          visible: true,
          busy: opts.busy,
          autoDismissMs: opts.autoDismissMs,
        };
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = entry;
          return next;
        }
        return [...prev, entry];
      });
      if (opts.autoDismissMs) {
        startTimer(opts.id, opts.autoDismissMs);
      } else {
        clearTimer(opts.id);
      }
    },
    [startTimer, clearTimer]
  );

  const dismissNotification = useCallback(
    (id: string) => {
      clearTimer(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, visible: false } : n))
      );
    },
    [clearTimer]
  );

  const removeNotification = useCallback(
    (id: string) => {
      clearTimer(id);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    },
    [clearTimer]
  );

  const replaceNotification = useCallback(
    (
      id: string,
      updates: { type?: NotificationType; message?: string; busy?: boolean; autoDismissMs?: number }
    ) => {
      setNotifications((prev) =>
        prev.map((n) => {
          if (n.id !== id) return n;
          const updated = {
            ...n,
            ...updates,
            visible: true,
            timestamp: Date.now(),
          };
          return updated;
        })
      );
      if (updates.autoDismissMs) {
        startTimer(id, updates.autoDismissMs);
      } else {
        clearTimer(id);
      }
    },
    [startTimer, clearTimer]
  );

  const clearHistory = useCallback(() => {
    setNotifications((prev) => prev.filter((n) => n.visible));
  }, []);

  const actions: NotificationActions = useMemo(() => ({
    addNotification,
    dismissNotification,
    removeNotification,
    replaceNotification,
    clearHistory,
  }), [addNotification, dismissNotification, removeNotification, replaceNotification, clearHistory]);

  return createElement(
    NotificationContext.Provider,
    { value: { notifications, actions } },
    children
  );
}

export function useNotifications() {
  return useContext(NotificationContext);
}
