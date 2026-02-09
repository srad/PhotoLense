use crate::services::color_service;
use rayon::prelude::*;
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(serde::Deserialize)]
pub struct GroupingConfig {
    method: String, // "fixed" | "kmeans"
    k: Option<usize>,
}

#[tauri::command]
pub async fn group_by_color(
    paths: Vec<String>,
    config: GroupingConfig,
) -> Result<HashMap<String, Vec<String>>, String> {
    // 1. Parallel Feature Extraction (CPU-bound)
    // We use spawn_blocking to offload the rayon/parallel processing from the async runtime
    let features = tokio::task::spawn_blocking(move || {
        paths
            .par_iter()
            .filter_map(|path_str| {
                let path_buf = PathBuf::from(path_str);
                // Extract Lab color for every image
                match color_service::get_image_lab(&path_buf) {
                    Ok(lab) => Some((path_str.clone(), lab)),
                    Err(_) => None, // Skip failed images (video/corrupt) or could return separate "Unknown" group later
                }
            })
            .collect::<Vec<_>>()
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?;

    // 2. Grouping
    // This is also CPU-bound but fast enough on the extracted features
    let groups = match config.method.as_str() {
        "kmeans" => {
            let k = config.k.unwrap_or(8).max(1);
            color_service::kmeans_clustering(features, k)
        }
        _ => {
            // Fixed Palette
            let mut map: HashMap<String, Vec<String>> = HashMap::new();
            for (path, lab) in features {
                let color_name = color_service::find_closest_palette_color(&lab);
                map.entry(color_name).or_default().push(path);
            }
            map
        }
    };

    Ok(groups)
}
