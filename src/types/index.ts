export interface DriveInfo {
  name: string;
  path: string;
}

export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

export interface PhotoEntry {
  name: string;
  path: string;
  size: number;
  modified: number | null;
  tags?: string[];
  width?: number | null;
  height?: number | null;
  has_embedding: boolean;
}

export interface ExifData {
  camera_make: string | null;
  camera_model: string | null;
  date_taken: string | null;
  exposure_time: string | null;
  f_number: string | null;
  iso: string | null;
  focal_length: string | null;
  width: number | null;
  height: number | null;
  orientation: string | null;
  orientation_id: number | null;
  gps_latitude: number | null;
  gps_longitude: number | null;
  software: string | null;
  flash: string | null;
  white_balance: string | null;
}

export interface ModelStatus {
  downloaded: boolean;
  loading: boolean;
  ready: boolean;
  error: string | null;
}

export interface Prediction {
  class_name: string;
  confidence: number;
}

export interface ClassifyResult {
  file_name: string;
  file_path: string;
  predictions: Prediction[];
  moved_to: string | null;
}

export type ModelType = "Base" | "Large" | "MobileNetV3Large";

export interface ClassifyProgress {
  current: number;
  total: number;
  current_file: string;
  results: ClassifyResult[];
  remaining_time?: number;
}

export interface SimilaritySearch {
  referencePath: string;
  threshold: number;
}

export type ViewMode = "grid" | "list";
export type SortBy = "name" | "size" | "date";
export type SortOrder = "asc" | "desc";

export interface TreeNodeData {
  name: string;
  path: string;
  children?: TreeNodeData[];
  expanded?: boolean;
  loaded?: boolean;
}

export interface IndexingState {
  current: number;
  total: number;
  label: string;
  isIndexing: boolean;
}

export interface ImportState {
  current: number;
  total: number;
  label: string;
}

export interface AppState {
  drives: DriveInfo[];
  treeNodes: TreeNodeData[];
  selectedFolder: string | null;
  photos: PhotoEntry[];
  selectedPhoto: PhotoEntry | null;
  exifData: ExifData | null;
  histogramData: string | null;
  viewMode: ViewMode;
  sortBy: SortBy;
  sortOrder: SortOrder;
  searchQuery: string;
  loading: boolean;
  error: string | null;
  selectedPaths: string[];
  filterTags: string[];
  showExif: boolean;
  showOverlay: boolean;
  classifyDialog: ClassifyDialogState;
  contextMenu: ContextMenuState | null;
  similaritySearch: SimilaritySearch | null;
  querying: boolean;
  indexingState: IndexingState | null;
  importState: ImportState | null;
  colorGroups: Record<string, string[]> | null;
}

export interface ClassifyDialogState {
  open: boolean;
  folderPath: string | null;
  status: "idle" | "downloading" | "loading" | "classifying" | "done" | "error";
  progress: ClassifyProgress | null;
  modelStatus: ModelStatus | null;
  error: string | null;
}

export interface ContextMenuState {
  x: number;
  y: number;
  folderPath: string;
}

export type AppAction =
  | { type: "SET_DRIVES"; drives: DriveInfo[] }
  | { type: "SET_TREE_NODES"; nodes: TreeNodeData[] }
  | { type: "UPDATE_TREE_NODE"; path: string; children: TreeNodeData[]; expanded: boolean }
  | { type: "TOGGLE_TREE_NODE"; path: string }
  | { type: "SET_SELECTED_FOLDER"; path: string | null }
  | { type: "SET_PHOTOS"; photos: PhotoEntry[] }
  | { type: "SET_SELECTED_PHOTO"; photo: PhotoEntry | null }
  | { type: "SET_EXIF"; data: ExifData | null }
  | { type: "SET_HISTOGRAM"; data: string | null }
  | { type: "SET_VIEW_MODE"; mode: ViewMode }
  | { type: "SET_SORT_BY"; sortBy: SortBy }
  | { type: "SET_SORT_ORDER"; order: SortOrder }
  | { type: "SET_SEARCH_QUERY"; query: string }
  | { type: "SET_LOADING"; loading: boolean }
  | { type: "SET_ERROR"; error: string | null }
  | { type: "TOGGLE_EXIF" }
  | { type: "TOGGLE_OVERLAY" }
  | { type: "SET_CLASSIFY_DIALOG"; state: Partial<ClassifyDialogState> }
  | { type: "SET_CONTEXT_MENU"; menu: ContextMenuState | null }
  | { type: "UPDATE_PHOTO_TAGS"; updates: { path: string; tags: string[] }[] }
  | { type: "SET_SELECTION"; paths: string[] }
  | { type: "TOGGLE_SELECTION"; path: string }
  | { type: "RANGE_SELECTION"; from: number; to: number }
  | { type: "SELECT_ALL" }
  | { type: "CLEAR_SELECTION" }
  | { type: "SET_FILTER_TAGS"; tags: string[] }
  | { type: "SET_SIMILARITY_SEARCH"; search: SimilaritySearch | null }
  | { type: "SET_SIMILARITY_THRESHOLD"; threshold: number }
  | { type: "SET_QUERYING"; querying: boolean }
  | { type: "SET_INDEXING_STATE"; state: IndexingState | null }
  | { type: "SET_IMPORT_STATE"; state: ImportState | null }
  | { type: "SET_COLOR_GROUPS"; groups: Record<string, string[]> | null }
  | { type: "REMOVE_PHOTOS"; paths: string[] };
