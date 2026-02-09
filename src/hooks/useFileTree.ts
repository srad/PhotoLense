import { useCallback } from "react";
import { listDirectory } from "../api/commands";
import { useAppDispatch } from "./useAppState";
import { usePhotos } from "./usePhotos";
import type { TreeNodeData } from "../types";

const STORAGE_KEY = "photolense_last_folder";

function getPathSegments(folderPath: string): string[] {
  // Build cumulative path segments for tree expansion.
  // Paths must match exactly what the Rust backend returns:
  //   Drive root: "C:\"  (with trailing separator)
  //   Subdirs:    "C:\Users", "C:\Users\foo" (no trailing separator)
  //   Unix root:  "/"
  //   Subdirs:    "/home", "/home/user"
  const isWindows = folderPath.includes("\\");
  const sep = isWindows ? "\\" : "/";

  // Normalize: strip trailing separator (unless it IS the root)
  let normalized = folderPath;
  if (normalized.length > 1 && normalized.endsWith(sep)) {
    normalized = normalized.slice(0, -1);
  }

  const parts = normalized.split(sep).filter(Boolean);
  const segments: string[] = [];

  if (isWindows) {
    // Drive root "C:\" is the first segment (matches list_drives output)
    const root = parts[0] + "\\";
    segments.push(root);
    // Subsequent segments: "C:\Users", "C:\Users\foo", etc. (no trailing \)
    for (let i = 1; i < parts.length; i++) {
      segments.push(parts[0] + "\\" + parts.slice(1, i + 1).join("\\"));
    }
  } else {
    segments.push("/");
    let current = "";
    for (const part of parts) {
      current += "/" + part;
      segments.push(current);
    }
  }

  return segments;
}

export function useFileTree() {
  const dispatch = useAppDispatch();
  const { loadPhotos } = usePhotos();

  const expandToFolder = useCallback(
    async (folderPath: string) => {
      const segments = getPathSegments(folderPath);

      // Walk each segment, loading children as needed
      for (const seg of segments) {
        try {
          const entries = await listDirectory(seg);
          const children: TreeNodeData[] = entries
            .filter((e) => e.is_dir)
            .map((e) => ({
              name: e.name,
              path: e.path,
              expanded: false,
              loaded: false,
            }));
          dispatch({
            type: "UPDATE_TREE_NODE",
            path: seg,
            children,
            expanded: true,
          });
        } catch {
          // Folder doesn't exist or not accessible — stop expanding
          return false;
        }
      }

      dispatch({ type: "SET_SELECTED_FOLDER", path: folderPath });
      loadPhotos(folderPath);
      localStorage.setItem(STORAGE_KEY, folderPath);
      return true;
    },
    [dispatch, loadPhotos]
  );

  return { expandToFolder };
}
