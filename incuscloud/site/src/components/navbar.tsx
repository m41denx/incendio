import { Link } from "fumapress/client";
import { Logo } from "./logo";

const links = [
  { href: "/#features", label: "Features" },
  { href: "/#how", label: "How it works" },
  { href: "/docs", label: "Docs" },
  { href: "https://github.com/m41denx/incendio", label: "GitHub" },
];

// Floating, sticky pill navbar: logo left, links and the primary action right (hyprr.link style).
export const Navbar = () => (
  <header className="sticky top-0 z-50 px-4 pt-4 sm:pt-5">
    <div className="mx-auto flex h-14 max-w-4xl items-center justify-between rounded-full border border-white/10 bg-fd-background/60 py-2 pl-5 pr-2 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05),0_10px_30px_-12px_rgba(0,0,0,0.7)] backdrop-blur-xl">
      <Link href="/" aria-label="IncusCloud home">
        <Logo />
      </Link>
      <nav className="flex items-center gap-1">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="hidden rounded-full px-3 py-1.5 text-sm text-fd-muted-foreground transition-colors hover:text-fd-foreground md:block"
          >
            {l.label}
          </Link>
        ))}
        <Link
          href="/docs/install/docker-compose"
          className="ml-1 rounded-full bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground transition-opacity hover:opacity-85"
        >
          Install
        </Link>
      </nav>
    </div>
  </header>
);
