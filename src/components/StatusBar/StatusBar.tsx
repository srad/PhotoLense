import { useMemo } from "react";
import { useAppState } from "../../hooks/useAppState";
import "./StatusBar.css";
import { LucideFolder, LucideHardDrive, LucideImages } from "lucide-react";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function StatusBar() {
  const state = useAppState();

  const folderInfo = useMemo(() => {
    if (!state.photos.length) return null;
    const totalSize = state.photos.reduce((sum, p) => sum + p.size, 0);
    return {count: state.photos.length, size: formatSize(totalSize)};
  }, [state.photos]);

  if (!state.selectedFolder) return null;

  return (
    <div className="status-bar">
      {folderInfo && (
        <>
          <span className="status-bar-item">
            <LucideImages size={14}/>
            {folderInfo.count} {folderInfo.count === 1 ? "file" : "files"}
          </span>
          <span className="status-bar-separator"/>
          <span className="status-bar-item">
            <LucideHardDrive size={14}/>
            {folderInfo.size}
          </span>
          <span className="status-bar-separator"/>
        </>
      )}
      <span className="status-bar-item status-bar-path" title={state.selectedFolder}>
        <LucideFolder size={14}/>
        <span style={{overflow: "hidden", textOverflow: "ellipsis"}}>
          {state.selectedFolder}
        </span>
      </span>
    </div>
  );
}
