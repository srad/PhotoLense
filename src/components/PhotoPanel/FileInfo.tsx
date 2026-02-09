import type { PhotoEntry } from "../../types";
import "./PhotoPanel.css";

interface FileInfoProps {
  photo: PhotoEntry;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function FileInfo({ photo }: FileInfoProps) {
  return (
    <div className="info-file-details">
      <div className="exif-field">
        <span className="exif-label">Path</span>
        <span className="exif-value">{photo.path}</span>
      </div>
      <div className="exif-field">
        <span className="exif-label">Size</span>
        <span className="exif-value">{formatFileSize(photo.size)}</span>
      </div>
    </div>
  );
}
