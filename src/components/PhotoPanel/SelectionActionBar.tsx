import { useState } from "react";
import { open, ask } from "@tauri-apps/plugin-dialog";
import { useAppState, useAppDispatch } from "../../hooks/useAppState";
import { usePhotos } from "../../hooks/usePhotos";
import { deleteFiles, moveFiles, copyFiles } from "../../api/commands";
import { FindSimilarButton } from "./FindSimilarButton";

export function SelectionActionBar() {
  const { selectedPaths, selectedFolder } = useAppState();
  const dispatch = useAppDispatch();
  const { loadPhotos } = usePhotos();
  const [busy, setBusy] = useState(false);

  if (selectedPaths.length === 0) return null;

  const handleDelete = async () => {
    const count = selectedPaths.length;
    const confirmed = await ask(
      `Delete ${count} file${count > 1 ? "s" : ""}? This cannot be undone.`,
      { title: "Confirm Delete", kind: "warning" }
    );
    if (!confirmed) return;

    setBusy(true);
    try {
      await deleteFiles(selectedPaths);
      // Optimistic update: remove from UI immediately without full reload
      dispatch({ type: "REMOVE_PHOTOS", paths: selectedPaths });
    } catch (err) {
      alert(`Delete failed: ${err}`);
      // If failed, reload to ensure state matches reality
      if (selectedFolder) loadPhotos(selectedFolder, { silent: true });
    } finally {
      setBusy(false);
    }
  };

  const handleMove = async () => {
    const dest = await open({ directory: true, title: "Move files to..." });
    if (!dest) return;

    setBusy(true);
    try {
      await moveFiles(selectedPaths, dest);
      // Optimistic update: remove from UI immediately
      dispatch({ type: "REMOVE_PHOTOS", paths: selectedPaths });
    } catch (err) {
      alert(`Move failed: ${err}`);
      if (selectedFolder) loadPhotos(selectedFolder, { silent: true });
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    const dest = await open({ directory: true, title: "Copy files to..." });
    if (!dest) return;

    setBusy(true);
    try {
      await copyFiles(selectedPaths, dest);
      dispatch({ type: "CLEAR_SELECTION" });
    } catch (err) {
      alert(`Copy failed: ${err}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="selection-action-bar">
      <span className="selection-count">
        {selectedPaths.length} file{selectedPaths.length > 1 ? "s" : ""} selected
      </span>
      <div className="selection-actions">
        <button className="selection-btn selection-btn-danger" onClick={handleDelete} disabled={busy}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
          Delete
        </button>
        <button className="selection-btn" onClick={handleMove} disabled={busy}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
          Move to...
        </button>
        <button className="selection-btn" onClick={handleCopy} disabled={busy}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          Copy to...
        </button>
        <FindSimilarButton disabled={busy} />
      </div>
      <button
        className="selection-btn selection-btn-clear"
        onClick={() => dispatch({ type: "CLEAR_SELECTION" })}
      >
        Clear
      </button>
    </div>
  );
}
