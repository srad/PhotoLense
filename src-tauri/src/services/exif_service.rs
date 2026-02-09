use crate::error::AppError;
use crate::models::exif_types::ExifData;
use exif::{In, Tag};
use std::fs::File;
use std::io::{BufReader, Cursor, Read};
use std::path::Path;

pub fn read_exif(path: &Path) -> Result<ExifData, AppError> {
    let file = File::open(path).map_err(|e| AppError {
        message: format!("Failed to open file: {}", e),
    })?;

    let mut reader = BufReader::new(file);
    let exif_reader = exif::Reader::new();
    let exif = exif_reader.read_from_container(&mut reader).map_err(|e| AppError {
        message: format!("Failed to read EXIF data: {}", e),
    })?;

    let mut data = ExifData::default();

    if let Some(field) = exif.get_field(Tag::Make, In::PRIMARY) {
        data.camera_make = Some(field.display_value().to_string().trim_matches('"').to_string());
    }
    if let Some(field) = exif.get_field(Tag::Model, In::PRIMARY) {
        data.camera_model = Some(field.display_value().to_string().trim_matches('"').to_string());
    }
    if let Some(field) = exif.get_field(Tag::DateTimeOriginal, In::PRIMARY) {
        data.date_taken = Some(field.display_value().to_string().trim_matches('"').to_string());
    }
    if let Some(field) = exif.get_field(Tag::ExposureTime, In::PRIMARY) {
        data.exposure_time = Some(field.display_value().to_string());
    }
    if let Some(field) = exif.get_field(Tag::FNumber, In::PRIMARY) {
        data.f_number = Some(field.display_value().to_string());
    }
    if let Some(field) = exif.get_field(Tag::PhotographicSensitivity, In::PRIMARY) {
        data.iso = Some(field.display_value().to_string());
    }
    if let Some(field) = exif.get_field(Tag::FocalLength, In::PRIMARY) {
        data.focal_length = Some(field.display_value().to_string());
    }
    if let Some(field) = exif.get_field(Tag::PixelXDimension, In::PRIMARY) {
        if let exif::Value::Long(ref v) = field.value {
            data.width = v.first().copied();
        } else if let exif::Value::Short(ref v) = field.value {
            data.width = v.first().map(|&x| x as u32);
        }
    }
    if let Some(field) = exif.get_field(Tag::PixelYDimension, In::PRIMARY) {
        if let exif::Value::Long(ref v) = field.value {
            data.height = v.first().copied();
        } else if let exif::Value::Short(ref v) = field.value {
            data.height = v.first().map(|&x| x as u32);
        }
    }
    if let Some(field) = exif.get_field(Tag::Orientation, In::PRIMARY) {
        data.orientation = Some(field.display_value().to_string());
        data.orientation_id = match field.value {
            exif::Value::Short(ref v) => v.first().map(|&x| x as u32),
            exif::Value::Long(ref v) => v.first().copied(),
            _ => None,
        };
    }
    if let Some(field) = exif.get_field(Tag::Software, In::PRIMARY) {
        data.software = Some(field.display_value().to_string().trim_matches('"').to_string());
    }
    if let Some(field) = exif.get_field(Tag::Flash, In::PRIMARY) {
        data.flash = Some(field.display_value().to_string());
    }
    if let Some(field) = exif.get_field(Tag::WhiteBalance, In::PRIMARY) {
        data.white_balance = Some(field.display_value().to_string());
    }

    // GPS coordinates
    if let (Some(lat_field), Some(lat_ref)) = (
        exif.get_field(Tag::GPSLatitude, In::PRIMARY),
        exif.get_field(Tag::GPSLatitudeRef, In::PRIMARY),
    ) {
        if let Some(lat) = parse_gps_coord(&lat_field.value, &lat_ref.display_value().to_string()) {
            data.gps_latitude = Some(lat);
        }
    }
    if let (Some(lon_field), Some(lon_ref)) = (
        exif.get_field(Tag::GPSLongitude, In::PRIMARY),
        exif.get_field(Tag::GPSLongitudeRef, In::PRIMARY),
    ) {
        if let Some(lon) = parse_gps_coord(&lon_field.value, &lon_ref.display_value().to_string()) {
            data.gps_longitude = Some(lon);
        }
    }

    Ok(data)
}

fn parse_gps_coord(value: &exif::Value, reference: &str) -> Option<f64> {
    if let exif::Value::Rational(ref rationals) = value {
        if rationals.len() >= 3 {
            let degrees = rationals[0].to_f64();
            let minutes = rationals[1].to_f64();
            let seconds = rationals[2].to_f64();
            let mut coord = degrees + minutes / 60.0 + seconds / 3600.0;
            let ref_clean = reference.trim_matches('"').trim();
            if ref_clean == "S" || ref_clean == "W" {
                coord = -coord;
            }
            return Some(coord);
        }
    }
    None
}

/// efficiently read the file header to find the EXIF orientation tag, defaulting to 1.
pub fn get_orientation(path: &Path) -> u32 {
    let file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return 1,
    };
    
    // Read first 128KB (covers most EXIF headers)
    let mut header_buf = Vec::with_capacity(128 * 1024);
    if file.take(128 * 1024).read_to_end(&mut header_buf).is_err() {
        return 1;
    }

    let exif = match exif::Reader::new().read_from_container(&mut Cursor::new(&header_buf)) {
        Ok(e) => e,
        Err(_) => return 1,
    };

    if let Some(field) = exif.get_field(exif::Tag::Orientation, exif::In::PRIMARY) {
        match field.value {
            exif::Value::Short(ref v) => *v.first().unwrap_or(&1) as u32,
            exif::Value::Long(ref v) => *v.first().unwrap_or(&1),
            _ => 1,
        }
    } else {
        1
    }
}

/// Apply EXIF orientation to the image.
pub fn apply_orientation(img: image::DynamicImage, orientation: u32) -> image::DynamicImage {
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
