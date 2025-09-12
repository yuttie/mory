// Test script to check current OpenAI API usage
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
struct OpenAIRequest {
    model: String,
    messages: Vec<OpenAIRequestMessage>,
    temperature: f32,
}

#[derive(Serialize)]
struct OpenAIRequestMessage {
    role: String,
    content: String,
}

fn main() {
    let request = OpenAIRequest {
        model: "gpt-4.1-mini".to_string(),
        messages: vec![
            OpenAIRequestMessage {
                role: "developer".to_string(),
                content: "You are a helpful assistant".to_string(),
            },
            OpenAIRequestMessage {
                role: "user".to_string(),
                content: "Hello".to_string(),
            }
        ],
        temperature: 0.3,
    };
    
    println!("Current request format:");
    println!("{}", serde_json::to_string_pretty(&request).unwrap());
}
