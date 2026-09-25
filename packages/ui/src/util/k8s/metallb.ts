// Client-side checks for MetalLB address pools; the agent re-validates and
// also rejects ranges outside the cluster's network.

const OCTET = "(25[0-5]|2[0-4]\\d|1?\\d?\\d)";
const IPV4 = `${OCTET}\\.${OCTET}\\.${OCTET}\\.${OCTET}`;
const ENTRY = new RegExp(`^${IPV4}(-${IPV4}|/(3[0-2]|[12]?\\d))?$`);

const toInt = (ip: string): number =>
  ip.split(".").reduce((acc, octet) => acc * 256 + Number(octet), 0);

/** Why a comma/space separated list of ranges is unusable, or null. */
export const metallbAddressesError = (value: string): string | null => {
  const entries = value
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (entries.length === 0) return "Enter at least one address range";
  for (const entry of entries) {
    if (!ENTRY.test(entry)) {
      return `${entry} is not an IPv4 range (a.b.c.d-e.f.g.h), CIDR or address`;
    }
    if (entry.includes("-")) {
      const [from = "", to = ""] = entry.split("-");
      if (toInt(from) > toInt(to)) return `${entry} ends before it starts`;
    }
  }
  return null;
};
