import { createContext, useContext, useReducer, type Dispatch } from "react";
import type { AppState, AppAction, TreeNodeData, ClassifyDialogState } from "../types";

const initialClassifyDialog: ClassifyDialogState = {
  open: false,
  folderPath: null,
  status: "idle",
  progress: null,
  modelStatus: null,
  error: null,
};

export const initialState: AppState = {
  drives: [],
  treeNodes: [],
  selectedFolder: null,
  photos: [],
  selectedPhoto: null,
  exifData: null,
  histogramData: null,
  viewMode: "grid",
  sortBy: "name",
  sortOrder: "asc",
  searchQuery: "",
  selectedPaths: [],
  filterTags: [],
  loading: false,
  error: null,
  showExif: false,
  showOverlay: localStorage.getItem("showOverlay") === "true",
  classifyDialog: initialClassifyDialog,
  contextMenu: null,
  similaritySearch: null,
  querying: false,
  indexingState: null,
  importState: null,
  colorGroups: null,
};

function updateTreeNodes(
  nodes: TreeNodeData[],
  path: string,
  children: TreeNodeData[],
  expanded: boolean
): TreeNodeData[] {
  return nodes.map((node) => {
    if (node.path === path) {
      return { ...node, children, expanded, loaded: true };
    }
    if (node.children) {
      return {
        ...node,
        children: updateTreeNodes(node.children, path, children, expanded),
      };
    }
    return node;
  });
}

function toggleTreeNode(nodes: TreeNodeData[], path: string): TreeNodeData[] {
  return nodes.map((node) => {
    if (node.path === path) {
      return { ...node, expanded: !node.expanded };
    }
    if (node.children) {
      return { ...node, children: toggleTreeNode(node.children, path) };
    }
    return node;
  });
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_DRIVES":
      return { ...state, drives: action.drives };
    case "SET_TREE_NODES":
      return { ...state, treeNodes: action.nodes };
    case "UPDATE_TREE_NODE":
      return {
        ...state,
        treeNodes: updateTreeNodes(
          state.treeNodes,
          action.path,
          action.children,
          action.expanded
        ),
      };
    case "TOGGLE_TREE_NODE":
      return {
        ...state,
        treeNodes: toggleTreeNode(state.treeNodes, action.path),
      };
    case "SET_SELECTED_FOLDER":
      return { ...state, selectedFolder: action.path, selectedPhoto: null, exifData: null, histogramData: null, selectedPaths: [], filterTags: [], similaritySearch: null, colorGroups: null };
    case "SET_PHOTOS":
      return { ...state, photos: action.photos, selectedPaths: [] };
    case "SET_SELECTED_PHOTO":
      return { ...state, selectedPhoto: action.photo };
    case "SET_EXIF":
      return { ...state, exifData: action.data };
    case "SET_HISTOGRAM":
      return { ...state, histogramData: action.data };
    case "SET_VIEW_MODE":
      return { ...state, viewMode: action.mode };
    case "SET_SORT_BY":
      return { ...state, sortBy: action.sortBy };
    case "SET_SORT_ORDER":
      return { ...state, sortOrder: action.order };
    case "SET_SEARCH_QUERY":
      return { ...state, searchQuery: action.query, selectedPaths: [] };
    case "SET_LOADING":
      return { ...state, loading: action.loading };
    case "SET_ERROR":
      return { ...state, error: action.error };
    case "TOGGLE_EXIF":
      return { ...state, showExif: !state.showExif };
    case "TOGGLE_OVERLAY": {
      const next = !state.showOverlay;
      localStorage.setItem("showOverlay", String(next));
      return { ...state, showOverlay: next };
    }
    case "SET_CLASSIFY_DIALOG":
      return {
        ...state,
        classifyDialog: { ...state.classifyDialog, ...action.state },
      };
    case "SET_CONTEXT_MENU":
      return { ...state, contextMenu: action.menu };
    case "UPDATE_PHOTO_TAGS": {
      const tagMap = new Map(action.updates.map((u) => [u.path, u.tags]));
      const newPhotos = state.photos.map((p) => {
        const tags = tagMap.get(p.path);
        if (tags) return { ...p, tags };
        return p;
      });
      return { ...state, photos: newPhotos };
    }
    case "SET_SELECTION":
      return { ...state, selectedPaths: action.paths };
    case "TOGGLE_SELECTION": {
      const set = new Set(state.selectedPaths);
      if (set.has(action.path)) {
        set.delete(action.path);
      } else {
        set.add(action.path);
      }
      return { ...state, selectedPaths: Array.from(set) };
    }
    case "RANGE_SELECTION": {
      const start = Math.min(action.from, action.to);
      const end = Math.max(action.from, action.to);
      const rangePaths = state.photos.slice(start, end + 1).map((p) => p.path);
      // Merge with existing selection
      const merged = new Set([...state.selectedPaths, ...rangePaths]);
      return { ...state, selectedPaths: Array.from(merged) };
    }
    case "SELECT_ALL":
      return { ...state, selectedPaths: state.photos.map((p) => p.path) };
    case "CLEAR_SELECTION":
      return { ...state, selectedPaths: [] };
    case "SET_FILTER_TAGS":
      return { ...state, filterTags: action.tags, selectedPaths: [], selectedPhoto: null, exifData: null, histogramData: null };
    case "SET_SIMILARITY_SEARCH":
      return { ...state, similaritySearch: action.search, selectedPaths: [], selectedPhoto: null, exifData: null, histogramData: null };
    case "SET_SIMILARITY_THRESHOLD":
      return state.similaritySearch
        ? { ...state, similaritySearch: { ...state.similaritySearch, threshold: action.threshold } }
        : state;
    case "SET_QUERYING":
      return { ...state, querying: action.querying };
    case "SET_INDEXING_STATE":
      return { ...state, indexingState: action.state };
    case "SET_IMPORT_STATE":
      return { ...state, importState: action.state };
    case "SET_COLOR_GROUPS":
      return { ...state, colorGroups: action.groups };
    case "REMOVE_PHOTOS": {
      const removedSet = new Set(action.paths);
      const newPhotos = state.photos.filter((p) => !removedSet.has(p.path));
      // Also clear selection if it contained any removed photos
      const newSelection = state.selectedPaths.filter((p) => !removedSet.has(p));
      const newSelectedPhoto = state.selectedPhoto && removedSet.has(state.selectedPhoto.path)
        ? null
        : state.selectedPhoto;

      return {
        ...state,
        photos: newPhotos,
        selectedPaths: newSelection,
        selectedPhoto: newSelectedPhoto,
        // If the selected photo was removed, clear EXIF + histogram too
        exifData: newSelectedPhoto ? state.exifData : null,
        histogramData: newSelectedPhoto ? state.histogramData : null,
      };
    }
    default:
      return state;
  }
}

export const AppStateContext = createContext<AppState>(initialState);
export const AppDispatchContext = createContext<Dispatch<AppAction>>(() => {});

export function useAppState() {
  return useContext(AppStateContext);
}

export function useAppDispatch() {
  return useContext(AppDispatchContext);
}

export function useAppReducer() {
  return useReducer(appReducer, initialState);
}
