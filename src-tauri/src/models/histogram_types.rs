use serde::Serialize;

#[derive(Debug, Serialize, Clone, Default)]
pub struct HistogramData {
    pub r: Vec<u32>,
    pub g: Vec<u32>,
    pub b: Vec<u32>,
}
