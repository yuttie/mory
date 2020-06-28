FROM rust:latest

ENV MORIED_GIT_DIR /notes
ENV MORIED_LISTEN localhost:3030
EXPOSE 3030

WORKDIR /usr/src/app
COPY . .

RUN cargo install --path .

VOLUME $MORIED_GIT_DIR

CMD ["moried"]
