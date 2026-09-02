use std::path::Path;
use std::time::Duration;

use base64::Engine;
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use tokio::process::Command;

use super::provider::{retry_after, ProviderError};

pub const PROMPT_VERSION: &str = "image-description-v1";
pub const PREPROCESS_VERSION: &str = "imagemagick-oriented-2048-v1";
pub const DETAIL: &str = "high";
const MAX_SOURCE_BYTES: usize = 32 * 1024 * 1024;
const MAX_OUTPUT_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
pub struct ImageDescription {
    pub description: String,
    pub visible_text: String,
}

pub async fn describe(
    client: &Client,
    model: &str,
    source: &[u8],
) -> Result<ImageDescription, ProviderError> {
    if source.len() > MAX_SOURCE_BYTES {
        return Err(permanent("image exceeds the source-byte limit"));
    }
    let normalized = normalize(source).await?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(normalized);
    let request = responses_request(model, encoded);
    let api_key = std::env::var("MORIED_OPENAI_API_KEY")
        .map_err(|_| permanent("OpenAI API key is not configured"))?;
    let response = client
        .post("https://api.openai.com/v1/responses")
        .bearer_auth(api_key)
        .json(&request)
        .send()
        .await
        .map_err(|error| ProviderError {
            retryable: error.is_connect() || error.is_timeout(),
            retry_after: None,
            message: format!("image description request failed: {error}"),
        })?;
    let status = response.status();
    let retry_after = retry_after(response.headers());
    if !status.is_success() {
        return Err(ProviderError {
            retryable: status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error(),
            retry_after,
            message: format!("image description provider returned HTTP {status}"),
        });
    }
    let response = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| permanent(&format!("invalid image description response: {error}")))?;
    let text = response
        .get("output")
        .and_then(|value| value.as_array())
        .into_iter()
        .flatten()
        .flat_map(|item| {
            item.get("content")
                .and_then(|value| value.as_array())
                .into_iter()
                .flatten()
        })
        .find(|item| item.get("type").and_then(|value| value.as_str()) == Some("output_text"))
        .and_then(|item| item.get("text").and_then(|value| value.as_str()))
        .ok_or_else(|| permanent("image description response contained no output text"))?;
    let description = serde_json::from_str::<ImageDescription>(text)
        .map_err(|error| permanent(&format!("invalid structured image description: {error}")))?;
    if description.description.trim().is_empty() && description.visible_text.trim().is_empty() {
        return Err(permanent("image description was empty"));
    }
    Ok(description)
}

fn responses_request(model: &str, encoded: String) -> ResponsesRequest<'_> {
    ResponsesRequest {
        model,
        store: false,
        max_output_tokens: 800,
        input: vec![InputMessage {
            role: "user",
            content: vec![
                InputContent::Text {
                    text: "Describe this image for private note search. State the important subjects, setting, layout, colors, objects, and actions. Transcribe all legible visible text exactly. Do not infer sensitive attributes or facts not visible.",
                },
                InputContent::Image {
                    image_url: format!("data:image/jpeg;base64,{encoded}"),
                    detail: DETAIL,
                },
            ],
        }],
        text: TextOutput {
            format: JsonSchemaFormat {
                kind: "json_schema",
                name: "image_search_description",
                strict: true,
                schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "description": { "type": "string" },
                        "visible_text": { "type": "string" }
                    },
                    "required": ["description", "visible_text"],
                    "additionalProperties": false
                }),
            },
        },
    }
}

async fn normalize(source: &[u8]) -> Result<Vec<u8>, ProviderError> {
    let directory = tempfile::tempdir()
        .map_err(|error| permanent(&format!("temporary image directory failed: {error}")))?;
    let input = directory.path().join("source");
    let output = directory.path().join("normalized.jpg");
    tokio::fs::write(&input, source)
        .await
        .map_err(|error| permanent(&format!("temporary image write failed: {error}")))?;
    let command = Command::new("magick")
        .arg("-limit")
        .arg("memory")
        .arg("256MiB")
        .arg("-limit")
        .arg("map")
        .arg("512MiB")
        .arg("-limit")
        .arg("disk")
        .arg("512MiB")
        .arg("-limit")
        .arg("area")
        .arg("40MP")
        .arg("-limit")
        .arg("width")
        .arg("20000")
        .arg("-limit")
        .arg("height")
        .arg("20000")
        .arg(format!("{}[0]", input.display()))
        .arg("-auto-orient")
        .arg("-strip")
        .arg("-resize")
        .arg("2048x2048>")
        .arg("-quality")
        .arg("92")
        .arg(&output)
        .kill_on_drop(true)
        .output();
    let result = tokio::time::timeout(Duration::from_secs(30), command)
        .await
        .map_err(|_| permanent("image normalization exceeded 30 seconds"))?
        .map_err(|error| permanent(&format!("ImageMagick could not start: {error}")))?;
    if !result.status.success() {
        return Err(permanent("ImageMagick rejected the image"));
    }
    let bytes = tokio::fs::read(&output)
        .await
        .map_err(|error| permanent(&format!("normalized image could not be read: {error}")))?;
    if bytes.len() > MAX_OUTPUT_BYTES {
        return Err(permanent("normalized image exceeds the output-byte limit"));
    }
    Ok(bytes)
}

fn permanent(message: &str) -> ProviderError {
    ProviderError {
        retryable: false,
        retry_after: None,
        message: message.to_owned(),
    }
}

pub fn supported(mime_type: &str, path: &Path) -> bool {
    if mime_type == "image/svg+xml" {
        return false;
    }
    matches!(
        mime_type,
        "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "image/bmp" | "image/tiff"
    ) && path.extension().is_some()
}

#[derive(Serialize)]
struct ResponsesRequest<'a> {
    model: &'a str,
    store: bool,
    max_output_tokens: usize,
    input: Vec<InputMessage>,
    text: TextOutput,
}

#[derive(Serialize)]
struct InputMessage {
    role: &'static str,
    content: Vec<InputContent>,
}

#[derive(Serialize)]
#[serde(tag = "type")]
enum InputContent {
    #[serde(rename = "input_text")]
    Text { text: &'static str },
    #[serde(rename = "input_image")]
    Image {
        image_url: String,
        detail: &'static str,
    },
}

#[derive(Serialize)]
struct TextOutput {
    format: JsonSchemaFormat,
}

#[derive(Serialize)]
struct JsonSchemaFormat {
    #[serde(rename = "type")]
    kind: &'static str,
    name: &'static str,
    strict: bool,
    schema: serde_json::Value,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_supported_rasters_and_rejects_svg_or_non_images() {
        assert!(supported("image/jpeg", Path::new("photo.jpg")));
        assert!(supported("image/gif", Path::new("animation.gif")));
        assert!(!supported("image/svg+xml", Path::new("diagram.svg")));
        assert!(!supported("text/plain", Path::new("photo.jpg")));
        assert!(!supported("image/png", Path::new("extensionless")));
    }

    #[test]
    fn vision_requests_are_stateless_high_detail_structured_outputs() {
        let request =
            serde_json::to_value(responses_request("vision-model", "pixels".to_owned())).unwrap();
        assert_eq!(request["store"], false);
        assert_eq!(request["input"][0]["content"][1]["detail"], DETAIL);
        assert_eq!(request["text"]["format"]["type"], "json_schema");
        assert_eq!(request["text"]["format"]["strict"], true);
    }
}
