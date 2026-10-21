import type { ReactNode } from "react";

// Building blocks shared by the landing pages: buttons, two-part headings, sections and a terminal.

export const btnPrimary =
  "inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-fd-primary px-5 text-sm font-medium text-fd-primary-foreground transition-opacity hover:opacity-85";
export const btnGlass = "matte inline-flex h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-medium text-fd-foreground";

/** A two-part heading: the lead, then the tail in muted grey. */
export const Split = ({ parts }: { parts: [string, string] }) => (
  <>
    {parts[0]} <span className="text-fd-muted-foreground">{parts[1]}</span>
  </>
);

export const Section = ({ id, eyebrow, title, sub, children }: { id?: string; eyebrow: string; title: ReactNode; sub?: string; children: ReactNode }) => (
  <section id={id} className="mx-auto w-full max-w-5xl scroll-mt-28 px-4 py-20 sm:py-24">
    <div className="mx-auto mb-12 flex max-w-2xl flex-col items-center gap-4 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-fd-muted-foreground">{eyebrow}</p>
      <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
      {sub && <p className="text-pretty text-[15px] leading-relaxed text-fd-muted-foreground">{sub}</p>}
    </div>
    {children}
  </section>
);

export const Terminal = ({ children }: { children: ReactNode }) => (
  <div className="glass overflow-hidden rounded-2xl">
    <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-3">
      <span className="size-2.5 rounded-full bg-white/15" />
      <span className="size-2.5 rounded-full bg-white/15" />
      <span className="size-2.5 rounded-full bg-white/15" />
    </div>
    <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed sm:p-5 sm:text-[13px]">{children}</pre>
  </div>
);

export const Prompt = ({ host = "" }: { host?: string }) => <span className="select-none text-fd-muted-foreground">{host}$ </span>;
export const Comment = ({ children }: { children: ReactNode }) => <span className="text-fd-muted-foreground/70">{children}</span>;
