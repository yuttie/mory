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
/// The side of the square an image is scaled down to fit before it is described.
pub const SENT_SIDE: u64 = 2048;
/// How many times an image may be scaled down before text in it is likely too small to read once
/// sent. Photographed slides sent at a quarter of their size were transcribed in full; a page
/// screenshot sent at a fourteenth was not legible at all.
const LEGIBLE_REDUCTION: u64 = 5;
// What an image may decode to, as production must hold it: a 2 GB machine running moried, Git and
// the web server besides. A decoder keeps buffers the limits below do not count, up to 8 bytes a
// pixel for a progressive CMYK JPEG, so at this bound ImageMagick peaks at about 320 MB resident
// and spills at most 530 MB to disk, an RGBA PNG; it took under a second on one core here.
const MAX_DECODED_PIXELS: u64 = 40_000_000;
// JPEG's own limit. A side holds no memory the pixel bound does not count, and a long screenshot
// within it is scaled down to the 2048 square like any other image.
const MAX_DIMENSION: u64 = 65_535;
const PREPROCESS_TIMEOUT: Duration = Duration::from_secs(30);
// The transcription of a dense screenshot or a photographed slide is most of an answer, and a
// reasoning model spends part of this budget before writing any of it. At 800, 75 of 358 images
// in the notes were cut off every time, three of them sampled after 38 to 386 reasoning tokens.
const MAX_OUTPUT_TOKENS: usize = 4_096;

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
        return Err(failure(
            Failure::TooLarge,
            format!(
                "image is {} bytes, over the {} MiB moried reads",
                source.len(),
                MAX_SOURCE_BYTES / (1024 * 1024),
            ),
        ));
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
    description_of(&response)
}

/// Reads the description out of a response, refusing one the model did not finish.
fn description_of(response: &serde_json::Value) -> Result<ImageDescription, ProviderError> {
    // A cut-off answer still carries its output text, so without this check it reads as the
    // invalid JSON it ends in, which names nothing that would tell anyone what to change.
    if response.get("status").and_then(|value| value.as_str()) == Some("incomplete") {
        let reason = response
            .pointer("/incomplete_details/reason")
            .and_then(|value| value.as_str())
            .unwrap_or("no reason given");
        return Err(item_failure(&format!("image description was cut off: {reason}")));
    }
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
        max_output_tokens: MAX_OUTPUT_TOKENS,
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
    // What the pixel cache spills to disk is ImageMagick's own file, which a process killed at the
    // deadline leaves behind, as large as the disk limit lets it grow; here it goes with the rest.
    command.env("MAGICK_TEMPORARY_PATH", directory.path());
    let command = command
        .arg("-limit")
        .arg("width")
        .arg(MAX_DIMENSION.to_string())
        .arg("-limit")
        .arg("height")
        .arg(MAX_DIMENSION.to_string())
        .arg(format!("{}[0]", input.display()))
        .arg("-auto-orient")
        .arg("-strip")
        .arg("-resize")
        .arg(format!("{SENT_SIDE}x{SENT_SIDE}>"))
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
        // The pixel cache, in memory and in mapped files, which a mapped page counts toward too;
        // what does not fit goes to disk.
        .arg("-limit")
        .arg("memory")
        .arg("128MiB")
        .arg("-limit")
        .arg("map")
        .arg("128MiB")
        // About twice the most an image within `MAX_DECODED_PIXELS` spills: 530 MB for an RGBA PNG
        // with its alpha, 410 MB for a CMYK JPEG turned upright, whose turned copy is a second cache.
        .arg("-limit")
        .arg("disk")
        .arg("1GiB");
}

async fn inspect_dimensions(input: &Path, deadline: Instant) -> Result<(), ProviderError> {
    // The limits above decide where pixels go, not whether an image is decoded at all, so they
    // would let a decompression bomb fill the disk. Ping reads only enough to refuse one first.
    // ImageMagick's own width and height limits are left out here, as they would refuse the image
    // as it reads the header, which would not tell it apart from a broken one.
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

/// The size an image of `width` by `height` is sent at, as `-resize` scales it down to fit.
pub fn sent_size(width: u64, height: u64) -> (u64, u64) {
    let longest = width.max(height);
    if longest <= SENT_SIDE {
        return (width, height);
    }
    let scaled = |side: u64| ((side * SENT_SIDE + longest / 2) / longest).max(1);
    (scaled(width), scaled(height))
}

/// Whether an image is scaled down so far to be sent that text in it is likely too small to read,
/// leaving a description of its layout rather than of what it says.
pub fn shrunk_past_reading(width: u64, height: u64) -> bool {
    width.max(height) > SENT_SIDE * LEGIBLE_REDUCTION
}

fn remaining_preprocess_time(deadline: Instant) -> Result<Duration, ProviderError> {
    deadline
        .checked_duration_since(Instant::now())
        .filter(|remaining| !remaining.is_zero())
        .ok_or_else(|| item_failure("image preprocessing exceeded 30 seconds"))
}

fn validate_dimensions(width: u64, height: u64) -> Result<(), ProviderError> {
    if width == 0 || height == 0 {
        return Err(item_failure("image has no pixels"));
    }
    let pixels = width.checked_mul(height);
    if width > MAX_DIMENSION
        || height > MAX_DIMENSION
        || pixels.is_none_or(|value| value > MAX_DECODED_PIXELS)
    {
        return Err(failure(
            Failure::TooLarge,
            format!(
                "image is {width} by {height} pixels, over the {} MP or {MAX_DIMENSION} pixels \
                 a side moried decodes",
                MAX_DECODED_PIXELS / 1_000_000,
            ),
        ));
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
    fn says_which_images_are_shrunk_past_reading() {
        assert_eq!(sent_size(1_000, 28_000), (73, 2_048));
        assert_eq!(sent_size(4_032, 3_024), (2_048, 1_536));
        assert_eq!(sent_size(800, 600), (800, 600));
        assert!(shrunk_past_reading(1_000, 28_000));
        assert!(!shrunk_past_reading(10_240, 10_240));
        assert!(!shrunk_past_reading(4_032, 3_024));
    }

    #[test]
    fn rejects_decoded_pixel_bombs_before_normalization() {
        assert!(validate_dimensions(8_000, 5_000).is_ok());
        assert!(validate_dimensions(10_000, 5_000).is_err());
        assert!(validate_dimensions(MAX_DIMENSION + 1, 1).is_err());
        assert!(validate_dimensions(u64::MAX, 2).is_err());
        assert_eq!(validate_dimensions(10_000, 5_000).unwrap_err().failure, Failure::TooLarge);
        assert_eq!(validate_dimensions(0, 100).unwrap_err().failure, Failure::Item);
    }

    #[tokio::test]
    async fn refuses_an_image_over_the_bound_as_too_large_before_decoding_it() {
        // A whole web page captured at once, as one note holds: 46 MP.
        let generated = std::process::Command::new("magick")
            .args(["-size", "1637x28108", "xc:white", "png:-"])
            .output()
            .unwrap();
        assert!(generated.status.success());

        let error = normalize(&generated.stdout).await.unwrap_err();

        assert_eq!(error.failure, Failure::TooLarge);
        assert_eq!(
            error.message,
            "image is 1637 by 28108 pixels, over the 40 MP or 65535 pixels a side moried decodes",
        );
    }

    #[tokio::test]
    async fn normalizes_an_image_at_the_pixel_bound_within_the_limits() {
        // An RGBA PNG, which spills the most of any image measured: 530 MB to disk.
        let generated = std::process::Command::new("magick")
            .args(["-size", "6324x6324", "xc:#ff000080", "-define", "png:color-type=6", "png:-"])
            .output()
            .unwrap();
        assert!(generated.status.success());
        assert!(validate_dimensions(6_324, 6_324).is_ok());

        let normalized = normalize(&generated.stdout).await.unwrap();

        assert!(normalized.starts_with(&[0xff, 0xd8, 0xff]));
    }

    #[tokio::test]
    async fn scales_down_an_image_taller_than_the_old_side_bound() {
        // A long screenshot within the pixel bound, which 20,000 pixels a side refused.
        let generated = std::process::Command::new("magick")
            .args(["-size", "1000x28000", "xc:white", "png:-"])
            .output()
            .unwrap();
        assert!(generated.status.success());

        let normalized = normalize(&generated.stdout).await.unwrap();

        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("normalized.jpg");
        std::fs::write(&path, normalized).unwrap();
        let identified = std::process::Command::new("magick")
            .args(["identify", "-format", "%w %h"])
            .arg(&path)
            .output()
            .unwrap();
        assert_eq!(String::from_utf8(identified.stdout).unwrap(), "73 2048");
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
    fn a_cut_off_description_names_why() {
        let response = serde_json::json!({
            "status": "incomplete",
            "incomplete_details": { "reason": "max_output_tokens" },
            "output": [{
                "type": "message",
                "content": [{ "type": "output_text", "text": "{\"description\": \"A ch" }],
            }],
        });

        let error = description_of(&response).unwrap_err();

        assert_eq!(error.failure, Failure::Item);
        assert_eq!(error.message, "image description was cut off: max_output_tokens");
    }

    #[test]
    fn a_completed_description_is_read() {
        let response = serde_json::json!({
            "status": "completed",
            "output": [
                { "type": "reasoning", "summary": [] },
                {
                    "type": "message",
                    "content": [{
                        "type": "output_text",
                        "text": "{\"description\": \"A chart\", \"visible_text\": \"Loss\"}",
                    }],
                },
            ],
        });

        let description = description_of(&response).unwrap();

        assert_eq!(description.description, "A chart");
        assert_eq!(description.visible_text, "Loss");
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
