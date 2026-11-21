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

FROM debian:bookworm-slim AS ffmpeg-build
# Verified against the official release signature. Update version and checksum together.
ENV FFMPEG_VERSION=9.1 \
    FFMPEG_SHA256=1a4d394ae63d190a526cd052eb4415c156b5c5e2df37efab41a7de0b8fde2433
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential ca-certificates curl \
       libdav1d-dev nasm pkg-config xz-utils zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src/ffmpeg
RUN curl --fail --show-error --location "https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz" -o ffmpeg.tar.xz \
    && echo "${FFMPEG_SHA256}  ffmpeg.tar.xz" | sha256sum --check - \
    && tar -xJf ffmpeg.tar.xz --strip-components=1 \
    && ./configure --prefix=/opt/ffmpeg --disable-autodetect --disable-debug \
       --disable-doc --disable-ffplay --disable-network --disable-hwaccels \
       --disable-gpl --disable-nonfree --enable-libdav1d --enable-zlib \
    && make -j"$(nproc)" \
    && make install \
    && mkdir -p /out/licenses/ffmpeg \
    && cp ffmpeg.tar.xz /out/licenses/ffmpeg/ffmpeg-${FFMPEG_VERSION}.tar.xz \
    && cp COPYING.LGPLv2.1 LICENSE.md /out/licenses/ffmpeg/ \
    && /opt/ffmpeg/bin/ffmpeg -buildconf > /out/licenses/ffmpeg/buildconf.txt 2>&1 \
    && printf '%s  ffmpeg-%s.tar.xz\n' "$FFMPEG_SHA256" "$FFMPEG_VERSION" > /out/licenses/ffmpeg/SHA256SUMS

FROM debian:bookworm-slim AS runtime
LABEL org.opencontainers.image.title="Dream Canvas" \
      org.opencontainers.image.description="Self-hosted infinite canvas for AI filmmaking" \
      org.opencontainers.image.authors="qgming" \
      org.opencontainers.image.source="https://github.com/qgming/dream-canvas"
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl libdav1d6 tzdata zlib1g \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 dream-canvas \
    && useradd --no-log-init --uid 10001 --gid dream-canvas --home-dir /app --no-create-home --shell /usr/sbin/nologin dream-canvas \
    && mkdir -p /data \
    && chown dream-canvas:dream-canvas /data
WORKDIR /app
COPY --from=server-build /out/dream-canvas-server /usr/local/bin/dream-canvas-server
COPY --from=ffmpeg-build /opt/ffmpeg/bin/ffmpeg /opt/ffmpeg/bin/ffprobe /usr/local/bin/
COPY --from=ffmpeg-build /out/licenses/ffmpeg/ ./licenses/ffmpeg/
COPY Dockerfile ./licenses/ffmpeg/Dockerfile
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
