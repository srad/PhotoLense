use image::GenericImageView;
use lab::Lab;
use std::collections::HashMap;
use std::path::Path;
use crate::error::AppError;
use crate::services::thumbnail_service;
use std::io::Cursor;
use image::ImageReader;

pub fn kmeans_clustering(items: Vec<(String, Lab)>, k: usize) -> HashMap<String, Vec<String>> {
    if items.is_empty() {
        return HashMap::new();
    }

    // 1. FAST EXIT: If we have fewer items than K, group by themselves.
    if items.len() <= k {
        let mut map = HashMap::new();
        for (path, lab) in items {
            let rgb = lab.to_rgb();
            let hex = format!("#{:02X}{:02X}{:02X}", rgb[0], rgb[1], rgb[2]);
            map.entry(hex).or_insert_with(Vec::new).push(path);
        }
        return map;
    }

    // 2. SAMPLING STRATEGY (Optimization)
    // If we have many items, we don't need to train on all of them.
    // We take a maximum of 500 samples to find the centroids.
    // We use a "step" to pick items evenly distributed across the set.
    let max_samples = 500;
    let step = (items.len() / max_samples).max(1);

    // Build flat_data only for the sampled items
    let mut training_data = Vec::with_capacity(max_samples * 3);

    // We iterate with 'step_by' to simulate random sampling without the 'rand' crate
    for (_, lab) in items.iter().step_by(step).take(max_samples) {
        training_data.push(lab.l);
        training_data.push(lab.a);
        training_data.push(lab.b);
    }

    let n_samples = training_data.len() / 3;

    // Use your specific ndarray_kentro crate to avoid version mismatch
    let data = match ndarray_kentro::Array2::from_shape_vec((n_samples, 3), training_data) {
        Ok(arr) => arr,
        Err(_) => return HashMap::new(),
    };

    // 3. TRAIN K-MEANS (Fast because n_samples is small)
    let mut kmeans = kentro::KMeans::new(k)
        .with_iterations(20) // 20 iterations is plenty for color
        .with_euclidean(true);

    // We don't care about the return value (clusters) here, only the centroids
    if kmeans.train(data.view(), None).is_err() {
        return HashMap::new();
    }

    let centroids = match kmeans.centroids() {
        Some(c) => c,
        None => return HashMap::new(),
    };

    // 4. PRE-CALCULATE CENTROIDS
    // Convert centroids to a simple Vec of Lab structs and Hex strings
    // This avoids doing matrix lookups inside the hot loop.
    let mut centers = Vec::new();
    let n_centroids = centroids.shape()[0];

    for i in 0..n_centroids {
        let c_l = centroids[[i, 0]];
        let c_a = centroids[[i, 1]];
        let c_b = centroids[[i, 2]];

        let rgb = Lab { l: c_l, a: c_a, b: c_b }.to_rgb();
        let hex = format!("#{:02X}{:02X}{:02X}", rgb[0], rgb[1], rgb[2]);

        centers.push((c_l, c_a, c_b, hex));
    }

    // 5. MANUAL ASSIGNMENT (The "Sweep")
    // Now we assign ALL items to the nearest centroid.
    // This is much faster than running k-means training on the full set.
    let mut groups: HashMap<String, Vec<String>> = HashMap::new();

    for (path, lab) in items {
        let mut min_dist = f32::MAX;
        let mut best_hex = "";

        // Find nearest centroid
        for (cl, ca, cb, hex) in &centers {
            // Euclidean distance squared (no need for sqrt for comparison)
            let dist = (lab.l - cl).powi(2) + (lab.a - ca).powi(2) + (lab.b - cb).powi(2);

            if dist < min_dist {
                min_dist = dist;
                best_hex = hex;
            }
        }

        if !best_hex.is_empty() {
            groups.entry(best_hex.to_string()).or_default().push(path);
        }
    }

    groups
}

struct PaletteColor {
    name: &'static str,
    lab: Lab,
}

// Helper to create Lab from RGB
fn rgb_to_lab(r: u8, g: u8, b: u8) -> Lab {
    Lab::from_rgb(&[r, g, b])
}

fn get_palette() -> Vec<PaletteColor> {
    vec![
        PaletteColor { name: "Red", lab: rgb_to_lab(255, 0, 0) },
        PaletteColor { name: "Orange", lab: rgb_to_lab(255, 165, 0) },
        PaletteColor { name: "Yellow", lab: rgb_to_lab(255, 255, 0) },
        PaletteColor { name: "Green", lab: rgb_to_lab(0, 128, 0) },
        PaletteColor { name: "Cyan", lab: rgb_to_lab(0, 255, 255) },
        PaletteColor { name: "Blue", lab: rgb_to_lab(0, 0, 255) },
        PaletteColor { name: "Purple", lab: rgb_to_lab(128, 0, 128) },
        PaletteColor { name: "Pink", lab: rgb_to_lab(255, 192, 203) },
        PaletteColor { name: "Brown", lab: rgb_to_lab(165, 42, 42) },
        PaletteColor { name: "Black", lab: rgb_to_lab(0, 0, 0) },
        PaletteColor { name: "White", lab: rgb_to_lab(255, 255, 255) },
        PaletteColor { name: "Grey", lab: rgb_to_lab(128, 128, 128) },
    ]
}

pub fn get_image_lab(path: &Path) -> Result<Lab, AppError> {
    // 1. Get thumbnail bytes (fast path: uses EXIF embedded thumb if available)
    let thumb_bytes = thumbnail_service::generate_thumbnail_bytes(path)?;

    // 2. Decode the small thumbnail
    let img = ImageReader::new(Cursor::new(thumb_bytes))
        .with_guessed_format()
        .map_err(|e| AppError {
            message: format!("Failed to read thumbnail format: {}", e),
        })?
        .decode()
        .map_err(|e| AppError {
            message: format!("Failed to decode thumbnail: {}", e),
        })?;

    // 3. Calculate average RGB
    // The thumbnail is already small (~200px), so we can iterate directly.
    let (width, height) = img.dimensions();
    let mut r_sum: u64 = 0;
    let mut g_sum: u64 = 0;
    let mut b_sum: u64 = 0;
    let count = (width * height) as u64;

    if count == 0 {
         return Err(AppError { message: "Image has no pixels".to_string() });
    }

    for pixel in img.pixels() {
        let p = pixel.2;
        r_sum += p[0] as u64;
        g_sum += p[1] as u64;
        b_sum += p[2] as u64;
    }

    let avg_r = (r_sum / count) as u8;
    let avg_g = (g_sum / count) as u8;
    let avg_b = (b_sum / count) as u8;

    Ok(Lab::from_rgb(&[avg_r, avg_g, avg_b]))
}

pub fn find_closest_palette_color(lab: &Lab) -> String {
    let palette = get_palette();
    let mut min_dist = f32::MAX;
    let mut closest_color = "Unknown";

    for p in palette {
        let l_diff = lab.l - p.lab.l;
        let a_diff = lab.a - p.lab.a;
        let b_diff = lab.b - p.lab.b;
        let dist = (l_diff * l_diff + a_diff * a_diff + b_diff * b_diff).sqrt();

        if dist < min_dist {
            min_dist = dist;
            closest_color = p.name;
        }
    }
    closest_color.to_string()
}
