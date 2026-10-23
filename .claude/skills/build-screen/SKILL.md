---
name: build-screen
description: Build one customer screen from its canvas design (design/<Name>.dc.html, its PNG and the spec §5 entry) with the UI kit, ar.json strings and all four states, then screenshot it at 390×844 and compare with the design. Use when asked to build, rebuild or match a screen to its design.
argument-hint: <Name> (design file name, e.g. Login)
---

# Build the $ARGUMENTS screen

Follow CLAUDE.md throughout. The spec wins over the design where they disagree.

## 1. Read before writing code

- `docs/spec.md` §5: find the entry for `$ARGUMENTS.dc.html` (`grep -n "$ARGUMENTS.dc.html" docs/spec.md`) and read it, plus the §5 global rules above §5.1. Read any §6 or §7 rules it depends on.
- `design/$ARGUMENTS.dc.html` as source code: `{{…}}` are template slots filled by the inline script, `[brackets]` are sample data from the database, and `support.js` is missing, so it won't render.
- `design/png/$ARGUMENTS.png` (2×, 780×1688). It shows only the first 844px; below the fold, the `.dc.html` is the source.
- `messages/ar.json`, `src/lib/routes.ts`, and the UI kit table in spec §4. Look at `/kit` (`src/app/kit/page.tsx`) for how each component is used.

## 2. Write down the plan first

Before any code, list in your reply:

1. Every "Change:" item and behavior rule from the spec entry. These override the design.
2. The route, and whether it's already in `routes.ts`.
3. Which kit components cover each part of the design, and what's left as new markup. Reuse the kit before you create a component; if a new one belongs in the kit, add it there with a `/kit` demo.
4. Design values with no token (color, radius, size, shadow). Add each to `@theme` in `src/app/globals.css` and to spec §4. Never use raw hex or arbitrary values.
5. The strings, as a new `ar.json` namespace named after the screen, copied exactly from the design.
6. The data each `[bracket]` needs, and where it comes from. If the tables don't exist yet, use typed placeholder data and say so.
7. Anything unclear in the spec. Ask; don't guess. Unresolved questions go in spec §13.

## 3. Build

- Server Component by default; `"use client"` only for the interactive parts, kept small. Uncached request data (`cookies()`, `headers()`, `searchParams`) sits under `<Suspense>`.
- RTL: logical classes only, flip directional icons, wrap phones, times, codes and order numbers in `dir="ltr"`, Western digits.
- Strings through `useTranslations("<Screen>")` or `getTranslations`. No Arabic in `.ts`/`.tsx`.
- Icons from lucide-react matched to the canvas glyph, `aria-hidden` when decorative. Icon-only buttons get an Arabic `aria-label`.
- Touch targets of at least 44px, visible focus, `pb-safe-*` on bottom bars and sheets.
- Money with `formatIQD()`, dates through `lib/dates` (Asia/Baghdad), phones through `lib/phone`.
- Writes go through Server Actions or RPC, with a shared Zod schema.

The edit hook runs Prettier, ESLint and the guards after every edit. Fix what it reports straight away.

## 4. All four states

- Loading: `loading.tsx` or a `<Suspense>` fallback built from `Skeleton`/`SkeletonGroup`, shaped like the real content.
- Empty: `EmptyState` with a CTA.
- Error: the screen's `error.tsx` calls `useReportError(error)` and renders `ErrorState` with Next's `retry` ("اعد المحاولة").
- Offline: the root layout already renders `OfflineBanner`. Check that the screen still works under it (no content hidden behind the banner).

## 5. Tests

- `tests/e2e/<route>.spec.ts`: the screen renders in Arabic and RTL, its links and actions go where the spec says, and the main controls are at least 44×44px. Wait for `document.fonts.ready`, then save a screenshot to `test-results/screenshots/<name>.png`.
- Unit tests in `tests/unit/` for any logic (validation, formatting, state). Component tests are `.test.tsx` with `// @vitest-environment happy-dom` and render via `react-dom/server`.

## 6. Compare with the design

1. Run `pnpm lint && pnpm typecheck && pnpm test`, then `pnpm test:e2e`. In cloud sessions, set `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium` first.
2. Open your screenshot and `design/png/$ARGUMENTS.png` with the Read tool and compare them region by region, top to bottom: layout and spacing, sizes, colors, radii, shadows, copy (every word), icons, alignment in RTL, and states.
3. Fix every difference you can. List the rest as "Departures from the canvas", each with its reason (spec change, accessibility, missing data). These go in the PR.

## 7. Wrap up

- Update docs: spec §5 if behavior was settled, §4 for new tokens or kit components, §12.3 when the task is done.
- Commit each logical change. Use `/ship-task` to run the checks and open the PR.
