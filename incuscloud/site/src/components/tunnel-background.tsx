import { ShaderBackground } from "./shader-background";

// Fixed backdrop: the dithered wave under a fine grid and a soft spotlight from the top.
export const TunnelBackground = () => (
  <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-fd-background">
    <ShaderBackground className="absolute inset-0 h-full w-full opacity-[0.14]" />
    <div
      className="grid-lines absolute inset-0"
      style={{
        maskImage: "radial-gradient(120% 90% at 50% 12%, black 0%, transparent 62%)",
        WebkitMaskImage: "radial-gradient(120% 90% at 50% 12%, black 0%, transparent 62%)",
      }}
    />
    <div className="absolute inset-0 bg-[radial-gradient(60%_40%_at_50%_-8%,rgba(255,255,255,0.10),transparent_60%)]" />
    <div className="absolute inset-0 bg-[radial-gradient(100%_100%_at_50%_50%,transparent_55%,rgba(0,0,0,0.6)_100%)]" />
  </div>
);
