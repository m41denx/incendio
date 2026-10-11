# IncusCloud P8 — Balancing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Keep a cluster's members evenly loaded, with ProxLB's model (balanciness, used or assigned, memory/CPU/disk, affinity, anti-affinity, pinning, ignore).
- Put members into maintenance and back.
- Suggest cross-cluster moves for tenants placed on several clusters.

**Architecture:**
- **Engine.** `balancing/engine.ts` is a pure port of ProxLB's calculation model (GPLv3, like this project; `refs/proxlb/proxlb/models/calculations.py`). Its input is members and instances; its output is a plan of moves with reasons:
  - Balanciness is the highest member percentage minus the lowest, for the method (memory, cpu, disk) and mode (used, assigned).
  - While balanciness exceeds the threshold, the next guest on the most loaded member moves to the most free member that fits. Affinity groups move together, largest first, as ProxLB does.
  - Moves violating anti-affinity, pinning or capacity are skipped.
  - Members in maintenance are never targets.
  - Plans are bounded by `maxMoves`.
- **Hints on instances, like ProxLB's tags.** Tenants set these on their own instances through the Incus API:
  - `user.incuscloud.affinity=<group>` and `user.incuscloud.anti-affinity=<group>`. Groups are scoped to the instance's project, so tenants cannot affect each other.
  - `user.incuscloud.pin=<member>[,<member>]`.
  - `user.incuscloud.balance=false` to be left alone.

  The fleet collector keeps only these keys (`instances.hints`); the inventory still stores no other config.
- **Policy and job.**
  - Policy: `balancing_policies`, one per cluster, with `enabled`, `method`, `mode`, `balanciness` (%), `intervalS`, `maxMoves`, `allowRestart` and `exclude` (members).
  - A `rebalance` job reads the cluster afresh (the collector for that one cluster), plans, then moves instances one at a time with `POST /1.0/instances/<n>?target=<member>` (Incus's own same-cluster move). How each instance moves:
    - a running VM with `migration.stateful` moves live;
    - a stopped instance moves as it is;
    - a running container moves only with `allowRestart` (stop, move, start), and is otherwise skipped with a reason.
  - Each move is verified (its location after), and the job can be cancelled between moves.
  - The job runner's `beforeTick` schedules due policies; a rebalance holds the instance key `rebalance:<clusterId>`.
- **Maintenance** is Incus's own member evacuation (`POST /1.0/cluster/members/<m>/state {action: "evacuate", mode}` and `restore`), run as jobs by platform operators. Evacuated members are excluded from plans.
- **Cross-cluster suggestions** are pure: for each tenant placed on two or more clusters, find a cluster whose memory use exceeds the coolest one by more than the threshold. Suggest the tenant's largest instances there, until the gap would close. The UI offers *Move…* (P6 migration) for each; nothing moves on its own.

**Tech Stack:** as P7. For live tests, a two-member nested Incus cluster `cluster-d` (members `d1`, `d2`) in project `incuscloud-dev`.

**Spec:** `docs/superpowers/specs/2026-10-11-incuscloud-design.md` (§1 Balancing, §3.2 `balancing_policies`, P8 row, D6) and ProxLB (`refs/proxlb`).

## Global Constraints

- **Platform operators** manage policies, plans, runs and maintenance.
- **Tenants** influence placement only through the hints on their own instances, and see suggestions for their own tenants.
- **Never move what was asked not to move.** `balance=false`, a pinned instance already on an allowed member, and instances in projects named in the policy's `exclude` are never moved.
- **No surprise downtime.** Running containers move only with `allowRestart`.
- **Audit:** policy changes, runs, evacuations and restores.

## Review Focus

- **Anti-affinity on a two-member cluster with three instances of one group.** It cannot be satisfied: plan what helps, never loop, and say so.
- **A plan computed on stale data.** Re-read the cluster before acting; a move whose instance changed member or state since is skipped, not forced.
- **Capacity.** Never plan a move that pushes the target over 100% of the method's capacity.
- **Maintenance members** are neither sources of balancing moves (Incus evacuates them) nor targets.
- **Oscillation.** One run must not move an instance back to where it came from.

---

### Task 1: Engine

- [ ] `src/balancing/engine.ts` and its tests:
  - balanciness and threshold, for each method and mode;
  - most-free target and the capacity check;
  - affinity groups moved together, larger first;
  - anti-affinity spreads and is reported when impossible;
  - pins, `balance=false` and maintenance members;
  - `maxMoves`;
  - no ping-pong;
  - a deterministic plan for the same input.

### Task 2: Inventory hints and schema

- [ ] Add `instances.hints` (jsonb, only the four `user.incuscloud.*` balancing keys, from the instance's own config). Test the collector.
- [ ] Add `balancing_policies` and migration 0009. Map member status `Evacuated` to maintenance.

### Task 3: Rebalance job, maintenance jobs, scheduler

- [ ] `rebalanceHandler`: read the cluster fresh, plan, move with verification, skip stale moves, cancel between moves. Its result lists moves done and skipped, with reasons.
- [ ] `evacuateHandler` / `restoreMemberHandler`.
- [ ] `scheduleBalancing(db)`.
- [ ] Stub-cluster tests for each.

### Task 4: API

Routes, all under `/api/v1/clusters/:id`:
- `GET/PUT balancing` (the policy);
- `POST balancing/plan` (a dry run, now);
- `POST balancing/run` (job);
- `POST members/:name/evacuate {mode}` and `POST members/:name/restore` (jobs).

Also `GET /api/v1/balancing/suggestions`.

- [ ] Authorisation tests. Suggestions are tested as a pure function plus visibility (tenants see only their own).

### Task 5: UI

- Haiku: the cluster page's Balancing section (policy form, plan preview, run), member Evacuate/Restore actions, and a Suggestions page.
- Mine: types, routes, nav, and MigrateInstance with a preset target.

### Task 6: Live and docs

- [ ] Build `cluster-d`, a two-member cluster, and enrol it.
- [ ] `scripts/balancing-e2e.ts`:
  1. imbalance by placing instances on d1;
  2. plan, then run (`allowRestart`), checking members afterwards;
  3. anti-affinity spread;
  4. a pin respected;
  5. evacuate d1, then restore it;
  6. suggestions across clusters b/c/d.
- [ ] Browser pass, then the README section on balancing.
