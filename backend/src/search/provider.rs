use std::time::Duration;

use async_trait::async_trait;
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};

/// Who a failure is waiting on, which decides what background indexing does next.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Failure {
    /// This item: its request fails every time, while other items may succeed. It is given up.
    Item,
    /// Nobody: a rate limit, an outage or a dropped connection clears up on its own. Requests
    /// pause, and the item is retried.
    Temporary,
    /// An admin: a missing or rejected key, a wrong model, an exhausted quota, or a machine that
    /// cannot run ImageMagick or write temporary files. Nothing changes until they act, so
    /// requests stop until moried restarts, and the item is kept for then.
    Admin,
}

#[derive(Debug)]
pub struct ProviderError {
    pub failure: Failure,
    pub retry_after: Option<Duration>,
    pub message: String,
}

impl ProviderError {
    /// Whether the item should be kept to try again rather than given up.
    pub fn retryable(&self) -> bool {
        self.failure != Failure::Item
    }
}

impl std::fmt::Display for ProviderError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for ProviderError {}

pub fn failure(failure: Failure, message: impl Into<String>) -> ProviderError {
    ProviderError {
        failure,
        retry_after: None,
        message: message.into(),
    }
}

pub fn request_error_failure(error: &reqwest::Error) -> Failure {
    if !error.is_builder()
        && (error.is_connect() || error.is_timeout() || error.is_request() || error.is_body())
    {
        Failure::Temporary
    } else {
        Failure::Item
    }
}

#[derive(Deserialize)]
struct ErrorBody {
    error: ErrorDetail,
}

#[derive(Deserialize)]
struct ErrorDetail {
    code: Option<String>,
}

/// Describes a response that was not a success.
///
/// Only the error's `code` is read from the body. OpenAI answers an exhausted quota with the same
/// 429 as a rate limit, and the code is the only thing that tells them apart.
pub async fn unsuccessful_response(response: reqwest::Response, provider: &str) -> ProviderError {
    let status = response.status();
    let retry_after = retry_after(response.headers());
    // The code lands in logs and in what the web app shows, so keep only one shaped like a code.
    let code = response
        .json::<ErrorBody>()
        .await
        .ok()
        .and_then(|body| body.error.code)
        .filter(|code| {
            code.len() <= 64
                && code
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
        });
    ProviderError {
        failure: status_failure(status, code.as_deref()),
        retry_after,
        message: match code {
            Some(code) => format!("{provider} returned HTTP {status} ({code})"),
            None => format!("{provider} returned HTTP {status}"),
        },
    }
}

fn status_failure(status: StatusCode, code: Option<&str>) -> Failure {
    if matches!(code, Some("insufficient_quota" | "model_not_found")) {
        return Failure::Admin;
    }
    match status {
        // The endpoints are fixed, so what cannot be found is the configured model.
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN | StatusCode::NOT_FOUND => Failure::Admin,
        StatusCode::TOO_MANY_REQUESTS => Failure::Temporary,
        status if status.is_server_error() => Failure::Temporary,
        _ => Failure::Item,
    }
}

#[async_trait]
pub trait EmbeddingProvider: Send + Sync {
    async fn embed(
        &self,
        input: &[String],
        model: &str,
        dimensions: usize,
    ) -> Result<Vec<Vec<f32>>, ProviderError>;
}

pub struct OpenAiEmbeddingProvider {
    client: Client,
}

impl OpenAiEmbeddingProvider {
    pub fn new(client: Client) -> Self {
        Self { client }
    }
}

#[derive(Serialize)]
struct EmbeddingRequest<'a> {
    model: &'a str,
    input: &'a [String],
    dimensions: usize,
    encoding_format: &'static str,
}

#[derive(Deserialize)]
struct EmbeddingResponse {
    data: Vec<EmbeddingData>,
}

#[derive(Debug, Deserialize)]
struct EmbeddingData {
    index: usize,
    embedding: Vec<f32>,
}

#[async_trait]
impl EmbeddingProvider for OpenAiEmbeddingProvider {
    async fn embed(
        &self,
        input: &[String],
        model: &str,
        dimensions: usize,
    ) -> Result<Vec<Vec<f32>>, ProviderError> {
        let api_key = std::env::var("MORIED_OPENAI_API_KEY")
            .map_err(|_| failure(Failure::Admin, "OpenAI API key is not configured"))?;
        let response = self
            .client
            .post("https://api.openai.com/v1/embeddings")
            .bearer_auth(api_key)
            .json(&EmbeddingRequest {
                model,
                input,
                dimensions,
                encoding_format: "float",
            })
            .send()
            .await
            .map_err(|error| {
                failure(request_error_failure(&error), format!("embedding request failed: {error}"))
            })?;
        if !response.status().is_success() {
            return Err(unsuccessful_response(response, "embedding provider").await);
        }
        let body = response.bytes().await.map_err(|error| {
            let kind = if error.is_body() || error.is_timeout() {
                Failure::Temporary
            } else {
                Failure::Item
            };
            failure(kind, format!("embedding response body failed: {error}"))
        })?;
        let response = serde_json::from_slice::<EmbeddingResponse>(&body).map_err(|error| {
            failure(Failure::Item, format!("invalid embedding response: {error}"))
        })?;
        ordered_embeddings(response.data, input.len())
    }
}

fn ordered_embeddings(
    mut data: Vec<EmbeddingData>,
    expected: usize,
) -> Result<Vec<Vec<f32>>, ProviderError> {
    data.sort_by_key(|item| item.index);
    if data.len() != expected
        || data
            .iter()
            .enumerate()
            .any(|(expected_index, item)| item.index != expected_index)
    {
        return Err(failure(
            Failure::Item,
            "embedding response indices do not match the request",
        ));
    }
    Ok(data.into_iter().map(|item| item.embedding).collect())
}

pub fn retry_after(headers: &reqwest::header::HeaderMap) -> Option<Duration> {
    let value = headers.get(reqwest::header::RETRY_AFTER)?.to_str().ok()?;
    if let Ok(seconds) = value.parse::<u64>() {
        return Some(Duration::from_secs(seconds));
    }
    let at = httpdate::parse_http_date(value).ok()?;
    Some(
        at.duration_since(std::time::SystemTime::now())
            .unwrap_or(Duration::ZERO),
    )
}

#[cfg(test)]
pub struct DeterministicEmbeddingProvider;

#[cfg(test)]
#[async_trait]
impl EmbeddingProvider for DeterministicEmbeddingProvider {
    async fn embed(
        &self,
        input: &[String],
        _model: &str,
        dimensions: usize,
    ) -> Result<Vec<Vec<f32>>, ProviderError> {
        Ok(input
            .iter()
            .map(|text| {
                let mut vector = vec![0.0; dimensions];
                for (index, byte) in text.bytes().enumerate() {
                    vector[index % dimensions] += byte as f32 / 255.0;
                }
                vector
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_retry_after_seconds() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(reqwest::header::RETRY_AFTER, "17".parse().unwrap());
        assert_eq!(retry_after(&headers), Some(Duration::from_secs(17)));
    }

    #[test]
    fn statuses_are_classified_by_who_can_resolve_them() {
        let cases = [
            (StatusCode::UNAUTHORIZED, None, Failure::Admin),
            (StatusCode::FORBIDDEN, None, Failure::Admin),
            (StatusCode::NOT_FOUND, Some("model_not_found"), Failure::Admin),
            (StatusCode::BAD_REQUEST, Some("model_not_found"), Failure::Admin),
            (StatusCode::TOO_MANY_REQUESTS, Some("insufficient_quota"), Failure::Admin),
            (StatusCode::TOO_MANY_REQUESTS, Some("rate_limit_exceeded"), Failure::Temporary),
            (StatusCode::TOO_MANY_REQUESTS, None, Failure::Temporary),
            (StatusCode::SERVICE_UNAVAILABLE, None, Failure::Temporary),
            (StatusCode::BAD_REQUEST, None, Failure::Item),
            (StatusCode::PAYLOAD_TOO_LARGE, None, Failure::Item),
        ];
        for (status, code, expected) in cases {
            assert_eq!(status_failure(status, code), expected, "{status} {code:?}");
        }
        assert!(failure(Failure::Admin, "missing API key").retryable());
        assert!(!failure(Failure::Item, "rejected input").retryable());
    }

    async fn respond_once(response: &'static str) -> reqwest::Response {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0; 1024];
            let _ = stream.read(&mut request).await.unwrap();
            stream.write_all(response.as_bytes()).await.unwrap();
        });
        Client::new()
            .get(format!("http://{address}"))
            .send()
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn an_exhausted_quota_is_told_apart_from_a_rate_limit_by_its_code() {
        let quota = respond_once(concat!(
            "HTTP/1.1 429 Too Many Requests\r\nContent-Type: application/json\r\n",
            "Connection: close\r\nContent-Length: 124\r\n\r\n",
            r#"{"error":{"message":"You exceeded your current quota","type":"insufficient_quota","#,
            r#""param":null,"code":"insufficient_quota"}}"#,
        ))
        .await;
        let error = unsuccessful_response(quota, "test provider").await;
        assert_eq!(error.failure, Failure::Admin);
        assert_eq!(
            error.message,
            "test provider returned HTTP 429 Too Many Requests (insufficient_quota)",
        );

        let limit = respond_once(concat!(
            "HTTP/1.1 429 Too Many Requests\r\nRetry-After: 20\r\n",
            "Connection: close\r\nContent-Length: 9\r\n\r\nnot json.",
        ))
        .await;
        let error = unsuccessful_response(limit, "test provider").await;
        assert_eq!(error.failure, Failure::Temporary);
        assert_eq!(error.retry_after, Some(Duration::from_secs(20)));
        assert_eq!(error.message, "test provider returned HTTP 429 Too Many Requests");
    }

    #[tokio::test]
    async fn post_connect_transport_failures_are_retryable() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            drop(stream);
        });
        let error = Client::new()
            .get(format!("http://{address}"))
            .send()
            .await
            .unwrap_err();
        server.await.unwrap();

        assert_eq!(request_error_failure(&error), Failure::Temporary);

        let builder_error = Client::new().get("://invalid").send().await.unwrap_err();
        assert_eq!(request_error_failure(&builder_error), Failure::Item);
    }

    #[test]
    fn orders_embedding_response_by_complete_unique_indices() {
        let ordered = ordered_embeddings(
            vec![
                EmbeddingData {
                    index: 1,
                    embedding: vec![2.0],
                },
                EmbeddingData {
                    index: 0,
                    embedding: vec![1.0],
                },
            ],
            2,
        )
        .unwrap();
        assert_eq!(ordered, vec![vec![1.0], vec![2.0]]);

        let duplicate = vec![
            EmbeddingData {
                index: 0,
                embedding: vec![1.0],
            },
            EmbeddingData {
                index: 0,
                embedding: vec![2.0],
            },
        ];
        assert!(ordered_embeddings(duplicate, 2).is_err());
        assert!(ordered_embeddings(
            vec![EmbeddingData {
                index: 1,
                embedding: vec![1.0],
            }],
            1,
        )
        .is_err());
    }
}
