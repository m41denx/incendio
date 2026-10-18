"use client";

import { Check, GitBranch } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
export type MilestoneState = "done" | "active" | "planned";
export interface RoadmapCopy {
  labels: { done: string; active: string; planned: string; now: string; branch: string };
  milestones: Array<{ version: string; name: string; state: MilestoneState; branch?: boolean; body: string; items: Array<{ text: string; state: MilestoneState }> }>;
}

// The roadmap as a release timeline, like a git graph: a track that draws itself in when scrolled
// into view, filled up to "we are here", with milestone nodes popping in one after another.
// Horizontal from md up, a vertical rail below. (From the hyprr web style; an optional branch
// milestone draws an arc off the active one.)

type T = RoadmapCopy;
type Milestone = T["milestones"][number];

const state = (s: string) => s as MilestoneState;
const ease = [0.22, 1, 0.36, 1] as const;

/** Where "we are here" sits on the segment between the last shipped and the active milestone. */
const NOW = 0.62;

const Node = ({ m, delay }: { m: Milestone; delay: number }) => {
  const reduce = useReducedMotion();
  const s = state(m.state);
  return (
    <motion.div
      className="relative z-10 grid size-8 shrink-0 place-items-center"
      initial={reduce ? false : { scale: 0, opacity: 0 }}
      whileInView={{ scale: 1, opacity: 1 }}
      viewport={{ once: true, amount: 0.6 }}
      transition={{ type: "spring", stiffness: 420, damping: 22, delay }}
    >
      {s === "active" && !reduce && (
        <motion.span
          className="absolute inset-0 rounded-full border border-white/50"
          animate={{ scale: [1, 2], opacity: [0.7, 0] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
        />
      )}
      {s === "done" ? (
        <span className="grid size-8 place-items-center rounded-full border border-success/50 bg-[color-mix(in_oklab,var(--color-success)_18%,var(--color-fd-background))] text-success">
          <Check className="size-4" strokeWidth={2.5} />
        </span>
      ) : s === "active" ? (
        <span className="grid size-8 place-items-center rounded-full bg-fd-primary shadow-[0_0_24px_rgba(255,255,255,0.35)]">
          <span className="size-2.5 rounded-full bg-fd-primary-foreground" />
        </span>
      ) : (
        <span className="grid size-8 place-items-center rounded-full border border-dashed border-white/25 bg-fd-background text-fd-muted-foreground">
          {m.branch ? <GitBranch className="size-3.5" /> : <span className="size-1.5 rounded-full bg-white/30" />}
        </span>
      )}
    </motion.div>
  );
};

const Chip = ({ s, t }: { s: MilestoneState; t: T["labels"] }) =>
  s === "done" ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] text-success">
      <Check className="size-3" strokeWidth={2.5} />
      {t.done}
    </span>
  ) : s === "active" ? (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-2 py-0.5 text-[11px] text-fd-foreground">
      <span className="size-1.5 animate-pulse rounded-full bg-fd-foreground" />
      {t.active}
    </span>
  ) : (
    <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-fd-muted-foreground">{t.planned}</span>
  );

const ItemMark = ({ s }: { s: MilestoneState }) =>
  s === "done" ? (
    <Check className="mt-0.5 size-3.5 shrink-0 text-success" strokeWidth={2.5} />
  ) : s === "active" ? (
    <span className="relative mt-[5px] grid size-2.5 shrink-0 place-items-center">
      <span className="absolute inset-0 animate-ping rounded-full bg-white/40" />
      <span className="size-2 rounded-full bg-fd-foreground" />
    </span>
  ) : (
    <span className="mt-[5px] size-2.5 shrink-0 rounded-full border border-white/25" />
  );

const Body = ({ m, t, delay }: { m: Milestone; t: T["labels"]; delay: number }) => {
  const reduce = useReducedMotion();
  const s = state(m.state);
  return (
    <motion.div
      className={`flex flex-col gap-3 rounded-2xl p-4 ${s === "active" ? "glass border-white/20!" : ""}`}
      initial={reduce ? false : { opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.5, ease, delay }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm">{m.version}</span>
        <Chip s={s} t={t} />
      </div>
      <div>
        <p className="font-medium">{m.name}</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-fd-muted-foreground">{m.body}</p>
      </div>
      <ul className="flex flex-col gap-1.5">
        {m.items.map((it, i) => (
          <motion.li
            key={it.text}
            className={`flex gap-2 text-[13px] leading-snug ${state(it.state) === "planned" ? "text-fd-muted-foreground" : "text-fd-foreground/90"}`}
            initial={reduce ? false : { opacity: 0, x: -6 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.35, delay: delay + 0.25 + i * 0.07 }}
          >
            <ItemMark s={state(it.state)} />
            {it.text}
          </motion.li>
        ))}
      </ul>
    </motion.div>
  );
};

// A finished stretch of track, drawn in from its start, with a light sweeping along it.
const Filled = ({ vertical, delay }: { vertical?: boolean; delay: number }) => {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={`absolute inset-0 overflow-hidden rounded-full bg-gradient-to-r from-success/70 to-white/80 ${vertical ? "origin-top bg-gradient-to-b" : "origin-left"}`}
      initial={reduce ? false : vertical ? { scaleY: 0 } : { scaleX: 0 }}
      whileInView={vertical ? { scaleY: 1 } : { scaleX: 1 }}
      viewport={{ once: true, amount: 0.8 }}
      transition={{ duration: 0.9, ease, delay }}
    >
      {!reduce && (
        <motion.span
          className={`absolute ${vertical ? "inset-x-0 h-10 bg-gradient-to-b" : "inset-y-0 w-16 bg-gradient-to-r"} from-transparent via-white to-transparent`}
          animate={vertical ? { top: ["-40px", "100%"] } : { left: ["-64px", "100%"] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut", repeatDelay: 0.6, delay: delay + 1 }}
        />
      )}
    </motion.div>
  );
};

const Dashed = ({ vertical }: { vertical?: boolean }) => (
  <div
    className={`absolute inset-0 ${
      vertical
        ? "bg-[repeating-linear-gradient(to_bottom,rgba(255,255,255,0.22)_0_4px,transparent_4px_9px)]"
        : "bg-[repeating-linear-gradient(to_right,rgba(255,255,255,0.22)_0_4px,transparent_4px_9px)]"
    }`}
  />
);

const NowHead = ({ label, vertical, delay }: { label?: string; vertical?: boolean; delay: number }) => {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className="absolute z-10"
      style={vertical ? { bottom: "0.75rem", left: "50%" } : { left: `${NOW * 100}%`, top: "50%" }}
      initial={reduce ? false : { opacity: 0, scale: 0.4 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true }}
      transition={{ type: "spring", stiffness: 380, damping: 20, delay }}
    >
      <span className="absolute -translate-x-1/2 -translate-y-1/2">
        <span className="relative grid size-3 place-items-center">
          {!reduce && <span className="absolute inset-0 animate-ping rounded-full bg-white/60" />}
          <span className="size-3 rounded-full bg-white shadow-[0_0_14px_rgba(255,255,255,0.8)]" />
        </span>
      </span>
      {label && (
        <span className="absolute -top-8 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/15 bg-fd-background/90 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-fd-foreground backdrop-blur">
          {label}
        </span>
      )}
    </motion.div>
  );
};

export const Roadmap = ({ t }: { t: T }) => {
  const reduce = useReducedMotion();
  const ms = t.milestones;
  const main = ms.filter((m) => !m.branch);
  const branch = ms.find((m) => m.branch);
  const activeIdx = main.findIndex((m) => state(m.state) === "active");

  return (
    <>
      {/* ── md and up: horizontal track ─────────────────────────────────── */}
      <div className="hidden md:block">
        <div className="grid grid-cols-4 gap-4">
          {ms.map((m, i) => {
            const isMain = !m.branch;
            const hasNext = isMain && i < main.length - 1;
            // Segment state: before the active milestone it's shipped, into it is "now", after is planned.
            const seg = i < activeIdx - 1 ? "done" : i === activeIdx - 1 ? "now" : "planned";
            return (
              <div key={m.version} className="flex flex-col">
                <div className="relative flex h-16 items-end px-4 pb-0">
                  {/* Track segment to the next milestone's node: node centre (left 2rem) to the next cell's node (+gap). */}
                  {hasNext && (
                    <div className="absolute bottom-[15px] left-8 h-0.5 w-[calc(100%+1rem)]">
                      {seg === "done" && <Filled delay={0.15 + i * 0.25} />}
                      {seg === "now" && (
                        <>
                          <Dashed />
                          <div className="absolute inset-y-0 left-0" style={{ width: `${NOW * 100}%` }}>
                            <Filled delay={0.15 + i * 0.25} />
                          </div>
                          <NowHead label={t.labels.now} delay={0.15 + i * 0.25 + 0.8} />
                        </>
                      )}
                      {seg === "planned" && <Dashed />}
                    </div>
                  )}
                  {/* The main line fades out past the last main milestone. */}
                  {isMain && i === main.length - 1 && (
                    <div className="absolute bottom-[15px] left-8 h-0.5 w-1/2 bg-gradient-to-r from-white/20 to-transparent" />
                  )}
                  {/* LTS branch: an arc from the active milestone's node, over the next one, down to this node. */}
                  {m.branch && branch && activeIdx >= 0 && (
                    <motion.div
                      className="pointer-events-none absolute bottom-[15px] h-12"
                      style={{ left: `calc(2rem - ${ms.length - 1 - activeIdx} * (100% + 1rem))`, width: `calc(${ms.length - 1 - activeIdx} * (100% + 1rem))` }}
                      initial={reduce ? false : { clipPath: "inset(0 100% 0 0)" }}
                      whileInView={{ clipPath: "inset(0 0% 0 0)" }}
                      viewport={{ once: true }}
                      transition={{ duration: 1.1, ease, delay: 0.9 }}
                    >
                      <svg className="h-full w-full overflow-visible" viewBox="0 0 100 48" preserveAspectRatio="none" fill="none" aria-hidden>
                        <path
                          d="M0 48 C 0 6, 6 6, 20 6 L 80 6 C 94 6, 100 6, 100 48"
                          stroke="rgba(255,255,255,0.28)"
                          strokeWidth="1.5"
                          vectorEffect="non-scaling-stroke"
                        />
                      </svg>
                    </motion.div>
                  )}
                  {m.branch && (
                    <motion.span
                      className="absolute top-0 inline-flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/10 bg-fd-background/90 px-2 py-0.5 font-mono text-[10px] text-fd-muted-foreground"
                      style={{ left: `calc(2rem - ${(ms.length - 1 - activeIdx) / 2} * (100% + 1rem))` }}
                      initial={reduce ? false : { opacity: 0, y: 4 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.4, delay: 1.6 }}
                    >
                      <GitBranch className="size-3" />
                      {t.labels.branch}
                    </motion.span>
                  )}
                  <Node m={m} delay={0.1 + i * 0.25} />
                </div>
                <Body m={m} t={t.labels} delay={0.2 + i * 0.15} />
              </div>
            );
          })}
        </div>
      </div>

      {/* ── below md: vertical rail ─────────────────────────────────────── */}
      <ol className="flex flex-col md:hidden">
        {ms.map((m, i) => {
          const last = i === ms.length - 1;
          const seg = m.branch ? "planned" : i < activeIdx - 1 ? "done" : i === activeIdx - 1 ? "now" : "planned";
          return (
            <li key={m.version} className="grid grid-cols-[2rem_1fr] gap-x-3">
              <div className="relative flex flex-col items-center">
                <Node m={m} delay={0.1} />
                {!last && (
                  <div className="relative my-1 w-0.5 flex-1">
                    {seg === "done" && <Filled vertical delay={0.2} />}
                    {seg === "now" && (
                      <>
                        <div className="absolute inset-x-0 top-0 bottom-3">
                          <Filled vertical delay={0.2} />
                        </div>
                        <NowHead vertical delay={0.9} />
                      </>
                    )}
                    {seg === "planned" && <Dashed vertical />}
                  </div>
                )}
              </div>
              <div className={seg === "now" ? "pb-1.5" : "pb-8"}>
                {m.branch && (
                  <span className="mb-1 inline-flex items-center gap-1 font-mono text-[10px] text-fd-muted-foreground">
                    <GitBranch className="size-3" />
                    {t.labels.branch}
                  </span>
                )}
                <div className="-mt-1">
                  <Body m={m} t={t.labels} delay={0.15} />
                </div>
                {seg === "now" && (
                  <span className="mt-6 ml-4 inline-block rounded-full border border-white/15 bg-fd-background/90 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-fd-foreground">
                    {t.labels.now}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
};
