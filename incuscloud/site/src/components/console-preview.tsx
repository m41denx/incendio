import { Boxes, ChevronDown, ChevronRight, Container, FolderKanban, HardDrive, Network, Search, Server } from "lucide-react";
import { Mark } from "./logo";

// A static, CSS-only rendition of the console: the inventory tree over every cluster, and the
// global instance search. Not a screenshot, so it never goes stale against the real UI.

type Status = "running" | "stopped" | "moving";
const rows: { name: string; cluster: string; tenant: string; status: Status; cpu: number[] }[] = [
  { name: "web-1", cluster: "prod", tenant: "acme", status: "running", cpu: [3, 4, 4, 6, 5, 7, 6, 8, 6, 7, 9, 7] },
  { name: "db-1", cluster: "prod", tenant: "acme", status: "running", cpu: [6, 6, 7, 7, 8, 7, 8, 9, 8, 8, 9, 9] },
  { name: "api-3", cluster: "edge", tenant: "globex", status: "moving", cpu: [4, 5, 3, 6, 4, 5, 7, 5, 4, 6, 5, 4] },
  { name: "acme-k8s-cp-0", cluster: "prod", tenant: "acme", status: "running", cpu: [2, 3, 3, 4, 3, 4, 4, 5, 4, 4, 5, 4] },
  { name: "ci-runner", cluster: "lab", tenant: "platform", status: "stopped", cpu: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { name: "cache", cluster: "edge", tenant: "globex", status: "running", cpu: [5, 4, 6, 5, 7, 6, 5, 6, 7, 6, 5, 6] },
  { name: "acme-k8s-md-0", cluster: "edge", tenant: "acme", status: "running", cpu: [3, 3, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4] },
  { name: "build-agent", cluster: "lab", tenant: "platform", status: "running", cpu: [8, 7, 9, 6, 8, 9, 7, 8, 6, 9, 8, 7] },
];

const tree: { label: string; count: string; depth: number; open?: boolean; kind: "all" | "cluster" | "member" }[] = [
  { label: "All clusters", count: "24/31", depth: 0, open: true, kind: "all" },
  { label: "prod", count: "14/18", depth: 1, open: true, kind: "cluster" },
  { label: "node1", count: "5/6", depth: 2, kind: "member" },
  { label: "node2", count: "5/6", depth: 2, kind: "member" },
  { label: "node3", count: "4/6", depth: 2, kind: "member" },
  { label: "edge", count: "6/8", depth: 1, kind: "cluster" },
  { label: "lab", count: "4/5", depth: 1, kind: "cluster" },
];

const Spark = ({ data }: { data: number[] }) => {
  const w = 60;
  const h = 16;
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / 10) * h).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-4 w-14 text-chart-1" preserveAspectRatio="none" aria-hidden>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
};

const StatusChip = ({ s }: { s: Status }) =>
  s === "running" ? (
    <span className="inline-flex items-center gap-1.5 text-success">
      <span className="size-1.5 rounded-full bg-success" />
      Running
    </span>
  ) : s === "moving" ? (
    <span className="inline-flex items-center gap-1.5 text-chart-1">
      <span className="relative grid size-1.5 place-items-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-chart-1/70" />
        <span className="size-1.5 rounded-full bg-chart-1" />
      </span>
      Moving to prod
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-fd-muted-foreground">
      <span className="size-1.5 rounded-full bg-white/30" />
      Stopped
    </span>
  );

export const ConsolePreview = () => (
  <div className="glass relative w-full overflow-hidden rounded-2xl text-left">
    {/* Title bar */}
    <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <Mark className="size-5 rounded-md" />
        <span className="text-fd-muted-foreground">All clusters</span>
        <ChevronRight className="size-3 text-fd-muted-foreground" />
        <span>Instances</span>
      </div>
      <div className="hidden items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 font-mono text-[11px] text-fd-muted-foreground sm:flex">
        <Search className="size-3" />
        tenant:acme status:running
      </div>
    </div>

    <div className="grid md:grid-cols-[200px_1fr]">
      {/* Side menu */}
      <aside className="hidden border-r border-white/10 p-3 md:block">
        <div className="mb-3 flex gap-1">
          {[Boxes, FolderKanban, Server, Network, HardDrive].map((Icon, i) => (
            <span key={i} className={`grid size-7 place-items-center rounded-md ${i === 0 ? "bg-white/[0.08] text-fd-foreground" : "text-fd-muted-foreground"}`}>
              <Icon className="size-3.5" strokeWidth={1.75} />
            </span>
          ))}
        </div>
        <ul className="flex flex-col gap-0.5 text-xs">
          {tree.map((n, i) => (
            <li
              key={`${n.label}-${i}`}
              className={`line-in flex items-center gap-1.5 rounded-md py-1 pr-1.5 ${n.kind === "all" ? "bg-white/[0.06]" : ""}`}
              style={{ paddingLeft: `${0.4 + n.depth * 0.75}rem`, animationDelay: `${0.15 + i * 0.08}s` }}
            >
              {n.kind === "member" ? (
                <span className="size-3" />
              ) : n.open ? (
                <ChevronDown className="size-3 text-fd-muted-foreground" />
              ) : (
                <ChevronRight className="size-3 text-fd-muted-foreground" />
              )}
              {n.kind === "member" ? (
                <Server className="size-3 text-success" strokeWidth={1.75} />
              ) : n.kind === "cluster" ? (
                <Container className="size-3 text-success" strokeWidth={1.75} />
              ) : (
                <Boxes className="size-3" strokeWidth={1.75} />
              )}
              <span className="flex-1 truncate">{n.label}</span>
              <span className="font-mono text-[10px] text-fd-muted-foreground">{n.count}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-col gap-1 border-t border-white/10 pt-3 text-xs text-fd-muted-foreground">
          {["Tenants", "Kubernetes", "Jobs", "Backups", "Permissions"].map((l) => (
            <span key={l} className="px-1.5 py-0.5">
              {l}
            </span>
          ))}
        </div>
      </aside>

      {/* Instances */}
      <div className="min-w-0 p-3 sm:p-4">
        <div className="mb-3 flex gap-1 overflow-x-auto text-xs [scrollbar-width:none]">
          {["Summary", "Clusters", "Instances", "Warnings"].map((t) => (
            <span key={t} className={t === "Instances" ? "shrink-0 rounded-md bg-white/[0.08] px-2.5 py-1" : "shrink-0 px-2.5 py-1 text-fd-muted-foreground"}>
              {t}
            </span>
          ))}
        </div>
        <div className="overflow-hidden rounded-xl border border-white/10">
          <table className="w-full text-xs">
            <thead className="bg-white/[0.03] text-fd-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-normal">Name</th>
                <th className="px-3 py-2 text-left font-normal">Cluster</th>
                <th className="hidden px-3 py-2 text-left font-normal sm:table-cell">Tenant</th>
                <th className="px-3 py-2 text-left font-normal">Status</th>
                <th className="hidden px-3 py-2 text-left font-normal sm:table-cell">CPU</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.name} className="line-in border-t border-white/[0.06]" style={{ animationDelay: `${0.4 + i * 0.12}s` }}>
                  <td className="truncate px-3 py-2 font-mono">{r.name}</td>
                  <td className="px-3 py-2 text-fd-muted-foreground">{r.cluster}</td>
                  <td className="hidden px-3 py-2 text-fd-muted-foreground sm:table-cell">{r.tenant}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <StatusChip s={r.status} />
                  </td>
                  <td className="hidden px-3 py-2 sm:table-cell">{r.status === "stopped" ? <span className="text-fd-muted-foreground">—</span> : <Spark data={r.cpu} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
);
