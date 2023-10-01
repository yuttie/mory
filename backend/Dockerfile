# build stage
FROM rust:latest as build-stage

WORKDIR /usr/src/app
COPY Cargo.toml .
COPY Cargo.lock .
COPY docker/dummy-main.rs src/main.rs
RUN cargo build --release

COPY src src
RUN touch src/main.rs && cargo build --release

# production stage
FROM debian:bookworm-slim as production-stage

COPY --from=build-stage /usr/src/app/target/release/moried /usr/local/bin/moried

ENV MORIED_GIT_DIR /repo
ENV MORIED_LISTEN 0.0.0.0:3030

RUN mkdir $MORIED_GIT_DIR

VOLUME $MORIED_GIT_DIR /home
EXPOSE 3030

WORKDIR /home
CMD ["moried"]
