import type { ExifData, PhotoEntry } from "../../types";
import { FileInfo } from "./FileInfo";
import { Histogram } from "./Histogram";
import "./PhotoPanel.css";

interface ExifPanelProps {
  exif: ExifData | null;
  histogramData: string | null;
  selectedPhoto: PhotoEntry | null;
}

export function ExifPanel({ exif, histogramData, selectedPhoto }: ExifPanelProps) {
  if (!selectedPhoto) {
    return (
      <div className="exif-panel">
        <div className="exif-header">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
          <span>Info</span>
        </div>
        <div className="exif-empty">
          <p>Select a photo to view info</p>
        </div>
      </div>
    );
  }

  const fields: [string, string | null | undefined][] = exif
    ? [
        ["Camera", [exif.camera_make, exif.camera_model].filter(Boolean).join(" ") || null],
        ["Date", exif.date_taken],
        ["Exposure", exif.exposure_time],
        ["Aperture", exif.f_number ? `f/${exif.f_number}` : null],
        ["ISO", exif.iso],
        ["Focal Length", exif.focal_length],
        ["Dimensions", exif.width && exif.height ? `${exif.width} x ${exif.height}` : null],
        ["Orientation", exif.orientation],
        ["Flash", exif.flash],
        ["White Balance", exif.white_balance],
        ["Software", exif.software],
        ["GPS", exif.gps_latitude != null && exif.gps_longitude != null
          ? `${exif.gps_latitude.toFixed(6)}, ${exif.gps_longitude.toFixed(6)}`
          : null],
      ]
    : [];

  return (
    <div className="exif-panel">
      <div className="exif-header">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4M12 8h.01" />
        </svg>
        <span>Info</span>
      </div>

      <div className="exif-filename">{selectedPhoto.name}</div>

      <FileInfo photo={selectedPhoto} />

      <Histogram data={histogramData} />

      {exif ? (
        <div className="exif-fields">
          {fields.map(
            ([label, value]) =>
              value && (
                <div className="exif-field" key={label}>
                  <span className="exif-label">{label}</span>
                  <span className="exif-value">{value}</span>
                </div>
              )
          )}
          {fields.every(([, v]) => !v) && (
            <div className="exif-empty">
              <p>No EXIF data available</p>
            </div>
          )}
        </div>
      ) : (
        <div className="exif-fields">
          <div className="exif-loading">
            <div className="thumb-spinner" />
          </div>
        </div>
      )}
    </div>
  );
}
