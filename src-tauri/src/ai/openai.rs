use super::provider::{AiGeneratedTask, AiProvider};
use std::env;
use std::future::Future;
use reqwest::Client;
use serde_json::{json, Value};
use crate::models::ChatMessage;

pub struct OpenAiProvider {
    api_key: String,
    base_url: String,
    model_name: String,
    client: Client,
}

#[derive(Debug, Clone)]
pub struct ToolCall {
    pub name: String,
    pub arguments: Value,
}

/// Extract plain text from either Responses API or Chat Completions API response.
fn extract_text(resp: &Value) -> String {
    // 1. Responses API convenience field
    if let Some(t) = resp["output_text"].as_str() {
        if !t.is_empty() {
            return t.to_string();
        }
    }
    // 2. Responses API: output[].type == "message" → content[].text
    if let Some(output) = resp["output"].as_array() {
        for item in output {
            if item["type"].as_str() == Some("message") {
                if let Some(content) = item["content"].as_array() {
                    for c in content {
                        if let Some(text) = c["text"].as_str() {
                            if !text.is_empty() {
                                return text.to_string();
                            }
                        }
                    }
                }
            }
        }
    }
    // 3. Chat Completions fallback (OpenAI-compatible endpoints)
    resp["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .to_string()
}

/// Extract tool calls from either Responses API or Chat Completions API response.
fn extract_tool_calls(resp: &Value) -> Vec<ToolCall> {
    let mut tool_calls = Vec::new();

    // Responses API: output[].type == "function_call"
    if let Some(output) = resp["output"].as_array() {
        for item in output {
            if item["type"].as_str() == Some("function_call") {
                let name = item["name"].as_str().unwrap_or("").to_string();
                let args_str = item["arguments"].as_str().unwrap_or("{}");
                let arguments: Value = serde_json::from_str(args_str).unwrap_or(json!({}));
                tool_calls.push(ToolCall { name, arguments });
            }
        }
    }

    // Chat Completions fallback
    if tool_calls.is_empty() {
        if let Some(calls) = resp["choices"][0]["message"]["tool_calls"].as_array() {
            for call in calls {
                let name = call["function"]["name"].as_str().unwrap_or("").to_string();
                let args_str = call["function"]["arguments"].as_str().unwrap_or("{}");
                let arguments: Value = serde_json::from_str(args_str).unwrap_or(json!({}));
                tool_calls.push(ToolCall { name, arguments });
            }
        }
    }

    tool_calls
}

impl OpenAiProvider {
    pub fn new() -> Result<Self, String> {
        let api_key = env::var("OPENAI_API_KEY")
            .or_else(|_| {
                option_env!("OPENAI_API_KEY")
                    .map(|s| s.to_string())
                    .ok_or_else(|| "OPENAI_API_KEY not set".to_string())
            })?;
        let base_url = env::var("OPENAI_BASE_URL")
            .unwrap_or_else(|_| {
                option_env!("OPENAI_BASE_URL")
                    .unwrap_or("https://api.openai.com/v1")
                    .to_string()
            });
        let model_name = env::var("OPENAI_MODEL")
            .unwrap_or_else(|_| {
                option_env!("OPENAI_MODEL")
                    .unwrap_or("gpt-4o")
                    .to_string()
            });
        Ok(Self {
            api_key,
            base_url,
            model_name,
            client: Client::new(),
        })
    }

    /// Calls the OpenAI Responses API with fallback to Chat Completions format.
    pub async fn chat_with_tools(
        &self,
        system_prompt: &str,
        messages: Vec<ChatMessage>,
        tools: Value,
    ) -> Result<(String, Vec<ToolCall>), String> {
        let url = format!("{}/responses", self.base_url.trim_end_matches('/'));

        let mut input: Vec<Value> = messages
            .iter()
            .map(|msg| json!({ "role": msg.role.to_string(), "content": msg.content }))
            .collect();

        // Responses API requires at least one input message
        if input.is_empty() {
            input.push(json!({ "role": "user", "content": "Begin." }));
        }

        let mut body = json!({
            "model": self.model_name,
            "instructions": system_prompt,
            "input": input,
        });

        let has_tools = tools.as_array().map(|a| !a.is_empty()).unwrap_or(false);
        if has_tools {
            body["tools"] = tools;
            body["tool_choice"] = json!("auto");
        }

        let resp = self.client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("HTTP request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("API error {}: {}", status, text));
        }

        let json_resp: Value = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        Ok((extract_text(&json_resp), extract_tool_calls(&json_resp)))
    }

    pub async fn chat(
        &self,
        system_prompt: &str,
        messages: Vec<ChatMessage>,
    ) -> Result<String, String> {
        let (content, _) = self
            .chat_with_tools(system_prompt, messages, json!([]))
            .await?;
        Ok(content)
    }

    /// Lightweight single-turn completion — no tool calls, no message history.
    pub async fn simple_completion(&self, system: &str, user_prompt: &str) -> Result<String, String> {
        let url = format!("{}/responses", self.base_url.trim_end_matches('/'));
        let body = json!({
            "model": self.model_name,
            "instructions": system,
            "input": [{ "role": "user", "content": user_prompt }],
        });
        let resp = self.client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("HTTP error: {}", e))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("API error {}: {}", status, text));
        }
        let json_resp: Value = resp.json().await.map_err(|e| format!("Parse error: {}", e))?;
        Ok(extract_text(&json_resp))
    }
}

impl AiProvider for OpenAiProvider {
    fn decompose_goal(
        &self,
        goal_title: &str,
        goal_description: Option<&str>,
    ) -> impl Future<Output = Result<Vec<AiGeneratedTask>, String>> + Send {
        let api_key = self.api_key.clone();
        let base_url = self.base_url.clone();
        let model_name = self.model_name.clone();
        let client = self.client.clone();
        let title = goal_title.to_string();
        let desc = goal_description.unwrap_or("").to_string();

        async move {
            let url = format!("{}/responses", base_url.trim_end_matches('/'));
            let prompt = format!(
                "You are an AI Chief of Staff. Decompose the following goal into a list of actionable tasks.\nGoal: {}\nDescription: {}\n\nReturn ONLY a JSON array of objects, where each object has: 'title' (string), 'description' (string or null), 'effort_minutes' (integer), 'priority' (integer 1-5, where 1 is highest). No markdown wrappers, no other text.",
                title, desc
            );
            let body = json!({
                "model": model_name,
                "instructions": "You are a helpful assistant that only outputs valid JSON arrays.",
                "input": [{ "role": "user", "content": prompt }],
            });
            let resp = client
                .post(&url)
                .header("Authorization", format!("Bearer {}", api_key))
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("HTTP request failed: {}", e))?;

            if !resp.status().is_success() {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                return Err(format!("API error {}: {}", status, text));
            }

            let json_resp: Value = resp
                .json()
                .await
                .map_err(|e| format!("Failed to parse response: {}", e))?;

            let text = extract_text(&json_resp);
            if text.is_empty() {
                return Err(format!("Empty response from AI. Full response: {}", json_resp));
            }

            let clean_text = text
                .trim()
                .trim_start_matches("```json")
                .trim_start_matches("```")
                .trim_end_matches("```")
                .trim();
            let tasks: Vec<AiGeneratedTask> = serde_json::from_str(clean_text)
                .map_err(|e| format!("Failed to parse task list: {} (response: {})", e, clean_text))?;
            Ok(tasks)
        }
    }
}

/// Tool definitions for the global (project-creation) chat.
pub fn global_chat_tools() -> Value {
    json!([
        {
            "type": "function",
            "name": "create_project",
            "description": "Create a new goal/project when the user has clearly stated a trackable objective. Do NOT call this for casual greetings, vague ideas, or when clarification is still needed.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": { "type": "string" },
                    "description": { "type": ["string", "null"] },
                    "target_date": { "type": ["string", "null"], "description": "YYYY-MM-DD" }
                },
                "required": ["title"]
            }
        },
        {
            "type": "function",
            "name": "create_task",
            "description": "Create a task under an existing goal. Only call after create_project has been called and you have a goal_id.",
            "parameters": {
                "type": "object",
                "properties": {
                    "goal_id": { "type": "string" },
                    "title": { "type": "string" },
                    "description": { "type": ["string", "null"] },
                    "effort_minutes": { "type": "integer" },
                    "priority": { "type": "integer", "minimum": 1, "maximum": 5 },
                    "deadline": { "type": ["string", "null"], "description": "ISO 8601 e.g. 2026-07-15" }
                },
                "required": ["goal_id", "title", "effort_minutes", "priority"]
            }
        },
        {
            "type": "function",
            "name": "delete_task",
            "description": "Delete an existing task by its ID.",
            "parameters": {
                "type": "object",
                "properties": {
                    "task_id": { "type": "string" }
                },
                "required": ["task_id"]
            }
        },
        {
            "type": "function",
            "name": "add_to_calendar",
            "description": "Add a fixed appointment, class, meeting, or time block to the user's calendar. Use this for ANY activity with a specific start and end time — college, gym, calls, errands. Do NOT use create_task for these. start_time and end_time MUST be full ISO 8601 datetime strings with timezone offset.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": { "type": "string" },
                    "start_time": { "type": "string", "description": "Full ISO 8601 with offset e.g. 2026-07-01T08:00:00+05:30 or 2026-07-01T08:00:00Z" },
                    "end_time":   { "type": "string", "description": "Full ISO 8601 with offset e.g. 2026-07-01T17:00:00+05:30 or 2026-07-01T17:00:00Z" }
                },
                "required": ["title", "start_time", "end_time"]
            }
        }
    ])
}

/// Tool definitions for the per-task chat.
pub fn task_chat_tools() -> Value {
    json!([
        {
            "type": "function",
            "name": "reschedule_task",
            "description": "Move this task's calendar slot to a new time. Check OCCUPIED SLOTS before proposing a new time.",
            "parameters": {
                "type": "object",
                "properties": {
                    "new_start": { "type": "string", "description": "ISO 8601 e.g. 2026-07-07T10:00:00Z" },
                    "new_end":   { "type": "string", "description": "ISO 8601 e.g. 2026-07-07T11:00:00Z" }
                },
                "required": ["new_start", "new_end"]
            }
        },
        {
            "type": "function",
            "name": "complete_task",
            "description": "Mark this task as completed.",
            "parameters": { "type": "object", "properties": {} }
        },
        {
            "type": "function",
            "name": "split_task",
            "description": "Break this task into smaller subtasks. The original task will be marked completed and replaced with the subtasks.",
            "parameters": {
                "type": "object",
                "properties": {
                    "subtasks": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": { "type": "string" },
                                "effort_minutes": { "type": "integer" },
                                "priority": { "type": "integer", "minimum": 1, "maximum": 5 }
                            },
                            "required": ["title", "effort_minutes", "priority"]
                        }
                    }
                },
                "required": ["subtasks"]
            }
        }
    ])
}
