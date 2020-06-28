FROM rust:latest

WORKDIR /usr/src/app
COPY Cargo.toml .
COPY Cargo.lock .
COPY src src

RUN cargo install --path .

ENV RUST_LOG info
ENV MORIED_GIT_DIR /notes
ENV MORIED_LISTEN 0.0.0.0:3030

VOLUME $MORIED_GIT_DIR
EXPOSE 3030

CMD ["moried"]
