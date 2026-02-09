use crate::error::AppError;
use base64::Engine;
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::ImageReader;
use std::io::{Cursor, Read};
use std::path::Path;
use std::time::Instant;

const THUMBNAIL_SIZE: u32 = 200;
const THUMBNAIL_QUALITY: u8 = 60;

/// Generate a thumbnail and return the raw JPEG bytes.
/// Respects EXIF orientation.
pub fn generate_thumbnail_bytes(path: &Path) -> Result<Vec<u8>, AppError> {
    let total_start = Instant::now();
    let name = path.file_name().unwrap_or_default().to_string_lossy();

    // 1. Read EXIF (Orientation + Embedded Thumbnail)
    let (exif_thumb, orientation) = read_exif_info(path);

    let is_jpeg = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| {
            let lower = e.to_ascii_lowercase();
            lower == "jpg" || lower == "jpeg"
        })
        .unwrap_or(false);

    // 2. Try EXIF embedded thumbnail (fastest)
    if is_jpeg {
        if let Some(bytes) = exif_thumb {
            let exif_start = Instant::now();
            
            // If no rotation needed, return raw bytes (fastest)
            if orientation == 1 {
                return Ok(bytes);
            }

            // If rotation needed: Decode -> Rotate -> Encode
            // This is still faster than decoding the full 24MP image
            match decode_and_rotate_bytes(&bytes, orientation) {
                Ok(rotated_bytes) => {
                    return Ok(rotated_bytes);
                }
                Err(e) => {
                    eprintln!("[thumb] {} EXIF rotate failed: {}, falling back", name, e);
                    // Fallback to full decode
                }
            }
        }
    }

    // 3. Fallback: Full decode -> Resize -> Rotate -> Encode
    let decode_start = Instant::now();
    let mut img = decode_image_dynamic(path)?;
    let decode_ms = decode_start.elapsed().as_secs_f64() * 1000.0;

    // Resize first (performance optimization)
    // We resize to a bounding box, so orientation doesn't affect the target box size yet.
    // e.g. 6000x4000 (Landscape) -> Resize 200x200 -> 200x133
    // Then Rotate 90 -> 133x200 (Portrait correct)
    let intermediate_size = THUMBNAIL_SIZE * 4; // ~800px
    if img.width() > intermediate_size * 2 || img.height() > intermediate_size * 2 {
        // Step 1: Nearest-neighbor to ~800px
        img = img.resize(intermediate_size, intermediate_size, FilterType::Nearest);
    }
    // Step 2: Triangle to 200px
    img = img.resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, FilterType::Triangle);

    // Rotate
    if orientation != 1 {
        img = apply_orientation(img, orientation);
    }

    let encode_start = Instant::now();
    let result = encode_jpeg_thumbnail(&img);
    let encode_ms = encode_start.elapsed().as_secs_f64() * 1000.0;

    result
}

/// Encode a DynamicImage to JPEG bytes at reduced quality.
fn encode_jpeg_thumbnail(img: &image::DynamicImage) -> Result<Vec<u8>, AppError> {
    let mut buffer = Cursor::new(Vec::new());
    let encoder = JpegEncoder::new_with_quality(&mut buffer, THUMBNAIL_QUALITY);
    img.write_with_encoder(encoder).map_err(|e| AppError {
        message: format!("Failed to encode thumbnail: {}", e),
    })?;
    Ok(buffer.into_inner())
}

/// Decode raw bytes, apply rotation, and re-encode to JPEG.
fn decode_and_rotate_bytes(bytes: &[u8], orientation: u32) -> Result<Vec<u8>, AppError> {
    let img = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| AppError { message: e.to_string() })?
        .decode()
        .map_err(|e| AppError { message: e.to_string() })?;

    let rotated = apply_orientation(img, orientation);
    encode_jpeg_thumbnail(&rotated)
}

/// Full decode of the image file.
fn decode_image_dynamic(path: &Path) -> Result<image::DynamicImage, AppError> {
    ImageReader::open(path)
        .map_err(|e| AppError {
            message: format!("Failed to open image {}: {}", path.display(), e),
        })?
        .decode()
        .map_err(|e| AppError {
            message: format!("Failed to decode image {}: {}", path.display(), e),
        })
}

/// Read file header, parse EXIF, return (Embedded Thumbnail, Orientation).
/// Orientation defaults to 1 if not found.
fn read_exif_info(path: &Path) -> (Option<Vec<u8>>, u32) {
    let file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return (None, 1),
    };
    
    // Read first 128KB (covers most EXIF headers)
    let mut header_buf = Vec::with_capacity(128 * 1024);
    if file.take(128 * 1024).read_to_end(&mut header_buf).is_err() {
        return (None, 1);
    }

    let exif = match exif::Reader::new().read_from_container(&mut Cursor::new(&header_buf)) {
        Ok(e) => e,
        Err(_) => return (None, 1),
    };

    // Extract Orientation
    let orientation = if let Some(field) = exif.get_field(exif::Tag::Orientation, exif::In::PRIMARY) {
        match field.value {
            exif::Value::Short(ref v) => *v.first().unwrap_or(&1) as u32,
            exif::Value::Long(ref v) => *v.first().unwrap_or(&1),
            _ => 1,
        }
    } else {
        1
    };

    // Extract Thumbnail
    let thumb_bytes = extract_thumb_from_exif(&exif);

    (thumb_bytes, orientation)
}

fn extract_thumb_from_exif(exif: &exif::Exif) -> Option<Vec<u8>> {
    let offset_field = exif.get_field(exif::Tag::JPEGInterchangeFormat, exif::In::THUMBNAIL)?;
    let length_field = exif.get_field(exif::Tag::JPEGInterchangeFormatLength, exif::In::THUMBNAIL)?;

    let offset = match offset_field.value {
        exif::Value::Long(ref v) => *v.first()? as usize,
        _ => return None,
    };

    let length = match length_field.value {
        exif::Value::Long(ref v) => *v.first()? as usize,
        _ => return None,
    };

    if length < 100 || length > 200_000 {
        return None;
    }

    let buf = exif.buf();
    if offset + length > buf.len() {
        return None;
    }

    let thumb_bytes = &buf[offset..offset + length];
    // Verify JPEG Signature
    if thumb_bytes.len() < 2 || thumb_bytes[0] != 0xFF || thumb_bytes[1] != 0xD8 {
        return None;
    }

    Some(thumb_bytes.to_vec())
}

/// Apply EXIF orientation to the image.
fn apply_orientation(img: image::DynamicImage, orientation: u32) -> image::DynamicImage {
    match orientation {
        2 => img.fliph(),
        3 => img.rotate180(),
        4 => img.flipv(),
        5 => img.fliph().rotate90(),
        6 => img.rotate90(),
        7 => img.fliph().rotate270(),
        8 => img.rotate270(),
        _ => img,
    }
}

/// Generate a thumbnail and return it as a base64 data URI.
pub fn generate_thumbnail(path: &Path) -> Result<String, AppError> {
    let bytes = generate_thumbnail_bytes(path)?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:image/jpeg;base64,{}", b64))
}
