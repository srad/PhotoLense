use crate::error::AppError;
use crate::models::fs_types::{DirEntry, DriveInfo, PhotoEntry};
use crate::services::classifier::inference;
use crate::services::classifier::model_manager::ModelManager;
use crate::services::fs_service;
use crate::services::thumbnail_service;
use crate::services::exif_service;
use crate::services::watcher::FolderWatcher;
use std::path::{Path, PathBuf};

use crate::services::db::Database;
use tauri::{AppHandle, Emitter, State};
use rayon::prelude::*;
use std::sync::atomic::{AtomicUsize, Ordering};

#[tauri::command]
pub fn list_drives() -> Result<Vec<DriveInfo>, AppError> {
    fs_service::list_drives()
}

#[tauri::command]
pub fn check_path_exists(path: String) -> bool {
    fs_service::path_exists(&path)
}

#[tauri::command]
pub fn autocomplete_path(partial: String) -> Result<Vec<String>, AppError> {
    fs_service::autocomplete_path(&partial)
}

#[tauri::command]
pub fn list_directory(path: String) -> Result<Vec<DirEntry>, AppError> {
    fs_service::list_directory(&path)
}

#[tauri::command]
pub async fn list_photos(
    path: String,
    db: State<'_, Database>,
    app: AppHandle,
    watcher: State<'_, FolderWatcher>,
) -> Result<(), AppError> {
    let db = db.inner().clone();
    let app_handle = app.clone();
    let path_for_task = path.clone();

    // Run heavy filesystem I/O and DB operations on a blocking thread
    // so we don't starve the async runtime (keeps IPC responsive for thumbnails)
    tokio::task::spawn_blocking(move || -> Result<(), AppError> {
        // Use list_image_files_with_meta — metadata comes free from DirEntry on Windows
        let image_files = fs_service::list_image_files_with_meta(&path_for_task)?;
        let total_files = image_files.len();

        // Pre-load existing DB records for this folder (1 query)
        let db_cache = db.get_folder_photo_cache(&path_for_task).map_err(|e| AppError {
            message: format!("DB Error: {}", e),
        })?;

        let mut keep_paths = Vec::with_capacity(total_files);
        let mut to_upsert: Vec<(String, u64, i64, Option<u32>, Option<u32>)> = Vec::new();

        for (i, (img_path, size, modified)) in image_files.iter().enumerate() {
            let file_path = img_path.to_string_lossy().to_string();
            keep_paths.push(file_path.clone());

            // Check if file is already in DB and unchanged
            if let Some(&(_id, db_modified, _, _width, _height)) = db_cache.get(&file_path) {
                if db_modified == *modified {
                    continue;
                }
            }

            // New or modified file — read dimensions from image header
            let (width, height) = image::image_dimensions(img_path)
                .map(|(w, h)| (Some(w), Some(h)))
                .unwrap_or((None, None));

            to_upsert.push((file_path, *size, *modified, width, height));

            // Emit progress periodically (every 25 files) to keep UI responsive
            if to_upsert.len() % 25 == 0 {
                let _ = app_handle.emit("import-progress", serde_json::json!({
                    "current": i + 1,
                    "total": total_files,
                }));
            }
        }

        // Batch upsert in a single transaction (one mutex acquire, much faster)
        let new_photo_paths = if !to_upsert.is_empty() {
            let imported_count = to_upsert.len();
            let results = db.batch_upsert_photos(&to_upsert).map_err(|e| AppError {
                message: format!("DB Error: {}", e),
            })?;

            let _ = app_handle.emit("import-progress", serde_json::json!({
                "current": imported_count,
                "total": imported_count,
                "done": true,
            }));

            // Collect newly inserted/changed photos for background thumbnail generation
            results.iter()
                .zip(to_upsert.iter())
                .filter_map(|((id, changed), (path, _, _, _, _))| {
                    if *changed { Some((*id, path.clone())) } else { None }
                })
                .collect::<Vec<_>>()
        } else {
            Vec::new()
        };

        // Only run cleanup if files may have been added/removed
        if !to_upsert.is_empty() || keep_paths.len() != db_cache.len() {
            db.cleanup_folder(&path_for_task, &keep_paths).map_err(|e| AppError {
                message: format!("DB Cleanup Error: {}", e),
            })?;
        }

        // Pre-generate thumbnails for newly imported photos in a background thread.
        // This runs detached so list_photos returns immediately, but thumbnails
        // will be cached in DB by the time the frontend batch-requests them.
        // Uses a dedicated 2-thread pool to avoid starving the UI for CPU time.
        if !new_photo_paths.is_empty() {
            let db_for_thumbs = db.clone();
            std::thread::spawn(move || {
                let pool = rayon::ThreadPoolBuilder::new()
                    .num_threads(2)
                    .build()
                    .expect("Failed to build thumbnail thread pool");
                pool.install(|| {
                    new_photo_paths.par_iter().for_each(|(photo_id, path_str)| {
                        // Skip if the UI already generated this thumbnail via get_thumbnail
                        if let Ok(Some(_)) = db_for_thumbs.get_thumbnail(*photo_id) {
                            return;
                        }
                        if let Ok(bytes) = thumbnail_service::generate_thumbnail_bytes(
                            Path::new(path_str),
                        ) {
                            let _ = db_for_thumbs.save_thumbnail(*photo_id, &bytes);
                        }
                    });
                });
            });
        }

        Ok(())
    })
    .await
    .map_err(|e| AppError {
        message: format!("Import task failed: {}", e),
    })??;

    // Start watching this folder for changes
    watcher.watch_folder(&path, app);

    Ok(())
}

fn run_indexing_task(
    db: State<'_, Database>,
    model_manager: State<'_, ModelManager>,
    app: AppHandle,
    folder: String,
) {
    let db_arc = db.inner().clone();
    let mm_arc = model_manager.inner().clone();
    let app_handle = app.clone();

    tokio::spawn(async move {
        // 1. Download model if not present
        if !mm_arc.is_downloaded().await {
            let _ = app_handle.emit("indexing-progress", serde_json::json!({
                "current": 0,
                "total": 1,
                "status": "downloading_model"
            }));
            if let Err(e) = mm_arc.download_model(&app_handle, None).await {
                eprintln!("Indexing: Failed to download model: {}", e);
                let _ = app_handle.emit("indexing-progress", serde_json::json!({
                    "current": 0, "total": 0, "done": true
                }));
                return;
            }
        }

        // 2. Load model if needed
        if !mm_arc.is_ready() {
            let _ = app_handle.emit("indexing-progress", serde_json::json!({
                "current": 0,
                "total": 1,
                "status": "loading_model"
            }));
            if let Err(e) = mm_arc.load_model(true).await {
                eprintln!("Indexing: Failed to load model: {}", e);
                let _ = app_handle.emit("indexing-progress", serde_json::json!({
                    "current": 0, "total": 0, "done": true
                }));
                return;
            }
        }

        // 3. Prepare DB table
        let model_type = *mm_arc.current_type.lock().await;
        let labels = match mm_arc.get_labels().await {
            Ok(l) => l,
            Err(_) => return,
        };
        let embedding_dim = labels.len();
        let model_type_str = format!("{:?}", model_type);

        if let Err(e) = db_arc.ensure_vec_table(embedding_dim, &model_type_str) {
            eprintln!("Indexing: Failed to ensure vec table: {}", e);
            return;
        }

        let crop_size = model_type.crop_size();

        // 4. Fetch photos that need indexing
        let photos_to_index = match db_arc.get_photos_to_index(&folder) {
            Ok(p) => p,
            Err(e) => {
                eprintln!("Indexing: Failed to get photos from DB: {}", e);
                return;
            }
        };

        let total_task = photos_to_index.len();
        if total_task == 0 {
            let _ = app_handle.emit("indexing-progress", serde_json::json!({
                "current": 0,
                "total": 0,
                "done": true
            }));
            return;
        }

        // 5. Run CPU-bound preprocessing and inference in parallel
        let _ = tokio::task::spawn_blocking(move || {
            let counter = AtomicUsize::new(0);

            photos_to_index.par_iter().for_each(|(photo_id, path_str)| {
                let name = Path::new(&path_str)
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy();

                // 1. Preprocess (Parallel CPU)
                let tensor_res = inference::preprocess_image(Path::new(path_str), crop_size);

                match tensor_res {
                    Ok(tensor) => {
                        // 2. Inference (Serial GPU/Model Lock)
                        let embedding_opt = {
                            let lock = mm_arc.get_model_lock();
                            let res = match lock.lock() {
                                Ok(mut guard) => {
                                    if let Some(session) = guard.as_mut() {
                                        inference::run_inference_with_model(session, tensor, &labels, 1)
                                            .map(|(_, emb)| emb)
                                            .ok()
                                    } else {
                                        None
                                    }
                                }
                                Err(_) => None,
                            };
                            res
                        };

                        // 3. Save to DB (Serial DB Lock)
                        if let Some(emb) = embedding_opt {
                            if let Err(e) = db_arc.set_embedding(*photo_id, &emb) {
                                eprintln!("Indexing: DB save failed for {}: {}", name, e);
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("Indexing: Preprocessing failed for {}: {}", name, e);
                    }
                }

                // Progress update
                let current = counter.fetch_add(1, Ordering::Relaxed) + 1;
                if current % 5 == 0 || current == total_task {
                    let _ = app_handle.emit("indexing-progress", serde_json::json!({
                        "current": current,
                        "total": total_task,
                        "file": name
                    }));
                }
            });

            let _ = app_handle.emit("indexing-progress", serde_json::json!({
                "current": total_task,
                "total": total_task,
                "done": true
            }));
        }).await;
    });
}

#[tauri::command]
pub async fn trigger_indexing(
    folder: String,
    db: State<'_, Database>,
    model_manager: State<'_, ModelManager>,
    app: AppHandle,
) -> Result<String, AppError> {
    // run_indexing_task will auto-download and auto-load the model if needed
    run_indexing_task(db, model_manager, app, folder);
    Ok("Started".to_string())
}

#[derive(serde::Serialize)]
pub struct IndexingStatus {
    total: usize,
    indexed: usize,
}

#[tauri::command]
pub fn get_indexing_status(
    folder: String,
    db: State<'_, Database>,
) -> Result<IndexingStatus, AppError> {
    let image_paths = fs_service::list_image_files(&folder)?;
    let total = image_paths.len();
    let mut indexed = 0;

    for img_path in image_paths {
        let file_path = img_path.to_string_lossy().to_string();
        if let Ok(Some(id)) = db.get_photo_id_by_path(&file_path) {
            if let Ok(true) = db.has_embedding(id) {
                indexed += 1;
            }
        }
    }

    Ok(IndexingStatus { total, indexed })
}

#[tauri::command]
pub fn query_photos(
    folder: String,
    search: Option<String>,
    sort_by: String,
    sort_order: String,
    filter_tags: Option<Vec<String>>,
    db: State<'_, Database>,
) -> Result<Vec<PhotoEntry>, AppError> {
    let rows = db
        .query_photos(&folder, search.as_deref(), &sort_by, &sort_order, filter_tags.as_deref())
        .map_err(|e| AppError {
            message: format!("DB Error: {}", e),
        })?;

    // Batch-load tags and embedding IDs (2 queries instead of N×2)
    let tags_map = db.get_tags_for_folder_photos(&folder).map_err(|e| AppError {
        message: format!("DB Error: {}", e),
    })?;
    let embedded_ids = db.get_all_embedded_ids().map_err(|e| AppError {
        message: format!("DB Error: {}", e),
    })?;

    let mut photos = Vec::new();
    for (id, path, size, modified, width, height) in rows {
        let name = Path::new(&path)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let tags = tags_map.get(&id).cloned().unwrap_or_default();
        photos.push(PhotoEntry {
            name,
            path,
            size: size as u64,
            modified: Some(modified as u64),
            tags: if tags.is_empty() { None } else { Some(tags) },
            width,
            height,
            has_embedding: embedded_ids.contains(&id),
        });
    }
    Ok(photos)
}

#[tauri::command]
pub fn find_similar_photos(
    folder: String,
    reference_path: String,
    threshold: f32,
    db: State<'_, Database>,
) -> Result<Vec<PhotoEntry>, AppError> {
    // threshold is 0.0–1.0 (similarity). Cosine distance = 1.0 - similarity.
    let max_distance = 1.0 - threshold;

    let photo_id = db
        .get_photo_id_by_path(&reference_path)
        .map_err(|e| AppError {
            message: format!("DB Error: {}", e),
        })?
        .ok_or_else(|| {
            println!("Reference photo not found in DB: {}", reference_path);
            AppError {
                message: "Reference photo not found in database".to_string(),
            }
        })?;
    
    let rows = db
        .find_similar_by_embedding(photo_id, &folder, max_distance, 200)
        .map_err(|e| {
            println!("DB find_similar error: {}", e);
            AppError {
                message: format!("DB Error: {}", e),
            }
        })?;
    
    let mut photos = Vec::new();
    for (id, path, size, modified, width, height, _distance) in rows {
        let name = Path::new(&path)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let tags = db.get_tags(id).unwrap_or_default();
        photos.push(PhotoEntry {
            name,
            path,
            size: size as u64,
            modified: Some(modified as u64),
            tags: if tags.is_empty() { None } else { Some(tags) },
            width,
            height,
            has_embedding: true,
        });
    }
    Ok(photos)
}

#[tauri::command]
pub fn get_all_tags(folder: String, db: State<'_, Database>) -> Result<Vec<String>, AppError> {
    db.get_tags_for_folder(&folder).map_err(|e| AppError {
        message: format!("DB Error: {}", e),
    })
}

#[tauri::command]
pub fn get_thumbnails_batch(
    paths: Vec<String>,
    db: State<'_, Database>,
) -> Result<std::collections::HashMap<String, String>, AppError> {
    // Fetch all cached thumbnails in a single DB query
    let cached = db.get_cached_thumbnails_by_paths(&paths).map_err(|e| AppError {
        message: format!("DB Error: {}", e),
    })?;

    let mut results = std::collections::HashMap::with_capacity(cached.len());
    for (path, blob) in cached {
        let b64 = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            &blob,
        );
        results.insert(path, format!("data:image/jpeg;base64,{}", b64));
    }

    Ok(results)
}

#[tauri::command]
pub fn get_thumbnail(path: String, db: State<'_, Database>) -> Result<String, AppError> {
    let img_path = Path::new(&path);
    if !img_path.exists() {
        return Err("File not found".into());
    }

    // Try to serve from DB cache
    if let Ok(Some(photo_id)) = db.get_photo_id_by_path(&path) {
        // Photo is in DB — check for cached thumbnail
        if let Ok(Some(blob)) = db.get_thumbnail(photo_id) {
            let b64 = base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                &blob,
            );
            return Ok(format!("data:image/jpeg;base64,{}", b64));
        }

        // No cached thumbnail — generate, save, and return
        let bytes = thumbnail_service::generate_thumbnail_bytes(img_path)?;
        let _ = db.save_thumbnail(photo_id, &bytes);
        let b64 = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            &bytes,
        );
        return Ok(format!("data:image/jpeg;base64,{}", b64));
    }

    // Photo not in DB yet (e.g. before import completes) — generate without caching
    thumbnail_service::generate_thumbnail(img_path)
}

#[tauri::command]
pub fn get_image_bytes(path: String) -> Result<Vec<u8>, AppError> {
    let img_path = Path::new(&path);
    if !img_path.exists() {
        return Err("File not found".into());
    }
    std::fs::read(img_path).map_err(|e| AppError {
        message: format!("Failed to read file: {}", e),
    })
}

#[tauri::command]
pub fn get_full_image(path: String) -> Result<String, AppError> {
    let img_path = Path::new(&path);
    if !img_path.exists() {
        return Err("File not found".into());
    }

    let orientation = exif_service::get_orientation(img_path);

    let mut img = image::ImageReader::open(img_path)
        .map_err(|e| AppError {
            message: format!("Failed to open image: {}", e),
        })?
        .decode()
        .map_err(|e| AppError {
            message: format!("Failed to decode image: {}", e),
        })?;

    // Optimization: Resize BEFORE rotating.
    // Rotating a full 24MP image (swapping w/h) is very expensive/slow.
    // Resizing it to screen size first reduces the pixel count by ~10x-20x, making rotation instant.
    // Since we resize to a square bounding box (1920x1920), the scale factor is the same
    // regardless of whether we rotate before or after.
    if img.width() > 1920 || img.height() > 1920 {
        img = img.thumbnail(1920, 1920);
    }

    // Apply rotation after resizing
    if orientation != 1 {
        img = exif_service::apply_orientation(img, orientation);
    }

    let mut buffer = std::io::Cursor::new(Vec::new());
    img.write_to(&mut buffer, image::ImageFormat::Jpeg)
        .map_err(|e| AppError {
            message: format!("Failed to encode image: {}", e),
        })?;

    let b64 = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        buffer.into_inner(),
    );
    Ok(format!("data:image/jpeg;base64,{}", b64))
}

#[tauri::command]
pub fn delete_files(paths: Vec<String>, db: State<'_, Database>) -> Result<(), AppError> {
    for path_str in &paths {
        let p = Path::new(path_str);
        if p.exists() {
            std::fs::remove_file(p).map_err(|e| AppError {
                message: format!("Failed to delete {}: {}", path_str, e),
            })?;
        }
    }
    db.delete_photos_by_paths(&paths).map_err(|e| AppError {
        message: format!("DB Error: {}", e),
    })?;
    Ok(())
}

#[tauri::command]
pub fn move_files(
    paths: Vec<String>,
    destination: String,
    db: State<'_, Database>,
) -> Result<(), AppError> {
    let dest = PathBuf::from(&destination);
    if !dest.is_dir() {
        return Err(AppError {
            message: format!("Destination is not a directory: {}", destination),
        });
    }
    for path_str in &paths {
        let src = PathBuf::from(path_str);
        let file_name = src
            .file_name()
            .ok_or_else(|| AppError {
                message: format!("Invalid file path: {}", path_str),
            })?;
        let new_path = dest.join(file_name);
        std::fs::rename(&src, &new_path).map_err(|e| {
            // rename can fail across drives, fall back to copy+delete
            if let Err(copy_err) = std::fs::copy(&src, &new_path) {
                return AppError {
                    message: format!(
                        "Failed to move {} (rename: {}, copy: {})",
                        path_str, e, copy_err
                    ),
                };
            }
            if let Err(del_err) = std::fs::remove_file(&src) {
                return AppError {
                    message: format!("Copied but failed to remove source {}: {}", path_str, del_err),
                };
            }
            // If copy+delete succeeded, this error is actually OK — swallow it
            // But we need to return *something* from the closure. We'll use a sentinel.
            AppError {
                message: String::new(),
            }
        }).or_else(|e| {
            if e.message.is_empty() {
                Ok(())
            } else {
                Err(e)
            }
        })?;
        let new_path_str = new_path.to_string_lossy().to_string();
        let _ = db.update_photo_path(path_str, &new_path_str);
    }
    Ok(())
}

#[tauri::command]
pub fn copy_files(paths: Vec<String>, destination: String) -> Result<(), AppError> {
    let dest = PathBuf::from(&destination);
    if !dest.is_dir() {
        return Err(AppError {
            message: format!("Destination is not a directory: {}", destination),
        });
    }
    for path_str in &paths {
        let src = PathBuf::from(path_str);
        let file_name = src
            .file_name()
            .ok_or_else(|| AppError {
                message: format!("Invalid file path: {}", path_str),
            })?;
        let new_path = dest.join(file_name);
        std::fs::copy(&src, &new_path).map_err(|e| AppError {
            message: format!("Failed to copy {}: {}", path_str, e),
        })?;
    }
    Ok(())
}
