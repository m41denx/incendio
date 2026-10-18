# IncusCloud site

The landing pages and documentation for IncusCloud and Incendio, built with [Fumapress](https://fumapress.dev) (Fumadocs on Waku). English only.

```sh
bun install
bun run dev        # http://localhost:3003
bun run typecheck
bun run build      # static output in dist/public
```

- `content/docs/` is the documentation, one MDX file per page; each folder's `meta.json` orders its pages. `incuscloud/` and `incendio/` are root folders, so each gets its own sidebar.
- `src/pages/incendio.tsx` is Incendio's landing page. Incendio's screenshots load from the repository on GitHub (`src/components/screenshot.tsx`), not from this site; in MDX, use `<Screenshot name="…" />`.
- `src/pages/index.tsx` is the landing page. Its feature cards play a small animation on hover (`src/components/feature-animations.tsx`).
- `press.config.tsx` holds the site settings. `site.baseUrl` is the public address used for links and social images; set it to where the site is hosted.
