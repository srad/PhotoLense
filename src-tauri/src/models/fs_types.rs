use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
pub struct DriveInfo {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct PhotoEntry {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub modified: Option<u64>,
    pub tags: Option<Vec<String>>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub has_embedding: bool,
}
