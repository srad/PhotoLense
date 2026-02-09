import {useEffect, useState} from "react";
import {open} from "@tauri-apps/plugin-dialog";
import {openPath} from "@tauri-apps/plugin-opener";
import {listen} from "@tauri-apps/api/event";
import {useAppDispatch, useAppState} from "../../hooks/useAppState";
import {usePhotos} from "../../hooks/usePhotos";
import {cancelClassification, classifyImages, downloadModel, loadModel} from "../../api/commands";
import type {ModelType} from "../../types";
import "./ClassifyDialog.css";

const MODEL_DESCRIPTIONS: Record<ModelType, string> = {
  Base: "ConvNeXt V2 Base (350MB): A robust all-rounder. Covers 22,000 categories (specific dog breeds, flowers, etc.) with good accuracy. Best for archiving.",
  Large: "ConvNeXt V2 Large (850MB): The heavyweight expert. Extremely detailed 22,000 categories. Slower and requires more RAM, but finds details others miss.",
  MobileNetV3Large: "MobileNet V3 Large (~20MB): The speedster. Optimized for speed and low resource usage. Covers 1,000 standard categories. Perfect for quick sorting on laptops.",
};

const DEFAULT_MODEL: ModelType = "MobileNetV3Large";

const DEFAULT_CONFIDENCE: Record<ModelType, number> = {
  MobileNetV3Large: 25,
  Base: 15,
  Large: 20,
};

function formatTime(seconds: number): string {
  if (!seconds) return "Calculating...";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

export function ClassifyDialog() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { loadPhotos } = usePhotos();
  const dialog = state.classifyDialog;

  const [organize, setOrganize] = useState(false);
  const [topK, setTopK] = useState(1);
  const [minConfidence, setMinConfidence] = useState(DEFAULT_CONFIDENCE[DEFAULT_MODEL]);
  const [outputFolder, setOutputFolder] = useState("");
  const [copyFiles, setCopyFiles] = useState(true);
  const [modelType, setModelType] = useState<ModelType>(DEFAULT_MODEL);
  const [useGpu, setUseGpu] = useState(true);
  const [isCancelling, setIsCancelling] = useState(false);

  const [downloadProgress, setDownloadProgress] = useState(0);
  const [classifyProgress, setClassifyProgress] = useState<{
    current: number,
    total: number,
    file: string,
    remaining_time?: number
  } | null>(null);

  useEffect(() => {
    if (dialog.open) {
      const saved = localStorage.getItem("lastOutputFolder");
      if (saved) {
        setOutputFolder(saved);
      } else if (dialog.folderPath) {
        setOutputFolder(dialog.folderPath);
      }
    }
  }, [dialog.open, dialog.folderPath]);

  useEffect(() => {
    if (outputFolder) {
      localStorage.setItem("lastOutputFolder", outputFolder);
    }
  }, [outputFolder]);

  useEffect(() => {
    const unlistenDownload = listen<number>("download-progress", (event) => {
      setDownloadProgress(event.payload);
    });

    const unlistenClassify = listen<{
      current: number,
      total: number,
      file: string,
      remaining_time?: number
    }>("classification-progress", (event) => {
      setClassifyProgress(event.payload);
    });

    return () => {
      unlistenDownload.then(f => f());
      unlistenClassify.then(f => f());
    };
  }, []);

  if (!dialog.open) return null;

  const close = () => {
    if (dialog.status === "classifying" || dialog.status === "downloading") {
      cancelClassification();
    }
    dispatch({
      type: "SET_CLASSIFY_DIALOG",
      state: {
        open: false,
        status: "idle",
        progress: null,
        modelStatus: null,
        error: null,
      },
    });
    setDownloadProgress(0);
    setClassifyProgress(null);
    setIsCancelling(false);
  };

  const handleCancel = async () => {
    console.log("Cancel clicked");
    setIsCancelling(true);
    try {
      await cancelClassification();
      console.log("Cancel command sent");
    } catch (e) {
      console.error("Failed to cancel:", e);
      setIsCancelling(false);
    }
    // Don't set error state here - let handleStart finish gracefully with partial results
  };

  const handleOpenOutput = async () => {
    const target = outputFolder || dialog.folderPath;
    console.log("Open Output clicked. Target:", target);
    if (target) {
      try {
        await openPath(target);
        console.log("Opened path successfully");
      } catch (e) {
        console.error("Failed to open path:", e);
        dispatch({
          type: "SET_CLASSIFY_DIALOG",
          state: {error: `Failed to open folder: ${String(e)}`}
        });
      }
    }
  };

  const handleBrowseOutput = async () => {
    const selected = await open({directory: true});
    if (selected) {
      setOutputFolder(selected);
    }
  };

  const handleStart = async () => {
    if (!dialog.folderPath) return;

    try {
      // Reset progress
      setDownloadProgress(0);
      setClassifyProgress(null);
      setIsCancelling(false);

      // Check model status
      dispatch({
        type: "SET_CLASSIFY_DIALOG",
        state: {status: "downloading", error: null},
      });

      // Set/Download Model
      await downloadModel(modelType);

      // Load Model
      dispatch({
        type: "SET_CLASSIFY_DIALOG",
        state: {status: "loading"},
      });
      await loadModel(modelType, useGpu);

      // Run classification
      dispatch({
        type: "SET_CLASSIFY_DIALOG",
        state: {status: "classifying"},
      });

      const result = await classifyImages(dialog.folderPath, topK, minConfidence / 100, organize, outputFolder || undefined, copyFiles);

      // Update photos with tags in memory (immediate feedback)
      if (!organize) {
        dispatch({
          type: "UPDATE_PHOTO_TAGS",
          updates: result.results.map(r => ({
            path: r.file_path,
            tags: r.predictions.map(p => p.class_name)
          }))
        });
      }

      // Refresh the photo list to ensure everything (paths, tags, new files) is synced
      // especially important if files were moved/copied or if cancelled early
      await loadPhotos(dialog.folderPath, { clearCache: false, silent: true });

      dispatch({
        type: "SET_CLASSIFY_DIALOG",
        state: {status: "done", progress: result},
      });
    } catch (err) {
      dispatch({
        type: "SET_CLASSIFY_DIALOG",
        state: {
          status: "error",
          error: err instanceof Error ? err.message : typeof err === "object" && err !== null && "message" in err ? (err as {
            message: string
          }).message : String(err),
        },
      });
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h3>Classify Images</h3>
          <button className="dialog-close" onClick={close}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div className="dialog-body">
          <div className="dialog-field">
            <label>Folder</label>
            <span className="dialog-path">{dialog.folderPath}</span>
          </div>

          {dialog.status === "idle" && (
            <>
              <div className="dialog-field checkbox-field">
                <label>
                  <input
                    type="checkbox"
                    checked={useGpu}
                    onChange={(e) => setUseGpu(e.target.checked)}
                  />
                  Use GPU Acceleration (Recommended)
                </label>
              </div>
              <div className="dialog-field">
                <label>Model Size</label>
                <select
                  value={modelType}
                  onChange={(e) => {
                    const mt = e.target.value as ModelType;
                    setModelType(mt);
                    setMinConfidence(DEFAULT_CONFIDENCE[mt]);
                  }}
                  className="dialog-select"
                >
                  <option value="MobileNetV3Large">MobileNet V3 Large (Fastest, ~1k classes)</option>
                  <option value="Large">ConvNeXt V2 Large (Better, ~850MB)</option>
                  <option value="Base">ConvNeXt V2 Base (Faster, ~350MB)</option>
                </select>
                <p className="dialog-note model-description">{MODEL_DESCRIPTIONS[modelType]}</p>
              </div>
              <div className="dialog-field">
                <label>Top K predictions</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={topK}
                  onChange={(e) => setTopK(Number(e.target.value))}
                />
                <p className="dialog-note">Number of predicted classes to save per image metadata.</p>
              </div>
              <div className="dialog-field">
                <label>Min Confidence ({minConfidence}%)</label>
                <input
                  type="range"
                  step="1"
                  min={0}
                  max={100}
                  value={minConfidence}
                  onChange={(e) => setMinConfidence(Number(e.target.value))}
                />
                <p className="dialog-note">Minimum confidence required to assign a tag.</p>
              </div>
              <div className="dialog-field checkbox-field">
                <label>
                  <input
                    type="checkbox"
                    checked={organize}
                    onChange={(e) => setOrganize(e.target.checked)}
                  />
                  Move/Copy files to class folders
                </label>
              </div>
              {organize && (
                <>
                  <div className="dialog-field">
                    <label>Output folder</label>
                    <div className="folder-picker">
                      <input
                        type="text"
                        readOnly
                        value={outputFolder}
                        placeholder="Same as source folder"
                        className="folder-picker-input"
                      />
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={handleBrowseOutput}
                      >
                        Browse
                      </button>
                      {outputFolder && (
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => setOutputFolder("")}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="dialog-field">
                    <label>File operation</label>
                    <div className="radio-group">
                      <label className="radio-label">
                        <input
                          type="radio"
                          name="fileOp"
                          checked={!copyFiles}
                          onChange={() => setCopyFiles(false)}
                        />
                        Move files
                      </label>
                      <label className="radio-label">
                        <input
                          type="radio"
                          name="fileOp"
                          checked={copyFiles}
                          onChange={() => setCopyFiles(true)}
                        />
                        Copy files
                      </label>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {dialog.status === "downloading" && (
            <div className="dialog-status">
              <p>Downloading model ({modelType})...</p>
              <progress value={downloadProgress} max="100" className="dialog-progress"></progress>
              <span className="progress-text">{downloadProgress}%</span>
            </div>
          )}

          {dialog.status === "loading" && (
            <div className="dialog-status">
              <div className="spinner"/>
              <p>Loading model into memory...</p>
            </div>
          )}

          {dialog.status === "classifying" && (
            <div className="dialog-status">
              <p>{isCancelling ? "Stopping..." : "Classifying images..."}</p>
              {classifyProgress && (
                <>
                  <progress
                    value={classifyProgress.current}
                    max={classifyProgress.total}
                    className="dialog-progress"
                  ></progress>
                  <p className="progress-details">
                    {classifyProgress.current} / {classifyProgress.total}
                    {classifyProgress.remaining_time !== undefined && (
                      <>
                        <span className="progress-text"> - </span>
                        <span
                          className="remaining-time">estimated time: {formatTime(classifyProgress.remaining_time)}</span>
                      </>
                    )}
                    <br/>
                    <span className="current-file">{classifyProgress.file}</span>
                  </p>
                </>
              )}
              {!classifyProgress && <div className="spinner"/>}
            </div>
          )}

          {dialog.status === "done" && dialog.progress && (
            <div className="dialog-results">
              <div className="result-summary-box">
                <div className="summary-item">
                  <span className="summary-label">Processed Files</span>
                  <span className="summary-value">{dialog.progress.results.length} / {dialog.progress.total}</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Tagged files</span>
                  <span className="summary-value">
                    {dialog.progress.results.filter(r => r.predictions.length > 0).length}
                  </span>
                </div>
              </div>
            </div>
          )}

          {dialog.status === "error" && (
            <div className="dialog-error">
              <p>{dialog.error}</p>
            </div>
          )}
        </div>

        <div className="dialog-footer">
          {(dialog.status === "classifying" || dialog.status === "done") && organize && (
            <button className="btn-secondary" onClick={handleOpenOutput}>
              Open Output Folder
            </button>
          )}
          {dialog.status === "idle" && (
            <button className="btn-primary" onClick={handleStart}>
              Start Classification
            </button>
          )}
          {(dialog.status === "downloading" || dialog.status === "classifying") && (
            <button 
              className="btn-danger" 
              onClick={handleCancel} 
              disabled={isCancelling}
              style={{ opacity: isCancelling ? 0.7 : 1, cursor: isCancelling ? "wait" : "pointer" }}
            >
              {isCancelling ? "Stopping..." : "Cancel"}
            </button>
          )}
          {(dialog.status === "done" || dialog.status === "error") && (
            <button className="btn-secondary" onClick={close}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}