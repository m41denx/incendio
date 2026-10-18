# IncusCloud site

The landing page and the documentation, built with [Fumapress](https://fumapress.dev) (Fumadocs on Waku). English only.

```sh
bun install
bun run dev        # http://localhost:3003
bun run typecheck
bun run build      # static output in dist/public
```

- `content/docs/` is the documentation, one MDX file per page; each folder's `meta.json` orders its pages.
- `src/pages/index.tsx` is the landing page. Its feature cards play a small animation on hover (`src/components/feature-animations.tsx`).
- `press.config.tsx` holds the site settings. `site.baseUrl` is the public address used for links and social images; set it to where the site is hosted.
