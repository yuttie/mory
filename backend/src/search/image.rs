use std::path::Path;
use std::time::{Duration, Instant};

use base64::Engine;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tokio::process::Command;

use super::provider::{
    failure, request_error_failure, unsuccessful_response, Failure, ProviderError,
};

pub const PROMPT_VERSION: &str = "image-description-v1";
pub const PREPROCESS_VERSION: &str = "imagemagick-oriented-2048-v2";
pub const DETAIL: &str = "high";
const MAX_SOURCE_BYTES: usize = 32 * 1024 * 1024;
const MAX_OUTPUT_BYTES: usize = 16 * 1024 * 1024;
const MAX_DECODED_PIXELS: u64 = 40_000_000;
const MAX_DIMENSION: u64 = 20_000;
const PREPROCESS_TIMEOUT: Duration = Duration::from_secs(30);

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
        return Err(item_failure("image exceeds the source-byte limit"));
    }
    let normalized = normalize(source).await?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(normalized);
    let request = responses_request(model, encoded);
    let api_key = std::env::var("MORIED_OPENAI_API_KEY")
        .map_err(|_| failure(Failure::Admin, "OpenAI API key is not configured"))?;
    let response = client
        .post("https://api.openai.com/v1/responses")
        .bearer_auth(api_key)
        .json(&request)
        .send()
        .await
        .map_err(|error| {
            let message = format!("image description request failed: {error}");
            failure(request_error_failure(&error), message)
        })?;
    if !response.status().is_success() {
        return Err(unsuccessful_response(response, "image description provider").await);
    }
    let body = response.bytes().await.map_err(|error| {
        retryable_body_failure(format!("image description response body failed: {error}"))
    })?;
    let response = serde_json::from_slice::<serde_json::Value>(&body)
        .map_err(|error| item_failure(&format!("invalid image description response: {error}")))?;
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
        .ok_or_else(|| item_failure("image description response contained no output text"))?;
    let description = serde_json::from_str::<ImageDescription>(text)
        .map_err(|error| item_failure(&format!("invalid structured image description: {error}")))?;
    if description.description.trim().is_empty() && description.visible_text.trim().is_empty() {
        return Err(item_failure("image description was empty"));
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
    let deadline = Instant::now() + PREPROCESS_TIMEOUT;
    // Temporary files fail for every image alike, on a full disk or an unwritable directory.
    let directory = tempfile::tempdir().map_err(|error| {
        failure(Failure::Admin, format!("temporary image directory failed: {error}"))
    })?;
    let input = directory.path().join("source");
    let output = directory.path().join("normalized.jpg");
    tokio::fs::write(&input, source)
        .await
        .map_err(|error| {
            failure(Failure::Admin, format!("temporary image write failed: {error}"))
        })?;
    inspect_dimensions(&input, deadline).await?;
    let mut command = Command::new("magick");
    apply_resource_limits(&mut command);
    let command = command
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
    let result = tokio::time::timeout(remaining_preprocess_time(deadline)?, command)
        .await
        .map_err(|_| item_failure("image preprocessing exceeded 30 seconds"))?
        .map_err(|error| failure(Failure::Admin, format!("ImageMagick could not start: {error}")))?;
    if !result.status.success() {
        return Err(item_failure("ImageMagick rejected the image"));
    }
    let bytes = tokio::fs::read(&output)
        .await
        .map_err(|error| item_failure(&format!("normalized image could not be read: {error}")))?;
    if bytes.len() > MAX_OUTPUT_BYTES {
        return Err(item_failure("normalized image exceeds the output-byte limit"));
    }
    Ok(bytes)
}

fn apply_resource_limits(command: &mut Command) {
    command
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
        .arg(MAX_DIMENSION.to_string());
}

async fn inspect_dimensions(input: &Path, deadline: Instant) -> Result<(), ProviderError> {
    // `-limit area` controls when ImageMagick spills pixels to disk; it does not reject a
    // decompression bomb. Ping reads only enough metadata to enforce the hard bound first.
    let mut command = Command::new("magick");
    command.arg("identify");
    apply_resource_limits(&mut command);
    let command = command
        .arg("-ping")
        .arg("-format")
        .arg("%w %h")
        .arg(format!("{}[0]", input.display()))
        .kill_on_drop(true)
        .output();
    let result = tokio::time::timeout(remaining_preprocess_time(deadline)?, command)
        .await
        .map_err(|_| item_failure("image preprocessing exceeded 30 seconds"))?
        .map_err(|error| failure(Failure::Admin, format!("ImageMagick could not start: {error}")))?;
    if !result.status.success() {
        return Err(item_failure("ImageMagick rejected the image header"));
    }
    let dimensions = String::from_utf8(result.stdout)
        .map_err(|_| item_failure("ImageMagick returned invalid image dimensions"))?;
    let mut parts = dimensions.split_whitespace();
    let width = parts
        .next()
        .and_then(|value| value.parse::<u64>().ok())
        .ok_or_else(|| item_failure("ImageMagick returned invalid image dimensions"))?;
    let height = parts
        .next()
        .and_then(|value| value.parse::<u64>().ok())
        .ok_or_else(|| item_failure("ImageMagick returned invalid image dimensions"))?;
    if parts.next().is_some() {
        return Err(item_failure("ImageMagick returned invalid image dimensions"));
    }
    validate_dimensions(width, height)
}

fn remaining_preprocess_time(deadline: Instant) -> Result<Duration, ProviderError> {
    deadline
        .checked_duration_since(Instant::now())
        .filter(|remaining| !remaining.is_zero())
        .ok_or_else(|| item_failure("image preprocessing exceeded 30 seconds"))
}

fn validate_dimensions(width: u64, height: u64) -> Result<(), ProviderError> {
    let pixels = width.checked_mul(height);
    if width == 0
        || height == 0
        || width > MAX_DIMENSION
        || height > MAX_DIMENSION
        || pixels.is_none_or(|value| value > MAX_DECODED_PIXELS)
    {
        return Err(item_failure("image exceeds the decoded-pixel limit"));
    }
    Ok(())
}

fn item_failure(message: &str) -> ProviderError {
    failure(Failure::Item, message)
}

fn retryable_body_failure(message: String) -> ProviderError {
    failure(Failure::Temporary, message)
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

    #[test]
    fn rejects_decoded_pixel_bombs_before_normalization() {
        assert!(validate_dimensions(8_000, 5_000).is_ok());
        assert!(validate_dimensions(10_000, 5_000).is_err());
        assert!(validate_dimensions(MAX_DIMENSION + 1, 1).is_err());
        assert!(validate_dimensions(u64::MAX, 2).is_err());
        assert!(validate_dimensions(0, 100).is_err());
    }

    #[tokio::test]
    async fn normalizes_a_real_raster_with_imagemagick() {
        let png = base64::engine::general_purpose::STANDARD
            .decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
            .unwrap();

        let normalized = normalize(&png).await.unwrap();

        assert!(normalized.starts_with(&[0xff, 0xd8, 0xff]));
        assert!(normalized.len() <= MAX_OUTPUT_BYTES);
    }

    #[test]
    fn malformed_complete_image_response_is_an_item_failure() {
        let error = serde_json::from_slice::<serde_json::Value>(b"{not json")
            .map_err(|error| item_failure(&format!("invalid image description response: {error}")))
            .unwrap_err();

        assert_eq!(error.failure, Failure::Item);
    }

    #[test]
    fn interrupted_image_response_body_is_temporary() {
        let error = retryable_body_failure("response ended early".to_owned());

        assert_eq!(error.failure, Failure::Temporary);
    }

    #[tokio::test]
    async fn preprocessing_stages_consume_one_shared_deadline() {
        let deadline = Instant::now() + Duration::from_millis(50);
        let first = remaining_preprocess_time(deadline).unwrap();
        tokio::time::sleep(Duration::from_millis(5)).await;
        let second = remaining_preprocess_time(deadline).unwrap();

        assert!(second < first);
        assert!(remaining_preprocess_time(Instant::now()).is_err());
    }
}
