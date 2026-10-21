# syntax=docker/dockerfile:1
# IncusCloud: the server (API, gateway, reconciler, workers), the platform UI
# and Incendio (each cluster's UI), in one image. Build from the repository root:
#   docker build -f incuscloud/Dockerfile -t incuscloud .

FROM oven/bun:1.4.2 AS build
# The commit, stamped into Incendio's build (the context has no .git).
ARG GIT_HASH=unknown
WORKDIR /src
COPY . .
RUN bun install --frozen-lockfile
RUN cd packages/api && bun run build
RUN UI_GIT_HASH=$GIT_HASH bun run build:ui
RUN cd incuscloud/web && bun run build
# Production dependencies only: the workspace manifests and the lockfile, installed apart.
RUN mkdir /deps && cp package.json bun.lock /deps/ \
  && for f in packages/*/package.json incuscloud/*/package.json; do mkdir -p "/deps/$(dirname "$f")" && cp "$f" "/deps/$f"; done \
  && cd /deps && bun install --production --frozen-lockfile --ignore-scripts

FROM oven/bun:1.4.2-slim
LABEL org.opencontainers.image.title="IncusCloud" \
      org.opencontainers.image.description="A multi-cluster control plane for Incus" \
      org.opencontainers.image.source="https://github.com/m41denx/incendio" \
      org.opencontainers.image.licenses="GPL-3.0-only"
WORKDIR /app
COPY --from=build /deps/ ./
COPY --from=build /src/packages/api/dist packages/api/dist
COPY --from=build /src/packages/k8s/src packages/k8s/src
COPY --from=build /src/incuscloud/server/src incuscloud/server/src
COPY --from=build /src/incuscloud/server/drizzle incuscloud/server/drizzle
COPY --from=build /src/incuscloud/server/tsconfig.json incuscloud/server/
COPY --from=build /src/incuscloud/web/build share/web
COPY --from=build /src/packages/ui/build/ui share/incendio
ENV IC_WEB_DIR=/app/share/web \
    IC_UI_DIR=/app/share/incendio \
    IC_LISTEN_HOST=0.0.0.0 \
    IC_LISTEN_PORT=8443 \
    NODE_ENV=production
USER bun
WORKDIR /app/incuscloud/server
EXPOSE 8443
CMD ["bun", "src/main.ts"]
