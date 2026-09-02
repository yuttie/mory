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

#[derive(Deserialize)]
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
        let api_key = std::env::var("MORIED_OPENAI_API_KEY").map_err(|_| ProviderError {
            retryable: false,
            retry_after: None,
            message: "OpenAI API key is not configured".to_owned(),
        })?;
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
                retryable: status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error(),
                retry_after,
                // Do not read the body: provider request IDs and diagnostics stay in server logs.
                message: format!("embedding provider returned HTTP {status}"),
            });
        }
        let mut response = response
            .json::<EmbeddingResponse>()
            .await
            .map_err(|error| ProviderError {
                retryable: false,
                retry_after: None,
                message: format!("invalid embedding response: {error}"),
            })?;
        response.data.sort_by_key(|item| item.index);
        Ok(response
            .data
            .into_iter()
            .map(|item| item.embedding)
            .collect())
    }
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
}
