# build stage
FROM rust:latest AS build-stage

WORKDIR /usr/src/app
COPY Cargo.toml .
COPY Cargo.lock .
COPY docker/dummy-main.rs src/main.rs
RUN cargo build --release

COPY src src
RUN touch src/main.rs && cargo build --release

# production stage
FROM debian:bookworm-slim AS production-stage

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    imagemagick \
    inkscape \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build-stage /usr/src/app/target/release/moried /usr/local/bin/moried

ENV MORIED_GIT_DIR=/repo
ENV MORIED_IMAGE_CACHE_DIR=/cache
ENV MORIED_LISTEN=0.0.0.0:3030

RUN mkdir $MORIED_GIT_DIR
RUN mkdir $MORIED_IMAGE_CACHE_DIR

VOLUME $MORIED_GIT_DIR $MORIED_IMAGE_CACHE_DIR /home
EXPOSE 3030

WORKDIR /home
CMD ["moried"]
