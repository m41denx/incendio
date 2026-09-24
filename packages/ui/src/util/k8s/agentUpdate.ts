// Updating the Kubernetes agent inside the management appliance. The release
// (appliance-v1 by default) carries manifest.json with the agent version and a
// sha256 per binary. Both the check and the update run *inside* the appliance
// through the Incus exec API: it has internet access and curl, the browser
// never talks to GitHub, and it works even when the agent is down.
import { BOOTSTRAP_REPO, DEFAULT_BOOTSTRAP_TAG } from "util/k8s/appliance";

export const AGENT_BIN = "/usr/local/bin/incendio-k8s";
const AGENT_SERVICE = "incendio-k8s";
const ARCHES = ["amd64", "arm64"] as const;
type Arch = (typeof ARCHES)[number];

export interface AgentManifest {
  version: string;
  binaries: Record<Arch, { name: string; sha256: string }>;
}

export const releaseBaseUrl = (tag = DEFAULT_BOOTSTRAP_TAG): string =>
  `https://github.com/${BOOTSTRAP_REPO}/releases/download/${tag}`;

const SHA256 = /^[0-9a-f]{64}$/;
// Asset names go into a shell script: keep them to a safe alphabet.
const ASSET_NAME = /^[A-Za-z0-9._-]+$/;
const VERSION = /^\d+\.\d+\.\d+$/;

/** Validate manifest.json; throws on anything unexpected. */
export const parseAgentManifest = (raw: string): AgentManifest => {
  const data = JSON.parse(raw) as Partial<AgentManifest>;
  if (typeof data.version !== "string" || !VERSION.test(data.version)) {
    throw new Error("agent manifest has no valid version");
  }
  const binaries = {} as AgentManifest["binaries"];
  for (const arch of ARCHES) {
    const entry = data.binaries?.[arch];
    if (
      !entry ||
      !ASSET_NAME.test(entry.name) ||
      !SHA256.test(entry.sha256.toLowerCase())
    ) {
      throw new Error(`agent manifest has no valid ${arch} binary`);
    }
    binaries[arch] = { name: entry.name, sha256: entry.sha256.toLowerCase() };
  }
  return { version: data.version, binaries };
};

/** Semver-ish comparison of dotted numeric versions ("0.10.0" > "0.9.1"). */
export const compareAgentVersions = (a: string, b: string): number => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

export const isAgentUpdateAvailable = (
  running: string | undefined,
  latest: string | undefined,
): boolean =>
  running !== undefined &&
  latest !== undefined &&
  compareAgentVersions(latest, running) > 0;

/** Prints manifest.json from the release (run inside the appliance). */
export const manifestCheckCommand = (base = releaseBaseUrl()): string[] => [
  "curl",
  "-fsSL",
  "--max-time",
  "30",
  `${base}/manifest.json`,
];

/**
 * Download the binary for the appliance's architecture, verify its checksum,
 * swap it in atomically (keeping the previous one as .prev for a manual
 * rollback) and restart the service. Any failure leaves the running agent
 * untouched.
 */
export const buildAgentUpdateScript = (
  manifest: AgentManifest,
  base = releaseBaseUrl(),
): string => {
  const cases = ARCHES.map(
    (arch) =>
      `  ${arch === "amd64" ? "x86_64|amd64" : "aarch64|arm64"}) name='${manifest.binaries[arch].name}'; sum='${manifest.binaries[arch].sha256}' ;;`,
  ).join("\n");
  return `set -eu
case "$(uname -m)" in
${cases}
  *) echo "unsupported architecture $(uname -m)" >&2; exit 1 ;;
esac
tmp="$(mktemp ${AGENT_BIN}.XXXXXX)"
trap 'rm -f "$tmp"' EXIT
curl -fsSL --max-time 240 -o "$tmp" '${base}/'"$name"
echo "$sum  $tmp" | sha256sum -c --quiet -
chmod 0755 "$tmp"
cp -f ${AGENT_BIN} ${AGENT_BIN}.prev
mv -f "$tmp" ${AGENT_BIN}
trap - EXIT
systemctl restart ${AGENT_SERVICE}
echo "updated to ${manifest.version}"
`;
};
