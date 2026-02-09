import { useNotifications } from "../../hooks/useNotifications";
import "./NotificationStack.css";

const accentColors: Record<string, string> = {
  info: "var(--accent)",
  success: "var(--success)",
  warning: "var(--warning)",
};

export function NotificationStack() {
  const { notifications, actions } = useNotifications();
  const visible = notifications.filter((n) => n.visible);

  if (visible.length === 0) return null;

  return (
    <div className="notification-stack">
      {visible.map((n) => (
        <div
          key={n.id}
          className="notification-toast"
          style={{ borderLeftColor: accentColors[n.type] || accentColors.info }}
        >
          {n.busy && <span className="notification-spinner" />}
          <span className="notification-message">{n.message}</span>
          <button
            className="notification-dismiss"
            onClick={() => actions.dismissNotification(n.id)}
            title="Dismiss"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
