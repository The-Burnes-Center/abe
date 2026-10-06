import * as React from "react";
import { createContext, useState, useContext, useCallback, useMemo, useRef } from "react";
import { v4 as uuidv4 } from "uuid";

export type NotificationType = "success" | "info" | "warning" | "error";

export interface AppNotification {
  id: string;
  type: NotificationType;
  content: string;
  date: number;
  dismissible: boolean;
  dismissLabel: string;
  onDismiss: () => void;
}

const AUTO_HIDE_MS: Record<NotificationType, number> = {
  success: 4000,
  info: 5000,
  warning: 6000,
  error: 8000,
};

/** Older toasts are dropped beyond this many, so a burst can't cover the screen. */
export const MAX_VISIBLE_NOTIFICATIONS = 3;

interface NotificationContextValue {
  notifications: AppNotification[];
  addNotification: (type: NotificationType | string, content: string) => string;
  removeNotification: (id: string) => void;
}

export const NotificationContext = createContext<NotificationContextValue>({
  notifications: [],
  addNotification: () => "",
  removeNotification: () => {},
});

const asType = (type: string): NotificationType =>
  type in AUTO_HIDE_MS ? (type as NotificationType) : "info";

export const NotificationProvider = ({ children }: { children: React.ReactNode }) => {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const listRef = useRef<AppNotification[]>([]);

  const commit = useCallback((next: AppNotification[]) => {
    listRef.current = next;
    setNotifications(next);
  }, []);

  const removeNotification = useCallback(
    (id: string) => {
      clearTimeout(timersRef.current[id]);
      delete timersRef.current[id];
      commit(listRef.current.filter((n) => n.id !== id));
    },
    [commit]
  );

  const addNotification = useCallback(
    (rawType: string, content: string): string => {
      const type = asType(rawType);
      const delay = AUTO_HIDE_MS[type];

      // Same message already showing: restart its timer instead of stacking a copy.
      const duplicate = listRef.current.find((n) => n.type === type && n.content === content);
      if (duplicate) {
        clearTimeout(timersRef.current[duplicate.id]);
        timersRef.current[duplicate.id] = setTimeout(() => removeNotification(duplicate.id), delay);
        return duplicate.id;
      }

      const id = uuidv4();
      const next = [
        ...listRef.current,
        {
          id,
          type,
          content,
          date: Date.now(),
          dismissible: true,
          dismissLabel: "Hide notification",
          onDismiss: () => removeNotification(id),
        },
      ];
      const overflow = next.slice(0, Math.max(0, next.length - MAX_VISIBLE_NOTIFICATIONS));
      overflow.forEach((n) => {
        clearTimeout(timersRef.current[n.id]);
        delete timersRef.current[n.id];
      });
      commit(next.slice(overflow.length));
      timersRef.current[id] = setTimeout(() => removeNotification(id), delay);
      return id;
    },
    [commit, removeNotification]
  );

  const value = useMemo(
    () => ({ notifications, addNotification, removeNotification }),
    [notifications, addNotification, removeNotification]
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useNotifications = () => useContext(NotificationContext);
