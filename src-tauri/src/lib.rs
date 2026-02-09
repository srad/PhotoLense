mod commands;
mod error;
mod models;
mod services;

use services::classifier::model_manager::ModelManager;
use services::db::Database;
use services::watcher::FolderWatcher;
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data directory");

            if !app_data_dir.exists() {
                std::fs::create_dir_all(&app_data_dir).expect("Failed to create app data directory");
            }

            let model_manager = ModelManager::new(app_data_dir.clone());
            app.manage(model_manager.clone());

            app.manage(FolderWatcher::new());

            let db_path = app_data_dir.join("library.db");
            let db = Database::new(db_path).expect("Failed to initialize database");
            app.manage(db);

            // Auto-download and load MobileNetV3 model on first start
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if !model_manager.is_downloaded().await {
                    let _ = app_handle.emit("model-auto-download", serde_json::json!({
                        "status": "downloading"
                    }));
                    if let Err(e) = model_manager.download_model(&app_handle, None).await {
                        eprintln!("Auto-download: Failed to download model: {}", e);
                        return;
                    }
                }

                if !model_manager.is_ready() {
                    let _ = app_handle.emit("model-auto-download", serde_json::json!({
                        "status": "loading"
                    }));
                    if let Err(e) = model_manager.load_model(true).await {
                        eprintln!("Auto-download: Failed to load model: {}", e);
                        return;
                    }
                }

                let _ = app_handle.emit("model-auto-download", serde_json::json!({
                    "status": "ready"
                }));
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::filesystem::list_drives,
            commands::filesystem::check_path_exists,
            commands::filesystem::autocomplete_path,
            commands::filesystem::list_directory,
            commands::filesystem::list_photos,
            commands::filesystem::query_photos,
            commands::filesystem::find_similar_photos,
            commands::filesystem::get_all_tags,
            commands::filesystem::get_thumbnails_batch,
            commands::filesystem::get_thumbnail,
            commands::filesystem::get_full_image,
            commands::filesystem::get_image_bytes,
            commands::filesystem::delete_files,
            commands::filesystem::move_files,
            commands::filesystem::copy_files,
            commands::filesystem::trigger_indexing,
            commands::filesystem::get_indexing_status,
            commands::exif::read_exif,
            commands::classifier::get_model_status,
            commands::classifier::download_model,
            commands::classifier::load_model,
            commands::classifier::classify_images,
            commands::classifier::set_model_type,
            commands::classifier::cancel_classification,
            commands::classifier::delete_all_tags,
            commands::color::group_by_color,
            commands::image::get_histogram,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
