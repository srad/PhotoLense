import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useAppState, useAppDispatch } from "../../hooks/useAppState";
import { usePhotos } from "../../hooks/usePhotos";
import { PhotoGrid } from "./PhotoGrid";
import { PhotoList } from "./PhotoList";
import { ExifPanel } from "./ExifPanel";
import { Lightbox } from "./Lightbox";
import { SelectionActionBar } from "./SelectionActionBar";
import { GroupIndex } from "./GroupIndex";
import "./PhotoPanel.css";
import type { PhotoEntry } from "../../types";

const PALETTE_ORDER = [
  "Red", "Orange", "Yellow", "Green", "Cyan", "Blue", "Purple", "Pink", "Brown", "Black", "Grey", "White", "Unknown"
];

function getGridColumns(container: HTMLElement): number {
  const grid = container.querySelector(".photo-grid") as HTMLElement | null;
  if (!grid) return 1;
  const cols = getComputedStyle(grid).gridTemplateColumns.split(" ").length;
  return cols || 1;
}

export function PhotoPanel() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { selectPhoto } = usePhotos();
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const contentRef = useRef<HTMLDivElement>(null);

  // Compute grouped/sorted photos if grouping is active
  const { displayPhotos, groups } = useMemo(() => {
    if (!state.colorGroups) {
      return { displayPhotos: state.photos, groups: null };
    }

    const groups: { color: string; photos: PhotoEntry[]; startIndex: number }[] = [];
    const sortedPhotos: PhotoEntry[] = [];
    const photoMap = new Map(state.photos.map(p => [p.path, p]));
    let currentIndex = 0;

    // Get all keys and sort them. 
    // If it's fixed palette, use PALETTE_ORDER. 
    // If it's K-Means (hex codes), sort by hue or just name/size.
    const keys = Object.keys(state.colorGroups);
    const isFixedPalette = keys.some(k => PALETTE_ORDER.includes(k));
    
    let sortedKeys: string[];
    if (isFixedPalette) {
      sortedKeys = PALETTE_ORDER.filter(k => keys.includes(k));
      // Add any keys not in PALETTE_ORDER at the end (just in case)
      const remaining = keys.filter(k => !PALETTE_ORDER.includes(k));
      sortedKeys.push(...remaining);
    } else {
      // K-Means: Sort by cluster size (descending)
      sortedKeys = keys.sort((a, b) => {
        const lenA = state.colorGroups![a]?.length || 0;
        const lenB = state.colorGroups![b]?.length || 0;
        return lenB - lenA;
      });
    }

    for (const color of sortedKeys) {
      const paths = state.colorGroups[color];
      if (paths && paths.length > 0) {
        const groupPhotos = paths
          .map(path => photoMap.get(path))
          .filter((p): p is PhotoEntry => !!p);
        
        if (groupPhotos.length > 0) {
          groups.push({
            color,
            photos: groupPhotos,
            startIndex: currentIndex
          });
          sortedPhotos.push(...groupPhotos);
          currentIndex += groupPhotos.length;
        }
      }
    }
    return { displayPhotos: sortedPhotos, groups };
  }, [state.photos, state.colorGroups]);

  const photosRef = useRef(displayPhotos);
  photosRef.current = displayPhotos;
  const focusedIndexRef = useRef(focusedIndex);
  focusedIndexRef.current = focusedIndex;
  const viewModeRef = useRef(state.viewMode);
  viewModeRef.current = state.viewMode;
  const selectedPathsRef = useRef(state.selectedPaths);
  selectedPathsRef.current = state.selectedPaths;

  // Reset focused index when photos change (but not when just grouping changes if possible? No, order changes)
  useEffect(() => {
    setFocusedIndex(-1);
  }, [displayPhotos]);

  const openLightbox = useCallback((index: number) => setLightboxIndex(index), []);
  const closeLightbox = useCallback(() => setLightboxIndex(null), []);

  const scrollToGroup = useCallback((color: string) => {
    // Escape special characters in color name (like # for hex) for querySelector if used, 
    // but here we use getElementById which is safer if ID is valid.
    // However, # is not valid in ID without escaping in CSS selector, but getElementById handles it fine?
    // Actually standard IDs shouldn't start with digits or special chars, but browsers are lenient.
    // Let's use a safe prefix.
    const safeId = `group-${color.replace(/#/g, '')}`;
    const el = document.getElementById(safeId);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const navigateTo = useCallback((index: number, shift = false) => {
    const p = photosRef.current;
    if (p.length === 0) return;
    const clamped = Math.max(0, Math.min(index, p.length - 1));
    setFocusedIndex(clamped);
    const photo = p[clamped];

    if (shift) {
      const existing = new Set(selectedPathsRef.current);
      existing.add(photo.path);
      dispatch({ type: "SET_SELECTION", paths: Array.from(existing) });
    } else {
      selectPhoto(photo);
    }

    // Scroll into view
    requestAnimationFrame(() => {
      const container = contentRef.current;
      if (!container) return;
      const selector = viewModeRef.current === "grid" ? ".photo-grid-item" : ".photo-list-item";
      const items = container.querySelectorAll(selector);
      const el = items[clamped] as HTMLElement | undefined;
      el?.scrollIntoView({ block: "nearest" });
    });
  }, [dispatch, selectPhoto]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if ((e.ctrlKey || e.metaKey) && e.key === "a") {
        e.preventDefault();
        dispatch({ type: "SELECT_ALL" });
        return;
      }
      if (e.key === "Escape") {
        dispatch({ type: "CLEAR_SELECTION" });
        setFocusedIndex(-1);
        return;
      }

      const cur = focusedIndexRef.current;
      const len = photosRef.current.length;
      if (len === 0) return;

      if (e.key === "Enter" && cur >= 0) {
        e.preventDefault();
        setLightboxIndex(cur);
        return;
      }

      let next = cur;
      const isGrid = viewModeRef.current === "grid";

      if (e.key === "ArrowRight") {
        e.preventDefault();
        next = cur < 0 ? 0 : cur + 1;
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        next = cur < 0 ? 0 : cur - 1;
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (isGrid) {
          const cols = contentRef.current ? getGridColumns(contentRef.current) : 1;
          next = cur < 0 ? 0 : cur + cols;
        } else {
          next = cur < 0 ? 0 : cur + 1;
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (isGrid) {
          const cols = contentRef.current ? getGridColumns(contentRef.current) : 1;
          next = cur < 0 ? 0 : cur - cols;
        } else {
          next = cur < 0 ? 0 : cur - 1;
        }
      } else {
        return;
      }

      navigateTo(next, e.shiftKey);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dispatch, navigateTo]);

  if (!state.selectedFolder) {
    return (
      <div className="photo-panel">
        <div className="photo-welcome">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
          <h2>Welcome to PhotoLense</h2>
          <p>Select a folder from the sidebar to view photos</p>
        </div>
      </div>
    );
  }

  return (
    <div className="photo-panel">
      <div className="photo-content-wrapper">
        {(state.querying || state.indexingState?.isIndexing) && <div className="busy-bar" />}
        <div className="photo-content" ref={contentRef}>
          {state.loading ? (
            <div className="photo-loading">
              <div className="spinner" />
              <p>Loading photos...</p>
            </div>
          ) : state.viewMode === "grid" ? (
            groups ? (
              <div className="photo-groups">
                {groups.map(group => (
                  <div key={group.color} className="photo-group">
                    <h3 
                      id={`group-${group.color.replace(/#/g, '')}`}
                      className="group-header" 
                      style={{
                        padding: "10px 20px",
                        margin: 0,
                        position: "sticky",
                        top: 0,
                        background: "var(--bg-secondary)",
                        zIndex: 10,
                        borderBottom: "1px solid var(--border-color)",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px"
                      }}
                    >
                      <div style={{
                        width: "12px",
                        height: "12px",
                        borderRadius: "50%",
                        backgroundColor: group.color === "Unknown" ? "#666" : group.color,
                        border: "1px solid var(--text-secondary)"
                      }}/>
                      {group.color}
                      <span style={{fontSize: "0.8em", color: "var(--text-secondary)", fontWeight: "normal"}}>
                        ({group.photos.length})
                      </span>
                    </h3>
                    <PhotoGrid
                      photos={group.photos}
                      selectedPhoto={state.selectedPhoto}
                      selectedPaths={state.selectedPaths}
                      showOverlay={state.showOverlay}
                      focusedIndex={focusedIndex}
                      startIndex={group.startIndex}
                      dispatch={dispatch}
                      onSelect={selectPhoto}
                      onOpen={openLightbox}
                      onFocus={setFocusedIndex}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <PhotoGrid
                photos={displayPhotos}
                selectedPhoto={state.selectedPhoto}
                selectedPaths={state.selectedPaths}
                showOverlay={state.showOverlay}
                focusedIndex={focusedIndex}
                dispatch={dispatch}
                onSelect={selectPhoto}
                onOpen={openLightbox}
                onFocus={setFocusedIndex}
              />
            )
          ) : (
            <PhotoList
              photos={displayPhotos}
              selectedPhoto={state.selectedPhoto}
              selectedPaths={state.selectedPaths}
              focusedIndex={focusedIndex}
              dispatch={dispatch}
              onSelect={selectPhoto}
              onOpen={openLightbox}
              onFocus={setFocusedIndex}
            />
          )}
        </div>
        
        {groups && (
          <GroupIndex 
            groups={groups.map(g => ({ color: g.color, count: g.photos.length }))}
            onScrollToGroup={scrollToGroup}
          />
        )}
        
        <SelectionActionBar />
      </div>

      {state.showExif && (
        <ExifPanel
          exif={state.exifData}
          histogramData={state.histogramData}
          selectedPhoto={state.selectedPhoto}
        />
      )}

      {lightboxIndex !== null && (
        <Lightbox
          photos={displayPhotos}
          index={lightboxIndex}
          onClose={closeLightbox}
          onIndexChange={setLightboxIndex}
        />
      )}
    </div>
  );
}
