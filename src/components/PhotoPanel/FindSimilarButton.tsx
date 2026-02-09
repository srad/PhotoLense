import { useAppState, useAppDispatch } from "../../hooks/useAppState";
import { useNotifications } from "../../hooks/useNotifications";
import { getIndexingStatus, triggerIndexing } from "../../api/commands";

export function FindSimilarButton({ disabled }: { disabled?: boolean }) {
  const { selectedPaths, photos, indexingState, selectedFolder } = useAppState();
  const dispatch = useAppDispatch();
  const { actions } = useNotifications();

  const singleSelected = selectedPaths.length === 1
    ? photos.find((p) => p.path === selectedPaths[0])
    : null;

  if (!singleSelected) return null;

  const handleClick = async () => {
    if (!selectedFolder) return;

    // Always dispatch similarity search immediately
    dispatch({
      type: "SET_SIMILARITY_SEARCH",
      search: { referencePath: singleSelected.path, threshold: 50 },
    });

    // If already indexing, just show a notification
    if (indexingState?.isIndexing) {
      actions.addNotification({
        id: "similarity-status",
        type: "warning",
        message: "Indexing in progress — results will update as photos are indexed.",
        busy: true,
      });
      return;
    }

    try {
      const status = await getIndexingStatus(selectedFolder);
      if (status.indexed < status.total) {
        // Not fully indexed — trigger indexing and notify
        try {
          await triggerIndexing(selectedFolder);
          actions.addNotification({
            id: "similarity-status",
            type: "warning",
            message: `Indexing in progress (${status.indexed}/${status.total})...`,
            busy: true,
          });
        } catch (err) {
          actions.addNotification({
            id: "similarity-status",
            type: "warning",
            message: `Cannot start indexing: ${err}. Download an AI model via Classify first.`,
            autoDismissMs: 8000,
          });
        }
      }
      // If fully indexed, no notification needed — results appear instantly
    } catch (err) {
      console.error("Failed to check indexing status:", err);
    }
  };

  return (
    <button className="selection-btn" onClick={handleClick} disabled={disabled}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="8"/>
        <path d="M21 21l-4.35-4.35"/>
      </svg>
      Find Similar
    </button>
  );
}
