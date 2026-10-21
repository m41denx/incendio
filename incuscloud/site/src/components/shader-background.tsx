"use client";

import { useEffect, useState } from "react";
import { Dither, LinearGradient, Shader, SineWave } from "shaders/react";

const transform = {
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
  scale: 1,
  anchorX: 0.5,
  anchorY: 0.5,
  edges: "transparent" as const,
};

// A slow, monochrome dithered wave (the hyprr.link signature). Greyscale and low-contrast so it
// reads as texture, not decoration. Mounted client-side only: WebGL has nothing to render on the
// server, and the shaders package can't be server-rendered under Vite's RSC build.
export const ShaderBackground = ({ className }: { className?: string }) => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return <Wave className={className} />;
};

const Wave = ({ className }: { className?: string }) => (
  <Shader id="incuscloud-bg" className={className}>
    <LinearGradient
      colorA="#0a0a0b"
      colorB="#141416"
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      angle={180}
      edges="stretch"
      colorSpace="oklab"
      transform={transform}
    />
    <Dither pixelSize={4} threshold={0.34} colorA="transparent" colorB="#c8c8c8" transform={transform}>
      <SineWave
        angle={304}
        color="#ffffff"
        speed={0.16}
        position={{ x: 0.5, y: 0.7 }}
        softness={0.55}
        amplitude={0.2}
        frequency={1.15}
        thickness={0.4}
      />
    </Dither>
  </Shader>
);
