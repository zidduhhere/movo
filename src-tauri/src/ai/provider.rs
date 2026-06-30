use std::future::Future;

// We use basic structs for parsed AI responses
#[derive(serde::Deserialize, Debug)]
pub struct AiGeneratedTask {
    pub title: String,
    pub description: Option<String>,
    pub effort_minutes: i32,
    pub priority: i32,
}

pub trait AiProvider {
    fn decompose_goal(
        &self,
        goal_title: &str,
        goal_description: Option<&str>,
    ) -> impl Future<Output = Result<Vec<AiGeneratedTask>, String>> + Send;
}
