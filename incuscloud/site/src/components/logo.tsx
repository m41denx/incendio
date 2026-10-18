// The IncusCloud mark: a light tile with one hub joined to three clusters, then the wordmark
// over "by hyprr". Monochrome, like the rest of the site.
export const Mark = ({ className = "size-7" }: { className?: string }) => (
  <span className={`grid shrink-0 place-items-center rounded-lg bg-fd-primary text-fd-primary-foreground ${className}`}>
    <svg viewBox="0 0 24 24" className="size-[70%]" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <path d="M12 12 5.5 6.5M12 12l6.5-5.5M12 12v7" />
      <circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />
      <circle cx="5" cy="6" r="2.2" />
      <circle cx="19" cy="6" r="2.2" />
      <circle cx="12" cy="19.5" r="2.2" />
    </svg>
  </span>
);

export const Logo = ({ className = "" }: { className?: string }) => (
  <span className={`inline-flex items-center gap-2 select-none ${className}`}>
    <Mark />
    <span className="flex flex-col -space-y-1 leading-tight">
      <span className="text-lg font-semibold tracking-tight text-fd-foreground">IncusCloud</span>
      <span className="text-[9px] text-fd-muted-foreground">by hyprr</span>
    </span>
  </span>
);
