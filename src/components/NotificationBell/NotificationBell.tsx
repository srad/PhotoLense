import { useEffect, useRef, useState } from "react";
import { useNotifications } from "../../hooks/useNotifications";
import "./NotificationBell.css";

function relativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const accentColors: Record<string, string> = {
  info: "var(--accent)",
  success: "var(--success)",
  warning: "var(--warning)",
};

export function NotificationBell() {
  const { notifications, actions } = useNotifications();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const history = notifications.filter((n) => !n.visible);
  const count = history.length;

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="notification-bell-wrapper" ref={panelRef}>
      <button
        className="notification-bell-btn"
        onClick={() => setOpen((v) => !v)}
        title="Notifications"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {count > 0 && <span className="notification-badge">{count}</span>}
      </button>

      {open && (
        <div className="notification-panel">
          <div className="notification-panel-header">
            <span>Notifications</span>
            {count > 0 && (
              <button
                className="notification-clear-btn"
                onClick={() => actions.clearHistory()}
              >
                Clear all
              </button>
            )}
          </div>
          <div className="notification-panel-list">
            {history.length === 0 ? (
              <div className="notification-panel-empty">No notifications</div>
            ) : (
              history.map((n) => (
                <div key={n.id} className="notification-panel-item">
                  <div
                    className="notification-panel-accent"
                    style={{ background: accentColors[n.type] || accentColors.info }}
                  />
                  <div className="notification-panel-content">
                    <span className="notification-panel-msg">{n.message}</span>
                    <span className="notification-panel-time">
                      {relativeTime(n.timestamp)}
                    </span>
                  </div>
                  <button
                    className="notification-panel-remove"
                    onClick={() => actions.removeNotification(n.id)}
                    title="Remove"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
