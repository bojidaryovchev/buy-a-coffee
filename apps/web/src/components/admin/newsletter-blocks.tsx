"use client";

import { useRef, useState } from "react";
import { TEXTAREA_CLASS } from "@/components/forms/field-styles";
import { NewsletterProductPicker } from "@/components/admin/newsletter-product-picker";
import { TEXT_TOOLS, type Edit } from "@/components/admin/newsletter-edits";
import {
  blockId,
  insertBlock,
  moveBlock,
  parseBody,
  removeBlock,
  replaceBlock,
  serializeBody,
  type BodyBlock,
  type BodyModel,
} from "@/lib/newsletter/body-blocks";
import { BLOCK_KIND_NAMES, reportsFor } from "@/lib/newsletter/deliverability";
import type { PickerProduct } from "@/lib/newsletter/picker";
import type { BlockReport, ReportedProduct } from "@/lib/newsletter/product-blocks";
import {
  DEFAULT_BLOCK_PRODUCTS,
  MAX_BLOCK_PRODUCTS,
  MAX_LETTER_PRODUCTS,
  isListKind,
  isTokenLine,
  parseProductToken,
  planTokens,
  productTokenLine,
  type BlockState,
  type ProductToken,
} from "@/lib/newsletter/tokens";

/**
 * The letter as blocks: text, and the products between it — the composer's
 * main view of the body (`lib/newsletter/body-blocks.ts`).
 *
 * A text block is a textarea with the formatting buttons. A block of chosen
 * products is drawn as its products — photograph, the shop's name for it, the
 * price — each with "Махни", and "+ Добави" opens the product search for
 * more. A list of reductions (`[[промоции: адрес, …]]`, the monthly letter's)
 * is drawn the same way, says which of its products are no longer reduced,
 * and its search offers only reduced ones. The two automatic blocks show what
 * they would draw if the letter went now, which is not something to edit:
 * "Замени с избраните" turns one into a list of exactly those products —
 * reductions stay a list of reductions — which can then be edited. Every block moves
 * up and down and can be taken out, and new ones go in at the end.
 *
 * What a product block shows comes from the preview (`reports`, matched to a
 * block by its line) and from the search, kept by slug (`known`), so a block
 * redraws at once when a product is taken out, and the preview follows a
 * moment later. Every change is a change of the body, handed up whole
 * (`onChange`): the form still saves, previews, checks and sends the body,
 * and nothing else.
 */

const TOOL_BUTTON =
  "inline-flex min-h-9 min-w-9 items-center justify-center rounded-sm border border-line-strong bg-paper-raised px-2.5 text-sm text-ink-900 transition-colors hover:bg-paper-sunken disabled:cursor-not-allowed disabled:text-ink-500";
const LINK_BUTTON =
  "inline-flex min-h-9 items-center px-2 text-sm text-pine-700 underline underline-offset-2 disabled:cursor-not-allowed disabled:text-ink-500 disabled:no-underline";

export type KnownProducts = ReadonlyMap<string, ReportedProduct & { readonly soldOut?: boolean }>;

/** A product as the search found it, as a block draws it. */
export const fromPicker = (product: PickerProduct): ReportedProduct & { soldOut: boolean } => ({
  slug: product.slug,
  title: product.title,
  detail: product.detail,
  price: product.price,
  oldPrice: product.oldPrice,
  image: product.image,
  soldOut: product.soldOut,
});

function Thumb({ src }: { src: string | null | undefined }) {
  return src ? (
    <img
      src={src}
      alt=""
      width={48}
      height={48}
      className="size-12 shrink-0 rounded-sm border border-line bg-paper-raised object-contain"
    />
  ) : (
    <span className="size-12 shrink-0 rounded-sm border border-line bg-paper-sunken" />
  );
}

function Price({ product }: { product: ReportedProduct }) {
  if (!product.price) return <span className="text-ink-500">Цена при запитване</span>;
  return (
    <span className="tabular-nums">
      <span className={product.oldPrice ? "font-semibold text-clay-600" : "font-semibold"}>
        {product.price}
      </span>
      {product.oldPrice && (
        <span className="ml-1.5 text-ink-500 line-through">{product.oldPrice}</span>
      )}
    </span>
  );
}

const describe = (product: ReportedProduct) =>
  product.detail ? `${product.title}, ${product.detail}` : product.title;

/** One product of a block: what the owner knows it by, and why it will not show, if it will not. */
function ProductRow({
  product,
  slug,
  problem,
  onRemove,
}: {
  product: ReportedProduct | undefined;
  slug: string;
  /** Said under it in caution (or critical, for what stops the send). */
  problem: { text: string; stops: boolean } | null;
  onRemove?: () => void;
}) {
  const name = product ? describe(product) : slug;
  return (
    <li className="flex items-center gap-3 py-2" data-product={slug}>
      <Thumb src={product?.image} />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium break-words text-ink-900">{product?.title ?? slug}</p>
        {product?.detail && <p className="text-xs text-ink-500">{product.detail}</p>}
        {product && (
          <p className="text-sm">
            <Price product={product} />
          </p>
        )}
        {problem && (
          <p className={`text-xs font-medium ${problem.stops ? "text-critical" : "text-caution"}`}>
            {problem.text}
          </p>
        )}
      </div>
      {onRemove && (
        <button
          type="button"
          aria-label={`Махни: ${name}`}
          onClick={onRemove}
          className={LINK_BUTTON}
        >
          Махни
        </button>
      )}
    </li>
  );
}

function BlockFrame({
  title,
  index,
  count,
  onMove,
  onRemove,
  children,
  labelId,
}: {
  title: string;
  index: number;
  count: number;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  children: React.ReactNode;
  labelId: string;
}) {
  return (
    <li
      aria-labelledby={labelId}
      className="rounded-md border border-line bg-paper-raised p-3"
      data-block-kind={title}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={labelId} className="text-sm font-semibold text-ink-900">
          {title}
        </h3>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={index === 0}
            onClick={() => onMove(-1)}
            aria-label={`${title}: премести нагоре`}
            className={TOOL_BUTTON}
          >
            Нагоре
          </button>
          <button
            type="button"
            disabled={index === count - 1}
            onClick={() => onMove(1)}
            aria-label={`${title}: премести надолу`}
            className={TOOL_BUTTON}
          >
            Надолу
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`${title}: махни блока`}
            className={TOOL_BUTTON}
          >
            Махни блока
          </button>
        </div>
      </div>
      <div className="mt-2">{children}</div>
    </li>
  );
}

export function NewsletterBlocks({
  model,
  onChange,
  reports,
  previewing,
  known,
  onKnown,
  describedBy,
}: {
  model: BodyModel;
  onChange: (model: BodyModel) => void;
  /** What the last preview's blocks resolved to; null before it answered, or after it failed. */
  reports: readonly BlockReport[] | null;
  previewing: boolean;
  known: KnownProducts;
  onKnown: (products: readonly (ReportedProduct & { soldOut?: boolean })[]) => void;
  describedBy?: string;
}) {
  const areas = useRef(new Map<string, HTMLTextAreaElement>());
  /** The block "+ Добави" is open for, or "new" for the picker that adds a block. */
  const [picking, setPicking] = useState<string | null>(null);

  /* Each product block with what it asks for, how the letter treats it, and
     the preview's answer for it. */
  const productBlocks = model.blocks.filter(
    (block): block is Extract<BodyBlock, { kind: "products" }> => block.kind === "products",
  );
  const tokens = productBlocks.map((block) => parseProductToken(block.line)!);
  const states = planTokens(tokens);
  const answers = reportsFor(tokens, reports);
  const facts = new Map<
    string,
    { token: ProductToken; state: BlockState; report: BlockReport | null }
  >(
    productBlocks.map((block, index) => [
      block.id,
      { token: tokens[index]!, state: states[index]!, report: answers[index] ?? null },
    ]),
  );

  const change = (next: BodyModel) => onChange(next);
  const setText = (index: number, block: BodyBlock, text: string) => {
    const next = replaceBlock(model, index, { id: block.id, kind: "text", text });
    /* A product line typed into a text block is a product block in the
       letter; read the body again so the blocks say what the letter will. */
    const typedLine = text.split(/\r\n|\r|\n/).some((line) => isTokenLine(line));
    change(typedLine ? parseBody(serializeBody(next)) : next);
  };
  const setLine = (index: number, block: BodyBlock, line: string) =>
    change(replaceBlock(model, index, { id: block.id, kind: "products", line }));

  const apply = (index: number, block: BodyBlock, edit: Edit) => {
    const area = areas.current.get(block.id);
    if (!area || block.kind !== "text") return;
    const result = edit(area.value, area.selectionStart, area.selectionEnd);
    setText(index, block, result.text);
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
  };

  const append = (block: BodyBlock) => {
    change(insertBlock(model, model.blocks.length, block));
  };

  const used = tokens.reduce(
    (sum, token, index) =>
      sum +
      (states[index] === "shown" && token.spec
        ? isListKind(token.spec.kind)
          ? (token.spec as { slugs: readonly string[] }).slugs.length
          : (token.spec as { limit: number }).limit
        : 0),
    0,
  );

  return (
    <div>
      {model.blocks.length === 0 ? (
        <p className="rounded-md border border-dashed border-line-strong bg-paper-raised p-6 text-center text-sm text-ink-500">
          Писмото е празно. Добавете текст или продукти отдолу.
        </p>
      ) : (
        <ol className="flex flex-col gap-3" aria-describedby={describedBy}>
          {model.blocks.map((block, index) => {
            const labelId = `${block.id}-title`;
            const frame = {
              index,
              count: model.blocks.length,
              onMove: (direction: -1 | 1) => change(moveBlock(model, index, direction)),
              onRemove: () => change(removeBlock(model, index)),
              labelId,
            };

            if (block.kind === "text") {
              return (
                <BlockFrame key={block.id} title="Текст" {...frame}>
                  <div
                    role="toolbar"
                    aria-label="Форматиране"
                    className="mb-1.5 flex flex-wrap gap-1.5"
                  >
                    {TEXT_TOOLS.map((tool) => (
                      <button
                        key={tool.label}
                        type="button"
                        title={tool.title}
                        onClick={() => apply(index, block, tool.edit)}
                        className={TOOL_BUTTON}
                      >
                        {tool.label}
                      </button>
                    ))}
                  </div>
                  <textarea
                    ref={(element) => {
                      if (element) areas.current.set(block.id, element);
                      else areas.current.delete(block.id);
                    }}
                    aria-labelledby={labelId}
                    value={block.text}
                    onChange={(event) => setText(index, block, event.currentTarget.value)}
                    rows={Math.min(14, Math.max(3, block.text.split("\n").length + 1))}
                    placeholder="Здравейте, …"
                    className={`${TEXTAREA_CLASS} leading-relaxed`}
                  />
                </BlockFrame>
              );
            }

            const fact = facts.get(block.id)!;
            const spec = fact.token.spec;
            if (!spec) {
              return (
                <BlockFrame key={block.id} title="Неразпознат блок" {...frame}>
                  <p className="text-sm text-critical">
                    <code className="font-mono">{block.line}</code> — {fact.token.problem}
                  </p>
                  <p className="mt-1 text-xs text-ink-500">
                    Поправете го в „Markdown“ или го махнете. Докато е в писмото, изпращането не
                    започва.
                  </p>
                </BlockFrame>
              );
            }

            const title =
              spec.kind === "picked"
                ? BLOCK_KIND_NAMES.picked
                : spec.kind === "reduced"
                  ? `${BLOCK_KIND_NAMES.reduced} · избрани`
                  : `${BLOCK_KIND_NAMES[spec.kind]} · автоматично`;
            const overCap =
              fact.state === "over-cap" ? (
                <p className="mb-2 text-sm font-medium text-critical">
                  Не се показва: блоковете над него вече дават {MAX_LETTER_PRODUCTS} продукта,
                  колкото побира едно писмо. Махнете го или намалете другите.
                </p>
              ) : null;

            if (spec.kind === "picked" || spec.kind === "reduced") {
              const report = fact.report;
              const listKind = spec.kind;
              const left = (slug: string) => {
                const slugs = spec.slugs.filter((item) => item !== slug);
                if (slugs.length === 0) change(removeBlock(model, index));
                else setLine(index, block, productTokenLine({ kind: listKind, slugs }));
              };
              const problemOf = (slug: string) => {
                if (report?.missing.includes(slug)) {
                  return {
                    text: "Няма продукт с този адрес — изпращането няма да започне.",
                    stops: true,
                  };
                }
                if (report?.notReduced?.some((item) => item.slug === slug)) {
                  return {
                    text: "Вече не е намален — изпращането няма да започне.",
                    stops: true,
                  };
                }
                if (
                  report?.soldOut?.some((item) => item.slug === slug) ||
                  (!report && known.get(slug)?.soldOut)
                ) {
                  return { text: "Изчерпан — няма да се покаже в писмото.", stops: false };
                }
                if (report?.gone?.includes(slug)) {
                  return {
                    text: "Вече не се продава — няма да се покаже в писмото.",
                    stops: false,
                  };
                }
                return null;
              };
              const room = MAX_BLOCK_PRODUCTS - spec.slugs.length;
              return (
                <BlockFrame key={block.id} title={title} {...frame}>
                  {overCap}
                  <ul className="flex flex-col divide-y divide-line">
                    {spec.slugs.map((slug) => (
                      <ProductRow
                        key={slug}
                        slug={slug}
                        product={
                          report?.products.find((product) => product.slug === slug) ??
                          known.get(slug)
                        }
                        problem={problemOf(slug)}
                        onRemove={() => left(slug)}
                      />
                    ))}
                  </ul>
                  {fact.token.invalid.length > 0 && (
                    <p className="mt-1 text-sm text-critical">
                      Не е адрес на продукт:{" "}
                      {fact.token.invalid.map((item) => `„${item}“`).join(", ")}. Поправете го в
                      „Markdown“.
                    </p>
                  )}
                  <div className="mt-2">
                    <button
                      type="button"
                      disabled={room <= 0}
                      aria-expanded={picking === block.id}
                      onClick={() => setPicking((open) => (open === block.id ? null : block.id))}
                      className={`${TOOL_BUTTON} aria-expanded:border-pine-700 aria-expanded:bg-pine-100`}
                    >
                      + Добави
                    </button>
                    {room <= 0 && (
                      <span className="ml-2 text-xs text-ink-500">
                        Един блок показва до {MAX_BLOCK_PRODUCTS} продукта.
                      </span>
                    )}
                  </div>
                  {picking === block.id && (
                    <NewsletterProductPicker
                      max={room}
                      exclude={spec.slugs}
                      onlyReduced={listKind === "reduced"}
                      insertLabel={(count) => (count > 1 ? `Добави ${count} продукта` : "Добави")}
                      onClose={() => setPicking(null)}
                      onInsert={(products) => {
                        setPicking(null);
                        onKnown(products.map(fromPicker));
                        setLine(
                          index,
                          block,
                          productTokenLine({
                            kind: listKind,
                            slugs: [...spec.slugs, ...products.map((product) => product.slug)],
                          }),
                        );
                      }}
                    />
                  )}
                </BlockFrame>
              );
            }

            /* An automatic block: what it would draw now, read-only. */
            const report = fact.report;
            const now =
              fact.state !== "shown" ? null : report ? (
                report.products.length > 0 ? (
                  <ul className="flex flex-col divide-y divide-line">
                    {report.products.map((product) => (
                      <ProductRow
                        key={product.slug}
                        slug={product.slug}
                        product={product}
                        problem={null}
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-caution">
                    Сега няма такива продукти — секцията няма да се покаже.
                  </p>
                )
              ) : (
                <p className="text-sm text-ink-500">
                  {previewing ? "Обновява се…" : "Прегледът не можа да покаже продуктите."}
                </p>
              );
            return (
              <BlockFrame key={block.id} title={title} {...frame}>
                {overCap}
                <p className="mb-1 text-xs text-ink-500">
                  {spec.kind === "new"
                    ? "Най-новите продукти, които могат да се поръчат"
                    : "Продуктите с най-голямо намаление, които могат да се поръчат"}
                  {spec.limit !== DEFAULT_BLOCK_PRODUCTS ? ` (до ${spec.limit})` : ""}. Взимат се в
                  момента на изпращането; сега това са:
                </p>
                {now}
                <div className="mt-2">
                  <button
                    type="button"
                    disabled={!report || report.products.length === 0}
                    onClick={() => {
                      if (!report) return;
                      onKnown(report.products);
                      /* Reductions stay reductions: frozen, the list is still
                         checked at the send for every product being reduced. */
                      setLine(
                        index,
                        block,
                        productTokenLine({
                          kind: spec.kind === "sale" ? "reduced" : "picked",
                          slugs: report.products.map((product) => product.slug),
                        }),
                      );
                    }}
                    className={TOOL_BUTTON}
                  >
                    Замени с избраните
                  </button>
                  <span className="ml-2 text-xs text-ink-500">
                    Превръща ги в списък, от който можете да махате и добавяте.
                  </span>
                </div>
              </BlockFrame>
            );
          })}
        </ol>
      )}

      <div
        role="toolbar"
        aria-label="Добави блок"
        className="mt-3 flex flex-wrap items-center gap-1.5"
      >
        <span className="mr-1 text-sm text-ink-700">Добави:</span>
        <button
          type="button"
          onClick={() => append({ id: blockId(), kind: "text", text: "" })}
          className={TOOL_BUTTON}
        >
          Текст
        </button>
        <button
          type="button"
          aria-expanded={picking === "new"}
          disabled={used >= MAX_LETTER_PRODUCTS}
          onClick={() => setPicking((open) => (open === "new" ? null : "new"))}
          className={`${TOOL_BUTTON} aria-expanded:border-pine-700 aria-expanded:bg-pine-100`}
        >
          Продукти…
        </button>
        <button
          type="button"
          title="Най-новите продукти, които могат да се поръчат, взети при изпращането"
          onClick={() =>
            append({
              id: blockId(),
              kind: "products",
              line: productTokenLine({ kind: "new", limit: DEFAULT_BLOCK_PRODUCTS }),
            })
          }
          className={TOOL_BUTTON}
        >
          Нови продукти
        </button>
        <button
          type="button"
          title="Продуктите с най-голямо намаление, взети при изпращането"
          onClick={() =>
            append({
              id: blockId(),
              kind: "products",
              line: productTokenLine({ kind: "sale", limit: DEFAULT_BLOCK_PRODUCTS }),
            })
          }
          className={TOOL_BUTTON}
        >
          Промоции
        </button>
      </div>
      {picking === "new" && (
        <NewsletterProductPicker
          max={Math.min(MAX_BLOCK_PRODUCTS, MAX_LETTER_PRODUCTS - used)}
          insertLabel={(count) => (count > 1 ? `Добави ${count} продукта` : "Добави")}
          onClose={() => setPicking(null)}
          onInsert={(products) => {
            setPicking(null);
            onKnown(products.map(fromPicker));
            append({
              id: blockId(),
              kind: "products",
              line: productTokenLine({
                kind: "picked",
                slugs: products.map((product) => product.slug),
              }),
            });
          }}
        />
      )}
    </div>
  );
}
