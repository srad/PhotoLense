import { useEffect, useRef, useState } from "react";
import { useAppDispatch, useAppState } from "../../hooks/useAppState";
import { getAllTags, groupByColor } from "../../api/commands";
import type { SortBy, ViewMode } from "../../types";
import "./AppToolbar.css";
import { SearchBox } from "../SearchBox/SearchBox.tsx";
import { SimilaritySlider } from "../SimilaritySlider/SimilaritySlider.tsx";
import { TagFilterDropdown } from "../TagFilterDropdown/TagFilterDropdown.tsx";
import { NotificationBell } from "../NotificationBell/NotificationBell.tsx";
import { ColorGroupDialog } from "../ColorGroupDialog/ColorGroupDialog.tsx";
import { PathInput } from "./PathInput";
import { useFileTree } from "../../hooks/useFileTree";

export function AppToolbar() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [search, setSearch] = useState(state.searchQuery);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [grouping, setGrouping] = useState(false);
  const [showColorDialog, setShowColorDialog] = useState(false);
  const { expandToFolder } = useFileTree();

  // Sync local input when the global state is reset (e.g. folder change)
  useEffect(() => {
    setSearch(state.searchQuery);
  }, [state.searchQuery]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes("MAC");
      const isFindShortcut =
        (isMac && e.metaKey && e.key === "f") ||
        (!isMac && e.ctrlKey && e.key === "f");

      if (isFindShortcut) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Fetch available tags when the folder changes or photos change (e.g. after classification or import)
  useEffect(() => {
    if (state.selectedFolder) {
      getAllTags(state.selectedFolder).then(setAvailableTags).catch(console.error);
    } else {
      setAvailableTags([]);
    }
  }, [state.selectedFolder, state.photos]);

  const onSearchChange = (value: string) => {
    setSearch(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      dispatch({type: "SET_SEARCH_QUERY", query: value});
    }, 300);
  };

  const toggleTag = (tag: string) => {
    const current = state.filterTags;
    let next: string[];
    if (current.includes(tag)) {
      next = current.filter(t => t !== tag);
    } else {
      next = [...current, tag];
    }
    dispatch({type: "SET_FILTER_TAGS", tags: next});
  };

  const handleGroupClick = () => {
    if (state.colorGroups) {
      dispatch({ type: "SET_COLOR_GROUPS", groups: null });
    } else {
      setShowColorDialog(true);
    }
  };

  const handleGroupConfirm = async (method: "fixed" | "kmeans", k?: number) => {
    setGrouping(true);
    try {
      const paths = state.photos.map(p => p.path);
      const groups = await groupByColor(paths, { method, k });
      dispatch({ type: "SET_COLOR_GROUPS", groups });
      setShowColorDialog(false);
    } catch (err) {
      console.error("Failed to group by color:", err);
      dispatch({ type: "SET_ERROR", error: "Failed to group by color" });
    } finally {
      setGrouping(false);
    }
  };

  // Prioritize the import state over the indexing state if both happen (though usually sequential)
  const activeProgress = state.importState || state.indexingState;

  return (
    <div className="app-toolbar">
      <div className="toolbar-left">
        {activeProgress && (
          <div className="toolbar-progress"
               title={`${activeProgress.label} ${activeProgress.current} of ${activeProgress.total}`}>
            <div className="toolbar-progress-bar">
              <div
                className="toolbar-progress-fill"
                style={{width: `${(activeProgress.current / activeProgress.total) * 100}%`}}
              />
            </div>
            <span className="toolbar-progress-text">
              {activeProgress.label} {activeProgress.current}/{activeProgress.total}
            </span>
          </div>
        )}
      </div>

      <div className="toolbar-center">
        <PathInput selectedFolder={state.selectedFolder} onNavigate={expandToFolder} />
        {state.similaritySearch ? (
          <SimilaritySlider />
        ) : (
          <SearchBox
            ref={searchInputRef}
            value={search}
            onChange={onSearchChange}
          />
        )}
      </div>

      <div className="toolbar-right">
        <TagFilterDropdown
          availableTags={availableTags}
          selectedTags={state.filterTags}
          onToggleTag={toggleTag}
        />

        <div className="view-toggle">
          <button
            className={state.viewMode === "grid" ? "active" : ""}
            onClick={() => dispatch({type: "SET_VIEW_MODE", mode: "grid" as ViewMode})}
            title="Grid view"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <rect x="3" y="3" width="7" height="7" rx="1"/>
              <rect x="14" y="3" width="7" height="7" rx="1"/>
              <rect x="3" y="14" width="7" height="7" rx="1"/>
              <rect x="14" y="14" width="7" height="7" rx="1"/>
            </svg>
          </button>
          <button
            className={state.viewMode === "list" ? "active" : ""}
            onClick={() => dispatch({type: "SET_VIEW_MODE", mode: "list" as ViewMode})}
            title="List view"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <rect x="3" y="4" width="18" height="2" rx="1"/>
              <rect x="3" y="11" width="18" height="2" rx="1"/>
              <rect x="3" y="18" width="18" height="2" rx="1"/>
            </svg>
          </button>
        </div>

        <select
          className="sort-select"
          value={state.sortBy}
          onChange={(e) =>
            dispatch({type: "SET_SORT_BY", sortBy: e.target.value as SortBy})
          }
        >
          <option value="name">Name</option>
          <option value="size">Size</option>
          <option value="date">Date</option>
        </select>

        <button
          className="sort-order-btn"
          onClick={() =>
            dispatch({
              type: "SET_SORT_ORDER",
              order: state.sortOrder === "asc" ? "desc" : "asc",
            })
          }
          title={state.sortOrder === "asc" ? "Ascending" : "Descending"}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               style={{transform: state.sortOrder === "desc" ? "rotate(180deg)" : "none"}}>
            <path d="M12 5v14M5 12l7-7 7 7"/>
          </svg>
        </button>

        {state.selectedFolder && state.photos.length > 0 && (
          <>
            <button
              className={`color-group-btn ${state.colorGroups ? "active" : ""}`}
              onClick={handleGroupClick}
              disabled={grouping}
              title={state.colorGroups ? "Ungroup colors" : "Group by color"}
            >
              {grouping ? (
                 <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                   <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/>
                 </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>
                </svg>
              )}
            </button>
            <ColorGroupDialog 
              open={showColorDialog} 
              onClose={() => setShowColorDialog(false)}
              onGroup={handleGroupConfirm}
              loading={grouping}
            />
            <button
              className="classify-btn"
              onClick={() =>
                dispatch({
                  type: "SET_CLASSIFY_DIALOG",
                  state: {open: true, folderPath: state.selectedFolder},
                })
              }
              title="Classify photos with AI"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2a4 4 0 0 1 4 4c0 1.95-1.4 3.58-3.25 3.93"/>
                <path d="M8.24 9.93A4 4 0 0 1 12 2"/>
                <path d="M2 12a4 4 0 0 1 6-3.46"/>
                <path d="M8 14a4 4 0 0 1-6-3.46"/>
                <path d="M12 22a4 4 0 0 1-4-4c0-1.95 1.4-3.58 3.25-3.93"/>
                <path d="M15.76 14.07A4 4 0 0 1 12 22"/>
                <path d="M22 12a4 4 0 0 1-6 3.46"/>
                <path d="M16 10a4 4 0 0 1 6 3.46"/>
                <circle cx="12" cy="12" r="2"/>
              </svg>
              <span>Classify</span>
            </button>
          </>
        )}

        <button
          className={`overlay-btn ${state.showOverlay ? "active" : ""}`}
          onClick={() => dispatch({type: "TOGGLE_OVERLAY"})}
          title="Toggle photo details overlay"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <path d="M3 15h18M7 15v6M17 15v6"/>
          </svg>
        </button>

        <button
          className={`info-btn ${state.showExif ? "active" : ""}`}
          onClick={() => dispatch({type: "TOGGLE_EXIF"})}
          title="Toggle EXIF info"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 16v-4M12 8h.01"/>
          </svg>
        </button>

        <NotificationBell />
      </div>
    </div>
  );
}
