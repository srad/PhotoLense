import { useCallback, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { listPhotos, queryPhotos, findSimilarPhotos, readExif, getHistogram } from "../api/commands";
import { clearThumbnailCache } from "../components/PhotoPanel/LazyThumbnail";
import { useAppDispatch, useAppState } from "./useAppState";
import { useNotifications } from "./useNotifications";
import type { PhotoEntry } from "../types";

export function usePhotos() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { actions: notifActions } = useNotifications();
  const selectedFolderRef = useRef(state.selectedFolder);
  selectedFolderRef.current = state.selectedFolder;
  const sortByRef = useRef(state.sortBy);
  sortByRef.current = state.sortBy;
  const sortOrderRef = useRef(state.sortOrder);
  sortOrderRef.current = state.sortOrder;
  const searchRef = useRef(state.searchQuery);
  searchRef.current = state.searchQuery;
  const filterTagsRef = useRef(state.filterTags);
  filterTagsRef.current = state.filterTags;
  const similaritySearchRef = useRef(state.similaritySearch);
  similaritySearchRef.current = state.similaritySearch;
  const notifActionsRef = useRef(notifActions);
  notifActionsRef.current = notifActions;
  const lastRetryRef = useRef(0);
  const partialResultShownRef = useRef(false);
  const importThrottleRef = useRef(0);
  const indexThrottleRef = useRef(0);

  const loadPhotos = useCallback(
    async (folderPath: string, opts?: { clearCache?: boolean; silent?: boolean }) => {
      if (!opts?.silent) {
        dispatch({ type: "SET_LOADING", loading: true });
      }
      dispatch({ type: "SET_ERROR", error: null });
      // Only clear thumbnail cache when switching to a different folder
      if (opts?.clearCache !== false && folderPath !== selectedFolderRef.current) {
        clearThumbnailCache();
      }
      try {
        // Query DB first — shows cached results instantly for previously imported folders
        const cached = await queryPhotos(
          folderPath,
          searchRef.current || null,
          sortByRef.current,
          sortOrderRef.current,
          filterTagsRef.current
        );
        if (cached.length > 0) {
          dispatch({ type: "SET_PHOTOS", photos: cached });
          dispatch({ type: "SET_LOADING", loading: false });
        }

        // Import phase — sync filesystem to DB (runs after cached results are shown)
        await listPhotos(folderPath);

        // Re-query for updated results (picks up new/modified/deleted files)
        const photos = await queryPhotos(
          folderPath,
          searchRef.current || null,
          sortByRef.current,
          sortOrderRef.current,
          filterTagsRef.current
        );
        dispatch({ type: "SET_PHOTOS", photos });
      } catch (err) {
        dispatch({
          type: "SET_ERROR",
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        dispatch({ type: "SET_LOADING", loading: false });
      }
    },
    [dispatch]
  );

  // Re-query DB when search or sort params change, or similarity search changes
  useEffect(() => {
    const folder = selectedFolderRef.current;
    if (!folder) return;

    let cancelled = false;
    dispatch({ type: "SET_QUERYING", querying: true });
    (async () => {
      try {
        let photos;
        if (state.similaritySearch) {
          photos = await findSimilarPhotos(
            folder,
            state.similaritySearch.referencePath,
            state.similaritySearch.threshold
          );
        } else {
          photos = await queryPhotos(
            folder,
            state.searchQuery || null,
            state.sortBy,
            state.sortOrder,
            state.filterTags
          );
        }
        if (!cancelled) dispatch({ type: "SET_PHOTOS", photos });
      } catch (err) {
        console.error("Failed to query photos:", err);
      } finally {
        if (!cancelled) dispatch({ type: "SET_QUERYING", querying: false });
      }
    })();

    return () => { cancelled = true; };
  }, [state.searchQuery, state.sortBy, state.sortOrder, state.filterTags, state.similaritySearch, dispatch]);

  // Listen for backend indexing-progress events → drive indexingState + progressive similarity results
  useEffect(() => {
    const unlistenIndexing = listen<{ current: number; total: number; done?: boolean; file?: string }>(
      "indexing-progress",
      (event) => {
        if (event.payload.done) {
          dispatch({ type: "SET_INDEXING_STATE", state: null });
          lastRetryRef.current = 0;
          partialResultShownRef.current = false;

          const sim = similaritySearchRef.current;
          const folder = selectedFolderRef.current;
          if (folder && sim) {
            // Final re-query for similarity search
            findSimilarPhotos(folder, sim.referencePath, sim.threshold)
              .then((photos) => {
                dispatch({ type: "SET_PHOTOS", photos });
                notifActionsRef.current.replaceNotification("similarity-status", {
                  type: "success",
                  message: "Indexing complete — showing all similar photos.",
                  busy: false,
                  autoDismissMs: 5000,
                });
              })
              .catch(console.error);
          } else if (folder) {
            // Re-query photos so has_embedding flags are updated
            queryPhotos(folder, searchRef.current || null, sortByRef.current, sortOrderRef.current, filterTagsRef.current)
              .then((photos) => dispatch({ type: "SET_PHOTOS", photos }))
              .catch(console.error);
          }
        } else {
          // Throttle UI updates to max 5/sec to avoid re-render storms
          const now = performance.now();
          if (now - indexThrottleRef.current >= 200) {
            indexThrottleRef.current = now;
            dispatch({
              type: "SET_INDEXING_STATE",
              state: {
                current: event.payload.current,
                total: event.payload.total,
                label: "Indexing",
                isIndexing: true,
              },
            });
          }

          // Progressive similarity: retry every 10 newly indexed photos
          const sim = similaritySearchRef.current;
          const folder = selectedFolderRef.current;
          if (folder && sim && event.payload.current - lastRetryRef.current >= 10) {
            lastRetryRef.current = event.payload.current;
            findSimilarPhotos(folder, sim.referencePath, sim.threshold)
              .then((photos) => {
                if (photos.length > 0) {
                  dispatch({ type: "SET_PHOTOS", photos });
                  partialResultShownRef.current = true;
                  notifActionsRef.current.replaceNotification("similarity-status", {
                    type: "info",
                    message: `Showing partial results (${event.payload.current}/${event.payload.total} indexed)...`,
                    busy: true,
                  });
                }
              })
              .catch(() => {});
          }
        }
      }
    );

    const unlistenImport = listen<{ current: number; total: number; done?: boolean }>(
      "import-progress",
      (event) => {
        if (event.payload.done) {
          importThrottleRef.current = 0;
          dispatch({ type: "SET_IMPORT_STATE", state: null });
        } else {
          // Throttle progress updates to max 5/sec to avoid re-render storms
          const now = performance.now();
          if (now - importThrottleRef.current < 200) return;
          importThrottleRef.current = now;
          dispatch({
            type: "SET_IMPORT_STATE",
            state: {
              current: event.payload.current,
              total: event.payload.total,
              label: "Importing",
            },
          });
        }
      }
    );

    return () => {
      unlistenIndexing.then((f) => f());
      unlistenImport.then((f) => f());
    };
  }, [dispatch]);

  useEffect(() => {
    const unlisten = listen("folder-changed", () => {
      const folder = selectedFolderRef.current;
      if (folder) {
        loadPhotos(folder, { clearCache: false, silent: true });
      }
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, [loadPhotos]);

  // Clean up similarity notification when search is cleared
  useEffect(() => {
    if (!state.similaritySearch) {
      notifActions.removeNotification("similarity-status");
      lastRetryRef.current = 0;
      partialResultShownRef.current = false;
    }
  }, [state.similaritySearch, notifActions]);

  const selectPhoto = useCallback(
    (photo: PhotoEntry | null) => {
      dispatch({ type: "SET_SELECTED_PHOTO", photo });
      dispatch({ type: "SET_EXIF", data: null });
      dispatch({ type: "SET_HISTOGRAM", data: null });
    },
    [dispatch]
  );

  // Load EXIF data asynchronously only when the exif panel is open
  useEffect(() => {
    if (!state.showExif || !state.selectedPhoto) {
      return;
    }
    let cancelled = false;
    readExif(state.selectedPhoto.path)
      .then((exif) => {
        if (!cancelled) dispatch({ type: "SET_EXIF", data: exif });
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: "SET_EXIF", data: null });
      });
    return () => { cancelled = true; };
  }, [state.showExif, state.selectedPhoto, dispatch]);

  // Load histogram data when the info panel is open
  useEffect(() => {
    if (!state.showExif || !state.selectedPhoto) {
      return;
    }
    let cancelled = false;
    getHistogram(state.selectedPhoto.path)
      .then((data) => {
        if (!cancelled) dispatch({ type: "SET_HISTOGRAM", data });
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: "SET_HISTOGRAM", data: null });
      });
    return () => { cancelled = true; };
  }, [state.showExif, state.selectedPhoto, dispatch]);

  return { loadPhotos, selectPhoto };
}
