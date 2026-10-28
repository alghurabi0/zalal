import type { ComponentProps } from "react";
import Markdown, { type Components, defaultUrlTransform } from "react-markdown";

import { cn } from "@/lib/cn";

/**
 * Admin-written Markdown (articles, later Terms and Privacy), rendered as
 * React elements, so nothing is ever set as HTML. The same component renders
 * N9 on the server and A11's preview in the browser. Safety rules:
 *
 * - raw HTML is dropped (`skipHtml`, no rehype-raw);
 * - only text elements are kept: paragraphs, headings, lists, emphasis,
 *   links, quotes and rules; anything else (images, code, tables) is
 *   unwrapped to its text. `#` headings take the h2 style, deeper ones h3;
 * - links keep only http(s):, tel: and paths on this site (`safeHref`), and
 *   links off the site open in a new tab without referrer or opener.
 */
const allowedElements = [
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "a",
  "blockquote",
  "hr",
  "br",
];

/**
 * The link target to keep, or null to drop the link and keep its words:
 * https:, http: and tel: links, and paths on this site ("/tips").
 * Everything else (javascript:, data:, mailto:, //host, relative paths,
 * anything with control characters) goes.
 */
export function safeHref(url: string | undefined | null): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (/^tel:\+?[0-9][0-9 -]{2,20}$/i.test(trimmed)) return trimmed;
  // react-markdown's own filter: it drops every scheme but http(s), mailto and a few more.
  const href = defaultUrlTransform(trimmed);
  if (!href || /[\u0000-\u001f\u007f\\]/.test(href)) return null;
  if (href.startsWith("/")) return href.startsWith("//") ? null : href;
  return /^https?:\/\/[^/]/i.test(href) ? href : null;
}

const components: Components = {
  h1: Heading2,
  h2: Heading2,
  h3: Heading3,
  h4: Heading3,
  h5: Heading3,
  h6: Heading3,
  p: (props) => <p {...dom(props)} />,
  ul: (props) => <ul {...dom(props)} className="flex list-disc flex-col gap-1.5 ps-5" />,
  ol: (props) => <ol {...dom(props)} className="flex list-decimal flex-col gap-1.5 ps-5" />,
  li: (props) => <li {...dom(props)} className="ps-1" />,
  strong: (props) => <strong {...dom(props)} className="font-extrabold text-navy" />,
  blockquote: (props) => (
    <blockquote {...dom(props)} className="border-s-4 border-aqua ps-3 text-muted" />
  ),
  hr: () => <hr className="border-divider" />,
  a: ({ href, children }) => {
    const safe = safeHref(href);
    if (!safe) return <>{children}</>;
    const external = !safe.startsWith("/");
    return (
      <a
        href={safe}
        className="font-bold text-teal underline underline-offset-2 hover:text-navy"
        {...(external ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {})}
      >
        {children}
      </a>
    );
  },
};

/** The element's own props: react-markdown also passes its syntax tree node. */
function dom<T extends { node?: unknown }>(props: T): Omit<T, "node"> {
  const { node, ...rest } = props;
  void node;
  return rest;
}

function Heading2(props: ComponentProps<"h2"> & { node?: unknown }) {
  return <h2 {...dom(props)} className="pt-2 text-18 leading-snug font-extrabold text-navy" />;
}

function Heading3(props: ComponentProps<"h3"> & { node?: unknown }) {
  return <h3 {...dom(props)} className="pt-1 text-16 leading-snug font-extrabold text-navy" />;
}

export function MarkdownText({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3 text-16 leading-body text-body-2", className)}>
      <Markdown
        skipHtml
        allowedElements={allowedElements}
        unwrapDisallowed
        // Links are checked in the `a` component, which keeps the words of a dropped link.
        urlTransform={(url) => url}
        components={components}
      >
        {children}
      </Markdown>
    </div>
  );
}
