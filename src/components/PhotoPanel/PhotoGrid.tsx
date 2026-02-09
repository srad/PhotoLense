import { memo, useMemo, useCallback, useRef, type MouseEvent, type Dispatch } from "react";
import type { AppAction, PhotoEntry } from "../../types";
import { LazyThumbnail } from "./LazyThumbnail";
import "./PhotoGrid.css";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface PhotoGridItemProps {
  photo: PhotoEntry;
  index: number;
  isSelected: boolean;
  isMultiSelected: boolean;
  isFocused: boolean;
  showOverlay: boolean;
  onItemClick: (photo: PhotoEntry, index: number, e: MouseEvent) => void;
  onItemDoubleClick: (index: number) => void;
  onCheckClick: (photo: PhotoEntry, e: MouseEvent) => void;
}

const PhotoGridItem = memo(function PhotoGridItem({
  photo, index, isSelected, isMultiSelected, isFocused, showOverlay,
  onItemClick, onItemDoubleClick, onCheckClick,
}: PhotoGridItemProps) {
  return (
    <div
      className={`photo-grid-item ${isSelected ? "selected" : ""} ${isMultiSelected ? "multi-selected" : ""} ${isFocused ? "focused" : ""}`}
      onClick={(e) => onItemClick(photo, index, e)}
      onDoubleClick={() => onItemDoubleClick(index)}
    >
      <div
        className={`select-check ${isMultiSelected ? "checked" : ""}`}
        onClick={(e) => onCheckClick(photo, e)}
      >
        {isMultiSelected && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
          </svg>
        )}
      </div>
      <div className="photo-thumb-container">
        <LazyThumbnail path={photo.path} alt={photo.name}/>
        {showOverlay && (
          <div className="photo-overlay">
            {photo.width && photo.height && (
              <span>{photo.width}x{photo.height}</span>
            )}
            <span>{formatSize(photo.size)}</span>
          </div>
        )}
      </div>
      {showOverlay && (
        <span className="photo-grid-name" title={photo.name}>
          {photo.name}
        </span>
      )}
      {showOverlay && photo.tags && photo.tags.length > 0 && (
        <div className="photo-tags">
          {photo.tags.slice(0, 2).map(tag => (
            <span key={tag} className="photo-tag">{tag}</span>
          ))}
          {photo.tags.length > 2 && <span className="photo-tag">+{photo.tags.length - 2}</span>}
        </div>
      )}
    </div>
  );
});

interface PhotoGridProps {
  photos: PhotoEntry[];
  selectedPhoto: PhotoEntry | null;
  selectedPaths: string[];
  showOverlay: boolean;
  focusedIndex: number;
  startIndex?: number;
  dispatch: Dispatch<AppAction>;
  onSelect: (photo: PhotoEntry) => void;
  onOpen: (index: number) => void;
  onFocus: (index: number) => void;
}

export const PhotoGrid = memo(function PhotoGrid({
  photos, selectedPhoto, selectedPaths, showOverlay, focusedIndex, startIndex = 0,
  dispatch, onSelect, onOpen, onFocus,
}: PhotoGridProps) {
  const selectedSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);

  const focusedIndexRef = useRef(focusedIndex);
  focusedIndexRef.current = focusedIndex;

  const handleItemClick = useCallback((photo: PhotoEntry, index: number, e: MouseEvent) => {
    // index is relative to this grid, convert to global if needed?
    // No, index passed here is `i + startIndex`.
    if (e.ctrlKey || e.metaKey) {
      dispatch({type: "TOGGLE_SELECTION", path: photo.path});
    } else if (e.shiftKey && focusedIndexRef.current >= 0) {
      dispatch({type: "RANGE_SELECTION", from: focusedIndexRef.current, to: index});
    } else {
      onSelect(photo);
    }
    onFocus(index);
  }, [dispatch, onSelect, onFocus]);

  const handleCheckClick = useCallback((photo: PhotoEntry, e: MouseEvent) => {
    e.stopPropagation();
    dispatch({type: "TOGGLE_SELECTION", path: photo.path});
  }, [dispatch]);

  if (photos.length === 0) {
    return (
      <div className="photo-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <polyline points="21 15 16 10 5 21"/>
        </svg>
        <p>No photos in this folder</p>
      </div>
    );
  }

  return (
    <div className="photo-grid">
      {photos.map((photo, i) => {
        const globalIndex = i + startIndex;
        return (
          <PhotoGridItem
            key={photo.path}
            photo={photo}
            index={globalIndex}
            isSelected={selectedPhoto?.path === photo.path}
            isMultiSelected={selectedSet.has(photo.path)}
            isFocused={focusedIndex === globalIndex}
            showOverlay={showOverlay}
            onItemClick={handleItemClick}
            onItemDoubleClick={onOpen}
            onCheckClick={handleCheckClick}
          />
        );
      })}
    </div>
  );
});
