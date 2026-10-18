import { Link } from "fumapress/client";
import { Logo } from "./logo";

// The hyprr wordmark with the dimmed "//" device, as across the hyprr family.
const Hyprr = () => (
  <>
    hyprr<span className="px-0.5 text-fd-foreground/30">//</span>cloud
  </>
);

const linkCls = "text-fd-muted-foreground transition-colors hover:text-fd-foreground";

// Floating pill footer, the same frosted treatment as the navbar.
export const Footer = () => (
  <footer className="px-4 pb-5 pt-4">
    <div className="mx-auto flex max-w-4xl flex-col items-center justify-between gap-4 rounded-2xl border border-white/10 bg-fd-background/60 px-5 py-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05),0_10px_30px_-12px_rgba(0,0,0,0.7)] backdrop-blur-xl sm:flex-row">
      <Link href="/">
        <Logo />
      </Link>
      <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm">
        <Link href="/docs" className={linkCls}>
          Docs
        </Link>
        <Link href="/docs/install" className={linkCls}>
          Install
        </Link>
        <a href="https://github.com/m41denx/incendio" target="_blank" rel="noopener" className={linkCls}>
          GitHub
        </a>
        <a href="https://hyprr.space" target="_blank" rel="noopener" className={linkCls}>
          <Hyprr />
        </a>
      </nav>
      <span className="font-mono text-xs text-fd-muted-foreground/60">
        GPL-3.0 · <Hyprr />
      </span>
    </div>
  </footer>
);
