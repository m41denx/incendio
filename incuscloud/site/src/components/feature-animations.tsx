"use client";

import { motion } from "motion/react";

// Hover animations for the feature cards. Each one mounts when its card is hovered, so it always
// starts from the top. Scenes are 280×150 SVGs in the site's monochrome palette; status hues
// (green, red, blue, amber) carry the story. Every `times` array ends at 1.

const C = {
  fg: "rgba(255,255,255,0.88)",
  dim: "rgba(255,255,255,0.45)",
  line: "rgba(255,255,255,0.2)",
  faint: "rgba(255,255,255,0.07)",
  green: "#3ec46d",
  red: "#ef4d4d",
  blue: "#5b9cf3",
  amber: "#e5b544",
};

// A looping keyframe transition: `times` places each keyframe on a 0..1 timeline.
const loop = (duration: number, times: number[], extra: object = {}) => ({
  duration,
  times,
  repeat: Infinity,
  ease: "easeInOut" as const,
  ...extra,
});

// Scale/rotate SVG groups around their own centre.
const centered = { transformBox: "fill-box" as const, transformOrigin: "center" };

const Scene = ({ children }: { children: React.ReactNode }) => (
  <svg viewBox="0 0 280 150" className="h-full w-full" fill="none" aria-hidden>
    {children}
  </svg>
);

const Label = ({ x, y, children, anchor = "middle", fill = C.dim, size = 8 }: { x: number; y: number; children: React.ReactNode; anchor?: "start" | "middle" | "end"; fill?: string; size?: number }) => (
  <text x={x} y={y} fill={fill} fontSize={size} fontFamily="ui-monospace, monospace" textAnchor={anchor}>
    {children}
  </text>
);

// IncusCloud's mark, a light tile with a hub joined to three clusters, centred on (0,0).
const Mark = ({ size = 26 }: { size?: number }) => {
  const k = size / 24;
  return (
    <g>
      <rect x={-size / 2} y={-size / 2} width={size} height={size} rx={size * 0.27} fill="#fafafa" />
      <g transform={`translate(${-size * 0.35} ${-size * 0.35}) scale(${k * 0.7})`} stroke="#18181b" strokeWidth="2.4" strokeLinecap="round">
        <path d="M12 12 5.5 6.5M12 12l6.5-5.5M12 12v7" />
        <circle cx="12" cy="12" r="2.6" fill="#18181b" stroke="none" />
        <circle cx="5" cy="6" r="2.2" />
        <circle cx="19" cy="6" r="2.2" />
        <circle cx="12" cy="19.5" r="2.2" />
      </g>
    </g>
  );
};

// A green badge with a check that draws itself, centred on (cx, cy), shown between t and `until`.
const Check = ({ cx, cy, D, t, until = 0.92, r = 7 }: { cx: number; cy: number; D: number; t: number; until?: number; r?: number }) => (
  <motion.g
    style={centered}
    initial={{ opacity: 0 }}
    animate={{ scale: [0, 0, 1.15, 1, 1, 0], opacity: [0, 0, 1, 1, 1, 0] }}
    transition={loop(D, [0, t, t + 0.04, t + 0.07, until, 1])}
  >
    <circle cx={cx} cy={cy} r={r} fill={C.green} />
    <motion.path
      d={`M${cx - r * 0.45} ${cy + r * 0.05} l${r * 0.32} ${r * 0.32} l${r * 0.6} -${r * 0.66}`}
      stroke="#fff"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      animate={{ pathLength: [0, 0, 1, 1] }}
      transition={loop(D, [0, t + 0.03, t + 0.1, 1])}
    />
  </motion.g>
);

// ── One sign-in: you sign in once, and the token works on every cluster. ────────────────────────

const signInClusters = [
  { y: 22, name: "prod" },
  { y: 62, name: "edge" },
  { y: 102, name: "lab" },
];

export const SignInAnim = () => {
  const D = 4.8;
  return (
    <Scene>
      {/* You */}
      <circle cx="30" cy="66" r="7" stroke={C.dim} />
      <path d="M17 92 a13 10 0 0 1 26 0" stroke={C.dim} />
      <Label x={30} y={110}>you</Label>

      {/* Signing in */}
      <motion.circle
        cx="48" cy="75" r="3" fill={C.fg}
        initial={{ opacity: 0 }}
        animate={{ x: [0, 0, 44, 44, 44], opacity: [0, 1, 1, 0, 0] }}
        transition={loop(D, [0, 0.04, 0.2, 0.22, 1])}
      />

      {/* IncusCloud */}
      <g transform="translate(110 75)">
        <motion.g style={centered} animate={{ scale: [1, 1, 1.14, 1, 1] }} transition={loop(D, [0, 0.2, 0.25, 0.3, 1])}>
          <Mark size={30} />
        </motion.g>
      </g>
      <Label x={110} y={106}>incuscloud</Label>

      {signInClusters.map((c, i) => {
        const t0 = 0.3 + i * 0.07;
        const t1 = t0 + 0.16;
        const dy = c.y + 13 - 75;
        return (
          <g key={c.name}>
            <line x1="126" y1="75" x2="190" y2={c.y + 13} stroke={C.faint} strokeWidth="1.5" />
            {/* The token, on its way */}
            <motion.rect
              x="124" y="72" width="10" height="6" rx="2" fill={C.blue}
              initial={{ opacity: 0 }}
              animate={{ x: [0, 0, 0, 56, 56, 56], y: [0, 0, 0, dy, dy, dy], opacity: [0, 0, 1, 1, 0, 0] }}
              transition={loop(D, [0, t0, t0 + 0.01, t1, t1 + 0.02, 1])}
            />
            <motion.rect
              x="190" y={c.y} width="72" height="26" rx="7" fill={C.faint}
              animate={{ stroke: [C.line, C.line, C.green, C.green, C.line] }}
              transition={loop(D, [0, t1, t1 + 0.03, 0.9, 1])}
            />
            <Label x={202} y={c.y + 16} anchor="start">{c.name}</Label>
            <Check cx={250} cy={c.y + 13} D={D} t={t1} r={6} />
          </g>
        );
      })}
    </Scene>
  );
};

// ── One quota across clusters: creates fill it, an oversized one is refused, a small one fits. ──

const quotaClusters = [
  { x: 22, name: "prod" },
  { x: 110, name: "edge" },
  { x: 198, name: "lab" },
];
// Instances as they arrive: cluster index and slot. The last one is the request that fits.
const arrivals = [
  [0, 0],
  [0, 1],
  [1, 0],
  [2, 0],
  [2, 1],
  [1, 1],
] as const;
const slot = (c: number, s: number) => ({ x: quotaClusters[c]!.x + 10 + s * 22, y: 76 });

export const QuotaAnim = () => {
  const D = 5.4;
  const fit = 0.7;
  return (
    <Scene>
      <Label x={22} y={18} anchor="start">acme · quota 8 instances</Label>
      <motion.rect
        x="22" y="24" width="236" height="8" rx="4" fill={C.faint}
        animate={{ stroke: [C.line, C.line, C.red, C.red, C.line, C.line] }}
        transition={loop(D, [0, 0.44, 0.47, 0.6, 0.63, 1])}
      />
      {/* Usage: five creates, then the one that fits. Each instance is 29.5px of the bar. */}
      <motion.rect
        x="22" y="24" height="8" rx="4"
        animate={{
          width: [0, 0, 148, 148, 177, 177, 0],
          fill: [C.dim, C.dim, C.dim, C.dim, C.green, C.green, C.dim],
        }}
        transition={loop(D, [0, 0.04, 0.34, fit, fit + 0.05, 0.92, 1])}
      />
      {/* The oversized request: four more would overflow. */}
      <motion.rect
        x="170" y="24" height="8" rx="4" fill={C.red} opacity="0.55"
        initial={{ opacity: 0 }}
        animate={{ width: [0, 0, 88, 88, 0, 0], opacity: [0, 0, 0.55, 0.55, 0, 0] }}
        transition={loop(D, [0, 0.42, 0.47, 0.58, 0.62, 1])}
      />
      <motion.g
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0, 1, 1, 0, 0], x: [0, 0, 0, -3, 3, -3, 0, 0] }}
        transition={{
          opacity: loop(D, [0, 0.4, 0.44, 0.58, 0.62, 1]),
          x: loop(D, [0, 0.46, 0.48, 0.5, 0.52, 0.54, 0.56, 1]),
        }}
      >
        <rect x="200" y="40" width="58" height="14" rx="4" fill="rgba(239,77,77,0.12)" stroke={C.red} strokeDasharray="3 2" />
        <Label x={229} y={50} fill={C.red}>+4 refused</Label>
      </motion.g>
      <motion.g
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0, 1, 1, 0, 0] }}
        transition={loop(D, [0, 0.64, 0.66, 0.9, 0.93, 1])}
      >
        <rect x="200" y="40" width="58" height="14" rx="4" fill="rgba(62,196,109,0.12)" stroke={C.green} />
        <Label x={229} y={50} fill={C.green}>+1</Label>
      </motion.g>

      {quotaClusters.map((c) => (
        <g key={c.name}>
          <rect x={c.x} y="62" width="60" height="42" rx="8" fill={C.faint} stroke={C.line} />
          <Label x={c.x + 30} y={118}>{c.name}</Label>
        </g>
      ))}
      {arrivals.map(([c, s], i) => {
        const t = i === arrivals.length - 1 ? fit : 0.06 + i * 0.055;
        const p = slot(c, s);
        return (
          <motion.rect
            key={i}
            x={p.x} y={p.y} width="16" height="16" rx="4"
            fill={i === arrivals.length - 1 ? "rgba(62,196,109,0.25)" : "rgba(255,255,255,0.14)"}
            stroke={i === arrivals.length - 1 ? C.green : C.dim}
            style={centered}
            initial={{ opacity: 0 }}
            animate={{ scale: [0, 0, 1.15, 1, 1, 0], opacity: [0, 0, 1, 1, 1, 0] }}
            transition={loop(D, [0, t, t + 0.04, t + 0.06, 0.92, 1])}
          />
        );
      })}
    </Scene>
  );
};

// ── Move between clusters: a cluster goes into maintenance; its instance moves and lands. ───────

export const MigrateAnim = () => {
  const D = 5;
  const go = 0.32;
  const land = 0.62;
  return (
    <Scene>
      {/* Clusters */}
      <motion.rect
        x="18" y="44" width="100" height="70" rx="10" fill={C.faint}
        animate={{ stroke: [C.line, C.line, C.amber, C.amber, C.line, C.line] }}
        transition={loop(D, [0, 0.1, 0.14, 0.86, 0.9, 1])}
      />
      <Label x={68} y={130}>prod</Label>
      <motion.g
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0, 1, 1, 0, 0] }}
        transition={loop(D, [0, 0.12, 0.16, 0.86, 0.9, 1])}
      >
        <rect x="30" y="26" width="76" height="13" rx="6.5" fill="rgba(229,181,68,0.14)" stroke={C.amber} />
        <Label x={68} y={35.5} fill={C.amber} size={7}>maintenance</Label>
      </motion.g>
      <motion.rect
        x="162" y="44" width="100" height="70" rx="10" fill={C.faint}
        animate={{ stroke: [C.line, C.line, C.green, C.green, C.line] }}
        transition={loop(D, [0, land, land + 0.03, 0.9, 1])}
      />
      <Label x={212} y={130}>edge</Label>

      {/* The path it takes */}
      <motion.path
        d="M96 79 C 120 52, 160 52, 184 79" stroke={C.line} strokeDasharray="3 4"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0, 1, 1, 0, 0], strokeDashoffset: [0, -40] }}
        transition={{ opacity: loop(D, [0, go - 0.04, go, land, land + 0.04, 1]), strokeDashoffset: { duration: 1, repeat: Infinity, ease: "linear" } }}
      />

      {/* The instance where it was */}
      <motion.g
        animate={{ opacity: [1, 1, 0.35, 0.35, 0, 0, 1] }}
        transition={loop(D, [0, go, go + 0.02, land, land + 0.06, 0.96, 1])}
      >
        <rect x="40" y="67" width="56" height="24" rx="6" fill="#141416" stroke={C.dim} />
        <circle cx="50" cy="79" r="2.6" fill={C.green} />
        <Label x={74} y={82}>web</Label>
      </motion.g>

      {/* On its way */}
      <motion.g
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0, 1, 1, 0, 0], x: [0, 0, 0, 144, 144, 144] }}
        transition={{
          opacity: loop(D, [0, go, go + 0.02, land - 0.01, land, 1]),
          x: loop(D, [0, go, go + 0.02, land - 0.01, land, 1]),
        }}
      >
        <motion.g animate={{ y: [0, 0, 0, -22, 0, 0, 0] }} transition={loop(D, [0, go, go + 0.02, (go + land) / 2, land - 0.01, land, 1])}>
          <rect x="40" y="67" width="56" height="24" rx="6" fill="#141416" stroke={C.blue} />
          <circle cx="50" cy="79" r="2.6" fill={C.blue} />
          <Label x={74} y={82}>web</Label>
        </motion.g>
      </motion.g>

      {/* Landed */}
      <motion.g
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0, 1, 1, 0, 0], scaleY: [1, 1, 0.82, 1, 1], scaleX: [1, 1, 1.08, 1, 1] }}
        style={{ ...centered, transformOrigin: "center bottom" }}
        transition={{
          opacity: loop(D, [0, land - 0.01, land + 0.01, 0.9, 0.94, 1]),
          scaleY: loop(D, [0, land - 0.01, land + 0.02, land + 0.06, 1]),
          scaleX: loop(D, [0, land - 0.01, land + 0.02, land + 0.06, 1]),
        }}
      >
        <rect x="184" y="67" width="56" height="24" rx="6" fill="#141416" stroke={C.green} />
        <circle cx="194" cy="79" r="2.6" fill={C.green} />
        <Label x={218} y={82}>web</Label>
      </motion.g>
      <Check cx={240} cy={67} D={D} t={land + 0.06} r={6} until={0.9} />
    </Scene>
  );
};

// ── Backups: an instance is backed up to S3, then restored on another cluster. ─────────────────

export const BackupAnim = () => {
  const D = 5.2;
  const up = [0.1, 0.3] as const;
  const down = [0.52, 0.72] as const;
  return (
    <Scene>
      {/* Clusters */}
      <rect x="14" y="48" width="78" height="58" rx="10" fill={C.faint} stroke={C.line} />
      <Label x={53} y={122}>prod</Label>
      <rect x="30" y="66" width="46" height="22" rx="6" fill="#141416" stroke={C.dim} />
      <Label x={53} y={80}>db</Label>

      <motion.rect
        x="188" y="48" width="78" height="58" rx="10" fill={C.faint}
        animate={{ stroke: [C.line, C.line, C.green, C.green, C.line] }}
        transition={loop(D, [0, down[1], down[1] + 0.03, 0.9, 1])}
      />
      <Label x={227} y={122}>edge</Label>

      {/* The bucket */}
      <path d="M118 52 v44 a22 7 0 0 0 44 0 v-44" fill={C.faint} stroke={C.dim} />
      <ellipse cx="140" cy="52" rx="22" ry="7" fill="#0f0f10" stroke={C.dim} />
      <svg x="118" y="52" width="44" height="52" overflow="hidden">
        <motion.rect
          x="0" width="44" fill="rgba(91,156,243,0.22)"
          animate={{ y: [52, 52, 40, 40, 52], height: [0, 0, 12, 12, 0] }}
          transition={loop(D, [0, up[1], up[1] + 0.06, 0.92, 1])}
        />
      </svg>
      <Label x={140} y={122}>s3</Label>

      {/* A backup, up to the bucket */}
      <motion.g
        initial={{ opacity: 0 }}
        animate={{ x: [0, 0, 0, 74, 74, 74], y: [0, 0, 0, -26, -26, -26], opacity: [0, 0, 1, 1, 0, 0] }}
        transition={loop(D, [0, up[0], up[0] + 0.02, up[1], up[1] + 0.04, 1])}
      >
        <rect x="59" y="70" width="14" height="16" rx="2.5" fill={C.blue} />
        <path d="M66 70v16" stroke="#0f0f10" strokeWidth="1.5" strokeDasharray="2 2" />
      </motion.g>
      <motion.g initial={{ opacity: 0 }} animate={{ opacity: [0, 0, 1, 1, 0, 0] }} transition={loop(D, [0, up[1], up[1] + 0.04, 0.46, 0.5, 1])}>
        <Label x={140} y={38} fill={C.blue}>backed up</Label>
      </motion.g>

      {/* Restored somewhere else */}
      <motion.g
        initial={{ opacity: 0 }}
        animate={{ x: [0, 0, 0, 80, 80, 80], y: [0, 0, 0, 26, 26, 26], opacity: [0, 0, 1, 1, 0, 0] }}
        transition={loop(D, [0, down[0], down[0] + 0.02, down[1], down[1] + 0.02, 1])}
      >
        <rect x="133" y="44" width="14" height="16" rx="2.5" fill={C.blue} />
        <path d="M140 44v16" stroke="#0f0f10" strokeWidth="1.5" strokeDasharray="2 2" />
      </motion.g>
      <motion.g
        style={centered}
        initial={{ opacity: 0 }}
        animate={{ scale: [0.5, 0.5, 1.1, 1, 1, 0.5], opacity: [0, 0, 1, 1, 1, 0] }}
        transition={loop(D, [0, down[1], down[1] + 0.04, down[1] + 0.07, 0.92, 1])}
      >
        <rect x="204" y="66" width="46" height="22" rx="6" fill="#141416" stroke={C.green} />
        <Label x={227} y={80}>db</Label>
      </motion.g>
      <Check cx={250} cy={66} D={D} t={down[1] + 0.07} r={6} />
    </Scene>
  );
};

// ── Kubernetes without appliances: one management cluster brings up nodes on three clusters. ────

const k8sClusters = [
  { y: 12, name: "prod" },
  { y: 58, name: "edge" },
  { y: 104, name: "lab" },
];

export const KubernetesAnim = () => {
  const D = 5;
  return (
    <Scene>
      {/* The management cluster: Cluster API with CAPN */}
      <g transform="translate(42 75)">
        <motion.g style={centered} animate={{ rotate: [0, 0, 30, 30] }} transition={loop(D, [0, 0.06, 0.24, 1])}>
          <circle r="18" fill={C.faint} stroke={C.dim} />
          {Array.from({ length: 7 }, (_, i) => {
            const a = (i / 7) * Math.PI * 2 - Math.PI / 2;
            return <line key={i} x1={Math.cos(a) * 5} y1={Math.sin(a) * 5} x2={Math.cos(a) * 13} y2={Math.sin(a) * 13} stroke={C.fg} strokeWidth="2" strokeLinecap="round" />;
          })}
          <circle r="4" fill="none" stroke={C.fg} strokeWidth="2" />
        </motion.g>
      </g>
      <Label x={42} y={108}>cluster api</Label>

      {k8sClusters.map((c, i) => {
        const t = 0.12 + i * 0.08;
        const ty = c.y + 17;
        return (
          <g key={c.name}>
            <line x1="62" y1="75" x2="148" y2={ty} stroke={C.faint} strokeWidth="1.5" />
            <motion.path
              d={`M62 75 L148 ${ty}`} stroke={C.blue} strokeWidth="1.5"
              initial={{ opacity: 0 }}
              animate={{ pathLength: [0, 0, 1, 1, 1], opacity: [0, 1, 1, 0.5, 0] }}
              transition={loop(D, [0, t, t + 0.12, 0.9, 1])}
            />
            <motion.rect
              x="148" y={c.y} width="116" height="34" rx="8" fill={C.faint}
              animate={{ stroke: [C.line, C.line, C.green, C.green, C.line] }}
              transition={loop(D, [0, t + 0.36, t + 0.4, 0.9, 1])}
            />
            <Label x={158} y={ty + 3} anchor="start">{c.name}</Label>
            {[0, 1, 2].map((j) => {
              const tj = t + 0.14 + j * 0.06;
              return (
                <motion.g
                  key={j}
                  style={centered}
                  initial={{ opacity: 0 }}
                  animate={{ scale: [0.3, 0.3, 1.15, 1, 1, 0.3], opacity: [0, 0, 1, 1, 1, 0] }}
                  transition={loop(D, [0, tj, tj + 0.04, tj + 0.06, 0.9, 1])}
                >
                  <rect x={192 + j * 22} y={c.y + 8} width="18" height="18" rx="4" fill={j === 0 ? "rgba(91,156,243,0.2)" : "rgba(255,255,255,0.1)"} stroke={j === 0 ? C.blue : C.dim} />
                  <motion.circle
                    cx={192 + j * 22 + 14} cy={c.y + 12} r="2" fill={C.green}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [0, 0, 1, 1, 0] }}
                    transition={loop(D, [0, t + 0.36, t + 0.4, 0.9, 1])}
                  />
                </motion.g>
              );
            })}
          </g>
        );
      })}
    </Scene>
  );
};

// ── Permissions: a role flows down the path tree, and No access stops it on one branch. ─────────

type TreeNode = { id: string; x: number; y: number; label: string };
const tree: TreeNode[] = [
  { id: "root", x: 140, y: 16, label: "/" },
  { id: "prod", x: 82, y: 54, label: "prod" },
  { id: "edge", x: 198, y: 54, label: "edge" },
  { id: "acmeP", x: 82, y: 92, label: "acme" },
  { id: "acmeE", x: 198, y: 92, label: "acme" },
  { id: "web", x: 54, y: 130, label: "web-1" },
  { id: "db", x: 110, y: 130, label: "db-1" },
];
const at = (id: string) => tree.find((n) => n.id === id)!;
const edges = [
  { from: "root", to: "prod", t: 0.16, tone: "ok" },
  { from: "root", to: "edge", t: 0.16, tone: "ok" },
  { from: "prod", to: "acmeP", t: 0.3, tone: "ok" },
  { from: "edge", to: "acmeE", t: 0.3, tone: "no" },
  { from: "acmeP", to: "web", t: 0.44, tone: "ok" },
  { from: "acmeP", to: "db", t: 0.44, tone: "ok" },
] as const;
// When each node lights up, and how.
const lit: Record<string, { t: number; color: string }> = {
  root: { t: 0.08, color: C.blue },
  prod: { t: 0.26, color: C.blue },
  edge: { t: 0.26, color: C.blue },
  acmeP: { t: 0.4, color: C.blue },
  acmeE: { t: 0.34, color: C.red },
  web: { t: 0.54, color: C.green },
  db: { t: 0.54, color: C.green },
};

export const PermissionsAnim = () => {
  const D = 5.4;
  return (
    <Scene>
      {edges.map((e) => {
        const a = at(e.from);
        const b = at(e.to);
        const d = `M${a.x} ${a.y + 8} L${b.x} ${b.y - 8}`;
        return (
          <g key={`${e.from}-${e.to}`}>
            <path d={d} stroke={C.line} strokeWidth="1.2" />
            <motion.path
              d={d} stroke={e.tone === "ok" ? C.blue : C.red} strokeWidth="1.8"
              initial={{ opacity: 0 }}
              animate={{ pathLength: [0, 0, e.tone === "ok" ? 1 : 0.5, e.tone === "ok" ? 1 : 0.5, 0], opacity: [0, 1, 1, 1, 0] }}
              transition={loop(D, [0, e.t, e.t + 0.1, 0.9, 1])}
            />
          </g>
        );
      })}
      {tree.map((n) => {
        const l = lit[n.id]!;
        return (
          <g key={n.id}>
            <motion.rect
              x={n.x - 22} y={n.y - 8} width="44" height="16" rx="5" fill="#141416"
              animate={{ stroke: [C.line, C.line, l.color, l.color, C.line] }}
              transition={loop(D, [0, l.t, l.t + 0.03, 0.9, 1])}
            />
            <Label x={n.x} y={n.y + 3} size={7} fill={C.fg}>{n.label}</Label>
          </g>
        );
      })}

      {/* The role, given on / */}
      <motion.g
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0, 1, 1, 0], x: [6, 6, 0, 0, 0] }}
        transition={loop(D, [0, 0.04, 0.08, 0.9, 1])}
      >
        <rect x="170" y="9" width="58" height="14" rx="7" fill="rgba(91,156,243,0.14)" stroke={C.blue} />
        <Label x={199} y={18.5} fill={C.blue} size={7}>operator</Label>
      </motion.g>

      {/* No access, on edge's acme project */}
      <motion.g
        style={centered}
        initial={{ opacity: 0 }}
        animate={{ scale: [0.5, 0.5, 1.1, 1, 1, 0.5], opacity: [0, 0, 1, 1, 1, 0] }}
        transition={loop(D, [0, 0.32, 0.36, 0.39, 0.9, 1])}
      >
        <rect x="170" y="112" width="58" height="14" rx="7" fill="rgba(239,77,77,0.14)" stroke={C.red} />
        <Label x={199} y={121.5} fill={C.red} size={7}>no access</Label>
      </motion.g>

      <Check cx={146} cy={130} D={D} t={0.6} r={6} until={0.9} />
    </Scene>
  );
};
