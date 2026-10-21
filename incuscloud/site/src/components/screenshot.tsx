// Incendio's screenshots, loaded straight from the repository on GitHub so the site never carries
// copies that drift from the README. They are dark windows on a transparent margin with their own
// drop shadow, so they sit on the page as they are.

const RAW = "https://raw.githubusercontent.com/m41denx/incendio/incus-port/.github/img/screenshots";

export const shots = {
  "instance-create": "Creating an instance",
  "instance-terminal": "An instance's terminal",
  "network-detail": "A network's details",
  "network-load-balancer": "An OVN load balancer with live backend health",
  "network-address-sets": "Network address sets",
  "network-dns-zones": "DNS zones",
  "storage-pools": "Storage pools",
  "btrfs-compression": "Btrfs compression on a volume",
  "cluster-settings": "Cluster settings: re-balancing and the placement scriptlet",
  "settings-logging": "Logging targets",
  "trusted-certificates": "Trusted certificates",
  "project-access": "Who can access a project",
  "kubernetes-clusters": "Kubernetes clusters",
  "kubernetes-cluster-detail": "A Kubernetes cluster's page",
  "kubernetes-create": "Creating a Kubernetes cluster",
  "kubernetes-appliance": "The management appliance's bring-up checklist",
} as const;

export type ShotName = keyof typeof shots;

export const shotUrl = (name: ShotName) => `${RAW}/${name}.png`;

/** A screenshot with its caption. `eager` for the one above the fold. */
export const Screenshot = ({ name, caption, eager }: { name: ShotName; caption?: string; eager?: boolean }) => (
  <figure className="not-prose my-6">
    <img
      src={shotUrl(name)}
      alt={shots[name]}
      width={3164}
      height={1912}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      className="block h-auto w-full"
    />
    <figcaption className="-mt-[3.5%] text-center text-xs text-fd-muted-foreground">{caption ?? shots[name]}</figcaption>
  </figure>
);
