use crate::error::AppError;
use base64::Engine;
use image::codecs::png::{CompressionType, PngEncoder};
use image::{ColorType, ImageEncoder};
use std::fs::File;
use std::io::{BufReader, Cursor, Read};
use std::path::Path;

const WIDTH: u32 = 256;
const HEIGHT: u32 = 100;

#[tauri::command]
pub fn get_histogram(path: String) -> Result<String, AppError> {
    let file_path = Path::new(&path);

    // 1. FAST PATH: Try to extract the embedded thumbnail (0ms - 5ms)
    // This avoids decoding the full 24MP image.
    let img = if let Ok(Some(thumb_vec)) = extract_exif_thumbnail(file_path) {
        // We found a thumbnail! Load it.
        image::load_from_memory(&thumb_vec).ok()
    } else {
        None
    };

    // 2. SLOW FALLBACK: Load full image if thumbnail failed (~200ms+)
    let img = match img {
        Some(i) => i,
        None => image::open(file_path).map_err(|e| AppError {
            message: format!("Failed to open image: {}", e),
        })?,
    };

    // 3. CRITICAL OPTIMIZATION: Resize immediately
    // Calculating histogram on 24MP is slow.
    // Calculating on 200px is instant and visually identical.
    let small_img = img.thumbnail_exact(200, 200);
    let rgb = small_img.into_rgb8();

    // 4. Calculate Histogram (Zero Allocation)
    let mut histogram = [0u32; 768]; // Stack buffer: R, G, B

    for p in rgb.pixels() {
        histogram[p[0] as usize] += 1;
        histogram[256 + p[1] as usize] += 1;
        histogram[512 + p[2] as usize] += 1;
    }

    // 5. Render Histogram (Integer Math)
    let max_val = histogram.iter().copied().max().unwrap_or(1).max(1);
    let scale = HEIGHT as f32 / max_val as f32;

    let mut raw = vec![0u8; (WIDTH * HEIGHT * 4) as usize];

    // Pre-compute bar heights for all 256 levels
    let mut r_h = [0u8; 256];
    let mut g_h = [0u8; 256];
    let mut b_h = [0u8; 256];

    for i in 0..256 {
        r_h[i] = (histogram[i] as f32 * scale) as u8;
        g_h[i] = (histogram[256 + i] as f32 * scale) as u8;
        b_h[i] = (histogram[512 + i] as f32 * scale) as u8;
    }

    // Draw pixels
    for x in 0..WIDTH {
        let rx = x as usize;
        let h_r = r_h[rx];
        let h_g = g_h[rx];
        let h_b = b_h[rx];

        for y in 0..HEIGHT {
            let inv_y = (HEIGHT - 1 - y) as u8;

            let in_r = inv_y < h_r;
            let in_g = inv_y < h_g;
            let in_b = inv_y < h_b;

            if !in_r && !in_g && !in_b { continue; }

            // Fast integer averaging for "blending"
            let mut r: u16 = 0;
            let mut g: u16 = 0;
            let mut b: u16 = 0;
            let mut c: u16 = 0;

            if in_r { r += 255; g += 80;  b += 80;  c += 1; }
            if in_g { r += 80;  g += 200; b += 80;  c += 1; }
            if in_b { r += 80;  g += 120; b += 255; c += 1; }

            if c > 0 { r /= c; g /= c; b /= c; }

            let idx = ((y * WIDTH + x) * 4) as usize;
            raw[idx] = r as u8;
            raw[idx + 1] = g as u8;
            raw[idx + 2] = b as u8;
            raw[idx + 3] = 255;
        }
    }

    // 6. Encode to PNG (Fastest settings)
    let mut png_bytes = Vec::with_capacity(raw.len());
    PngEncoder::new_with_quality(
        &mut png_bytes,
        CompressionType::Fast, // Speed > Size
        image::codecs::png::FilterType::NoFilter,
    )
        .write_image(&raw, WIDTH, HEIGHT, ColorType::Rgba8.into())
        .map_err(|e| AppError { message: e.to_string() })?;

    let b64 = base64::engine::general_purpose::STANDARD.encode(&png_bytes);
    Ok(format!("data:image/png;base64,{}", b64))
}

/// Helper: Robustly extract JPEG thumbnail using kamadak-exif
fn extract_exif_thumbnail(path: &Path) -> Result<Option<Vec<u8>>, AppError> {
    let file = File::open(path).map_err(|_| AppError { message: "File error".into() })?;

    // Read first 128KB (Standard Exif limit is 64KB, but we add safety margin)
    let mut reader = BufReader::with_capacity(128 * 1024, file);
    let mut buf = Vec::with_capacity(128 * 1024);
    reader.by_ref().take(128 * 1024).read_to_end(&mut buf).ok();

    // Parse Exif from the buffer
    let exif = match exif::Reader::new().read_from_container(&mut Cursor::new(&buf)) {
        Ok(e) => e,
        Err(_) => return Ok(None), // Not a JPEG or no Exif
    };

    // Get Offset and Length tags
    let offset_field = exif.get_field(exif::Tag::JPEGInterchangeFormat, exif::In::THUMBNAIL);
    let length_field = exif.get_field(exif::Tag::JPEGInterchangeFormatLength, exif::In::THUMBNAIL);

    let (offset_val, length_val) = match (offset_field, length_field) {
        (Some(o), Some(l)) => (o, l),
        _ => return Ok(None), // Tags missing
    };

    let offset = match offset_val.value {
        exif::Value::Long(ref v) => *v.first().unwrap_or(&0) as usize,
        _ => return Ok(None),
    };

    let length = match length_val.value {
        exif::Value::Long(ref v) => *v.first().unwrap_or(&0) as usize,
        _ => return Ok(None),
    };

    // Validate bounds
    let raw_buf = exif.buf(); // This is the TIFF buffer
    if offset + length > raw_buf.len() || length == 0 {
        return Ok(None);
    }

    let thumb = &raw_buf[offset..offset + length];

    // Quick sanity check: Does it start with JPEG Magic Bytes (FF D8)?
    if thumb.len() > 2 && thumb[0] == 0xFF && thumb[1] == 0xD8 {
        Ok(Some(thumb.to_vec()))
    } else {
        Ok(None)
    }
}