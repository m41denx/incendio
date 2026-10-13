import type { FC, ReactNode } from "react";
import classnames from "classnames";

/** What an inventory row is. */
export type Kind = "root" | "cluster" | "member" | "container" | "vm" | "project" | "network" | "pool";
/** How it is doing: running/online, stopped, in between, frozen, failing, or no status. */
export type Tone = "ok" | "off" | "busy" | "frozen" | "bad" | "none";

const TONES: Record<string, Tone> = {
  running: "ok",
  online: "ok",
  created: "ok",
  ready: "ok",
  stopped: "off",
  evacuated: "busy",
  starting: "busy",
  stopping: "busy",
  restarting: "busy",
  pending: "busy",
  creating: "busy",
  deleting: "busy",
  degraded: "busy",
  blocked: "busy",
  frozen: "frozen",
  error: "bad",
  offline: "bad",
  unavailable: "bad",
  unreachable: "bad",
  errored: "bad",
};

/** An Incus or IncusCloud status as a tone (any case); unknown or none is "none". */
export const toneOf = (status?: string): Tone => (status ? (TONES[status.toLowerCase()] ?? "none") : "none");

// Square, 16px, drawn in currentColor: the tone tints them.
const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "square", strokeLinejoin: "miter" } as const;
const SHAPES: Record<Kind, ReactNode> = {
  root: <path {...S} d="M4.5 12.5h8a3 3 0 0 0 .4-6 4.5 4.5 0 0 0-8.6-1A3.5 3.5 0 0 0 4.5 12.5z" />,
  cluster: (
    <g {...S}>
      <rect x="5.5" y="1.5" width="5" height="4" />
      <rect x="1.5" y="10.5" width="5" height="4" />
      <rect x="9.5" y="10.5" width="5" height="4" />
      <path d="M8 5.5v2.5M4 10.5V8h8v2.5" />
    </g>
  ),
  member: (
    <g {...S}>
      <rect x="2.5" y="2.5" width="11" height="4.5" />
      <rect x="2.5" y="9" width="11" height="4.5" />
      <path d="M5 4.75h1M5 11.25h1" />
    </g>
  ),
  container: (
    <g {...S}>
      <path d="M8 1.75l5.75 3v6.5L8 14.25l-5.75-3v-6.5z" />
      <path d="M2.25 4.75L8 7.75l5.75-3M8 7.75v6.5" />
    </g>
  ),
  vm: (
    <g {...S}>
      <rect x="1.75" y="2.25" width="12.5" height="9" />
      <path d="M5 14h6M8 11.25V14" />
    </g>
  ),
  project: <path {...S} d="M1.75 3.25h4.5l1.5 1.75h6.5v8.25H1.75z" />,
  network: (
    <g {...S}>
      <circle cx="8" cy="8" r="6.25" />
      <ellipse cx="8" cy="8" rx="2.75" ry="6.25" />
      <path d="M1.75 8h12.5" />
    </g>
  ),
  pool: (
    <g {...S}>
      <ellipse cx="8" cy="3.75" rx="5.75" ry="2" />
      <path d="M2.25 3.75v8.5c0 1.1 2.6 2 5.75 2s5.75-.9 5.75-2v-8.5M2.25 8c0 1.1 2.6 2 5.75 2s5.75-.9 5.75-2" />
    </g>
  ),
};

/** An inventory kind's icon, tinted by its tone. */
const KindIcon: FC<{ kind: Kind; tone?: Tone; className?: string }> = ({ kind, tone = "none", className }) => (
  <svg className={classnames("ic-kind", `ic-kind--${kind}`, `ic-tone--${tone}`, className)} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
    {SHAPES[kind]}
  </svg>
);

export default KindIcon;
