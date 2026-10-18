import type { RouteConfig } from "fumapress";
import { Link } from "fumapress/client";
import { asMarkdown, md } from "fumapress/markdown";
import { ArrowRight, Check, Server, Users } from "lucide-react";
import type { ReactNode } from "react";
import { Architecture } from "../components/architecture";
import { ConsolePreview } from "../components/console-preview";
import { type FeatureKind, FeatureCard } from "../components/feature-card";
import { OgImage } from "../components/og-image";
import { Roadmap, type RoadmapCopy } from "../components/roadmap";

const meta = {
  title: "IncusCloud: every Incus cluster, one private cloud",
  description:
    "One sign-in, one console and one API in front of all your Incus clusters, with tenants, quotas, permissions, backups, migration and Kubernetes. Nothing to install on the clusters.",
};

export function getConfig() {
  return {
    takumiOptions: {
      node: <OgImage title="Every Incus cluster. One private cloud." description="One sign-in, one console and one API in front of all your Incus clusters." />,
    },
  } satisfies RouteConfig;
}

const features: { kind: FeatureKind; title: string; body: string }[] = [
  {
    kind: "signin",
    title: "One sign-in, everywhere",
    body: "Sign in once, in the browser or with the stock incus CLI. The same token works on every cluster, and each cluster still checks it itself.",
  },
  {
    kind: "quota",
    title: "Tenants with one quota",
    body: "Place a tenant on any number of clusters. Its quota holds across all of them, and an oversized create is refused before it starts.",
  },
  {
    kind: "migrate",
    title: "Move between clusters",
    body: "Move or copy instances across clusters after a pre-flight check, live for stateful VMs, and keep replicas you can fail over to.",
  },
  {
    kind: "backup",
    title: "Backups to S3",
    body: "Scheduled backups with retention to any S3 store, restored to any cluster, even into restricted tenant projects.",
  },
  {
    kind: "k8s",
    title: "Kubernetes, no appliances",
    body: "One Cluster API install drives every cluster. Tenants create Kubernetes clusters from the console, inside their quota.",
  },
  {
    kind: "acl",
    title: "Permissions that reach Incus",
    body: "Roles on paths, resolved the Proxmox way, and written into every cluster's OpenFGA store so Incus enforces them too.",
  },
];

const included = [
  "Device-flow CLI sign-in",
  "Service accounts",
  "Groups",
  "Global instance search",
  "Metrics",
  "Replication and failover",
  "Balancing with affinity",
  "Member maintenance",
  "Self-service create",
  "Per-user quotas",
  "Audit and gateway logs",
  "Incendio for every cluster",
  "Docker Compose and Helm",
];

const steps = [
  { title: "Enrol", body: "Create a trust token on a cluster and paste it into the console. IncusCloud sets up sign-in and permissions on it; nothing is installed." },
  { title: "Place", body: "Place tenants on clusters. Each gets a restricted project, its members' grants and its share of the quota." },
  { title: "Use", body: "People sign in once and work in the console, the incus CLI or Terraform, on every cluster they may use." },
];

const audiences = [
  {
    icon: Server,
    title: "For platform teams",
    lead: "Run many Incus clusters like one cloud.",
    points: [
      "Enrol a cluster with one trust token; nothing to install on it",
      "Every instance, member and pool in one inventory, with metrics",
      "Move, replicate, back up and rebalance across clusters",
      "Every change in the audit log, every gateway request logged",
    ],
  },
  {
    icon: Users,
    title: "For tenants",
    lead: "A private cloud that stays inside its fences.",
    points: [
      "Self-service instances and Kubernetes, inside one quota",
      "Their own images, profiles and volumes in restricted projects",
      "The stock incus CLI and Terraform, signed in through the browser",
      "Admins who manage their own members, roles and service accounts",
    ],
  },
];

const roadmap: RoadmapCopy = {
  labels: { done: "Shipped", active: "In progress", planned: "Planned", now: "We are here", branch: "" },
  milestones: [
    {
      version: "P1–P10",
      name: "The control plane",
      state: "done",
      body: "Sign-in, the gateway, the fleet inventory, mobility, backups, balancing, tenant quotas and Kubernetes.",
      items: [
        { text: "Gateway and one sign-in", state: "done" },
        { text: "Migration and replication", state: "done" },
        { text: "Backups to S3", state: "done" },
        { text: "Kubernetes through Cluster API", state: "done" },
      ],
    },
    {
      version: "ACL 1–4",
      name: "Permissions",
      state: "done",
      body: "Roles on paths, ownership, groups and quotas, enforced in IncusCloud and in Incus.",
      items: [
        { text: "Roles, privileges and paths", state: "done" },
        { text: "Ownership and the User role", state: "done" },
        { text: "Groups and cluster groups", state: "done" },
        { text: "Quotas per instance and per user", state: "done" },
      ],
    },
    {
      version: "0.1",
      name: "Beta",
      state: "active",
      body: "Packaged and documented. Release testing and hardening are under way.",
      items: [
        { text: "Docker Compose and Helm", state: "done" },
        { text: "This site and the docs", state: "done" },
        { text: "Release testing", state: "active" },
        { text: "Body limits, trusted proxies, log retention", state: "planned" },
      ],
    },
    {
      version: "Next",
      name: "Production",
      state: "planned",
      body: "What the beta's known limits ask for.",
      items: [
        { text: "Per-cluster OpenFGA tokens", state: "planned" },
        { text: "Several API replicas", state: "planned" },
        { text: "Leases that expire instances", state: "planned" },
      ],
    },
  ],
};

const btnPrimary =
  "inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-fd-primary px-5 text-sm font-medium text-fd-primary-foreground transition-opacity hover:opacity-85";
const btnGlass = "matte inline-flex h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-medium text-fd-foreground";

/** A two-part heading: the lead, then the tail in muted grey. */
const Split = ({ parts }: { parts: [string, string] }) => (
  <>
    {parts[0]} <span className="text-fd-muted-foreground">{parts[1]}</span>
  </>
);

const Section = ({ id, eyebrow, title, sub, children }: { id?: string; eyebrow: string; title: ReactNode; sub?: string; children: ReactNode }) => (
  <section id={id} className="mx-auto w-full max-w-5xl scroll-mt-28 px-4 py-20 sm:py-24">
    <div className="mx-auto mb-12 flex max-w-2xl flex-col items-center gap-4 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-fd-muted-foreground">{eyebrow}</p>
      <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
      {sub && <p className="text-pretty text-[15px] leading-relaxed text-fd-muted-foreground">{sub}</p>}
    </div>
    {children}
  </section>
);

const Terminal = ({ children }: { children: ReactNode }) => (
  <div className="glass overflow-hidden rounded-2xl">
    <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-3">
      <span className="size-2.5 rounded-full bg-white/15" />
      <span className="size-2.5 rounded-full bg-white/15" />
      <span className="size-2.5 rounded-full bg-white/15" />
    </div>
    <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed sm:p-5 sm:text-[13px]">{children}</pre>
  </div>
);

const Prompt = ({ host = "" }: { host?: string }) => <span className="select-none text-fd-muted-foreground">{host}$ </span>;
const Comment = ({ children }: { children: ReactNode }) => <span className="text-fd-muted-foreground/70">{children}</span>;

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
          <Link
            href="/docs/install"
            className="matte shine relative inline-flex items-center gap-2 overflow-hidden rounded-full py-1 pl-1 pr-3 text-xs text-fd-muted-foreground hover:text-fd-foreground"
          >
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-fd-foreground">Beta</span>
            Packaged for Docker Compose and Helm
            <ArrowRight className="size-3" />
          </Link>
          <h1 className="text-balance text-[2.3rem] font-semibold leading-[0.98] tracking-tight sm:text-6xl md:text-7xl">
            Every Incus cluster. <span className="block text-fd-muted-foreground">One private cloud.</span>
          </h1>
          <p className="max-w-xl text-pretty text-[15px] leading-relaxed text-fd-muted-foreground sm:text-base">
            IncusCloud puts one sign-in, one console and one API in front of all your Incus clusters, then adds tenants,
            quotas, permissions, backups, migration and Kubernetes. Nothing to install on the clusters.
          </p>
          <div className="flex w-full max-w-xs flex-col gap-3 sm:w-auto sm:max-w-none sm:flex-row">
            <Link href="/docs/quickstart" className={btnPrimary}>
              Get started
              <ArrowRight className="size-4" />
            </Link>
            <Link href="/docs" className={btnGlass}>
              Read the docs
            </Link>
          </div>
        </div>

        <div className="relative w-full max-w-4xl">
          {/* Soft light pooling behind the preview. */}
          <div className="pointer-events-none absolute -inset-10 -z-10 bg-[radial-gradient(50%_50%_at_50%_40%,rgba(255,255,255,0.07),transparent_70%)] blur-2xl" />
          <ConsolePreview />
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────── */}
      <Section id="features" eyebrow="Why IncusCloud" title={<Split parts={["Many clusters.", "One way in."]} />} sub="What a single Incus cluster can't do on its own.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <FeatureCard key={f.kind} kind={f.kind} title={f.title} body={f.body} />
          ))}
        </div>
        <div className="mt-10 flex flex-col items-center gap-4">
          <p className="text-xs text-fd-muted-foreground">Also included</p>
          <ul className="flex max-w-3xl flex-wrap justify-center gap-2">
            {included.map((s) => (
              <li key={s} className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-fd-muted-foreground">
                <Check className="size-3 text-fd-foreground/60" />
                {s}
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <Section
        id="how"
        eyebrow="How it works"
        title={<Split parts={["A control plane,", "not another layer."]} />}
        sub="IncusCloud talks to each cluster over its own API. Requests reach the cluster as the person who made them, and the cluster enforces their permissions itself."
      >
        <Architecture />
        <ol className="mt-12 grid gap-5 sm:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.title} className="flex gap-4">
              <span className="grid size-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.05] font-mono text-xs">{i + 1}</span>
              <div>
                <p className="text-sm font-medium">{s.title}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-fd-muted-foreground">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      {/* ── Audiences ────────────────────────────────────────────────────── */}
      <Section eyebrow="Who it's for" title={<Split parts={["Built for operators.", "Safe for tenants."]} />}>
        <div className="grid gap-3 md:grid-cols-2">
          {audiences.map(({ icon: Icon, title, lead, points }) => (
            <div key={title} className="glass flex flex-col rounded-2xl p-6">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05]">
                  <Icon className="size-4" strokeWidth={1.75} />
                </div>
                <p className="font-medium">{title}</p>
              </div>
              <p className="mt-4 text-pretty text-[15px] leading-relaxed">{lead}</p>
              <ul className="mt-4 flex flex-col gap-2.5">
                {points.map((p) => (
                  <li key={p} className="flex gap-2.5 text-[13px] leading-relaxed text-fd-muted-foreground">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-fd-foreground/60" />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Install ──────────────────────────────────────────────────────── */}
      <Section
        eyebrow="Install"
        title={<Split parts={["Running in fifteen minutes.", "On one host."]} />}
        sub="Docker Compose with Postgres, Hydra and OpenFGA, or a Helm chart for Kubernetes."
      >
        <div className="grid items-center gap-8 lg:grid-cols-[1fr_1.4fr]">
          <ol className="flex flex-col gap-5">
            {[
              { title: "Generate secrets and certificates", body: "setup.sh writes the settings, fresh secrets and an internal CA, or takes your own certificate." },
              { title: "Start the stack", body: "One docker compose up. Migrations run, and the first administrator is created." },
              { title: "Enrol a cluster", body: "A trust token from the cluster, pasted into the console. It's ready within a minute." },
            ].map((step, i) => (
              <li key={step.title} className="flex gap-4">
                <span className="grid size-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.05] font-mono text-xs">{i + 1}</span>
                <div>
                  <p className="text-sm font-medium">{step.title}</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-fd-muted-foreground">{step.body}</p>
                </div>
              </li>
            ))}
            <li className="flex flex-wrap gap-x-5 gap-y-2">
              <Link href="/docs/install/docker-compose" className="inline-flex items-center gap-1.5 text-sm text-fd-foreground underline-offset-4 hover:underline">
                Docker Compose guide <ArrowRight className="size-3.5" />
              </Link>
              <Link href="/docs/install/helm" className="inline-flex items-center gap-1.5 text-sm text-fd-foreground underline-offset-4 hover:underline">
                Helm guide <ArrowRight className="size-3.5" />
              </Link>
            </li>
          </ol>
          <Terminal>
            <Comment># on the host</Comment>
            {"\n"}
            <Prompt />
            {"./setup.sh --host cloud.example.com \\\n    --cluster-domain clusters.example.com --admin you@example.com"}
            {"\n"}
            <Prompt />
            docker compose up -d
            {"\n\n"}
            <Comment># on the cluster</Comment>
            {"\n"}
            <Prompt host="prod" />
            incus config trust add incuscloud --quiet
            {"\n\n"}
            <Comment># anywhere</Comment>
            {"\n"}
            <Prompt />
            {"incus remote add prod https://prod.clusters.example.com \\\n    --auth-type=oidc"}
            {"\n"}
            <Prompt />
            incus list prod:
          </Terminal>
        </div>
      </Section>

      {/* ── Roadmap ──────────────────────────────────────────────────────── */}
      <Section id="roadmap" eyebrow="Roadmap" title={<Split parts={["Where it stands.", "Where it's going."]} />} sub="What has shipped, what the beta is finishing, and what comes next.">
        <Roadmap t={roadmap} />
      </Section>

      {/* ── Closing CTA ──────────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-5xl px-4 pb-20 pt-8">
        <div className="glass relative overflow-hidden rounded-3xl px-6 py-14 text-center sm:py-16">
          <div className="grid-lines pointer-events-none absolute inset-0 [mask-image:radial-gradient(70%_80%_at_50%_0%,black,transparent)]" />
          <div className="relative flex flex-col items-center gap-5">
            <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              <Split parts={["Bring your clusters.", "Leave with a cloud."]} />
            </h2>
            <p className="max-w-md text-pretty text-[15px] text-fd-muted-foreground">Start with one host and one cluster. Add the rest when you're ready.</p>
            <div className="flex w-full max-w-xs flex-col gap-3 sm:w-auto sm:max-w-none sm:flex-row">
              <Link href="/docs/quickstart" className={btnPrimary}>
                Get started <ArrowRight className="size-4" />
              </Link>
              <Link href="/docs/install" className={btnGlass}>
                Installation guide
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

/** The Markdown form of the landing page, served to LLMs alongside the docs (llms.txt plugin). */
function pageMarkdown() {
  return md`# IncusCloud

> ${meta.description}

- [Get started](/docs/quickstart)
- [Read the docs](/docs)

## Why IncusCloud

${features.map((f) => md`- **${f.title}**: ${f.body}\n`)}

Also included: ${included.join(", ")}.

## How it works

${steps.map((s, i) => md`${String(i + 1)}. **${s.title}**: ${s.body}\n`)}

## Who it's for

${audiences.map((a) => md`### ${a.title}\n\n${a.lead}\n\n${a.points.map((p) => md`- ${p}\n`)}\n`)}

## Roadmap

${roadmap.milestones.map((r) => md`- **${r.version}, ${r.name}** (${roadmap.labels[r.state]}): ${r.body}\n`)}
`;
}
