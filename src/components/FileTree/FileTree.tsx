import { useEffect, useCallback, useRef } from "react";
import { listDrives, listDirectory } from "../../api/commands";
import { useAppState, useAppDispatch } from "../../hooks/useAppState";
import { usePhotos } from "../../hooks/usePhotos";
import { useFileTree } from "../../hooks/useFileTree";
import { TreeNode } from "./TreeNode";
import type { TreeNodeData } from "../../types";
import "./FileTree.css";

const STORAGE_KEY = "photolense_last_folder";



export function FileTree() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { loadPhotos } = usePhotos();
  const { expandToFolder } = useFileTree();
  const restoredRef = useRef(false);

  useEffect(() => {
    async function init() {
      try {
        const drives = await listDrives();
        dispatch({ type: "SET_DRIVES", drives });
        const nodes: TreeNodeData[] = drives.map((d) => ({
          name: d.name,
          path: d.path,
          expanded: false,
          loaded: false,
        }));
        dispatch({ type: "SET_TREE_NODES", nodes });

        // Restore last opened folder
        if (!restoredRef.current) {
          restoredRef.current = true;
          const saved = localStorage.getItem(STORAGE_KEY);
          if (saved) {
            await expandToFolder(saved);
          }
        }
      } catch (err) {
        dispatch({
          type: "SET_ERROR",
          error: `Failed to list drives: ${err}`,
        });
      }
    }
    init();
  }, [dispatch, expandToFolder]);

  const handleToggle = useCallback(
    async (path: string) => {
      const findNode = (nodes: TreeNodeData[]): TreeNodeData | null => {
        for (const n of nodes) {
          if (n.path === path) return n;
          if (n.children) {
            const found = findNode(n.children);
            if (found) return found;
          }
        }
        return null;
      };

      const node = findNode(state.treeNodes);
      if (!node) return;

      if (node.expanded) {
        dispatch({ type: "TOGGLE_TREE_NODE", path });
        return;
      }

      if (!node.loaded) {
        try {
          const entries = await listDirectory(path);
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
            path,
            children,
            expanded: true,
          });
        } catch (err) {
          console.error("Failed to list directory:", err);
          dispatch({
            type: "UPDATE_TREE_NODE",
            path,
            children: [],
            expanded: true,
          });
        }
      } else {
        dispatch({ type: "TOGGLE_TREE_NODE", path });
      }
    },
    [state.treeNodes, dispatch]
  );

  const handleSelect = useCallback(
    (path: string) => {
      dispatch({ type: "SET_SELECTED_FOLDER", path });
      loadPhotos(path);
      localStorage.setItem(STORAGE_KEY, path);
    },
    [dispatch, loadPhotos]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, folderPath: string) => {
      e.preventDefault();
      dispatch({
        type: "SET_CONTEXT_MENU",
        menu: { x: e.clientX, y: e.clientY, folderPath },
      });
    },
    [dispatch]
  );

  return (
    <div className="file-tree">
      {/*<div className="file-tree-header">*/}
      {/*  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">*/}
      {/*    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />*/}
      {/*  </svg>*/}
      {/*  <span>Explorer</span>*/}
      {/*</div>*/}
      <div className="file-tree-content">
        {state.treeNodes.map((node) => (
          <TreeNode
            key={node.path}
            node={node}
            depth={0}
            selectedPath={state.selectedFolder}
            onToggle={handleToggle}
            onSelect={handleSelect}
            onContextMenu={handleContextMenu}
          />
        ))}
      </div>
    </div>
  );
}
