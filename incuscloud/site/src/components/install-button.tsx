"use client";

import { Link } from "fumapress/client";
import { useRouter } from "waku";

// The navbar's primary action: Incendio's install guide on the Incendio pages, IncusCloud's elsewhere.
export const InstallButton = () => {
  const { path } = useRouter();
  const incendio = path === "/incendio" || path.startsWith("/incendio/") || path.startsWith("/docs/incendio");
  return (
    <Link
      href={incendio ? "/docs/incendio/install" : "/docs/incuscloud/install/docker-compose"}
      className="ml-1 rounded-full bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground transition-opacity hover:opacity-85"
    >
      Install
    </Link>
  );
};
