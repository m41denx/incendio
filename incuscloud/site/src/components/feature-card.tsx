"use client";

import { Archive, ArrowRightLeft, Building2, Container, KeyRound, ShieldCheck } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRef, useState } from "react";
import { BackupAnim, KubernetesAnim, MigrateAnim, PermissionsAnim, QuotaAnim, SignInAnim } from "./feature-animations";

const kinds = {
  signin: { icon: KeyRound, Anim: SignInAnim },
  quota: { icon: Building2, Anim: QuotaAnim },
  migrate: { icon: ArrowRightLeft, Anim: MigrateAnim },
  backup: { icon: Archive, Anim: BackupAnim },
  k8s: { icon: Container, Anim: KubernetesAnim },
  acl: { icon: ShieldCheck, Anim: PermissionsAnim },
};

export type FeatureKind = keyof typeof kinds;

// A feature card. Hovering (or tapping, on touch) lifts and enlarges it over its neighbours and
// swaps the text for an animation of the feature; leaving brings the text back. The card keeps its
// grid slot, so nothing around it moves.
export const FeatureCard = ({ kind, title, body }: { kind: FeatureKind; title: string; body: string }) => {
  const { icon: Icon, Anim } = kinds[kind];
  const reduce = useReducedMotion();
  const [active, setActive] = useState(false);
  const pointer = useRef("mouse");
  const on = active && !reduce;

  return (
    <motion.div
      onPointerDown={(e) => (pointer.current = e.pointerType)}
      onClick={() => pointer.current !== "mouse" && setActive((a) => !a)}
      onHoverStart={() => setActive(true)}
      onHoverEnd={() => setActive(false)}
      animate={{ scale: on ? 1.1 : 1 }}
      transition={{ type: "spring", stiffness: 320, damping: 26 }}
      className={`relative min-h-[200px] overflow-hidden rounded-2xl border p-5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] backdrop-blur-xl transition-[background-color,border-color,box-shadow] duration-200 ${
        on
          ? "z-10 border-white/20 bg-[#161618]/95 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08),0_30px_80px_-20px_rgba(0,0,0,0.9)]"
          : "z-0 border-white/10 bg-white/[0.035]"
      }`}
    >
      <motion.div
        animate={{ opacity: on ? 0 : 1, y: on ? -6 : 0 }}
        transition={{ duration: 0.2 }}
        className="flex flex-col gap-3.5"
      >
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05]">
          <Icon className="size-4 text-fd-foreground" strokeWidth={1.75} />
        </div>
        <div>
          <p className="text-sm font-medium text-fd-foreground">{title}</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-fd-muted-foreground">{body}</p>
        </div>
      </motion.div>

      <AnimatePresence>
        {on && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.25, delay: 0.08 } }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            className="absolute inset-0 flex flex-col p-4"
            aria-hidden
          >
            <div className="flex items-center gap-2 text-xs font-medium text-fd-muted-foreground">
              <Icon className="size-3.5" strokeWidth={1.75} />
              {title}
            </div>
            <div className="min-h-0 flex-1 pt-1">
              <Anim />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
