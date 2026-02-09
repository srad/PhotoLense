import { type Dispatch, memo, type MouseEvent, useCallback, useMemo, useRef } from "react";
import type { AppAction, PhotoEntry } from "../../types";
import { LazyThumbnail } from "./LazyThumbnail";
import "./PhotoList.css";
import { CameraOff, CheckCircle, Circle } from "lucide-react";

interface PhotoListItemProps {
  photo: PhotoEntry;
  index: number;
  isSelected: boolean;
  isMultiSelected: boolean;
  isFocused: boolean;
  onItemClick: (photo: PhotoEntry, index: number, e: MouseEvent) => void;
  onItemDoubleClick: (index: number) => void;
  onCheckClick: (photo: PhotoEntry, e: MouseEvent) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(timestamp: number | null): string {
  if (!timestamp) return "\u2014";
  return new Date(timestamp * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const PhotoListItem = memo(function PhotoListItem({
                                                    photo, index, isSelected, isMultiSelected, isFocused,
                                                    onItemClick, onItemDoubleClick, onCheckClick,
                                                  }: PhotoListItemProps) {
  return (
    <div
      className={`photo-list-item ${isSelected ? "selected" : ""} ${isMultiSelected ? "multi-selected" : ""} ${isFocused ? "focused" : ""}`}
      onClick={(e) => onItemClick(photo, index, e)}
      onDoubleClick={() => onItemDoubleClick(index)}
    >
      <span className="list-col-selector">
        <div
          className={`list-select-check ${isMultiSelected ? "checked" : ""}`}
          onClick={(e) => onCheckClick(photo, e)}
        >
          {isMultiSelected ? (
            <CheckCircle size={16}/>
          ) : <Circle size={16}/>}
        </div>
      </span>
      <span className="list-col-thumb">
        <LazyThumbnail path={photo.path} alt={photo.name}/>
      </span>
      <span className="list-col-name" title={photo.name}>
        {photo.name}
      </span>
      <span className="list-col-size">{formatSize(photo.size)}</span>
      <span className="list-col-resolution">{photo.width}x{photo.height}px</span>
      <span className="list-col-date">{formatDate(photo.modified)}</span>
    </div>
  );
});

interface PhotoListProps {
  photos: PhotoEntry[];
  selectedPhoto: PhotoEntry | null;
  selectedPaths: string[];
  focusedIndex: number;
  dispatch: Dispatch<AppAction>;
  onSelect: (photo: PhotoEntry) => void;
  onOpen: (index: number) => void;
  onFocus: (index: number) => void;
}

export const PhotoList = memo(function PhotoList({
                                                   photos, selectedPhoto, selectedPaths, focusedIndex,
                                                   dispatch, onSelect, onOpen, onFocus,
                                                 }: PhotoListProps) {
  const selectedSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);

  const focusedIndexRef = useRef(focusedIndex);
  focusedIndexRef.current = focusedIndex;

  const handleItemClick = useCallback((photo: PhotoEntry, index: number, e: MouseEvent) => {
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
        <CameraOff size={48}/>
        <p>No photos in this folder</p>
      </div>
    );
  }

  return (
    <div className="photo-list">
      <div className="photo-list-header">
        <span className="list-col-selector"></span>
        <span className="list-col-name">Name</span>
        <span className="list-col-size">Size</span>
        <span className="list-col-resolution">Resolution</span>
        <span className="list-col-date">Modified</span>
      </div>
      {photos.map((photo, i) => (
        <PhotoListItem
          key={photo.path}
          photo={photo}
          index={i}
          isSelected={selectedPhoto?.path === photo.path}
          isMultiSelected={selectedSet.has(photo.path)}
          isFocused={focusedIndex === i}
          onItemClick={handleItemClick}
          onItemDoubleClick={onOpen}
          onCheckClick={handleCheckClick}
        />
      ))}
    </div>
  );
});
