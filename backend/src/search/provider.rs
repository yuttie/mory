use std::time::Duration;

use async_trait::async_trait;
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};

#[derive(Debug)]
pub struct ProviderError {
    pub retryable: bool,
    pub retry_after: Option<Duration>,
    pub message: String,
}

impl std::fmt::Display for ProviderError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for ProviderError {}

pub fn recoverable(message: impl Into<String>) -> ProviderError {
    ProviderError {
        retryable: true,
        retry_after: None,
        message: message.into(),
    }
}

pub fn status_is_retryable(status: StatusCode) -> bool {
    matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN)
        || status == StatusCode::TOO_MANY_REQUESTS
        || status.is_server_error()
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
            .map_err(|_| recoverable("OpenAI API key is not configured"))?;
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
            .map_err(|error| ProviderError {
                retryable: error.is_connect() || error.is_timeout(),
                retry_after: None,
                message: format!("embedding request failed: {error}"),
            })?;
        let status = response.status();
        let retry_after = retry_after(response.headers());
        if !status.is_success() {
            return Err(ProviderError {
                retryable: status_is_retryable(status),
                retry_after,
                // Do not read the body: provider request IDs and diagnostics stay in server logs.
                message: format!("embedding provider returned HTTP {status}"),
            });
        }
        let body = response.bytes().await.map_err(|error| ProviderError {
            retryable: error.is_body() || error.is_timeout(),
            retry_after: None,
            message: format!("embedding response body failed: {error}"),
        })?;
        let response =
            serde_json::from_slice::<EmbeddingResponse>(&body).map_err(|error| ProviderError {
                retryable: false,
                retry_after: None,
                message: format!("invalid embedding response: {error}"),
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
        return Err(ProviderError {
            retryable: false,
            retry_after: None,
            message: "embedding response indices do not match the request".to_owned(),
        });
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
    fn corrected_provider_configuration_remains_retryable() {
        assert!(recoverable("missing API key").retryable);
        assert!(status_is_retryable(StatusCode::UNAUTHORIZED));
        assert!(status_is_retryable(StatusCode::FORBIDDEN));
        assert!(!status_is_retryable(StatusCode::BAD_REQUEST));
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
