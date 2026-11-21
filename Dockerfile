# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS web-build
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY web/ ./
COPY plugins/canvas/ /src/plugins/canvas/
COPY VERSION /src/VERSION
RUN npm run build

FROM golang:1.25-bookworm AS server-build
WORKDIR /src/server
COPY server/go.mod server/go.sum ./
COPY server/third_party/qjs/ ./third_party/qjs/
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY server/ ./
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/dream-canvas-server ./cmd/server

FROM debian:bookworm-slim AS runtime
LABEL org.opencontainers.image.title="Dream Canvas" \
      org.opencontainers.image.description="Self-hosted infinite canvas for AI filmmaking" \
      org.opencontainers.image.authors="qgming" \
      org.opencontainers.image.source="https://github.com/qgming/dream-canvas"
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 dream-canvas \
    && useradd --no-log-init --uid 10001 --gid dream-canvas --home-dir /app --no-create-home --shell /usr/sbin/nologin dream-canvas \
    && mkdir -p /data \
    && chown dream-canvas:dream-canvas /data
WORKDIR /app
COPY --from=server-build /out/dream-canvas-server /usr/local/bin/dream-canvas-server
COPY --from=web-build /src/web/dist/ ./web/
COPY VERSION ./VERSION
COPY LICENSE ./licenses/dream-canvas-LICENSE
COPY server/third_party/qjs/LICENSE server/third_party/qjs/NOTICE.md ./licenses/qjs/
COPY web/src/components/animate-ui/LICENSE.md ./licenses/animate-ui-LICENSE.md
ENV TZ=UTC
USER 10001:10001
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK CMD curl --fail --silent --output /dev/null http://127.0.0.1:8080/api/health || exit 1
ENTRYPOINT ["/usr/local/bin/dream-canvas-server"]
CMD ["-data", "/data", "-web", "/app/web", "-listen", "0.0.0.0:8080"]
