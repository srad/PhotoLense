use crate::error::AppError;
use futures::StreamExt;
use ort::session::Session;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

const UPDATE_API_URL: &str = "https://vs.sedrad.com/api/v1/apps/photolense/latest";
const UPDATE_BASE_URL: &str = "https://vs.sedrad.com";

#[derive(serde::Deserialize)]
struct UpdateResponse {
    files: Vec<UpdateFile>,
}

#[derive(serde::Deserialize)]
struct UpdateFile {
    #[serde(rename = "fileName")]
    file_name: String,
    #[serde(rename = "downloadUrl")]
    download_url: String,
}

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ModelType {
    Base,
    Large,
    MobileNetV3Large,
}

impl ModelType {
    fn config(&self) -> (&'static str, &'static str, &'static str, &'static str) {
        match self {
            ModelType::Base => (
                "https://huggingface.co/Xenova/convnextv2-base-22k-384/resolve/main/onnx/model.onnx",
                "https://huggingface.co/Xenova/convnextv2-base-22k-384/resolve/main/config.json",
                "convnextv2-base-22k-384.onnx",
                "convnextv2-base-22k-384-config.json",
            ),
            ModelType::Large => (
                "https://huggingface.co/Xenova/convnextv2-large-22k-384/resolve/main/onnx/model.onnx",
                "https://huggingface.co/Xenova/convnextv2-large-22k-384/resolve/main/config.json",
                "convnextv2-large-22k-384.onnx",
                "convnextv2-large-22k-384-config.json",
            ),
            ModelType::MobileNetV3Large => (
                "DYNAMIC", // Placeholder, fetched dynamically
                "DYNAMIC", // Placeholder, fetched dynamically
                "mobilenetv3_large.onnx",
                "mobilenetv3_config.json",
            ),
        }
    }

    pub fn crop_size(&self) -> u32 {
        match self {
            ModelType::Base | ModelType::Large => 384,
            ModelType::MobileNetV3Large => 224,
        }
    }
}

pub type TractModel = Session;

#[derive(Clone)]
pub struct ModelManager {
    pub model_dir: PathBuf,
    pub labels: Arc<Mutex<Option<Vec<String>>>>,
    pub model: Arc<std::sync::Mutex<Option<TractModel>>>,
    pub loading: Arc<Mutex<bool>>,
    pub error: Arc<Mutex<Option<String>>>,
    pub current_type: Arc<Mutex<ModelType>>,
    pub cancel_flag: Arc<AtomicBool>,
    pub current_use_gpu: Arc<Mutex<bool>>,
    loaded_type: Arc<Mutex<Option<ModelType>>>,
}

impl ModelManager {
    pub fn new(app_data_dir: PathBuf) -> Self {
        let model_dir = app_data_dir.join("models");
        Self {
            model_dir,
            labels: Arc::new(Mutex::new(None)),
            model: Arc::new(std::sync::Mutex::new(None)),
            loading: Arc::new(Mutex::new(false)),
            error: Arc::new(Mutex::new(None)),
            current_type: Arc::new(Mutex::new(ModelType::MobileNetV3Large)),
            cancel_flag: Arc::new(AtomicBool::new(false)),
            current_use_gpu: Arc::new(Mutex::new(true)),
            loaded_type: Arc::new(Mutex::new(None)),
        }
    }

    #[allow(dead_code)]
    pub async fn get_model_type(&self) -> ModelType {
        *self.current_type.lock().await
    }

    pub fn cancel_classification(&self) {
        self.cancel_flag.store(true, Ordering::Relaxed);
    }

    pub fn reset_cancel_flag(&self) {
        self.cancel_flag.store(false, Ordering::Relaxed);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancel_flag.load(Ordering::Relaxed)
    }

    pub async fn model_path(&self) -> PathBuf {
        let type_lock = self.current_type.lock().await;
        let (_, _, filename, _) = type_lock.config();
        self.model_dir.join(filename)
    }

    pub async fn config_path(&self) -> PathBuf {
        let type_lock = self.current_type.lock().await;
        let (_, _, _, filename) = type_lock.config();
        self.model_dir.join(filename)
    }

    pub async fn is_downloaded(&self) -> bool {
        self.model_path().await.exists() && self.config_path().await.exists()
    }

    pub fn is_ready(&self) -> bool {
        self.model.lock().unwrap().is_some()
    }

    pub async fn is_loading(&self) -> bool {
        *self.loading.lock().await
    }

    pub async fn get_error(&self) -> Option<String> {
        self.error.lock().await.clone()
    }

    pub async fn download_model(&self, app: &AppHandle, model_type: Option<ModelType>) -> Result<(), AppError> {
        if let Some(t) = model_type {
            *self.current_type.lock().await = t;
        }

        if self.is_downloaded().await {
            return Ok(());
        }

        std::fs::create_dir_all(&self.model_dir).map_err(|e| AppError {
            message: format!("Failed to create model directory: {}", e),
        })?;

        let type_lock = self.current_type.lock().await;
        let (mut model_url, mut config_url, model_file, config_file) = type_lock.config();
        let model_path = self.model_dir.join(model_file);
        let config_path = self.model_dir.join(config_file);
        
        let current_type_enum = *type_lock;
        drop(type_lock); // Release lock before long async ops

        self.reset_cancel_flag();

        // Dynamic URL resolution for MobileNetV3Large
        let mut dynamic_model_url = String::new();
        let mut dynamic_config_url = String::new();

        if current_type_enum == ModelType::MobileNetV3Large {
            let client = reqwest::Client::new();
            let resp = client.get(UPDATE_API_URL).send().await
                .map_err(|e| AppError { message: format!("Failed to fetch update info: {}", e) })?;
            
            let update_data: UpdateResponse = resp.json().await
                .map_err(|e| AppError { message: format!("Failed to parse update info: {}", e) })?;

            for file in update_data.files {
                if file.file_name == "mobilenetv3_large.onnx" {
                    dynamic_model_url = format!("{}{}", UPDATE_BASE_URL, file.download_url);
                } else if file.file_name == "mobilenetv3_config.json" {
                    dynamic_config_url = format!("{}{}", UPDATE_BASE_URL, file.download_url);
                }
            }

            if dynamic_model_url.is_empty() || dynamic_config_url.is_empty() {
                return Err("Failed to resolve dynamic model URLs".into());
            }

            model_url = &dynamic_model_url;
            config_url = &dynamic_config_url;
        }

        if !config_path.exists() {
            download_file(config_url, &config_path, app, &self.cancel_flag).await?;
        }

        if !model_path.exists() {
            download_file(model_url, &model_path, app, &self.cancel_flag).await?;
        }

        Ok(())
    }

    pub async fn load_model(&self, use_gpu: bool) -> Result<(), AppError> {
        let needs_reload = {
            let current_gpu = *self.current_use_gpu.lock().await;
            let loaded = *self.loaded_type.lock().await;
            let requested = *self.current_type.lock().await;
            current_gpu != use_gpu || !self.is_ready() || loaded != Some(requested)
        };

        if !needs_reload {
            return Ok(());
        }

        {
            let mut loading = self.loading.lock().await;
            if *loading {
                // If loading, and config matches? Hard to check.
                // Assuming singular loading process.
                return Err("Model is already loading".into());
            }
            *loading = true;
        }

        *self.error.lock().await = None;

        let result = self.do_load_model(use_gpu).await;

        *self.loading.lock().await = false;

        if let Err(ref e) = result {
            *self.error.lock().await = Some(e.message.clone());
        } else {
            *self.current_use_gpu.lock().await = use_gpu;
            *self.loaded_type.lock().await = Some(*self.current_type.lock().await);
        }

        result
    }

    async fn do_load_model(&self, use_gpu: bool) -> Result<(), AppError> {
        // Load labels from config.json id2label field
        let config_path = self.config_path().await;
        let config_content = tokio::fs::read_to_string(&config_path)
            .await
            .map_err(|e| AppError {
                message: format!("Failed to read config file {}: {}", config_path.display(), e),
            })?;

        let config: serde_json::Value = serde_json::from_str(&config_content).map_err(|e| AppError {
            message: format!("Failed to parse config JSON: {}", e),
        })?;

        let id2label = config["id2label"]
            .as_object()
            .ok_or_else(|| AppError {
                message: "Config missing id2label field".to_string(),
            })?;

        let mut labels: Vec<(usize, String)> = id2label
            .iter()
            .map(|(k, v)| {
                let idx = k.parse::<usize>().unwrap_or(0);
                let label = v.as_str().unwrap_or("unknown").to_string();
                (idx, label)
            })
            .collect();
        labels.sort_by_key(|(idx, _)| *idx);
        let labels: Vec<String> = labels.into_iter().map(|(_, label)| label).collect();

        *self.labels.lock().await = Some(labels);

        // Initialize ONNX Runtime and load model
        let model_path = self.model_path().await;
        
        let model = tokio::task::spawn_blocking(move || -> Result<Session, AppError> {
            let _ = ort::init()
                .with_name("photo-lense")
                .commit();

            let mut builder = Session::builder()
                .map_err(|e| AppError { message: format!("Failed to create session builder: {}", e) })?
                .with_optimization_level(ort::session::builder::GraphOptimizationLevel::Level3)
                .map_err(|e| AppError { message: format!("Failed to set optimization level: {}", e) })?
                .with_intra_threads(4)
                .map_err(|e| AppError { message: format!("Failed to set intra threads: {}", e) })?;

            if use_gpu {
                builder = builder.with_execution_providers([
                    ort::execution_providers::DirectMLExecutionProvider::default().build(),
                    ort::execution_providers::CoreMLExecutionProvider::default().build(),
                    ort::execution_providers::CUDAExecutionProvider::default().build(),
                    ort::execution_providers::CPUExecutionProvider::default().build(),
                ]).map_err(|e| AppError { message: format!("Failed to register GPU execution providers: {}", e) })?;
            } else {
                builder = builder.with_execution_providers([
                    ort::execution_providers::CPUExecutionProvider::default().build(),
                ]).map_err(|e| AppError { message: format!("Failed to register CPU execution provider: {}", e) })?;
            }

            let session = builder.commit_from_file(model_path)
                .map_err(|e| AppError {
                    message: format!("Failed to load ONNX model: {}", e),
                })?;
                
            Ok(session)
        })
        .await
        .map_err(|e| AppError {
            message: format!("Failed to spawn model loading task: {}", e),
        })??;

        *self.model.lock().unwrap() = Some(model);

        Ok(())
    }

    pub fn get_model_lock(&self) -> Arc<std::sync::Mutex<Option<TractModel>>> {
        self.model.clone()
    }

    pub async fn get_labels(&self) -> Result<Vec<String>, AppError> {
        self.labels
            .lock()
            .await
            .clone()
            .ok_or_else(|| AppError {
                message: "Labels not loaded".to_string(),
            })
    }
}

async fn download_file(url: &str, dest: &PathBuf, app: &AppHandle, cancel_flag: &AtomicBool) -> Result<(), AppError> {
    let client = reqwest::Client::new();
    let response = client.get(url).send().await?;

    if !response.status().is_success() {
        return Err(format!(
            "Failed to download {}: HTTP {}",
            url,
            response.status()
        )
        .into());
    }

    let total_size = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    let mut file = tokio::fs::File::create(dest).await.map_err(|e| AppError {
        message: format!("Failed to create file {}: {}", dest.display(), e),
    })?;

    let mut stream = response.bytes_stream();
    let mut last_emit = 0;

    while let Some(chunk) = stream.next().await {
        if cancel_flag.load(Ordering::Relaxed) {
            // Clean up partial file
            drop(file);
            let _ = tokio::fs::remove_file(dest).await;
            return Err("Download cancelled".into());
        }

        let chunk = chunk?;
        downloaded += chunk.len() as u64;
        tokio::io::AsyncWriteExt::write_all(&mut file, &chunk)
            .await
            .map_err(|e| AppError {
                message: format!("Failed to write to file: {}", e),
            })?;
        
        if total_size > 0 {
            let progress = (downloaded * 100) / total_size;
            // Emit every 1% or so to reduce traffic
            if progress > last_emit {
                let _ = app.emit("download-progress", progress);
                last_emit = progress;
            }
        }
    }
    let _ = app.emit("download-progress", 100u64); // Ensure 100% is sent

    Ok(())
}