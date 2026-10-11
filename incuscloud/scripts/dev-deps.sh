#!/bin/sh
# Downloads the pinned development dependencies into incuscloud/.dev/ and
# creates a development CA plus a server certificate for local services.
# Idempotent: existing files are kept.
set -eu

HYDRA_VERSION=26.2.0
OPENFGA_VERSION=1.22.0

root=$(cd "$(dirname "$0")/.." && pwd)
dev="$root/.dev"
mkdir -p "$dev/bin" "$dev/tls"

case "$(uname -m)" in
	x86_64) arch=64bit; fga_arch=amd64 ;;
	aarch64 | arm64) arch=arm64; fga_arch=arm64 ;;
	*) echo "unsupported architecture $(uname -m)" >&2; exit 1 ;;
esac

fetch() { # url, binary name inside the archive, destination
	if [ ! -x "$3" ]; then
		tmp=$(mktemp -d)
		curl -fsSL "$1" | tar -xz -C "$tmp"
		install -m 0755 "$tmp/$2" "$3"
		rm -rf "$tmp"
	fi
}

fetch "https://github.com/ory/hydra/releases/download/v${HYDRA_VERSION}/hydra_${HYDRA_VERSION}-linux_${arch}.tar.gz" hydra "$dev/bin/hydra"
fetch "https://github.com/openfga/openfga/releases/download/v${OPENFGA_VERSION}/openfga_${OPENFGA_VERSION}_linux_${fga_arch}.tar.gz" openfga "$dev/bin/openfga"

tls="$dev/tls"
if [ ! -f "$tls/ca.crt" ]; then
	openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
		-keyout "$tls/ca.key" -out "$tls/ca.crt" -days 3650 \
		-subj "/CN=IncusCloud development CA" 2>/dev/null
fi

if [ ! -f "$tls/server.crt" ]; then
	sans="DNS:localhost,DNS:$(hostname),IP:127.0.0.1"
	for ip in $(ip -4 -o addr show scope global | awk '{print $4}' | cut -d/ -f1); do
		sans="$sans,IP:$ip"
	done
	openssl req -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
		-keyout "$tls/server.key" -out "$tls/server.csr" -subj "/CN=incuscloud-dev" 2>/dev/null
	printf 'subjectAltName=%s\nextendedKeyUsage=serverAuth\n' "$sans" > "$tls/server.ext"
	openssl x509 -req -in "$tls/server.csr" -CA "$tls/ca.crt" -CAkey "$tls/ca.key" \
		-CAcreateserial -out "$tls/server.crt" -days 825 -extfile "$tls/server.ext" 2>/dev/null
	rm -f "$tls/server.csr" "$tls/server.ext"
fi

echo "hydra:   $("$dev/bin/hydra" version 2>/dev/null | head -1)"
echo "openfga: $("$dev/bin/openfga" version 2>&1 | head -1)"
echo "tls:     $tls (CA: ca.crt)"
