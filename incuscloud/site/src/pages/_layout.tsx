import type { ReactNode } from "react";
import { Footer } from "../components/footer";
import { Navbar } from "../components/navbar";
import { TunnelBackground } from "../components/tunnel-background";

// Shell for file-based routes (the landing page): the backdrop and the floating pill chrome.
// Docs pages are content routes and render through the docs layout in press.config.tsx instead.
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-x-clip">
      <TunnelBackground />
      <Navbar />
      <main className="flex flex-1 flex-col">{children}</main>
      <Footer />
    </div>
  );
}
