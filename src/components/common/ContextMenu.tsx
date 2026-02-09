import { useEffect, useRef } from "react";
import { useAppState, useAppDispatch } from "../../hooks/useAppState";
import "./ContextMenu.css";

export function ContextMenu() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const menuRef = useRef<HTMLDivElement>(null);
  const menu = state.contextMenu;

  useEffect(() => {
    if (!menu) return;

    const close = () => {
      dispatch({ type: "SET_CONTEXT_MENU", menu: null });
    };

    const handleMouseDown = (e: MouseEvent) => {
      // Close if clicking outside the menu
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        close();
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        close();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };

    // Defer listener attachment so the original right-click event
    // doesn't immediately trigger close
    const frame = requestAnimationFrame(() => {
      document.addEventListener("mousedown", handleMouseDown);
      document.addEventListener("contextmenu", handleContextMenu);
      document.addEventListener("keydown", handleEscape);
    });

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menu, dispatch]);

  if (!menu) return null;

  const handleClassify = () => {
    dispatch({ type: "SET_CONTEXT_MENU", menu: null });
    dispatch({
      type: "SET_CLASSIFY_DIALOG",
      state: {
        open: true,
        folderPath: menu.folderPath,
        status: "idle",
        progress: null,
        error: null,
      },
    });
  };

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: menu.x, top: menu.y }}
    >
      <button className="context-menu-item" onClick={handleClassify}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </svg>
        Classify Images
      </button>
    </div>
  );
}
