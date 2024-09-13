## 1.2.0 (2024-09-13)
* Disable trace and debug level logs in release builds for performance
* Extract titles as well as metadata
* Upgrade dependencies to their latest versions

## 1.1.0 (2024-08-14)
* Upgrade dependencies to their latest versions
* Relax size limit of file upload (from 8 MiB to 16 MiB)
* Fix Docker container build problem
* Save cached entries to a cache file

## 1.0.0 (2022-12-23)
* Remove openssl from dependencies
* Upgrade rust-argon2 to v1.0.0
* Disable compression
* Apply rate limiting to /login
* Replace warp with axum 
* Update Rust edition to 2021
* Configurable session duration (via MORIED_SESSION_DURATION)

## 0.4.0 (2020-12-31)
* Brush up Docker image
