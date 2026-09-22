# Build js / css
FROM oven/bun:1 AS bun-dependencies
WORKDIR /srv
COPY . .
RUN bun install --frozen-lockfile
RUN bun run build
RUN mkdir /srv/deploy
RUN mv build /srv/deploy/
RUN mv entrypoint /srv/deploy/
RUN mv haproxy-demo.cfg /srv/deploy/

# Build the demo image
FROM ubuntu:noble

# Set up environment
ENV LANG C.UTF-8
WORKDIR /srv
RUN apt-get update && apt-get install -y --no-install-recommends \
        haproxy \
        apt-transport-https \
        build-essential \
        ca-certificates \
        curl \
        git \
        libssl-dev \
        unzip \
        wget

# Install bun (provides `bunx serve` used by entrypoint)
ENV BUN_INSTALL=/usr/local
RUN curl -fsSL https://bun.sh/install | bash

# Import code
COPY --from=bun-dependencies /srv/deploy /srv

ENTRYPOINT ["./entrypoint"]
