use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
pub struct ModelStatus {
    pub downloaded: bool,
    pub loading: bool,
    pub ready: bool,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ClassifyResult {
    pub file_name: String,
    pub file_path: String,
    pub predictions: Vec<Prediction>,
    pub moved_to: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct Prediction {
    pub class_name: String,
    pub confidence: f32,
}

#[derive(Debug, Serialize, Clone)]
pub struct ClassifyProgress {
    pub current: usize,
    pub total: usize,
    pub current_file: String,
    pub results: Vec<ClassifyResult>,
}
