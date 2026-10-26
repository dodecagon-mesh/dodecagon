FROM oven/bun:1.4.4

ARG TARGETARCH
ENV RUNNING_IN_DOCKER=true

USER root

COPY apps/server/build/out/dodecagon-linux-x64 /tmp/dodecagon-linux-x64
COPY apps/server/build/out/dodecagon-linux-arm64 /tmp/dodecagon-linux-arm64

RUN set -eux; \
    case "$TARGETARCH" in \
      amd64)  cp /tmp/dodecagon-linux-x64 /dodecagon ;; \
      arm64)  cp /tmp/dodecagon-linux-arm64 /dodecagon ;; \
      *) echo "Unsupported arch: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    chmod +x /dodecagon; \
    chown bun:bun /dodecagon; \
    rm -rf /tmp/dodecagon-linux-*

RUN mkdir -p /home/bun/.config/dodecagon && \
    chown -R bun:bun /home/bun/.config

COPY docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /home/bun

ENTRYPOINT ["/entrypoint.sh"]