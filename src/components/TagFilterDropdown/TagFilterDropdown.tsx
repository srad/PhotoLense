import { useEffect, useRef, useState } from "react";
import { TagsIcon, Trash2 } from "lucide-react";
import { deleteAllTags } from "../../api/commands";
import { useAppState } from "../../hooks/useAppState";
import { usePhotos } from "../../hooks/usePhotos";
import "./TagFilterDropdown.css";

type TagFilterDropdownProps = {
  availableTags: string[];
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
};

export function TagFilterDropdown({
                                    availableTags,
                                    selectedTags,
                                    onToggleTag,
                                  }: TagFilterDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const state = useAppState();
  const { loadPhotos } = usePhotos();

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const handleDeleteAll = async () => {
    if (!state.selectedFolder) return;
    const confirm = await window.confirm("Are you sure you want to delete ALL tags in this folder?");
    if (confirm) {
      try {
        await deleteAllTags(state.selectedFolder);
        setIsOpen(false);
        // Refresh photos to update UI
        await loadPhotos(state.selectedFolder, { clearCache: false, silent: true });
      } catch (error) {
        console.error("Failed to delete tags:", error);
      }
    }
  };

  if (availableTags.length === 0) return null;

  return (
    <div className="tag-filter-dropdown" ref={ref}>
      <button
        className={`tag-filter-btn ${selectedTags.length > 0 ? "active" : ""}`}
        onClick={() => setIsOpen((v) => !v)}
        title="Filter by tags"
        type="button"
      >
        <TagsIcon size={14}/>

        <span>
          {selectedTags.length > 0
            ? `${selectedTags.length} tags`
            : "Tags"}
        </span>
      </button>

      {isOpen && (
        <div className="tag-menu">
          <div className="tag-list">
            {availableTags.map((tag) => (
              <label key={tag} className="tag-menu-item">
                <input
                  type="checkbox"
                  checked={selectedTags.includes(tag)}
                  onChange={() => onToggleTag(tag)}
                />
                <span>{tag}</span>
              </label>
            ))}
          </div>
          <div className="tag-menu-footer">
            <button className="delete-tags-btn" onClick={handleDeleteAll}>
              <Trash2 size={12} />
              <span>Delete All Tags</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}