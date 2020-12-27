# build stage
FROM rust:latest as build-stage

WORKDIR /usr/src/app
COPY Cargo.toml .
COPY Cargo.lock .
COPY src src

RUN cargo build --release

# production stage
FROM debian:buster-slim as production-stage

RUN apt-get update && apt-get install -y libssl1.1 && rm -rf /var/lib/apt/lists/*

COPY --from=build-stage /usr/src/app/target/release/moried /usr/local/bin/moried

ENV MORIED_GIT_DIR /repo
ENV MORIED_LISTEN 0.0.0.0:3030

VOLUME $MORIED_GIT_DIR
EXPOSE 3030

CMD ["moried"]
