import { useEffect, useCallback, useState } from "react";
import { getImageBytes } from "../../api/commands";
import type { PhotoEntry } from "../../types";

interface LightboxProps {
  photos: PhotoEntry[];
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
}

export function Lightbox({ photos, index, onClose, onIndexChange }: LightboxProps) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const photo = photos[index];

  const goTo = useCallback(
    (dir: -1 | 1) => {
      const next = index + dir;
      if (next >= 0 && next < photos.length) {
        onIndexChange(next);
      }
    },
    [index, photos.length, onIndexChange]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goTo(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goTo(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, goTo]);

  useEffect(() => {
    setLoading(true);
    let cancelled = false;
    let objectUrl: string | null = null;
    
    // Fetch raw image bytes
    // WebView2 (Chromium) automatically respects EXIF orientation in <img> tags.
    // We don't need to manually rotate via CSS.
    getImageBytes(photo.path)
      .then((bytes) => {
        if (cancelled) return;
        const blob = new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });
        objectUrl = URL.createObjectURL(blob);
        setImageSrc(objectUrl);
      })
      .catch((e) => {
        if (!cancelled) console.error("Failed to load image", e);
      });

    return () => { 
      cancelled = true; 
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photo.path]);

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <div 
        className="lightbox-content" 
        onClick={(e) => e.stopPropagation()}
        style={{ position: 'relative', minWidth: '200px', minHeight: '200px' }}
      >
        {imageSrc && (
          <img 
            src={imageSrc} 
            alt={photo.name} 
            className="lightbox-image" 
            style={{ 
              opacity: loading ? 0 : 1, // Hide until loaded to prevent jump
              transition: "opacity 0.2s ease-in"
            }}
            onLoad={() => setLoading(false)}
            onError={() => setLoading(false)}
          />
        )}
        {loading && (
          <div 
            className="lightbox-loading" 
            style={{ position: 'absolute', inset: 0, minWidth: 0, minHeight: 0 }}
          >
            <div className="spinner" />
          </div>
        )}
      </div>

      {index > 0 && (
        <button 
          className="lightbox-nav lightbox-prev" 
          onClick={(e) => { e.stopPropagation(); goTo(-1); }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      )}
      {index < photos.length - 1 && (
        <button 
          className="lightbox-nav lightbox-next" 
          onClick={(e) => { e.stopPropagation(); goTo(1); }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      )}

      <div className="lightbox-footer">
        <span className="lightbox-name">{photo.name}</span>
        <span className="lightbox-counter">{index + 1} / {photos.length}</span>
      </div>

      <button className="lightbox-close" onClick={onClose}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
