// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MarkdownText, safeHref } from "@/components/articles/markdown";
import { articleHighlights, plainText } from "@/lib/articles/highlights";
import { adminEditErrorFor } from "@/lib/admin/edit-errors";
import { readMinutes } from "@/lib/articles/read-time";
import { saveArticleSchema, saveCategorySchema, slugSchema } from "@/lib/schemas/article";

function render(markdown: string) {
  const template = document.createElement("template");
  template.innerHTML = renderToStaticMarkup(<MarkdownText>{markdown}</MarkdownText>);
  return template.content;
}

describe("readMinutes", () => {
  it("is words ÷ 150, rounded, at least 1 (as articles.read_minutes)", () => {
    expect(readMinutes("")).toBe(1);
    expect(readMinutes("كلمة")).toBe(1);
    expect(readMinutes("كلمة ".repeat(224))).toBe(1);
    expect(readMinutes("كلمة ".repeat(225))).toBe(2);
    expect(readMinutes(`${"كلمة ".repeat(300)}\n\n- ${"كلمة ".repeat(74)}`)).toBe(3);
    expect(readMinutes("كلمة\n".repeat(500))).toBe(3);
  });
});

describe("articleHighlights", () => {
  it("takes the first numbered list, up to 5 items, as plain text", () => {
    const body = [
      "مقدمة قصيرة.",
      "",
      "## العلامات",
      "",
      "1. ريحة **غريبة**",
      "2. لون [عكر](https://example.com)",
      "3. ثالث",
      "4. رابع",
      "5. خامس",
      "6. سادس",
    ].join("\n");
    expect(articleHighlights(body)).toEqual({
      kind: "list",
      items: ["ريحة غريبة", "لون عكر", "ثالث", "رابع", "خامس"],
    });
  });

  it("stops at the end of the first list", () => {
    expect(articleHighlights("1. أول\n2. ثاني\n\nنص\n\n1. غيره")).toEqual({
      kind: "list",
      items: ["أول", "ثاني"],
    });
  });

  it("otherwise takes the first paragraph, skipping headings and bullet lists", () => {
    expect(articleHighlights("## عنوان\n\n- نقطة\n\nسطر *أول*\nسطر ثاني\n\nفقرة ثانية")).toEqual({
      kind: "text",
      text: "سطر أول سطر ثاني",
    });
  });

  it("is null for an empty body", () => {
    expect(articleHighlights("  \n\n## عنوان فقط")).toBeNull();
  });

  it("plainText drops marks and HTML, keeps link words", () => {
    expect(plainText("**غامق** و _مائل_ و `كود` <b>x</b> [رابط](/x) ![صورة](/y.png)")).toBe(
      "غامق و مائل و كود x رابط صورة",
    );
  });
});

describe("safeHref", () => {
  it("keeps http(s), tel and same-site paths", () => {
    expect(safeHref("https://example.com/a")).toBe("https://example.com/a");
    expect(safeHref("http://example.com")).toBe("http://example.com");
    expect(safeHref("tel:+9647801234567")).toBe("tel:+9647801234567");
    expect(safeHref("/book")).toBe("/book");
  });

  it("drops everything else", () => {
    for (const url of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      " javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "mailto:a@example.com",
      "//evil.example",
      "/\\evil.example",
      "relative/path",
      "#top",
      "https:evil",
      "java\tscript:alert(1)",
      "",
      undefined,
    ]) {
      expect(safeHref(url), String(url)).toBeNull();
    }
  });
});

describe("MarkdownText", () => {
  it("renders headings, lists, emphasis and quotes with h1 as h2", () => {
    const doc = render(
      "# عنوان\n\n### فرعي\n\nنص **غامق** و *مائل*\n\n1. أول\n2. ثاني\n\n- نقطة\n\n> اقتباس\n\n---",
    );
    expect(doc.querySelector("h1")).toBeNull();
    expect(doc.querySelector("h2")?.textContent).toBe("عنوان");
    expect(doc.querySelector("h3")?.textContent).toBe("فرعي");
    expect(doc.querySelectorAll("ol li")).toHaveLength(2);
    expect(doc.querySelectorAll("ul li")).toHaveLength(1);
    expect(doc.querySelector("strong")?.textContent).toBe("غامق");
    expect(doc.querySelector("em")?.textContent).toBe("مائل");
    expect(doc.querySelector("blockquote")?.textContent?.trim()).toBe("اقتباس");
    expect(doc.querySelector("hr")).not.toBeNull();
    expect(doc.querySelector("[node]")).toBeNull();
  });

  it("drops raw HTML, scripts and event handlers", () => {
    const doc = render(
      'قبل <script>alert(1)</script> <img src=x onerror="alert(1)"> <b onclick="x()">بعد</b>\n\n<div>كتلة</div>',
    );
    const html = (doc.firstChild as HTMLElement).innerHTML;
    expect(doc.querySelector("script, img, b, div div")).toBeNull();
    expect(html).not.toMatch(/onerror|onclick|<script/i);
    expect(doc.textContent).toContain("قبل");
    expect(doc.textContent).toContain("بعد");
  });

  it("unwraps images, code and other elements to their text", () => {
    const doc = render("![بديل](https://example.com/x.png) `كود` \n\n```\nكتلة كود\n```");
    expect(doc.querySelector("img, code, pre")).toBeNull();
    expect(doc.textContent).toContain("كود");
    expect(doc.textContent).toContain("كتلة كود");
  });

  it("keeps safe links, opens external ones in a new tab, drops unsafe ones", () => {
    const doc = render(
      [
        "[داخلي](/book)",
        "[خارجي](https://example.com)",
        "[سيئ](javascript:alert(1))",
        "[مشفر](&#106;avascript:alert(1))",
        "[بيانات](data:text/html;base64,PHNjcmlwdD4=)",
        "<javascript:alert(1)>",
        "<https://example.com/auto>",
      ].join("\n\n"),
    );
    const links = [...doc.querySelectorAll("a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/book",
      "https://example.com",
      "https://example.com/auto",
    ]);
    expect(links[0]?.getAttribute("target")).toBeNull();
    expect(links[1]?.getAttribute("target")).toBe("_blank");
    expect(links[1]?.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect(doc.textContent).toContain("سيئ");
    expect(doc.textContent).toContain("مشفر");
    // A dropped autolink keeps its words as text, never as a link.
    expect((doc.firstChild as HTMLElement).innerHTML).not.toMatch(/href="(javascript|data)/i);
  });
});

describe("article schemas", () => {
  const base = {
    id: null,
    slug: "tank-lid",
    title: "غطاء الخزان مهم",
    categoryId: 1,
    coverPath: null,
    body: "",
    featured: false,
    status: "draft" as const,
  };

  it("takes a Latin slug, lowercased and trimmed", () => {
    expect(slugSchema.parse("  Tank-Lid ")).toBe("tank-lid");
    for (const bad of ["ab", "tank lid", "tank--lid", "-tank", "خزان", "a".repeat(81)]) {
      expect(slugSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("saves an empty draft but publishes only with a body", () => {
    expect(saveArticleSchema.safeParse(base).success).toBe(true);
    expect(saveArticleSchema.safeParse({ ...base, status: "published" }).success).toBe(false);
    expect(saveArticleSchema.safeParse({ ...base, status: "published", body: "نص" }).success).toBe(
      true,
    );
  });

  it("takes covers only from articles/", () => {
    expect(saveArticleSchema.safeParse({ ...base, coverPath: "articles/x.webp" }).success).toBe(
      true,
    );
    for (const bad of ["x.webp", "articles/a/x.webp", "brand/x.webp"]) {
      expect(saveArticleSchema.safeParse({ ...base, coverPath: bad }).success, bad).toBe(false);
    }
  });

  it("trims and checks category names", () => {
    expect(saveCategorySchema.parse({ id: null, name: "  صحة  ", icon: "droplet" }).name).toBe(
      "صحة",
    );
    expect(saveCategorySchema.safeParse({ id: null, name: "ص", icon: "droplet" }).success).toBe(
      false,
    );
    expect(saveCategorySchema.safeParse({ id: null, name: "صحة", icon: "star" }).success).toBe(
      false,
    );
  });

  it("maps the A11 error codes", () => {
    expect(adminEditErrorFor({ code: "ZL009" })).toBe("upload_not_found");
    expect(adminEditErrorFor({ code: "ZL030" })).toBe("category_in_use");
    expect(adminEditErrorFor({ code: "ZL031" })).toBe("slug_taken");
    expect(adminEditErrorFor({ code: "ZL032" })).toBe("slug_locked");
    expect(adminEditErrorFor({ code: "ZL033" })).toBe("category_name_taken");
    expect(adminEditErrorFor({ code: "22023", message: "invalid_order" })).toBe("invalid");
  });
});

describe("articleHighlights, harder lists", () => {
  it("reads loose lists and wrapped items", () => {
    expect(articleHighlights("1. أول\n\n2. ثاني\n   يكمل هنا\n\n3. ثالث\n\nفقرة")).toEqual({
      kind: "list",
      items: ["أول", "ثاني يكمل هنا", "ثالث"],
    });
  });

  it("keeps comparisons, inner underscores and escaped marks", () => {
    expect(plainText("الحرارة < 50 و > 30")).toBe("الحرارة < 50 و > 30");
    expect(plainText("file_name و _مائل_")).toBe("file_name و مائل");
    expect(plainText("نجمة \\* و \\_ هنا")).toBe("نجمة * و _ هنا");
  });
});
