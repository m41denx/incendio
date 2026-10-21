# IncusCloud UI alignment with Incendio

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** IncusCloud's web UI and its sign-in pages look like Incendio, because they reuse Incendio's styles and components. Custom pieces follow the same square, metro style.

**Why:** User review on 2026-10-12: "even login page and sidebar looks custom". Screenshots confirmed it.
- The login page was a rounded card in the system font.
- The navigation was Vanilla, but not Incendio's frame: logo, dividers, collapse control, version footer.
- Meters, empty states and page headers were `ic-*` look-alikes.

**Architecture:**
- **Shared code, not copies.** `incuscloud/web` imports leaf components from `packages/ui/src` through an alias `@incendio/ui/*` (Vite, tsconfig, Vitest): `PageHeader`, `Meter`. Only modules whose imports are React, `classnames` or `@canonical/react-components` are allowed.
- **Shared SCSS.** Our `styles.scss` imports Incendio's `_settings.scss`, the Vanilla build, and Incendio's partials for the frame and the shared components:
  - `font`, `pattern_navigation`, `page_header`, `meter`, `empty_state`, `status_bar`, `login`;
  - Incendio's global panel and logo rules, extracted to a `_shell.scss` partial in `packages/ui` that both apps import.
- **Frame.** `Application id="l-application"` → `Navigation` → routes → `StatusBar`, with Incendio's markup:
  - a mobile `l-navigation-bar`;
  - a dark `p-panel` drawer with `p-panel__logo` (logo image plus `logo-text p-heading--4`);
  - `p-side-navigation__list` sections separated by `navigation-hr`;
  - the account, documentation and sign-out entries at the bottom;
  - the collapse toggle (remembered per browser);
  - "Version …" in the status bar.
- **Pages.** `CustomLayout` with `PageHeader` (title, search, controls) as Incendio's list pages have, the empty-state pattern for empty lists, and Incendio's `Meter` for usage bars.
- **Sign-in pages** (login, consent, device, error) are rendered by the server inside the same frame, with the web build's own stylesheet, found from `index.html`. A Vanilla form with a `p-button--positive` button, no card.
- **Custom pieces** keep `border-radius: 0`, Vanilla tokens and the Ubuntu font, with flat buttons and inputs. The `ic-*` look-alikes are removed.
  - Muted text uses `u-text--muted`; identifiers use `<code>`.
  - Only true layout utilities stay: action column widths, form page width.

## Tasks

### Task 1: Shared base
- [ ] Add the `@incendio/ui` alias (Vite, tsconfig paths, Vitest). Extract `packages/ui/src/sass/_shell.scss` (panel, logo, `l-main` rules) from Incendio's `styles.scss`; Incendio imports it, with no visual change there (check with an Incendio screenshot).
- [ ] Rewrite `incuscloud/web/src/sass/styles.scss` on Incendio's settings and partials. Delete the look-alike classes and replace their uses. Web suite green.

### Task 2: Frame
- [ ] `components/Navigation.tsx` in Incendio's structure: sections and roles as `sections()` today, collapse, the mobile bar, sign out as a navigation entry. `components/StatusBar.tsx` shows the platform version. Tests for collapse, sections and sign out.

### Task 3: Pages
- [ ] Every page: `PageHeader`, empty states, `Meter` (dashboard capacity, tenant quota). Tests updated to the new markup. Run the browser e2e scripts to check flows still work.

### Task 4: Sign-in pages
- [ ] Server: `identity/pages.ts` renders the frame with the web stylesheet (or a minimal Vanilla fallback when no web build is configured). Login, consent, device, device done, error. Tests (markup, no inline rounded styles).

### Task 5: Visual check
- [ ] Screenshots of every page and the sign-in flow, side by side with Incendio's equivalents. Fix the differences. Deploy and tell the user.
