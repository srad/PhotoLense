use std::path::Path;
use crate::error::AppError;
use crate::models::exif_types::ExifData;
use crate::services::exif_service;

#[tauri::command]
pub fn read_exif(path: String) -> Result<ExifData, AppError> {
    exif_service::read_exif(Path::new(&path))
}