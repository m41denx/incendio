#!/bin/sh
# Builds firecloud_<version>_<arch>.deb for the machine's architecture.
#
#   packaging/build-deb.sh <version> [output dir]
#
# Needs Go, a C toolchain, autoconf/automake/libtool, pkg-config and the
# libuv, liblz4 and libsqlite3 development packages. dqlite (with its bundled
# raft) is built from source and shipped in /usr/lib/firecloud, so the
# package does not depend on the distribution's libdqlite (too old on
# Ubuntu 24.04). Build on the oldest supported release (Ubuntu 24.04): the
# package then installs on 24.04, 26.04 and Debian 13.
set -eu

VERSION="${1:?usage: build-deb.sh <version> [output dir]}"
OUT="${2:-$(pwd)}"
DQLITE_TAG="${DQLITE_TAG:-v1.18.7}"

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$(dirname "$HERE")"
ARCH="$(dpkg --print-architecture)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> dqlite ${DQLITE_TAG}"
git clone -q --depth 1 --branch "$DQLITE_TAG" https://github.com/canonical/dqlite "$WORK/dqlite"
(
    cd "$WORK/dqlite"
    autoreconf -i >/dev/null
    ./configure -q --enable-build-raft --prefix=/usr --libdir=/usr/lib/firecloud >/dev/null
    make -s -j"$(nproc)" >/dev/null
    make -s install DESTDIR="$WORK/dqlite-root" >/dev/null
)

ROOT="$WORK/root"
mkdir -p "$ROOT/DEBIAN" "$ROOT/usr/bin" "$ROOT/usr/lib/firecloud" "$ROOT/usr/lib/systemd/system" "$ROOT/usr/share/doc/firecloud"
cp -a "$WORK"/dqlite-root/usr/lib/firecloud/libdqlite.so* "$ROOT/usr/lib/firecloud/"

echo "==> firecloud ${VERSION} (${ARCH})"
(
    cd "$SRC"
    export CGO_ENABLED=1
    export CGO_CFLAGS="-I$WORK/dqlite-root/usr/include"
    export CGO_LDFLAGS="-L$WORK/dqlite-root/usr/lib/firecloud -Wl,-rpath,/usr/lib/firecloud"
    export CGO_LDFLAGS_ALLOW="-Wl,-rpath,.*"
    LDFLAGS="-s -w -X github.com/m41denx/incendio/firecloud/version.RawVersion=${VERSION}"
    go build -trimpath -tags agent -ldflags "$LDFLAGS" -o "$ROOT/usr/bin/firecloud" ./cmd/firecloud
    go build -trimpath -tags agent -ldflags "$LDFLAGS" -o "$ROOT/usr/bin/firecloudd" ./cmd/firecloudd
)

install -m 644 "$HERE/firecloud.service" "$ROOT/usr/lib/systemd/system/firecloud.service"
install -m 755 "$HERE/debian/postinst" "$HERE/debian/prerm" "$HERE/debian/postrm" "$ROOT/DEBIAN/"
cat > "$ROOT/usr/share/doc/firecloud/copyright" <<COPYRIGHT
Firecloud is a fork of MicroCloud (https://github.com/canonical/microcloud),
Copyright Canonical Ltd., licensed under the GNU Affero General Public
License version 3. Firecloud's changes are under the same license.
It includes dqlite (https://github.com/canonical/dqlite), LGPL-3.0 with a
static-linking exception. Full license text: /usr/share/common-licenses/AGPL-3
or https://www.gnu.org/licenses/agpl-3.0.html
COPYRIGHT

SIZE="$(du -sk "$ROOT" | cut -f1)"
cat > "$ROOT/DEBIAN/control" <<CONTROL
Package: firecloud
Version: ${VERSION}
Architecture: ${ARCH}
Maintainer: Incendio <https://github.com/m41denx/incendio>
Installed-Size: ${SIZE}
Depends: libc6, libuv1t64 | libuv1, liblz4-1, libsqlite3-0
Recommends: snapd
Section: admin
Priority: optional
Homepage: https://github.com/m41denx/incendio
Description: Incus cluster bootstrapper
 Firecloud sets up an Incus cluster across machines with OVN networking
 (MicroOVN) and optional shared storage (MicroCeph, TrueNAS or clustered
 LVM), installs the Incendio web UI, and keeps OVN and Ceph settings in
 sync with Incus. A fork of MicroCloud for Incus.
CONTROL

mkdir -p "$OUT"
dpkg-deb --build --root-owner-group "$ROOT" "$OUT/firecloud_${VERSION}_${ARCH}.deb" >/dev/null
echo "==> $OUT/firecloud_${VERSION}_${ARCH}.deb"
