/**
 * The balancing engine: a pure port of ProxLB's model (refs/proxlb, GPLv3, as
 * this project). Members carry a capacity and a load; guests carry what they
 * use and what they were assigned, and placement hints set on the instance:
 *
 *   user.incuscloud.affinity=<group>       keep the group on one member
 *   user.incuscloud.anti-affinity=<group>  keep the group on different members
 *   user.incuscloud.pin=<member>[,…]       only on these members
 *   user.incuscloud.balance=false          never move it
 *
 * Groups are scoped to the instance's project, so a tenant's hints only ever
 * concern its own instances.
 *
 * Order of work:
 *   1. pins are enforced,
 *   2. anti-affinity groups are spread,
 *   3. split affinity groups are gathered where most of each runs,
 *   4. then, while the spread (highest member percentage minus lowest) exceeds
 *      the threshold, the busiest member that can still lower it gives up the
 *      unit (a guest, or a whole affinity group) whose move leaves the lowest
 *      spread.
 * A move must fit the target and strictly improve the spread; no guest moves
 * twice in one plan; members in maintenance are neither counted nor targets.
 */

export type Method = "memory" | "cpu" | "disk";
export type Mode = "used" | "assigned";
export type Resources = Record<Method, number>;

export interface Member {
  name: string;
  maintenance: boolean;
  total: Resources;
  /** What the member reports in use (used mode). */
  used: Resources;
}

export interface Hints {
  affinity?: string;
  antiAffinity?: string;
  pin?: string[];
  /** false: never moved. */
  balance?: boolean;
}

export interface Guest {
  project: string;
  name: string;
  member: string;
  type: string;
  running: boolean;
  /** Whether it can be moved at all (a running container needs a restart, which the policy may not allow). */
  movable: boolean;
  used: Resources;
  assigned: Resources;
  hints: Hints;
}

export interface PlanInput {
  members: Member[];
  guests: Guest[];
  method: Method;
  mode: Mode;
  /** Percentage points of spread tolerated. */
  balanciness: number;
  maxMoves: number;
}

export type MoveReason = "pin" | "anti-affinity" | "affinity" | "balance";

export interface Move {
  project: string;
  name: string;
  from: string;
  to: string;
  reason: MoveReason;
}

export interface Plan {
  /** Spread before and after the plan, in percentage points. */
  before: number;
  after: number;
  moves: Move[];
  notes: string[];
}

const METHODS: Method[] = ["memory", "cpu", "disk"];
const key = (g: Pick<Guest, "project" | "name">) => `${g.project}/${g.name}`;

/** The working state of a plan: where each guest is and each member's load. */
class State {
  readonly load = new Map<string, Resources>();
  readonly where = new Map<string, string>();

  constructor(
    readonly members: Member[],
    readonly guests: Guest[],
    readonly mode: Mode,
  ) {
    for (const m of members) {
      if (mode === "used") this.load.set(m.name, { ...m.used });
      else this.load.set(m.name, { memory: 0, cpu: 0, disk: 0 });
    }
    for (const g of guests) {
      this.where.set(key(g), g.member);
      if (mode === "assigned") {
        const l = this.load.get(g.member);
        if (l) for (const r of METHODS) l[r] += g.assigned[r];
      }
    }
  }

  size(g: Guest, r: Method) {
    return this.mode === "used" ? g.used[r] : g.assigned[r];
  }

  percent(member: string, r: Method) {
    const m = this.members.find((x) => x.name === member)!;
    return m.total[r] > 0 ? (this.load.get(member)![r] / m.total[r]) * 100 : 0;
  }

  /** The active members (not in maintenance). */
  active() {
    return this.members.filter((m) => !m.maintenance);
  }

  spread(r: Method) {
    const p = this.active().map((m) => this.percent(m.name, r));
    return p.length ? Math.max(...p) - Math.min(...p) : 0;
  }

  move(g: Guest, to: string) {
    const from = this.where.get(key(g))!;
    const lf = this.load.get(from);
    const lt = this.load.get(to)!;
    for (const r of METHODS) {
      const s = this.size(g, r);
      if (lf) lf[r] -= s;
      lt[r] += s;
    }
    this.where.set(key(g), to);
  }

  /** Whether `units` fit on `to` for method `r` (at most 100% of its capacity). */
  fits(units: Guest[], to: string, r: Method) {
    const m = this.members.find((x) => x.name === to)!;
    const add = units.reduce((n, g) => n + this.size(g, r), 0);
    return this.load.get(to)![r] + add <= m.total[r];
  }

  /** Others of `g`'s anti-affinity group on `member`. */
  antiConflict(g: Guest, member: string, ignore: Set<string> = new Set()) {
    const group = g.hints.antiAffinity;
    if (!group) return false;
    return this.guests.some((o) => o !== g && !ignore.has(key(o)) && o.project === g.project && o.hints.antiAffinity === group && this.where.get(key(o)) === member);
  }
}

/** Spread of `members` with `guests` where they are now. */
export function spread(members: Member[], guests: Guest[], method: Method, mode: Mode): number {
  return new State(members, guests, mode).spread(method);
}

export function plan(input: PlanInput): Plan {
  const { method, maxMoves } = input;
  const s = new State(input.members, input.guests, input.mode);
  const before = s.spread(method);
  const moves: Move[] = [];
  const notes: string[] = [];
  const moved = new Set<string>();
  const activeNames = () => s.active().map((m) => m.name);
  let capped = false;

  /** May `g` be moved by this plan, and to which members. */
  const allowed = (g: Guest) => {
    if (!g.movable || g.hints.balance === false || moved.has(key(g))) return [];
    const on = s.where.get(key(g))!;
    // Guests on members in maintenance are Incus's evacuation to handle.
    if (input.members.find((m) => m.name === on)?.maintenance) return [];
    return activeNames().filter((m) => m !== on && (!g.hints.pin?.length || g.hints.pin.includes(m)));
  };
  const record = (g: Guest, to: string, reason: MoveReason) => {
    if (moves.length >= maxMoves) {
      capped = true;
      return false;
    }
    moves.push({ project: g.project, name: g.name, from: s.where.get(key(g))!, to, reason });
    s.move(g, to);
    moved.add(key(g));
    return true;
  };
  /** The allowed target for `g` with the lowest load that fits and keeps anti-affinity. */
  const leastLoaded = (g: Guest, targets: string[]) =>
    targets
      .filter((t) => s.fits([g], t, method) && !s.antiConflict(g, t))
      .sort((a, b) => s.percent(a, method) - s.percent(b, method) || a.localeCompare(b))[0];

  const guests = [...input.guests].sort((a, b) => key(a).localeCompare(key(b)));

  /** The move of a unit (a guest, or a whole affinity group all there) off `source` that leaves the lowest spread, if any improves on `current`. */
  const bestMove = (source: string, current: number) => {
    const here = guests.filter((g) => s.where.get(key(g)) === source && allowed(g).length);
    const units: Guest[][] = [];
    const seen = new Set<string>();
    for (const g of here) {
      if (seen.has(key(g))) continue;
      if (g.hints.affinity) {
        const group = guests.filter((o) => o.project === g.project && o.hints.affinity === g.hints.affinity);
        if (group.every((o) => s.where.get(key(o)) === source && allowed(o).length)) {
          for (const o of group) seen.add(key(o));
          units.push(group);
        }
        continue;
      }
      seen.add(key(g));
      units.push([g]);
    }
    let best: { unit: Guest[]; to: string; spread: number; size: number } | undefined;
    for (const unit of units) {
      const targets = activeNames().filter((t) => unit.every((g) => allowed(g).includes(t)));
      const ignore = new Set(unit.map(key));
      for (const to of targets) {
        if (!s.fits(unit, to, method) || unit.some((g) => s.antiConflict(g, to, ignore))) continue;
        for (const g of unit) s.move(g, to);
        const after = s.spread(method);
        for (const g of unit) s.move(g, source);
        if (after >= current - 1e-9) continue;
        const size = unit.reduce((n, g) => n + s.size(g, method), 0);
        if (!best || after < best.spread - 1e-9 || (Math.abs(after - best.spread) < 1e-9 && (size > best.size || (size === best.size && key(unit[0]!) < key(best.unit[0]!))))) best = { unit, to, spread: after, size };
      }
    }
    return best;
  };

  // 1. Pins.
  for (const g of guests) {
    const pin = g.hints.pin;
    if (!pin?.length || pin.includes(s.where.get(key(g))!)) continue;
    const to = leastLoaded(g, allowed(g));
    if (to) record(g, to, "pin");
    else notes.push(`${key(g)} is pinned to ${pin.join(", ")} but cannot go there now`);
  }

  // 2. Anti-affinity: one of each group per member.
  const antiGroups = groupBy(guests.filter((g) => g.hints.antiAffinity), (g) => `${g.project}/${g.hints.antiAffinity}`);
  for (const [, members] of antiGroups) {
    const name = members[0]!.hints.antiAffinity!;
    if (members.length > activeNames().length) notes.push(`Anti-affinity group "${name}" in ${members[0]!.project} has ${members.length} instances but only ${activeNames().length} members`);
    const seen = new Set<string>();
    for (const g of members) {
      const on = s.where.get(key(g))!;
      if (!seen.has(on)) {
        seen.add(on);
        continue;
      }
      const to = leastLoaded(g, allowed(g).filter((t) => !seen.has(t)));
      if (to && record(g, to, "anti-affinity")) seen.add(to);
    }
  }

  // 3. Affinity: gather a split group where most of it runs.
  const affGroups = groupBy(guests.filter((g) => g.hints.affinity), (g) => `${g.project}/${g.hints.affinity}`);
  for (const [, members] of affGroups) {
    const count = new Map<string, number>();
    for (const g of members) count.set(s.where.get(key(g))!, (count.get(s.where.get(key(g))!) ?? 0) + 1);
    if (count.size < 2) continue;
    const home = [...count.entries()].filter(([m]) => activeNames().includes(m)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
    if (!home) continue;
    for (const g of members) {
      if (s.where.get(key(g)) === home) continue;
      if (allowed(g).includes(home) && s.fits([g], home, method) && !s.antiConflict(g, home)) record(g, home, "affinity");
      else notes.push(`${key(g)} could not join its affinity group "${g.hints.affinity}" on ${home}`);
    }
  }

  // 4. Balance: the busiest member that has an improving move gives its best one.
  for (;;) {
    if (s.spread(method) <= input.balanciness || capped) break;
    const current = s.spread(method);
    const sources = activeNames().sort((a, b) => s.percent(b, method) - s.percent(a, method) || a.localeCompare(b));
    let best: { unit: Guest[]; to: string; spread: number; size: number } | undefined;
    for (const source of sources) {
      best = bestMove(source, current);
      if (best) break;
    }
    if (!best) {
      notes.push(`No move improves the balance further (${current.toFixed(1)} points of spread left)`);
      break;
    }
    if (moves.length + best.unit.length > maxMoves) {
      capped = true;
      break;
    }
    for (const g of best.unit) record(g, best.to, "balance");
  }
  if (capped) notes.push(`Stopped after ${moves.length} moves (the policy's maximum)`);

  return { before, after: s.spread(method), moves, notes };
}

function groupBy<T>(xs: T[], k: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) m.set(k(x), [...(m.get(k(x)) ?? []), x]);
  return m;
}
