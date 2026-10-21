"use client";

import { Globe, KeyRound, Server, ShieldCheck, Terminal, Database, Workflow } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { Mark } from "./logo";

// How it fits together, drawn in when scrolled into view: clients reach IncusCloud, IncusCloud
// reaches each cluster over its own API, and Hydra, OpenFGA and Postgres sit behind it. A light runs
// along each finished line. Horizontal from md up, stacked below.

const ease = [0.22, 1, 0.36, 1] as const;

const Tile = ({ icon: Icon, children, tone }: { icon: typeof Server; children: ReactNode; tone?: "ok" }) => (
  <div className="matte flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm">
    <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.05]">
      <Icon className={`size-3.5 ${tone === "ok" ? "text-success" : ""}`} strokeWidth={1.75} />
    </span>
    <span className="min-w-0">{children}</span>
  </div>
);

const Reveal = ({ children, delay, className = "" }: { children: ReactNode; delay: number; className?: string }) => {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.4 }}
      transition={{ duration: 0.5, ease, delay }}
    >
      {children}
    </motion.div>
  );
};

// A connector that draws itself in, then carries a light along it.
const Wire = ({ delay, vertical, label }: { delay: number; vertical?: boolean; label?: string }) => {
  const reduce = useReducedMotion();
  return (
    <div className={`relative flex items-center justify-center ${vertical ? "h-12 w-full" : "h-10 w-full"}`}>
      <div className={`relative overflow-hidden rounded-full bg-white/10 ${vertical ? "h-full w-px" : "h-px w-full"}`}>
        <motion.div
          className={`absolute inset-0 bg-white/40 ${vertical ? "origin-top" : "origin-left"}`}
          initial={reduce ? false : vertical ? { scaleY: 0 } : { scaleX: 0 }}
          whileInView={vertical ? { scaleY: 1 } : { scaleX: 1 }}
          viewport={{ once: true, amount: 0.8 }}
          transition={{ duration: 0.7, ease, delay }}
        />
        {!reduce && (
          <motion.span
            className={`absolute ${vertical ? "inset-x-0 h-6 bg-gradient-to-b" : "inset-y-0 w-10 bg-gradient-to-r"} from-transparent via-white to-transparent`}
            animate={vertical ? { top: ["-24px", "100%"] } : { left: ["-40px", "100%"] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut", repeatDelay: 1.2, delay: delay + 0.9 }}
          />
        )}
      </div>
      {label && (
        <span className="absolute whitespace-nowrap rounded-full border border-white/10 bg-fd-background/90 px-2 py-0.5 font-mono text-[10px] text-fd-muted-foreground backdrop-blur max-md:left-1/2 max-md:ml-3 md:-top-7">
          {label}
        </span>
      )}
    </div>
  );
};

export const Architecture = () => (
  <div className="flex flex-col gap-6">
    <div className="grid items-center gap-0 md:grid-cols-[1fr_7.5rem_1.2fr_7.5rem_1fr]">
      {/* Clients */}
      <Reveal delay={0} className="flex flex-col gap-2">
        <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.2em] text-fd-muted-foreground">People</p>
        <Tile icon={Globe}>Browser console</Tile>
        <Tile icon={Terminal}>
          <span className="font-mono text-[13px]">incus</span> CLI, Terraform
        </Tile>
        <Tile icon={Workflow}>Service accounts</Tile>
      </Reveal>

      <div className="hidden md:block">
        <Wire delay={0.35} label="one sign-in" />
      </div>
      <div className="md:hidden">
        <Wire vertical delay={0.35} label="one sign-in" />
      </div>

      {/* IncusCloud */}
      <Reveal delay={0.25} className="glass relative overflow-hidden rounded-2xl p-5">
        <div className="grid-lines pointer-events-none absolute inset-0 [mask-image:radial-gradient(80%_80%_at_50%_0%,black,transparent)]" />
        <div className="relative flex flex-col gap-4">
          <div className="flex items-center gap-2.5">
            <Mark className="size-8" />
            <div>
              <p className="font-medium">IncusCloud</p>
              <p className="font-mono text-[11px] text-fd-muted-foreground">cloud.example.com</p>
            </div>
          </div>
          <ul className="grid grid-cols-2 gap-2 text-[13px]">
            {["Console, API", "Gateway", "Tenants, quotas", "Permissions", "Jobs, backups", "Reconciler"].map((x) => (
              <li key={x} className="truncate rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-fd-muted-foreground">
                {x}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2 border-t border-white/10 pt-4 text-xs text-fd-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <KeyRound className="size-3" strokeWidth={1.75} /> Hydra
            </span>
            <span className="text-white/20">·</span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="size-3" strokeWidth={1.75} /> OpenFGA
            </span>
            <span className="text-white/20">·</span>
            <span className="inline-flex items-center gap-1.5">
              <Database className="size-3" strokeWidth={1.75} /> Postgres
            </span>
          </div>
        </div>
      </Reveal>

      <div className="hidden md:block">
        <Wire delay={0.75} label="their own API" />
      </div>
      <div className="md:hidden">
        <Wire vertical delay={0.75} label="their own API" />
      </div>

      {/* Clusters */}
      <Reveal delay={0.5} className="flex flex-col gap-2">
        <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.2em] text-fd-muted-foreground">Incus clusters</p>
        {["prod · 3 members", "edge · 2 members", "lab · standalone"].map((c) => (
          <Tile key={c} icon={Server} tone="ok">
            {c}
          </Tile>
        ))}
      </Reveal>
    </div>
  </div>
);
