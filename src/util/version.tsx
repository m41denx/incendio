export const RECENT_MAJOR_SERVER_VERSION = 5;

// Incendio version. Shown in the UI as `Version <serverVersion>-ui-<UI_VERSION>`
// (e.g. 7.4-ui-0.22-p5); the GitHub release tag is UI_VERSION itself (0.22-p5).
// UI_BASE is the lxd-ui release this fork is based on; bump INCENDIO_PATCH and
// add a matching CHANGELOG.md entry (## 0.22-p5) for each release.
export const UI_BASE = "0.22";
export const INCENDIO_PATCH = 5;
export const UI_VERSION = `${UI_BASE}-p${INCENDIO_PATCH}`;

// defined in vite.config.ts and injected at build time
declare const __UI_GIT_HASH__: string;
export const UI_GIT_HASH = __UI_GIT_HASH__ ?? "unknown";
