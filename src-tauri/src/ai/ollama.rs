use super::provider::{AiGeneratedTask, AiProvider};
use std::future::Future;

pub struct OllamaProvider {
    pub base_url: String,
    pub model_name: String,
}

impl OllamaProvider {
    pub fn new(base_url: Option<String>, model_name: Option<String>) -> Self {
        Self {
            base_url: base_url.unwrap_or_else(|| "http://localhost:11434".to_string()),
            model_name: model_name.unwrap_or_else(|| "llama3".to_string()),
        }
    }
}

impl AiProvider for OllamaProvider {
    fn decompose_goal(
        &self,
        _goal_title: &str,
        _goal_description: Option<&str>,
    ) -> impl Future<Output = Result<Vec<AiGeneratedTask>, String>> + Send {
        async move {
            // Stub implementation
            Err("Ollama integration not yet fully implemented".to_string())
        }
    }
}
