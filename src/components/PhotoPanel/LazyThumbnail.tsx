import { memo, useEffect, useRef, useState } from "react";
import { getThumbnail, getThumbnailsBatch } from "../../api/commands";

interface LazyThumbnailProps {
  path: string;
  alt: string;
  className?: string;
}

// Simple in-memory cache so thumbnails survive re-renders and scrolling back
const thumbnailCache = new Map<string, string>();

// --- Batched thumbnail loading ---
// Requests arriving within the same frame are coalesced into a single IPC call
// that fetches all cached thumbnails in one DB query. Uncached thumbnails fall
// back to individual generation with a concurrency limiter.

const BATCH_DELAY_MS = 10;
type Subscriber = { resolve: (v: string) => void; reject: (e: unknown) => void };
let pendingBatch = new Map<string, Subscriber[]>();
let batchTimer: ReturnType<typeof setTimeout> | null = null;

// Concurrency limiter for individual (uncached) thumbnail generation
const MAX_CONCURRENT = 6;
let activeRequests = 0;
const slotQueue: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (activeRequests < MAX_CONCURRENT) {
      activeRequests++;
      resolve();
    } else {
      slotQueue.push(() => { activeRequests++; resolve(); });
    }
  });
}

function releaseSlot() {
  activeRequests--;
  const next = slotQueue.shift();
  if (next) next();
}

function loadUncached(path: string, subscribers: Subscriber[]) {
  acquireSlot().then(() => {
    getThumbnail(path)
      .then((data) => {
        thumbnailCache.set(path, data);
        for (const s of subscribers) s.resolve(data);
      })
      .catch((err) => {
        for (const s of subscribers) s.reject(err);
      })
      .finally(releaseSlot);
  });
}

async function flushBatch() {
  batchTimer = null;
  const batch = pendingBatch;
  pendingBatch = new Map();

  const paths = Array.from(batch.keys());
  if (paths.length === 0) return;

  try {
    // Single IPC call fetches all cached thumbnails from DB
    const results = await getThumbnailsBatch(paths);

    for (const [path, subscribers] of batch) {
      const data = results[path];
      if (data) {
        thumbnailCache.set(path, data);
        for (const s of subscribers) s.resolve(data);
      } else {
        // Not cached in DB — fall back to individual generation
        loadUncached(path, subscribers);
      }
    }
  } catch {
    // Batch call failed — fall back to individual loading for all
    for (const [path, subscribers] of batch) {
      loadUncached(path, subscribers);
    }
  }
}

function requestThumbnail(path: string): Promise<string> {
  // In-memory cache hit — instant
  const cached = thumbnailCache.get(path);
  if (cached) return Promise.resolve(cached);

  return new Promise<string>((resolve, reject) => {
    let subs = pendingBatch.get(path);
    if (!subs) {
      subs = [];
      pendingBatch.set(path, subs);
    }
    subs.push({ resolve, reject });

    if (batchTimer === null) {
      batchTimer = setTimeout(flushBatch, BATCH_DELAY_MS);
    }
  });
}

// --- Component ---

export const LazyThumbnail = memo(function LazyThumbnail({ path, alt, className }: LazyThumbnailProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(() => thumbnailCache.get(path) ?? null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (thumbnailCache.has(path)) {
      setSrc(thumbnailCache.get(path)!);
      return;
    }

    const el = ref.current;
    if (!el) return;

    let cancelled = false;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          observer.disconnect();
          setLoading(true);
          requestThumbnail(path)
            .then((data) => { if (!cancelled) setSrc(data); })
            .catch(() => {})
            .finally(() => { if (!cancelled) setLoading(false); });
        }
      },
      { rootMargin: "200px" }
    );

    observer.observe(el);
    return () => { cancelled = true; observer.disconnect(); };
  }, [path]);

  if (src) {
    return <img src={src} alt={alt} className={className} />;
  }

  return (
    <div ref={ref} className={`lazy-thumb-placeholder ${className ?? ""}`}>
      {loading && <div className="thumb-spinner" />}
    </div>
  );
});

/** Call this when navigating to a new folder to free memory */
export function clearThumbnailCache() {
  thumbnailCache.clear();
}
