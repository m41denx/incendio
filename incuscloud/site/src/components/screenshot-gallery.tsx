"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { type ShotName, shotUrl, shots } from "./screenshot";

// Incendio's screenshots by area: a row of matte tabs, then the screenshot crossfading as you
// move through the area with the arrows. Images come straight from GitHub (see screenshot.tsx).

const areas: { id: string; label: string; shots: ShotName[] }[] = [
  { id: "k8s", label: "Kubernetes", shots: ["kubernetes-cluster-detail", "kubernetes-clusters", "kubernetes-create", "kubernetes-appliance"] },
  { id: "instances", label: "Instances", shots: ["instance-create", "instance-terminal"] },
  { id: "networking", label: "Networking", shots: ["network-load-balancer", "network-detail", "network-address-sets", "network-dns-zones"] },
  { id: "storage", label: "Storage", shots: ["storage-pools", "btrfs-compression"] },
  { id: "cluster", label: "Clustering", shots: ["cluster-settings", "settings-logging"] },
  { id: "access", label: "Access", shots: ["trusted-certificates", "project-access"] },
];

export const ScreenshotGallery = () => {
  const reduce = useReducedMotion();
  const [area, setArea] = useState(0);
  const [i, setI] = useState(0);
  const a = areas[area]!;
  const name = a.shots[i]!;
  const step = (d: number) => setI((n) => (n + d + a.shots.length) % a.shots.length);

  return (
    <div className="flex w-full flex-col items-center gap-5">
      <div role="tablist" aria-label="Screenshots" className="flex max-w-full flex-wrap justify-center gap-2">
        {areas.map((x, n) => (
          <button
            key={x.id}
            role="tab"
            aria-selected={n === area}
            onClick={() => {
              setArea(n);
              setI(0);
            }}
            className="matte shrink-0 cursor-pointer rounded-full px-5 py-2.5 text-sm font-medium text-fd-muted-foreground transition-colors hover:text-fd-foreground aria-selected:border-transparent! aria-selected:bg-fd-primary! aria-selected:text-fd-primary-foreground!"
          >
            {x.label}
          </button>
        ))}
      </div>

      <div className="relative w-full">
        {/* Holds the screenshots' aspect ratio, so the page doesn't jump while one loads. */}
        <div className="relative aspect-[3164/1912] w-full">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.img
              key={name}
              src={shotUrl(name)}
              alt={shots[name]}
              width={3164}
              height={1912}
              decoding="async"
              className="absolute inset-0 h-full w-full"
              initial={reduce ? false : { opacity: 0, scale: 0.985 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduce ? undefined : { opacity: 0 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
            />
          </AnimatePresence>
        </div>
        {a.shots.length > 1 && (
          <>
            <button
              aria-label="Previous screenshot"
              onClick={() => step(-1)}
              className="matte absolute top-1/2 left-0 grid size-9 -translate-y-1/2 place-items-center rounded-full text-fd-foreground sm:-left-3"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              aria-label="Next screenshot"
              onClick={() => step(1)}
              className="matte absolute top-1/2 right-0 grid size-9 -translate-y-1/2 place-items-center rounded-full text-fd-foreground sm:-right-3"
            >
              <ChevronRight className="size-4" />
            </button>
          </>
        )}
      </div>

      <div className="-mt-[4%] flex items-center gap-3 text-xs text-fd-muted-foreground">
        <span>{shots[name]}</span>
        {a.shots.length > 1 && (
          <span className="flex gap-1.5" aria-hidden>
            {a.shots.map((s, n) => (
              <span key={s} className={`size-1.5 rounded-full ${n === i ? "bg-fd-foreground" : "bg-white/20"}`} />
            ))}
          </span>
        )}
      </div>
    </div>
  );
};
