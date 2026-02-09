use crate::error::AppError;
use crate::models::classify_types::{ClassifyProgress, ClassifyResult, ModelStatus};
use crate::services::classifier::inference;
use crate::services::classifier::model_manager::{ModelManager, ModelType};
use crate::services::db::Database;
use crate::services::fs_service;
use rayon::prelude::*;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub async fn get_model_status(model_manager: State<'_, ModelManager>) -> Result<ModelStatus, AppError> {
    Ok(ModelStatus {
        downloaded: model_manager.is_downloaded().await,
        loading: model_manager.is_loading().await,
        ready: model_manager.is_ready(),
        error: model_manager.get_error().await,
    })
}

#[tauri::command]
pub async fn set_model_type(model_manager: State<'_, ModelManager>, model_type: ModelType) -> Result<(), AppError> {
    *model_manager.current_type.lock().await = model_type;
    Ok(())
}

#[tauri::command]
pub async fn cancel_classification(model_manager: State<'_, ModelManager>) -> Result<(), AppError> {
    model_manager.cancel_classification();
    Ok(())
}

#[tauri::command]
pub async fn download_model(
    app: AppHandle,
    model_manager: State<'_, ModelManager>,
    model_type: Option<ModelType>,
) -> Result<(), AppError> {
    model_manager.download_model(&app, model_type).await
}

#[tauri::command]
pub async fn load_model(
    model_manager: State<'_, ModelManager>,
    model_type: Option<ModelType>,
    use_gpu: Option<bool>,
) -> Result<(), AppError> {
    if let Some(t) = model_type {
        *model_manager.current_type.lock().await = t;
    }
    
    if !model_manager.is_downloaded().await {
        return Err("Model not downloaded. Call download_model first.".into());
    }
    model_manager.load_model(use_gpu.unwrap_or(true)).await
}

#[tauri::command]
pub async fn classify_images(
    app: AppHandle,
    model_manager: State<'_, ModelManager>,
    db: State<'_, Database>,
    folder_path: String,
    top_k: Option<usize>,
    min_confidence: Option<f32>,
    organize: Option<bool>,
    output_folder: Option<String>,
    copy_files: Option<bool>,
) -> Result<ClassifyProgress, AppError> {
    let top_k = top_k.unwrap_or(5);
    let min_confidence = min_confidence.unwrap_or(0.0);
    let organize = organize.unwrap_or(false);
    let copy_files = copy_files.unwrap_or(false);

    if !model_manager.is_ready() {
        return Err("Model not loaded. Call load_model first.".into());
    }

    model_manager.reset_cancel_flag();
    let labels = model_manager.get_labels().await?;
    let image_paths = fs_service::list_image_files(&folder_path)?;
    let total = image_paths.len();

    if total == 0 {
        return Ok(ClassifyProgress {
            current: 0,
            total: 0,
            current_file: String::new(),
            results: Vec::new(),
        });
    }

    let model_manager_state = model_manager.inner().clone();
    let db_state = db.inner().clone();
    let current_model_type = *model_manager.current_type.lock().await;
    let crop_size = current_model_type.crop_size();

    // Run classification in parallel on a blocking thread
    let results = tokio::task::spawn_blocking(move || {
        let current_count = Arc::new(AtomicUsize::new(0));
        let start_time = std::time::Instant::now();

        let results: Result<Vec<ClassifyResult>, AppError> = image_paths
            .par_iter()
            .enumerate()
            .map(|(_, img_path)| {
                // Check cancellation
                if model_manager_state.is_cancelled() {
                    return Ok(ClassifyResult {
                        file_name: String::new(),
                        file_path: String::new(),
                        predictions: Vec::new(),
                        moved_to: None,
                    });
                }

                let file_name = img_path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();

                // Progress update
                let count = current_count.fetch_add(1, Ordering::Relaxed) + 1;
                
                // Calculate remaining time
                let elapsed = start_time.elapsed().as_secs_f64();
                let avg_per_item = elapsed / (count as f64);
                let remaining_time = (avg_per_item * (total.saturating_sub(count)) as f64) as u64;

                // Emit progress event (fire and forget)
                let _ = app.emit("classification-progress", serde_json::json!({
                    "current": count,
                    "total": total,
                    "file": file_name,
                    "remaining_time": remaining_time
                }));

                // 1. Preprocess (Parallel CPU)
                let tensor_res = inference::preprocess_image(img_path, crop_size);

                let predictions = match tensor_res {
                    Ok(tensor) => {
                         // 2. Inference (Serial GPU/Model Lock)
                        let model_lock = model_manager_state.get_model_lock();
                        let mut guard = model_lock.lock().unwrap();
                        
                        if let Some(session) = guard.as_mut() {
                            match inference::run_inference_with_model(session, tensor, &labels, top_k) {
                                Ok((preds, _)) => {
                                    let filtered = preds
                                        .into_iter()
                                        .filter(|p| p.confidence >= min_confidence)
                                        .collect::<Vec<_>>();
                                    filtered
                                }
                                Err(e) => {
                                    let err_msg = e.to_string();
                                    if err_msg.contains("887A0005") || err_msg.contains("DeviceRemoved") {
                                        // We can't easily return Err from here and stop everything nicely in Rayon map
                                        // But we can return empty and log it, or propagate a special error?
                                        // Let's print and return empty for now, or assume driver crash kills the process anyway.
                                        eprintln!("GPU Driver Crashed: {}", err_msg);
                                        Vec::new()
                                    } else {
                                        eprintln!("Failed to classify {}: {}", file_name, e);
                                        Vec::new()
                                    }
                                }
                            }
                        } else {
                            eprintln!("Model unloaded during classification of {}", file_name);
                            Vec::new()
                        }
                    }
                    Err(e) => {
                        eprintln!("Failed to preprocess {}: {}", file_name, e);
                        Vec::new()
                    }
                };

                let mut moved_to = None;
                let mut final_path = img_path.clone();

                if organize && !predictions.is_empty() {
                    let top_class = &predictions[0].class_name;
                    let folder_name: String = top_class
                        .chars()
                        .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' { c } else { '_' })
                        .collect();
                    let folder_name = folder_name.trim().to_string();

                    let base_dir = output_folder.as_deref().unwrap_or(&folder_path);
                    let dest_dir = Path::new(base_dir).join(&folder_name);
                    
                    if let Err(e) = std::fs::create_dir_all(&dest_dir) {
                        eprintln!("Failed to create directory {}: {}", dest_dir.display(), e);
                    } else {
                        let dest_path = dest_dir.join(&file_name);
                        let result = if copy_files {
                            std::fs::copy(img_path, &dest_path).map(|_| ())
                        } else {
                            std::fs::rename(img_path, &dest_path)
                        };
                        if let Err(e) = result {
                            eprintln!("Failed to {} {} to {}: {}", if copy_files { "copy" } else { "move" }, file_name, dest_path.display(), e);
                        } else {
                            moved_to = Some(dest_path.to_string_lossy().to_string());
                            if !copy_files {
                                final_path = dest_path;
                            }
                        }
                    }
                }

                // Store tags in DB for the final file location
                {
                    let file_path_str = final_path.to_string_lossy().to_string();
                    let tags: Vec<String> = predictions.iter().map(|p| p.class_name.clone()).collect();

                    let metadata = std::fs::metadata(&final_path);
                    let size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
                    let modified = metadata
                        .as_ref()
                        .ok()
                        .and_then(|m| m.modified().ok())
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0) as i64;

                    if let Ok((id, _)) = db_state.upsert_photo(&file_path_str, size, modified, None, None) {
                        if !tags.is_empty() {
                            if let Err(e) = db_state.add_tags(id, &tags) {
                                eprintln!("Failed to save tags for {}: {}", file_name, e);
                            }
                        }
                    }
                }

                Ok(ClassifyResult {
                    file_name,
                    file_path: img_path.to_string_lossy().to_string(),
                    predictions,
                    moved_to,
                })
            })
            .collect();

        results
    })
    .await
    .map_err(|e| AppError {
        message: format!("Task join failed: {}", e),
    })??;

    // Filter out empty results (cancelled items)
    let filtered_results: Vec<ClassifyResult> = results
        .into_iter()
        .filter(|r| !r.file_name.is_empty())
        .collect();

    if model_manager.is_cancelled() && filtered_results.is_empty() {
        return Err("Classification cancelled by user".into());
    }

    Ok(ClassifyProgress {
        current: filtered_results.len(),
        total,
        current_file: String::new(),
        results: filtered_results,
    })
}

#[tauri::command]
pub async fn delete_all_tags(db: State<'_, Database>, folder: String) -> Result<(), AppError> {
    db.delete_tags_for_folder(&folder).map_err(|e| AppError {
        message: format!("Failed to delete tags: {}", e),
    })
}
