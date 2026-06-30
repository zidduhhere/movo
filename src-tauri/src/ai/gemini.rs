use super::provider::{AiGeneratedTask, AiProvider};
use std::env;
use std::future::Future;
use reqwest::Client;
use serde_json::json;

pub struct GeminiProvider {
    api_key: String,
    model_name: String,
    client: Client,
}

impl GeminiProvider {
    pub fn new() -> Result<Self, String> {
        let api_key = env::var("GEMINI_API_KEY")
            .map_err(|_| "GEMINI_API_KEY not set in environment".to_string())?;
        let model_name = env::var("GEMINI_MODEL_NAME")
            .unwrap_or_else(|_| "gemini-1.5-pro".to_string());
        
        Ok(Self {
            api_key,
            model_name,
            client: Client::new(),
        })
    }
}

impl AiProvider for GeminiProvider {
    fn decompose_goal(
        &self,
        goal_title: &str,
        goal_description: Option<&str>,
    ) -> impl Future<Output = Result<Vec<AiGeneratedTask>, String>> + Send {
        let api_key = self.api_key.clone();
        let model_name = self.model_name.clone();
        let client = self.client.clone();
        let title = goal_title.to_string();
        let desc = goal_description.unwrap_or("").to_string();

        async move {
            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
                model_name, api_key
            );

            let prompt = format!(
                "You are an AI Chief of Staff. Decompose the following goal into a list of actionable tasks.\nGoal: {}\nDescription: {}\n\nReturn ONLY a JSON array of objects, where each object has: 'title' (string), 'description' (string or null), 'effort_minutes' (integer), 'priority' (integer 1-5, where 1 is highest). No markdown wrappers, no other text.",
                title, desc
            );

            let body = json!({
                "contents": [{
                    "parts": [{"text": prompt}]
                }],
                "generationConfig": {
                    "responseMimeType": "application/json",
                }
            });

            let resp = client.post(&url)
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("HTTP request failed: {}", e))?;

            if !resp.status().is_success() {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                return Err(format!("API error {}: {}", status, text));
            }

            let json_resp: serde_json::Value = resp.json()
                .await
                .map_err(|e| format!("Failed to parse response: {}", e))?;

            let text = json_resp["candidates"][0]["content"]["parts"][0]["text"]
                .as_str()
                .ok_or("Failed to extract text from response")?;

            let tasks: Vec<AiGeneratedTask> = serde_json::from_str(text)
                .map_err(|e| format!("Failed to parse JSON array: {}", e))?;

            Ok(tasks)
        }
    }
}
