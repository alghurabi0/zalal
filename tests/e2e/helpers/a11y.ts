import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

// Accessibility checks shared by a11y.spec.ts (spec §5 global rules, CLAUDE.md
// UI rules; Phase 6, task 4).

/** WCAG 2.2 A and AA, plus axe's best practices (landmarks, regions). */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

/**
 * Accepted departures, by axe rule id, with the reason. Empty for now: the
 * canvas's sub-3:1 borders and tiles are non-text, which axe's
 * color-contrast doesn't check (spec §4 "Contrast").
 */
const ACCEPTED: Record<string, string> = {};

/** Runs axe on the page (or one part of it) and fails on any violation. */
export async function expectNoAxeViolations(page: Page, label: string, include?: string) {
  let builder = new AxeBuilder({ page }).withTags(TAGS).disableRules(Object.keys(ACCEPTED));
  if (include) builder = builder.include(include);
  const { violations } = await builder.analyze();
  const found = violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(" "))
        .join(" | ")}`,
  );
  expect(found, `axe on ${label}`).toEqual([]);
}

/**
 * Interactive elements whose touch target is under the minimum: 44 px, or
 * `linkMin` for links (admin, desktop-first, allows WCAG 2.5.8's 24 px for
 * text links). A pseudo-element strip counts (the kit's chips), radio and
 * checkbox inputs are measured by their label, controls shown only on
 * keyboard focus are skipped, and links inside a sentence are exempt (WCAG
 * 2.5.8 "inline").
 */
export async function smallTargets(page: Page, { linkMin = 44 } = {}): Promise<string[]> {
  return page.evaluate((linkMin) => {
    const hitRect = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      const box = { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      const after = getComputedStyle(el, "::after");
      if (after.content !== "none" && after.position === "absolute") {
        const holder = getComputedStyle(el).position !== "static" ? el : el.offsetParent;
        if (holder instanceof HTMLElement) {
          const c = holder.getBoundingClientRect();
          const px = (v: string) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0);
          box.top = Math.min(box.top, c.top + px(after.top));
          box.bottom = Math.max(box.bottom, c.bottom - px(after.bottom));
          box.left = Math.min(box.left, c.left + px(after.left));
          box.right = Math.max(box.right, c.right - px(after.right));
        }
      }
      return { width: box.right - box.left, height: box.bottom - box.top };
    };

    const problems: string[] = [];
    const controls = document.querySelectorAll<HTMLElement>(
      'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="switch"], summary',
    );
    for (const el of controls) {
      const own = el.getBoundingClientRect();
      if (own.width === 0 || own.height === 0) continue;
      if (el.closest('[aria-hidden="true"], [inert]')) continue;
      if (getComputedStyle(el).visibility === "hidden") continue;

      // A radio or checkbox is tapped through its label (which may also
      // hide it, as the chips do).
      const choice = el instanceof HTMLInputElement && /^(radio|checkbox)$/.test(el.type);
      const target: HTMLElement | null = choice ? (el.closest("label") ?? el) : el;
      // Shown only on keyboard focus (the sheets' close button).
      if (!choice && (own.width <= 1 || own.height <= 1)) continue;
      if (
        target.tagName === "A" &&
        getComputedStyle(target).display === "inline" &&
        target.parentElement?.tagName === "P"
      ) {
        continue;
      }
      const min = target.tagName === "A" ? linkMin : 44;
      const { width, height } = hitRect(target);
      if (width + 0.5 < min || height + 0.5 < min) {
        const name = (target.getAttribute("aria-label") ?? target.textContent ?? "").trim();
        problems.push(
          `${target.tagName.toLowerCase()} "${name.slice(0, 30)}" ${Math.round(width)}×${Math.round(height)}`,
        );
      }
    }
    return problems;
  }, linkMin);
}

/**
 * Tabs through the page `steps` times and returns the focused elements that
 * show no focus indicator (no outline, ring or outlined ::after).
 */
export async function focusWithoutIndicator(page: Page, steps: number): Promise<string[]> {
  const missing: string[] = [];
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press("Tab");
    const problem = await page.evaluate(() => {
      const el = document.activeElement;
      if (!(el instanceof HTMLElement) || el === document.body) return null;
      const shown = (style: CSSStyleDeclaration) =>
        (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) ||
        style.boxShadow !== "none";
      if (shown(getComputedStyle(el)) || shown(getComputedStyle(el, "::after"))) return null;
      return `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)}"`;
    });
    if (problem) missing.push(problem);
  }
  return missing;
}
