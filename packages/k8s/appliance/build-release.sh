#!/usr/bin/env sh
# Build the release assets for the Incendio Kubernetes management appliance
# (docs/k8s/management-appliance.md §4). These are uploaded to the GitHub
# Release that cloud-init pulls from:
#   - k8s-api-linux-amd64 / k8s-api-linux-arm64  standalone agent binaries
#   - bootstrap.sh                                the pinned bootstrap script
#
# The agent ships as a Bun single-file executable so the appliance needs no Bun
# runtime install; systemd runs the binary directly. Output -> ./dist.
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
PKG_DIR="$(cd "${HERE}/.." && pwd)"
OUT_DIR="${HERE}/dist"
ENTRY="${PKG_DIR}/src/index.ts"

mkdir -p "${OUT_DIR}"

build() {
  bun_target="$1"
  outfile="$2"
  echo "[build-release] compiling ${outfile} (${bun_target})"
  bun build --compile --minify --target="${bun_target}" "${ENTRY}" \
    --outfile "${OUT_DIR}/${outfile}"
}

build bun-linux-x64 k8s-api-linux-amd64
build bun-linux-arm64 k8s-api-linux-arm64
cp "${HERE}/bootstrap.sh" "${OUT_DIR}/bootstrap.sh"

echo "[build-release] assets ready in ${OUT_DIR}:"
ls -la "${OUT_DIR}"
