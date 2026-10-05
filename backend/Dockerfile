# build stage
# On the production stage's Debian release: a binary built on a newer one can
# need a newer glibc than that stage has, and fail to start.
FROM rust:1-trixie AS build-stage

WORKDIR /usr/src/app
COPY Cargo.toml .
COPY Cargo.lock .
COPY docker/dummy-main.rs src/main.rs
RUN cargo build --release

COPY src src
RUN touch src/main.rs && cargo build --release

# production stage
FROM debian:trixie-slim AS production-stage

# A new value reinstalls the packages below, whose security fixes a cached
# layer would otherwise keep out until debian:trixie-slim itself changes. CI
# passes the week, so the first build each week takes them in.
ARG APT_REFRESH
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    tzdata \
    imagemagick \
    inkscape \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build-stage /usr/src/app/target/release/moried /usr/local/bin/moried

ENV TZ=Asia/Tokyo

ENV MORIED_GIT_DIR=/repo
ENV MORIED_IMAGE_CACHE_DIR=/cache
ENV MORIED_SEARCH_INDEX_DIR=/search-index
ENV MORIED_LISTEN=0.0.0.0:3030

RUN mkdir $MORIED_GIT_DIR
RUN mkdir $MORIED_IMAGE_CACHE_DIR
RUN mkdir $MORIED_SEARCH_INDEX_DIR

VOLUME $MORIED_GIT_DIR $MORIED_IMAGE_CACHE_DIR $MORIED_SEARCH_INDEX_DIR /home
EXPOSE 3030

WORKDIR /home
CMD ["moried"]
