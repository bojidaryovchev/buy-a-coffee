import Link from "next/link";
import type { ReactNode } from "react";
import { ButtonLink, cx } from "@/components/ui/primitives";
import { siteConfig } from "@/config/site";
import type { Block, InlineContent } from "@/lib/journal";

/**
 * Renders an article body.
 *
 * One component for the whole block format, and a server component with no
 * client code in it: an article is text, links and the occasional table, so it
 * arrives as finished HTML and works with JavaScript off.
 *
 * Every block maps to the element that means what it says — `p`, `h2`/`h3`,
 * `ul`/`ol`, `table` with a `caption` and scoped headers, `aside` for a
 * callout. The heading levels come straight from the block, and the block type
 * cannot express an `h1`, so the page's single `h1` stays the article title.
 *
 * The `switch` statements have no default on purpose. Adding a block type
 * without teaching this component to draw it is a type error here, not a
 * paragraph that quietly disappears from a published article.
 */

const LINK_CLASS = "text-pine-700 underline underline-offset-2 hover:text-pine-900";

function InlineRun({ content }: { content: InlineContent }): ReactNode {
  return content.map((node, index) => {
    if (typeof node === "string") return node;

    switch (node.type) {
      case "link":
        return (
          <Link key={index} href={node.href} className={LINK_CLASS}>
            {node.text}
          </Link>
        );
      case "strong":
        return (
          <strong key={index} className="font-semibold text-ink-900">
            {node.text}
          </strong>
        );
      case "phone":
        // Rendered from the site configuration so no article carries the number.
        return (
          <a
            key={index}
            href={`tel:${siteConfig.contact.phoneHref}`}
            className={cx(LINK_CLASS, "whitespace-nowrap")}
          >
            {siteConfig.contact.phone}
          </a>
        );
    }
  });
}

function BlockView({ block }: { block: Block }): ReactNode {
  switch (block.type) {
    case "paragraph":
      return (
        <p>
          <InlineRun content={block.content} />
        </p>
      );

    case "heading":
      return block.level === 2 ? (
        <h2 className="pt-6 font-display text-2xl font-semibold text-ink-900">{block.text}</h2>
      ) : (
        <h3 className="pt-2 font-display text-lg font-semibold text-ink-900">{block.text}</h3>
      );

    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag className={cx("space-y-2 pl-5", block.ordered ? "list-decimal" : "list-disc")}>
          {block.items.map((item, index) => (
            <li key={index} className="pl-1">
              <InlineRun content={item} />
            </li>
          ))}
        </Tag>
      );
    }

    case "callout":
      return (
        <aside
          className={cx(
            "rounded-md border px-4 py-3 text-sm",
            block.tone === "caution"
              ? "border-clay-500/40 bg-clay-100 text-ink-900"
              : "border-line bg-paper-sunken text-ink-700",
          )}
        >
          {block.title && <p className="font-semibold text-ink-900">{block.title}</p>}
          <p className={cx(block.title && "mt-1")}>
            <InlineRun content={block.content} />
          </p>
        </aside>
      );

    case "table":
      return (
        <figure>
          {/* A wide table scrolls inside its own box rather than pushing the
              page sideways on a phone. The box is focusable so a keyboard user
              can scroll it too. */}
          <div
            role="region"
            aria-label={block.caption}
            tabIndex={0}
            className="overflow-x-auto rounded-md border border-line bg-paper-raised"
          >
            <table className="w-full border-collapse text-left text-sm">
              <caption className="border-b border-line px-4 py-3 text-left font-medium text-ink-900">
                {block.caption}
              </caption>
              <thead>
                <tr>
                  {block.columns.map((column, index) => (
                    <th
                      key={index}
                      scope="col"
                      className="border-b border-line px-4 py-2 text-2xs font-medium tracking-wide text-ink-500 uppercase"
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="border-b border-line last:border-b-0">
                    {row.map((cell, cellIndex) =>
                      cellIndex === 0 ? (
                        <th
                          key={cellIndex}
                          scope="row"
                          className="px-4 py-2 font-medium text-ink-900"
                        >
                          <InlineRun content={cell} />
                        </th>
                      ) : (
                        <td key={cellIndex} className="px-4 py-2 text-ink-700">
                          <InlineRun content={cell} />
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {block.note && (
            <figcaption className="mt-2 text-xs text-ink-500">{block.note}</figcaption>
          )}
        </figure>
      );

    case "action":
      return (
        <p className="flex flex-wrap gap-3 pt-2">
          {block.links.map((entry, index) => (
            <ButtonLink
              key={entry.href}
              href={entry.href}
              variant={index === 0 ? "primary" : "secondary"}
            >
              {entry.label}
            </ButtonLink>
          ))}
        </p>
      );
  }
}

export function ArticleBody({ blocks }: { blocks: readonly Block[] }) {
  return (
    <div className="max-w-prose space-y-4 text-base leading-relaxed text-ink-700">
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} />
      ))}
    </div>
  );
}
