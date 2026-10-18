import type { RouteConfig } from "fumapress";
import { Link } from "fumapress/client";
import { asMarkdown, md } from "fumapress/markdown";
import { ArrowRight, Boxes, Check, Container, HardDrive, Layers, Network, Server, ShieldCheck, Sparkles, ToggleRight } from "lucide-react";
import { btnGlass, btnPrimary, Comment, Prompt, Section, Split, Terminal } from "../components/landing";
import { IncendioMark, Mark } from "../components/logo";
import { OgImage } from "../components/og-image";
import { Screenshot } from "../components/screenshot";
import { ScreenshotGallery } from "../components/screenshot-gallery";

const meta = {
  title: "Incendio: a web UI for Incus, with Kubernetes",
  description:
    "Incendio is a browser UI for Incus, made for Incus: almost every instance setting, OVN, every storage driver, permissions through OpenFGA, and Kubernetes clusters on your own servers.",
};

export function getConfig() {
  return {
    takumiOptions: {
      node: <OgImage eyebrow="Incendio" title="A web UI for Incus. Made for Incus." description="Containers, VMs, networks, storage and Kubernetes clusters, from your Incus server." />,
    },
  } satisfies RouteConfig;
}

const RELEASES = "https://github.com/m41denx/incendio/releases";

const different = [
  { icon: Sparkles, title: "A newer base", body: "Built on a current LXD-UI release, with its latest pages, fixes and polish." },
  { icon: Layers, title: "Made for Incus", body: "Pages for what only Incus has: OVN interconnect, address sets, DNS zones, LINSTOR, TrueNAS, logging targets, ACME and more." },
  { icon: Container, title: "Kubernetes", body: "Create, scale, upgrade and delete Kubernetes clusters that run as ordinary Incus instances." },
  { icon: ToggleRight, title: "Only what you have", body: "Features appear when your server reports their API extension. Older servers get a clean UI, not broken pages." },
];

const areas = [
  {
    icon: Boxes,
    title: "Instances",
    href: "/docs/incendio/features/instances",
    points: ["Almost every container and VM setting in the forms", "Live and incremental migration", "UEFI variables, QEMU scriptlet, SMBIOS", "Files, terminal, console and VGA screenshots"],
  },
  {
    icon: Network,
    title: "Networking",
    href: "/docs/incendio/features/networking",
    points: ["OVN load balancers with live backend health", "OVN interconnect and remote peers", "Address sets for ACL rules", "DNS zones with a record editor"],
  },
  {
    icon: HardDrive,
    title: "Storage",
    href: "/docs/incendio/features/storage",
    points: ["Every driver, LINSTOR and TrueNAS included", "A ZFS vdev builder", "Browse and upload into custom volumes", "Bucket backups: export and import"],
  },
  {
    icon: Server,
    title: "Clustering and settings",
    href: "/docs/incendio/features/clustering",
    points: ["Automatic re-balancing", "Placement scriptlet and placement groups", "Logging targets: Loki, syslog, webhook", "ACME certificates"],
  },
  {
    icon: ShieldCheck,
    title: "Access",
    href: "/docs/incendio/features/access",
    points: ["Permissions through OpenFGA: grants, groups, checks", "The authorization scriptlet, with OIDC claims", "Trusted certificates with descriptions", "Who can access an instance or project"],
  },
  {
    icon: Container,
    title: "Kubernetes",
    href: "/docs/incendio/kubernetes",
    points: ["Clusters of containers or VMs", "Scale and upgrade from the UI", "MetalLB for LoadBalancer services", "Kubeconfig, activity and bootstrap logs"],
  },
];

const k8sSteps = [
  { title: "Deploy the appliance", body: "One click in Kubernetes settings. Incendio creates a container with Cluster API, CAPN and its agent, and trusts it." },
  { title: "Create a cluster", body: "Pick a version, the nodes and their size. Watch every node come up, with the reason when one doesn't." },
  { title: "Run it", body: "Download the kubeconfig. Scale, upgrade, add MetalLB or delete the cluster from its page." },
];

export default function Page() {
  if (asMarkdown()) return pageMarkdown();

  return (
    <>
      <title>{meta.title}</title>
      <meta name="description" content={meta.description} />
      <meta property="og:title" content={meta.title} />
      <meta property="og:description" content={meta.description} />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="mx-auto flex w-full max-w-5xl flex-col items-center gap-12 px-4 pb-10 pt-20 sm:pt-28">
        <div className="flex max-w-3xl flex-col items-center gap-6 text-center">
          <a
            href={RELEASES}
            target="_blank"
            rel="noopener"
            className="matte shine relative inline-flex items-center gap-2 overflow-hidden rounded-full py-1 pl-1 pr-3 text-xs text-fd-muted-foreground hover:text-fd-foreground"
          >
            <IncendioMark className="size-5 rounded-full" />
            Incendio 0.22 · releases on GitHub
            <ArrowRight className="size-3" />
          </a>
          <h1 className="text-balance text-[2.3rem] font-semibold leading-[0.98] tracking-tight sm:text-6xl md:text-7xl">
            A web UI for Incus. <span className="block text-fd-muted-foreground">Made for Incus.</span>
          </h1>
          <p className="max-w-xl text-pretty text-[15px] leading-relaxed text-fd-muted-foreground sm:text-base">
            Incendio runs from your Incus server, like the stock UI, and covers almost everything Incus can do: instances,
            OVN networking, every storage driver, clustering and permissions. It also builds Kubernetes clusters on the
            same servers.
          </p>
          <div className="flex w-full max-w-xs flex-col gap-3 sm:w-auto sm:max-w-none sm:flex-row">
            <Link href="/docs/incendio/install" className={btnPrimary}>
              Install
              <ArrowRight className="size-4" />
            </Link>
            <Link href="/docs/incendio" className={btnGlass}>
              Read the docs
            </Link>
          </div>
        </div>

        <div className="relative w-full max-w-5xl">
          <div className="pointer-events-none absolute -inset-10 -z-10 bg-[radial-gradient(50%_50%_at_50%_45%,rgba(233,84,32,0.08),transparent_70%)] blur-2xl" />
          <ScreenshotGallery />
        </div>
      </section>

      {/* ── Why ──────────────────────────────────────────────────────────── */}
      <Section eyebrow="Why Incendio" title={<Split parts={["More than compatible.", "Built for Incus."]} />} sub="Incendio is a fork of Canonical's LXD-UI, rebuilt for Incus.">
        <div className="grid gap-3 sm:grid-cols-2">
          {different.map(({ icon: Icon, title, body }) => (
            <div key={title} className="glass flex gap-4 rounded-2xl p-5">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05]">
                <Icon className="size-4" strokeWidth={1.75} />
              </div>
              <div>
                <p className="font-medium">{title}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-fd-muted-foreground">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Areas ────────────────────────────────────────────────────────── */}
      <Section id="features" eyebrow="Features" title={<Split parts={["Almost all of Incus.", "In one place."]} />}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {areas.map(({ icon: Icon, title, href, points }) => (
            <Link key={title} href={href} className="glass group flex flex-col rounded-2xl p-5 transition-colors hover:border-white/20">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05]">
                  <Icon className="size-4" strokeWidth={1.75} />
                </div>
                <p className="font-medium">{title}</p>
                <ArrowRight className="ml-auto size-4 text-fd-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </div>
              <ul className="mt-4 flex flex-col gap-2">
                {points.map((p) => (
                  <li key={p} className="flex gap-2.5 text-[13px] leading-relaxed text-fd-muted-foreground">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-fd-foreground/60" />
                    {p}
                  </li>
                ))}
              </ul>
            </Link>
          ))}
        </div>
      </Section>

      {/* ── Kubernetes ───────────────────────────────────────────────────── */}
      <Section
        id="kubernetes"
        eyebrow="Kubernetes"
        title={<Split parts={["Kubernetes, built in.", "From the same UI."]} />}
        sub="Standard kubeadm clusters through Cluster API and its Incus provider, managed from the same UI as everything else."
      >
        <div className="grid items-center gap-8 lg:grid-cols-[1fr_1.5fr]">
          <ol className="flex flex-col gap-5">
            {k8sSteps.map((s, i) => (
              <li key={s.title} className="flex gap-4">
                <span className="grid size-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.05] font-mono text-xs">{i + 1}</span>
                <div>
                  <p className="text-sm font-medium">{s.title}</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-fd-muted-foreground">{s.body}</p>
                </div>
              </li>
            ))}
            <li>
              <Link href="/docs/incendio/kubernetes" className="inline-flex items-center gap-1.5 text-sm text-fd-foreground underline-offset-4 hover:underline">
                Kubernetes docs <ArrowRight className="size-3.5" />
              </Link>
            </li>
          </ol>
          <Screenshot name="kubernetes-create" />
        </div>
      </Section>

      {/* ── Install ──────────────────────────────────────────────────────── */}
      <Section eyebrow="Install" title={<Split parts={["Unpack it.", "Point Incus at it."]} />} sub="Incendio is a folder of static files. Incus serves it on its own address, with nothing else to run.">
        <div className="mx-auto max-w-3xl">
          <Terminal>
            <Prompt />
            {"sudo mkdir -p /opt/incendio/ui"}
            {"\n"}
            <Prompt />
            {"sudo unzip incendio-ui-<version>.zip -d /opt/incendio/ui"}
            {"\n\n"}
            <Comment># Environment=INCUS_UI=/opt/incendio/ui</Comment>
            {"\n"}
            <Prompt />
            sudo systemctl edit incus
            {"\n"}
            <Prompt />
            sudo systemctl restart incus
            {"\n\n"}
            <Comment># then open https://your-server:8443/ui/</Comment>
          </Terminal>
          <div className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2">
            <Link href="/docs/incendio/install" className="inline-flex items-center gap-1.5 text-sm text-fd-foreground underline-offset-4 hover:underline">
              Installation guide <ArrowRight className="size-3.5" />
            </Link>
            <a href={RELEASES} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 text-sm text-fd-foreground underline-offset-4 hover:underline">
              Download a release <ArrowRight className="size-3.5" />
            </a>
          </div>
        </div>
      </Section>

      {/* ── IncusCloud ───────────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-5xl px-4 pb-20 pt-8">
        <div className="glass relative overflow-hidden rounded-3xl px-6 py-14 text-center sm:py-16">
          <div className="grid-lines pointer-events-none absolute inset-0 [mask-image:radial-gradient(70%_80%_at_50%_0%,black,transparent)]" />
          <div className="relative flex flex-col items-center gap-5">
            <div className="flex items-center gap-2">
              <IncendioMark className="size-9" />
              <span className="text-fd-muted-foreground">+</span>
              <Mark className="size-9" />
            </div>
            <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              <Split parts={["More than one cluster?", "Meet IncusCloud."]} />
            </h2>
            <p className="max-w-lg text-pretty text-[15px] text-fd-muted-foreground">
              IncusCloud puts one sign-in and one console in front of all your clusters, with tenants, quotas, backups and
              migration. It serves Incendio for every one of them.
            </p>
            <div className="flex w-full max-w-xs flex-col gap-3 sm:w-auto sm:max-w-none sm:flex-row">
              <Link href="/" className={btnPrimary}>
                About IncusCloud <ArrowRight className="size-4" />
              </Link>
              <Link href="/docs/incendio/incuscloud" className={btnGlass}>
                Incendio in IncusCloud
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

/** The Markdown form of this page, served to LLMs alongside the docs (llms.txt plugin). */
function pageMarkdown() {
  return md`# Incendio

> ${meta.description}

- [Install](/docs/incendio/install)
- [Read the docs](/docs/incendio)
- [Releases](${RELEASES})

## Why Incendio

${different.map((d) => md`- **${d.title}**: ${d.body}\n`)}

## Features

${areas.map((a) => md`### ${a.title}\n\n${a.points.map((p) => md`- ${p}\n`)}\n`)}

## Kubernetes

${k8sSteps.map((s, i) => md`${String(i + 1)}. **${s.title}**: ${s.body}\n`)}
`;
}
