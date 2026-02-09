import { invoke } from "@tauri-apps/api/core";
import type {
  DriveInfo,
  DirEntry,
  PhotoEntry,
  ExifData,
  ModelStatus,
  ClassifyProgress,
  ModelType,
} from "../types";

export async function listDrives(): Promise<DriveInfo[]> {
  return invoke<DriveInfo[]>("list_drives");
}

export async function checkPathExists(path: string): Promise<boolean> {
  return invoke<boolean>("check_path_exists", { path });
}

export async function autocompletePath(partial: string): Promise<string[]> {
  return invoke<string[]>("autocomplete_path", { partial });
}

export async function listDirectory(path: string): Promise<DirEntry[]> {
  return invoke<DirEntry[]>("list_directory", { path });
}

export async function listPhotos(path: string): Promise<void> {
  return invoke<void>("list_photos", { path });
}

export async function getAllTags(folder: string): Promise<string[]> {
  return invoke<string[]>("get_all_tags", { folder });
}

export async function queryPhotos(
  folder: string,
  search: string | null,
  sortBy: string,
  sortOrder: string,
  filterTags: string[] | null
): Promise<PhotoEntry[]> {
  return invoke<PhotoEntry[]>("query_photos", {
    folder,
    search,
    sortBy,
    sortOrder,
    filterTags,
  });
}

export async function findSimilarPhotos(
  folder: string,
  referencePath: string,
  threshold: number
): Promise<PhotoEntry[]> {
  // threshold comes in as 0–100 (percentage), convert to 0.0–1.0 for backend
  return invoke<PhotoEntry[]>("find_similar_photos", {
    folder,
    referencePath,
    threshold: threshold / 100,
  });
}

export async function getThumbnailsBatch(paths: string[]): Promise<Record<string, string>> {
  return invoke<Record<string, string>>("get_thumbnails_batch", { paths });
}

export async function getThumbnail(path: string): Promise<string> {
  return invoke<string>("get_thumbnail", { path });
}

export async function getFullImage(path: string): Promise<string> {
  return invoke<string>("get_full_image", { path });
}

export async function getImageBytes(path: string): Promise<Uint8Array> {
  return invoke<Uint8Array>("get_image_bytes", { path });
}

export async function readExif(path: string): Promise<ExifData> {
  return invoke<ExifData>("read_exif", { path });
}

export async function getHistogram(path: string): Promise<string> {
  return invoke<string>("get_histogram", { path });
}

export async function getModelStatus(): Promise<ModelStatus> {
  return invoke<ModelStatus>("get_model_status");
}

export async function setModelType(modelType: ModelType): Promise<void> {
  return invoke<void>("set_model_type", { modelType });
}

export async function cancelClassification(): Promise<void> {
  return invoke<void>("cancel_classification");
}

export async function downloadModel(modelType?: ModelType): Promise<void> {
  return invoke<void>("download_model", { modelType: modelType || null });
}

export async function loadModel(modelType?: ModelType, useGpu?: boolean): Promise<void> {
  return invoke<void>("load_model", { modelType: modelType || null, useGpu: useGpu ?? true });
}

export async function deleteFiles(paths: string[]): Promise<void> {
  return invoke<void>("delete_files", { paths });
}

export async function moveFiles(
  paths: string[],
  destination: string
): Promise<void> {
  return invoke<void>("move_files", { paths, destination });
}

export async function copyFiles(
  paths: string[],
  destination: string
): Promise<void> {
  return invoke<void>("copy_files", { paths, destination });
}

export async function triggerIndexing(folder: string): Promise<string> {
  return invoke<string>("trigger_indexing", { folder });
}

export async function getIndexingStatus(folder: string): Promise<{ total: number; indexed: number }> {
  return invoke<{ total: number; indexed: number }>("get_indexing_status", { folder });
}

export async function classifyImages(
  folderPath: string,
  topK?: number,
  minConfidence?: number,
  organize?: boolean,
  outputFolder?: string,
  copyFiles?: boolean
): Promise<ClassifyProgress> {
  return invoke<ClassifyProgress>("classify_images", {
    folderPath,
    topK: topK ?? 5,
    minConfidence: minConfidence ?? 0.0,
    organize: organize ?? false,
    outputFolder: outputFolder || null,
    copyFiles: copyFiles ?? false,
  });
}

export async function deleteAllTags(folder: string): Promise<void> {
  return invoke<void>("delete_all_tags", { folder });
}

export interface GroupingConfig {
  method: "fixed" | "kmeans";
  k?: number;
}

export async function groupByColor(paths: string[], config: GroupingConfig): Promise<Record<string, string[]>> {
  return invoke<Record<string, string[]>>("group_by_color", { paths, config });
}
