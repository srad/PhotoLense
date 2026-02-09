use crate::error::AppError;
use crate::models::classify_types::Prediction;
use crate::services::classifier::model_manager::TractModel;
use image::ImageReader;
use ndarray::Array4;
use ort::value::Value;
use std::path::Path;

const CROP_PCT: f32 = 0.875;

// ImageNet normalization constants
const MEAN: [f32; 3] = [0.485, 0.456, 0.406];
const STD: [f32; 3] = [0.229, 0.224, 0.225];

pub fn preprocess_image(path: &Path, crop_size: u32) -> Result<Array4<f32>, AppError> {
    let img = ImageReader::open(path)
        .map_err(|e| AppError {
            message: format!("Failed to open image {}: {}", path.display(), e),
        })?
        .decode()
        .map_err(|e| AppError {
            message: format!("Failed to decode image {}: {}", path.display(), e),
        })?;

    // Preprocessing: resize shortest edge to ceil(crop_size / crop_pct), then center crop
    let resize_size = (crop_size as f32 / CROP_PCT).ceil() as u32;
    let (w, h) = (img.width(), img.height());
    let (new_w, new_h) = if w < h {
        (resize_size, ((h as f32 / w as f32) * resize_size as f32).round() as u32)
    } else {
        (((w as f32 / h as f32) * resize_size as f32).round() as u32, resize_size)
    };
    let resized = img.resize_exact(new_w, new_h, image::imageops::FilterType::Triangle);

    // Center crop to crop_size x crop_size
    let crop_x = (new_w.saturating_sub(crop_size)) / 2;
    let crop_y = (new_h.saturating_sub(crop_size)) / 2;
    let cropped = resized.crop_imm(crop_x, crop_y, crop_size, crop_size);
    let rgb = cropped.to_rgb8();

    // Create NCHW tensor using a two-pass approach for cache-friendly access.
    // Pass 1: normalize pixels sequentially (reads and writes are contiguous).
    let raw = rgb.into_raw();
    let hw = (crop_size * crop_size) as usize;
    let mut interleaved = vec![0f32; 3 * hw];
    for (i, pixel) in raw.chunks_exact(3).enumerate() {
        let off = i * 3;
        interleaved[off] = (pixel[0] as f32 / 255.0 - MEAN[0]) / STD[0];
        interleaved[off + 1] = (pixel[1] as f32 / 255.0 - MEAN[1]) / STD[1];
        interleaved[off + 2] = (pixel[2] as f32 / 255.0 - MEAN[2]) / STD[2];
    }

    // Pass 2: transpose HWC → CHW using cache-friendly tiles.
    // Processing TILE pixels at a time keeps both source and all 3 destination
    // channel write-heads within L1 cache (~48KB on most CPUs).
    let mut data = vec![0f32; 3 * hw];
    const TILE: usize = 1024;
    for base in (0..hw).step_by(TILE) {
        let end = (base + TILE).min(hw);
        for i in base..end {
            let src = i * 3;
            data[i] = interleaved[src];
            data[hw + i] = interleaved[src + 1];
            data[2 * hw + i] = interleaved[src + 2];
        }
    }

    let tensor = Array4::from_shape_vec(
        (1, 3, crop_size as usize, crop_size as usize),
        data,
    )
    .map_err(|e| AppError {
        message: format!("Failed to create tensor: {}", e),
    })?;

    Ok(tensor)
}

/// Returns (predictions, L2-normalized embedding) from the model output logits.
pub fn run_inference_with_model(
    model: &mut TractModel,
    input: Array4<f32>,
    labels: &[String],
    top_k: usize,
) -> Result<(Vec<Prediction>, Vec<f32>), AppError> {
    // Get the input name from the model (assuming single input)
    let input_name = model.inputs()[0].name().to_string();

    // Create tensor Value
    let input_tensor = Value::from_array(input)
        .map_err(|e| AppError { message: format!("Failed to create tensor value: {}", e) })?;

    // Run inference
    let outputs = model
        .run(ort::inputs![input_name.as_str() => input_tensor])
        .map_err(|e| AppError {            message: format!("Inference failed: {}", e),
        })?;

    // Get the first output tensor
    let output_value = outputs
        .values()
        .next()
        .ok_or_else(|| AppError {
            message: "Model produced no outputs".to_string(),
        })?;

    let (_, data) = output_value
        .try_extract_tensor::<f32>()
        .map_err(|e| AppError {
            message: format!("Failed to extract output tensor: {}", e),
        })?;

    // Compute L2-normalized embedding from raw logits (before softmax)
    let logits: Vec<f32> = data.iter().copied().collect();
    let l2_norm = logits.iter().map(|x| x * x).sum::<f32>().sqrt();
    let embedding: Vec<f32> = if l2_norm > 0.0 {
        logits.iter().map(|x| x / l2_norm).collect()
    } else {
        logits.clone()
    };

    // Apply softmax
    let max_logit = data
        .iter()
        .fold(f32::NEG_INFINITY, |a, &b| a.max(b));

    let exp_sum: f32 = data.iter().map(|&x| (x - max_logit).exp()).sum();
    let probabilities: Vec<f32> = data
        .iter()
        .map(|&x| (x - max_logit).exp() / exp_sum)
        .collect();

    // Get top-K predictions
    let mut indexed: Vec<(usize, f32)> = probabilities.iter().copied().enumerate().collect();
    indexed.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    let top_k = top_k.min(indexed.len());
    let predictions: Vec<Prediction> = indexed[..top_k]
        .iter()
        .map(|&(idx, conf)| {
            let class_name = labels
                .get(idx)
                .cloned()
                .unwrap_or_else(|| format!("class_{}", idx));
            Prediction {
                class_name,
                confidence: conf,
            }
        })
        .collect();

    Ok((predictions, embedding))
}

pub fn classify_image_with_model(
    model: &mut TractModel,
    path: &Path,
    labels: &[String],
    top_k: usize,
    crop_size: u32,
) -> Result<(Vec<Prediction>, Vec<f32>), AppError> {
    let tensor = preprocess_image(path, crop_size)?;
    run_inference_with_model(model, tensor, labels, top_k)
}
