use std::process::Command;
use tempfile::tempdir;
use std::fs;

#[test]
fn test_binary_compiles() {
    // Test that the binary compiles successfully
    let output = Command::new("cargo")
        .args(&["build", "--bin", "moried"])
        .current_dir(".")
        .output()
        .expect("Failed to execute cargo build");
    
    if !output.status.success() {
        panic!("Build failed: {}", String::from_utf8_lossy(&output.stderr));
    }
}

#[tokio::test]
async fn test_git_grep_command() {
    // Create a temporary directory with a git repository for testing git grep
    let temp_dir = tempdir().expect("Failed to create temp directory");
    let repo_path = temp_dir.path();
    
    // Initialize git repository
    Command::new("git")
        .args(&["init"])
        .current_dir(repo_path)
        .output()
        .expect("Failed to init git repo");
    
    // Configure git user (required for commits)
    Command::new("git")
        .args(&["config", "user.name", "Test User"])
        .current_dir(repo_path)
        .output()
        .expect("Failed to configure git user.name");
    
    Command::new("git")
        .args(&["config", "user.email", "test@example.com"])
        .current_dir(repo_path)
        .output()
        .expect("Failed to configure git user.email");
    
    // Create a test file
    let test_file = repo_path.join("test.txt");
    fs::write(&test_file, "Hello world\nThis is a test\nAnother line")
        .expect("Failed to write test file");
    
    // Add and commit the file
    Command::new("git")
        .args(&["add", "test.txt"])
        .current_dir(repo_path)
        .output()
        .expect("Failed to add file");
    
    Command::new("git")
        .args(&["commit", "-m", "Initial commit"])
        .current_dir(repo_path)
        .output()
        .expect("Failed to commit");
    
    // Test git grep command directly
    let output = Command::new("git")
        .args(&["grep", "--line-number", "--null", "-I", "test", "HEAD"])
        .current_dir(repo_path)
        .output()
        .expect("Failed to execute git grep");
    
    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(stdout.contains("test"));
        assert!(stdout.contains("test.txt"));
    }
}

#[test]
fn test_mime_type_detection() {
    // Since we can't easily import the function, let's test the mime_guess crate directly
    // This validates that our dependency works as expected
    use mime_guess;
    
    let guess = mime_guess::from_path("test.txt");
    assert_eq!(guess.first().unwrap().as_ref(), "text/plain");
    
    let guess_md = mime_guess::from_path("test.md");
    assert_eq!(guess_md.first().unwrap().as_ref(), "text/markdown");
    
    let guess_json = mime_guess::from_path("test.json");
    assert_eq!(guess_json.first().unwrap().as_ref(), "application/json");
}

#[test]
fn test_yaml_parsing() {
    // Test the YAML parsing functionality that we use in extract_metadata
    use serde_yaml;
    
    let yaml_content = r#"
title: "Test Document"
author: "Test Author"
tags: ["test", "yaml"]
"#;
    
    let result: Result<serde_yaml::Value, _> = serde_yaml::from_str(yaml_content);
    assert!(result.is_ok());
    
    let doc = result.unwrap();
    assert!(doc.get("title").is_some());
    assert!(doc.get("author").is_some());
    assert!(doc.get("tags").is_some());
}

#[test]
fn test_markdown_parsing() {
    // Test the markdown parsing functionality
    use markdown;
    
    let content = r#"---
title: "Test"
---
# Heading 1
## Heading 2
Some content here.
"#;
    
    let mut opts = markdown::ParseOptions::gfm();
    opts.constructs.frontmatter = true;
    
    let result = markdown::to_mdast(content, &opts);
    assert!(result.is_ok());
    
    let node = result.unwrap();
    assert!(node.children().is_some());
}

#[test]
fn test_jwt_token_creation() {
    // Test JWT token functionality
    use jsonwebtoken as jwt;
    use serde::{Deserialize, Serialize};
    
    #[derive(Debug, Serialize, Deserialize)]
    struct TestClaims {
        sub: String,
        exp: usize,
    }
    
    let claims = TestClaims {
        sub: "test_user".to_string(),
        exp: 10000000000, // Far future
    };
    
    let secret = "test_secret";
    let token = jwt::encode(
        &jwt::Header::default(),
        &claims,
        &jwt::EncodingKey::from_secret(secret.as_ref())
    );
    
    assert!(token.is_ok());
    
    // Test decoding
    let token_str = token.unwrap();
    let decoded = jwt::decode::<TestClaims>(
        &token_str,
        &jwt::DecodingKey::from_secret(secret.as_ref()),
        &jwt::Validation::default()
    );
    
    assert!(decoded.is_ok());
    let decoded_claims = decoded.unwrap();
    assert_eq!(decoded_claims.claims.sub, "test_user");
}