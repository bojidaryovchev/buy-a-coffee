"use client";

import { useEffect, useMemo, useState } from "react";
import type { PromotionTargets } from "@catalog/db/schema";
import { FieldError } from "@/components/forms/field-error";
import { HELPER_CLASS, INPUT_CLASS, LABEL_CLASS } from "@/components/forms/field-styles";
import { useActionForm } from "@/components/forms/use-schema-form";
import { PromotionProductPicker } from "@/components/admin/promotion-product-picker";
import { Badge, buttonClasses } from "@/components/ui/primitives";
import { savePromotion, type PromotionFormState } from "@/lib/promotions/actions";
import {
  addDays,
  daysBetween,
  endOfMonth,
  formatDay,
  formatDayRange,
  isDay,
  periodLength,
  type Day,
} from "@/lib/promotions/days";
import {
  chosenProductText,
  type ChosenProduct,
  type PromotionPickerProduct,
} from "@/lib/promotions/picker";
import type { PromotionPreview } from "@/lib/promotions/preview";
import {
  PROMOTION_LABEL_MAX,
  PROMOTION_MAX_DAYS,
  PROMOTION_MAX_LEAD_DAYS,
  PROMOTION_MAX_PERCENT,
  PROMOTION_NAME_MAX,
  PROMOTION_PRESETS,
  hasInclusion,
  needsConfirmation,
  parsePercent,
  promotionFormSchema,
  type PromotionFormMode,
} from "@/lib/promotions/schemas";
import { productsWord } from "@/lib/promotions/status";

/**
 * The promotion editor: a name, the words customers see, the percentage, the
 * days, what it covers — and, beside them, what the shop will show for every
 * product it covers, worked out on the server as the owner chooses.
 *
 * Built like the newsletter composer (`newsletter-composer.tsx`): a real form
 * posting to a server action (`savePromotion`), validated in the browser with
 * the schema the action checks with, keeping what was chosen when the server
 * says no. What it adds:
 *
 *   - The percentage as one press (5 to 30) or a number typed, and above 20%
 *     a box to tick, "Да, 30% е правилно", that the server asks for too: a
 *     typo there costs the owner's margin on every sale.
 *   - Days with shortcuts. The choice is days, in Sofia, both ends included;
 *     `lib/promotions/days.ts` turns it into the instants the shop compares.
 *   - What it covers as brands, categories (a category takes its
 *     subcategories with it) and single products, less exclusions — kept as
 *     the owner chose them, in one hidden field, and resolved into products
 *     by the server.
 *   - A preview from `/api/admin/promotions/preview`, a moment after any
 *     change: how many products, each one's price now and in the promotion,
 *     the struck price and the badge as the shop will draw them, and why a
 *     badge is smaller or missing.
 *
 * A running promotion keeps its percentage and its first day: they are shown,
 * not offered, and the action refuses a change to them.
 */

export interface BrandOption {
  readonly id: string;
  readonly name: string;
  readonly count: number;
  /** No longer in the supplier's catalog; shown only because it is chosen. */
  readonly inactive?: boolean;
}

export interface CategoryOption {
  readonly id: string;
  readonly name: string;
  /** Products on sale in it and every category below it. */
  readonly count: number;
  readonly children: readonly CategoryOption[];
  /** No longer in the supplier's catalog; shown only because it is chosen. */
  readonly inactive?: boolean;
}

/** " — неактивна", for a brand or category the supplier no longer lists. */
function InactiveMark({ inactive }: { inactive?: boolean }) {
  if (!inactive) return null;
  return <span className="text-xs font-semibold text-caution"> — неактивна</span>;
}

export type { ChosenProduct } from "@/lib/promotions/picker";

export interface PromotionFormValues {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly label: string;
  readonly percent: string;
  readonly startDay: Day;
  readonly endDay: Day;
  readonly targets: PromotionTargets;
}

const fieldErrorsOf = (state: PromotionFormState) => state.fieldErrors;

const SECTION = "rounded-md border border-line bg-paper-raised p-4 sm:p-5";
const LEGEND = "px-1 font-display text-lg font-semibold text-ink-900";
const SUBHEADING = "text-sm font-semibold text-ink-900";
const CHECKBOX = "size-5 shrink-0 accent-pine-900";
const COUNT = "text-xs text-ink-500 tabular-nums";

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("bg-BG", { hour: "2-digit", minute: "2-digit" });

/** Every category id below `node`. */
function descendants(node: CategoryOption): string[] {
  return node.children.flatMap((child) => [child.id, ...descendants(child)]);
}

function CategoryTree({
  nodes,
  selected,
  covered,
  onToggle,
}: {
  nodes: readonly CategoryOption[];
  selected: ReadonlySet<string>;
  /** The name of the chosen category above, which already covers these. */
  covered: string | null;
  onToggle: (node: CategoryOption) => void;
}) {
  return (
    <ul className="flex flex-col">
      {nodes.map((node) => {
        const checked = covered !== null || selected.has(node.id);
        return (
          <li key={node.id}>
            <label className="flex min-h-11 items-center gap-2 text-sm text-ink-900">
              <input
                type="checkbox"
                checked={checked}
                disabled={covered !== null}
                onChange={() => onToggle(node)}
                className={CHECKBOX}
              />
              <span>
                {node.name}{" "}
                <span className={COUNT}>
                  {node.count}
                  <span className="sr-only"> {productsWord(node.count)}</span>
                </span>
                <InactiveMark inactive={node.inactive} />
                {covered !== null && (
                  <span className="text-xs text-ink-500"> — влиза с „{covered}“</span>
                )}
              </span>
            </label>
            {node.children.length > 0 && (
              <div className="pl-7">
                <CategoryTree
                  nodes={node.children}
                  selected={selected}
                  covered={covered ?? (selected.has(node.id) ? node.name : null)}
                  onToggle={onToggle}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ChosenProducts({
  ids,
  names,
  onRemove,
  empty,
}: {
  ids: readonly string[];
  names: Readonly<Record<string, ChosenProduct>>;
  onRemove: (id: string) => void;
  empty: string;
}) {
  if (ids.length === 0) return <p className="mt-1 text-sm text-ink-500">{empty}</p>;
  return (
    <ul className="mt-1 flex flex-col divide-y divide-line">
      {ids.map((id) => {
        const product = names[id];
        const text = chosenProductText(product);
        return (
          <li key={id} className="flex items-center gap-2 py-1.5 text-sm">
            <span className="min-w-0 flex-1 break-words text-ink-900">{text}</span>
            <button
              type="button"
              aria-label={`Махни: ${text}`}
              onClick={() => onRemove(id)}
              className="min-h-11 px-2 text-sm text-pine-700 underline underline-offset-2 lg:min-h-9"
            >
              Махни
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function PreviewPanel({
  preview,
  state,
  message,
}: {
  preview: PromotionPreview | null;
  state: "idle" | "loading" | "error";
  message: string | null;
}) {
  const line =
    message ??
    (state === "loading"
      ? "Обновява се…"
      : state === "error"
        ? "Прегледът не можа да се обнови. Изборът ви е запазен във формата."
        : "Цените, както ще ги вижда купувачът, ако запазите сега.");
  return (
    /* Beside the form on a wide screen, and kept in view while the form,
       which is long, scrolls past it. */
    <section
      aria-labelledby="preview-title"
      className="min-w-0 xl:sticky xl:top-4 xl:max-h-[calc(100dvh-2rem)] xl:self-start xl:overflow-y-auto"
    >
      <h2 id="preview-title" className="font-display text-xl font-semibold text-ink-900">
        Как ще изглежда в магазина
      </h2>
      <p className="mt-1 text-xs text-ink-500" aria-live="polite">
        {line}
      </p>

      {preview && message === null && (
        <div className="mt-3">
          <p className="text-lg font-semibold text-ink-900">
            {preview.percentOff === null
              ? `${preview.total} ${productsWord(preview.total)} — изберете отстъпка, за да видите цените`
              : preview.reduced > 0
                ? `Ще бъдат намалени ${preview.reduced} ${productsWord(preview.reduced)}`
                : preview.elsewhere > 0
                  ? "Тази промоция няма да определя цената на нито един продукт: другата важи вместо нея."
                  : "Няма продукти с цена, които да се намалят."}
          </p>
          {preview.percentOff !== null &&
            preview.reduced > 0 &&
            preview.withBadge < preview.reduced && (
              <p className="mt-1 text-sm text-ink-700">
                Със значка „−%“ и зачертана цена: {preview.withBadge}. На останалите цената пак
                пада, но без значка — бележката под всеки казва защо.
              </p>
            )}
          {preview.percentOff !== null && preview.elsewhere > 0 && (
            <p className="mt-1 text-sm text-ink-700">
              В друга промоция, която по това време важи вместо тази: {preview.elsewhere}.
            </p>
          )}
          {preview.absent > 0 && (
            <p className="mt-1 text-sm text-ink-700">
              Временно липсващи в каталога на доставчика: {preview.absent}. Остават в промоцията, но
              не се продават, докато не се върнат в него.
            </p>
          )}

          {preview.rows.length > 0 && (
            <div className="mt-3 overflow-x-auto rounded-md border border-line bg-paper-raised">
              <table className="w-full min-w-[28rem] text-sm">
                <caption className="sr-only">Продуктите в промоцията и цените им</caption>
                <thead className="border-b border-line text-left text-xs tracking-wide text-ink-500 uppercase">
                  <tr>
                    <th className="px-3 py-2 font-medium">Продукт</th>
                    <th className="px-3 py-2 font-medium">Сега → в промоцията</th>
                    <th className="px-3 py-2 font-medium">Значка</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={row.id} className="border-b border-line align-top last:border-0">
                      <td className="px-3 py-2">
                        <p className="font-medium break-words text-ink-900">{row.title}</p>
                        {row.detail && <p className="text-xs text-ink-500">{row.detail}</p>}
                        {row.notes.length > 0 && (
                          <ul className="mt-1 flex flex-col gap-0.5">
                            {row.notes.map((note) => (
                              <li
                                key={note.kind + note.text}
                                className={`text-xs ${
                                  note.kind === "noBadge" || note.kind === "overlap"
                                    ? "text-caution"
                                    : "text-ink-700"
                                }`}
                              >
                                {note.text}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                        {row.regular === null ? (
                          <span className="text-ink-500">Без цена</span>
                        ) : (
                          <>
                            <span className="text-ink-700">{row.regular}</span>
                            {row.price !== null && (
                              <>
                                {" → "}
                                <strong className="font-semibold text-clay-600">{row.price}</strong>
                              </>
                            )}
                            {row.struck !== null && (
                              <span className="block text-xs text-ink-500">
                                зачертана: <span className="line-through">{row.struck}</span>
                              </span>
                            )}
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                        {row.badge !== null ? (
                          <Badge tone="reduction">−{row.badge}%</Badge>
                        ) : (
                          <span className="text-ink-500">без</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {preview.more > 0 && (
            <p className="mt-2 text-sm text-ink-500">
              + още {preview.more} {productsWord(preview.more)}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

export function PromotionForm({
  mode,
  today,
  initial,
  brands,
  categories,
  chosenProducts,
}: {
  mode: PromotionFormMode;
  /** Today in Sofia, as the server saw it when drawing the page. */
  today: Day;
  initial: PromotionFormValues;
  brands: readonly BrandOption[];
  categories: readonly CategoryOption[];
  /** The names of the products `initial.targets` lists, by id. */
  chosenProducts: Readonly<Record<string, ChosenProduct>>;
}) {
  const locked = mode === "running";
  const schema = useMemo(() => promotionFormSchema(mode, today), [mode, today]);
  const initialPercent = parsePercent(initial.percent);
  const { state, formAction, form, formProps, pending, errorOf, ariaFor, lineFor } = useActionForm({
    schema,
    action: savePromotion,
    initialState: {} as PromotionFormState,
    fieldErrorsOf,
    defaultValuesOf: () => ({
      id: initial.id,
      version: initial.version,
      name: initial.name,
      label: initial.label,
      percent: initial.percent,
      /* A saved percentage was confirmed when it was saved; a different one
         must be confirmed again. */
      confirmHigh: mode !== "new" && needsConfirmation(initialPercent) ? initial.percent : "",
      startDay: initial.startDay,
      endDay: initial.endDay,
      targets: JSON.stringify(initial.targets),
    }),
  });
  const { register, setValue, watch, getValues, reset } = form;
  const submitted = form.formState.isSubmitted;

  /* -- what it covers ------------------------------------------------------- */
  const [targets, setTargets] = useState<PromotionTargets>(initial.targets);
  const [names, setNames] = useState<Record<string, ChosenProduct>>(() => ({ ...chosenProducts }));
  const [picking, setPicking] = useState<"include" | "exclude" | null>(null);
  const targetsJson = JSON.stringify(targets);
  useEffect(() => {
    setValue("targets", targetsJson, { shouldDirty: true, shouldValidate: submitted });
  }, [targetsJson, setValue, submitted]);

  const selectedBrands = useMemo(() => new Set(targets.brandIds), [targets.brandIds]);
  const selectedCategories = useMemo(() => new Set(targets.categoryIds), [targets.categoryIds]);
  const included = useMemo(() => new Set(targets.productIds), [targets.productIds]);
  const excluded = useMemo(() => new Set(targets.excludedProductIds), [targets.excludedProductIds]);

  const toggleBrand = (id: string) =>
    setTargets((current) => ({
      ...current,
      brandIds: current.brandIds.includes(id)
        ? current.brandIds.filter((brand) => brand !== id)
        : [...current.brandIds, id],
    }));
  /* A category chosen takes its subcategories with it, so choosing it drops
     any of them chosen one by one. */
  const toggleCategory = (node: CategoryOption) =>
    setTargets((current) => {
      if (current.categoryIds.includes(node.id)) {
        return { ...current, categoryIds: current.categoryIds.filter((id) => id !== node.id) };
      }
      const below = new Set(descendants(node));
      return {
        ...current,
        categoryIds: [...current.categoryIds.filter((id) => !below.has(id)), node.id],
      };
    });
  /* A product is either in the promotion by name or kept out of it, not both. */
  const toggleProduct = (
    list: "productIds" | "excludedProductIds",
    product: PromotionPickerProduct,
  ) => {
    setNames((current) => ({
      ...current,
      [product.id]: { title: product.title, detail: product.detail },
    }));
    const other = list === "productIds" ? "excludedProductIds" : "productIds";
    setTargets((current) =>
      current[list].includes(product.id)
        ? { ...current, [list]: current[list].filter((id) => id !== product.id) }
        : {
            ...current,
            [list]: [...current[list], product.id],
            [other]: current[other].filter((id) => id !== product.id),
          },
    );
  };
  const removeProduct = (list: "productIds" | "excludedProductIds", id: string) =>
    setTargets((current) => ({ ...current, [list]: current[list].filter((item) => item !== id) }));

  /* -- the percentage ------------------------------------------------------- */
  const percentText = String(watch("percent") ?? "");
  const percent = parsePercent(percentText);
  const confirmedValue = String(watch("confirmHigh") ?? "");
  const choosePercent = (value: number) =>
    setValue("percent", String(value), { shouldDirty: true, shouldValidate: submitted });

  /* -- the days ------------------------------------------------------------- */
  const startDay = String(watch("startDay") ?? "");
  const endDay = String(watch("endDay") ?? "");
  const validPeriod = isDay(startDay) && isDay(endDay) && daysBetween(startDay, endDay) >= 0;
  const setEnd = (day: Day) =>
    setValue("endDay", day, { shouldDirty: true, shouldValidate: submitted });
  const from = isDay(startDay) ? startDay : today;
  const shortcuts: { label: string; end: Day }[] = [
    { label: "1 седмица", end: addDays(from, 6) },
    { label: "2 седмици", end: addDays(from, 13) },
    { label: "До края на месеца", end: endOfMonth(from) },
  ];

  /* -- after a save ---------------------------------------------------------- */
  useEffect(() => {
    if (state.version) setValue("version", state.version);
    /* Someone saved first: keep what was typed here, and take their version,
       so the next press writes over it — knowingly, after the banner. */
    if (state.conflictVersion) setValue("version", state.conflictVersion);
    if (!state.savedAt) return;
    reset(getValues());
  }, [state, reset, getValues, setValue]);

  const dirty = form.formState.isDirty;
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /* -- the preview ----------------------------------------------------------- */
  const [preview, setPreview] = useState<PromotionPreview | null>(null);
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "error">("idle");
  const [previewMessage, setPreviewMessage] = useState<string | null>(null);
  const covers = hasInclusion(targets);
  useEffect(() => {
    if (!covers) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setPreviewState("loading");
      try {
        const response = await fetch("/api/admin/promotions/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            promotionId: initial.id || null,
            percent: percentText,
            startDay,
            endDay,
            targets: JSON.parse(targetsJson) as unknown,
          }),
          signal: controller.signal,
        });
        const answer = (await response.json()) as PromotionPreview & { error?: string };
        if (controller.signal.aborted) return;
        if (response.status === 422) {
          setPreviewMessage(answer.error ?? null);
          setPreviewState("idle");
          return;
        }
        if (!response.ok) throw new Error(answer.error);
        setPreview(answer);
        setPreviewMessage(null);
        setPreviewState("idle");
      } catch {
        if (!controller.signal.aborted) setPreviewState("error");
      }
    }, 500);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [covers, initial.id, percentText, startDay, endDay, targetsJson]);

  /* A conflict is not a refusal of what was typed: it has a banner of its own. */
  const answer =
    state.error && !state.conflictVersion
      ? { message: state.error }
      : state.fieldErrors
        ? {
            message: "Поправете отбелязаните полета и запазете отново.",
            fieldErrors: state.fieldErrors,
          }
        : undefined;
  const line = lineFor(answer, "Поправете отбелязаните полета и запазете отново.");

  return (
    <form
      {...formProps}
      action={formAction}
      className="mt-6 grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
    >
      <div className="flex min-w-0 flex-col gap-6">
        <input type="hidden" {...register("id")} />
        <input type="hidden" {...register("version")} />
        <input type="hidden" {...register("targets")} />

        <div className="flex flex-col gap-4">
          <div>
            <label htmlFor="name" className={LABEL_CLASS}>
              Име
              <span aria-hidden className="text-critical">
                {" "}
                *
              </span>
            </label>
            <input
              id="name"
              {...register("name")}
              required
              maxLength={PROMOTION_NAME_MAX}
              autoComplete="off"
              placeholder="Напр. Есен 2026 — Lavazza"
              {...ariaFor("name", "name", "name-help")}
              className={INPUT_CLASS}
            />
            <p id="name-help" className={HELPER_CLASS}>
              За вас, за да я намирате в списъка. В магазина не се показва.
            </p>
            <FieldError id="name" message={errorOf("name")} />
          </div>

          <div>
            <label htmlFor="label" className={LABEL_CLASS}>
              Надпис за клиентите <span className="font-normal text-ink-500">(по избор)</span>
            </label>
            <input
              id="label"
              {...register("label")}
              maxLength={PROMOTION_LABEL_MAX}
              autoComplete="off"
              placeholder="Напр. Есенни дни"
              {...ariaFor("label", "label", "label-help")}
              className={INPUT_CLASS}
            />
            <p id="label-help" className={HELPER_CLASS}>
              Няколко думи, които магазинът показва до намалението. До {PROMOTION_LABEL_MAX} знака.
            </p>
            <FieldError id="label" message={errorOf("label")} />
          </div>
        </div>

        <fieldset className={SECTION}>
          <legend className={LEGEND}>Отстъпка</legend>
          {locked ? (
            <>
              <input type="hidden" {...register("percent")} />
              <p className="font-display text-3xl font-semibold text-ink-900 tabular-nums">
                −{initial.percent}%
              </p>
              <p className="mt-1 text-sm text-ink-700">
                Промоцията тече и отстъпката ѝ не се променя. За друга отстъпка спрете тази и
                започнете нова.
              </p>
            </>
          ) : (
            <>
              <div role="group" aria-label="Готови отстъпки" className="flex flex-wrap gap-2">
                {PROMOTION_PRESETS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={percent === value}
                    onClick={() => choosePercent(value)}
                    className={buttonClasses({
                      variant: "secondary",
                      size: "sm",
                      className:
                        "min-w-16 tabular-nums aria-pressed:border-pine-900 aria-pressed:bg-pine-900 aria-pressed:text-paper",
                    })}
                  >
                    {value}%
                  </button>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-end gap-x-3 gap-y-1">
                <div>
                  <label htmlFor="percent" className={LABEL_CLASS}>
                    Или друга, от 1 до {PROMOTION_MAX_PERCENT}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="percent"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={PROMOTION_MAX_PERCENT}
                      step={1}
                      {...register("percent")}
                      {...ariaFor("percent", "percent", "percent-help")}
                      className={`${INPUT_CLASS} w-28 tabular-nums`}
                    />
                    <span aria-hidden className="text-ink-700">
                      %
                    </span>
                  </div>
                </div>
              </div>
              <FieldError id="percent" message={errorOf("percent")} />
              {needsConfirmation(percent) && (
                <div className="mt-3 rounded-sm bg-caution-100 p-3">
                  <p className="text-sm text-ink-900">
                    −{percent}% е голямо намаление. Проверете, че не е грешка при писане.
                  </p>
                  <label className="mt-1 flex min-h-11 items-center gap-2 text-sm font-medium text-ink-900">
                    <input
                      type="checkbox"
                      name="confirmHigh"
                      value={String(percent)}
                      checked={confirmedValue === String(percent)}
                      onChange={(event) =>
                        setValue(
                          "confirmHigh",
                          event.currentTarget.checked ? String(percent) : "",
                          {
                            shouldDirty: true,
                            shouldValidate: submitted,
                          },
                        )
                      }
                      {...ariaFor("confirmHigh", "confirmHigh")}
                      className={CHECKBOX}
                    />
                    Да, {percent}% е правилно
                  </label>
                  <FieldError id="confirmHigh" message={errorOf("confirmHigh")} />
                </div>
              )}
            </>
          )}
          <p id="percent-help" className="mt-3 text-sm text-ink-500">
            Намалението излиза от вашата печалба: доставчикът ви таксува същата цена. Новата цена се
            закръгля надолу до стотинка.
          </p>
        </fieldset>

        <fieldset className={SECTION}>
          <legend className={LEGEND}>Период</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              {locked ? (
                <>
                  <input type="hidden" {...register("startDay")} />
                  <p className={LABEL_CLASS}>Първи ден</p>
                  <p className="text-base text-ink-900">{formatDay(initial.startDay)}</p>
                </>
              ) : (
                <>
                  <label htmlFor="startDay" className={LABEL_CLASS}>
                    Първи ден
                  </label>
                  <input
                    id="startDay"
                    type="date"
                    min={today}
                    max={addDays(today, PROMOTION_MAX_LEAD_DAYS)}
                    {...register("startDay")}
                    {...ariaFor("startDay", "startDay", "period-help")}
                    className={INPUT_CLASS}
                  />
                  <FieldError id="startDay" message={errorOf("startDay")} />
                </>
              )}
            </div>
            <div>
              <label htmlFor="endDay" className={LABEL_CLASS}>
                Последен ден
              </label>
              <input
                id="endDay"
                type="date"
                min={locked ? today : isDay(startDay) && startDay > today ? startDay : today}
                {...register("endDay")}
                {...ariaFor("endDay", "endDay", "period-help")}
                className={INPUT_CLASS}
              />
              <FieldError id="endDay" message={errorOf("endDay")} />
            </div>
          </div>
          <div
            role="group"
            aria-label="Бърз избор на последния ден"
            className="mt-3 flex flex-wrap gap-2"
          >
            {shortcuts.map((shortcut) => (
              <button
                key={shortcut.label}
                type="button"
                onClick={() => setEnd(shortcut.end)}
                className={buttonClasses({ variant: "secondary", size: "sm" })}
              >
                {shortcut.label}
              </button>
            ))}
          </div>
          {validPeriod && (
            <p className="mt-3 text-sm font-medium text-ink-900">
              {formatDayRange(startDay, endDay)} · {periodLength(startDay, endDay)}{" "}
              {periodLength(startDay, endDay) === 1 ? "ден" : "дни"}
            </p>
          )}
          <p id="period-help" className="mt-1 text-sm text-ink-500">
            От 00:00 на първия ден до 24:00 на последния, българско време; включва се и спира сама.
            {!locked &&
              " Започва ли днес, цените в магазина се сменят веднага щом запазите."} До{" "}
            {PROMOTION_MAX_DAYS} дни: по-дълго намаление вече е просто новата цена.
          </p>
        </fieldset>

        <fieldset className={SECTION} aria-describedby="targets-help">
          <legend className={LEGEND}>Кои продукти</legend>
          <p id="targets-help" className="text-sm text-ink-500">
            Изберете марки, категории или отделни продукти — поне едно. Продукт, който по-късно се
            появи в избрана марка или категория, влиза в промоцията сам.
          </p>

          <h3 className={`mt-4 ${SUBHEADING}`}>Марки</h3>
          <ul className="mt-1 grid gap-x-4 sm:grid-cols-2">
            {brands.map((brand) => (
              <li key={brand.id}>
                <label className="flex min-h-11 items-center gap-2 text-sm text-ink-900">
                  <input
                    type="checkbox"
                    checked={selectedBrands.has(brand.id)}
                    onChange={() => toggleBrand(brand.id)}
                    className={CHECKBOX}
                  />
                  <span>
                    {brand.name}{" "}
                    <span className={COUNT}>
                      {brand.count}
                      <span className="sr-only"> {productsWord(brand.count)}</span>
                    </span>
                    <InactiveMark inactive={brand.inactive} />
                  </span>
                </label>
              </li>
            ))}
          </ul>

          <h3 className={`mt-4 ${SUBHEADING}`}>Категории</h3>
          <p className="text-xs text-ink-500">Категорията взима и всичките си подкатегории.</p>
          <div className="mt-1">
            <CategoryTree
              nodes={categories}
              selected={selectedCategories}
              covered={null}
              onToggle={toggleCategory}
            />
          </div>

          <h3 className={`mt-4 ${SUBHEADING}`}>Отделни продукти</h3>
          <ChosenProducts
            ids={targets.productIds}
            names={names}
            onRemove={(id) => removeProduct("productIds", id)}
            empty="Няма избрани поотделно."
          />
          {picking === "include" ? (
            <PromotionProductPicker
              title="Добавете продукти към промоцията"
              addLabel="Добави"
              chosen={included}
              onToggle={(product) => toggleProduct("productIds", product)}
              onClose={() => setPicking(null)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setPicking("include")}
              className={buttonClasses({ variant: "secondary", size: "sm", className: "mt-2" })}
            >
              Добави продукт…
            </button>
          )}

          <h3 className={`mt-5 ${SUBHEADING}`}>Без тези продукти</h3>
          <p className="text-xs text-ink-500">
            Не се намаляват, дори да са от избрана марка или категория.
          </p>
          <ChosenProducts
            ids={targets.excludedProductIds}
            names={names}
            onRemove={(id) => removeProduct("excludedProductIds", id)}
            empty="Няма изключени."
          />
          {picking === "exclude" ? (
            <PromotionProductPicker
              title="Изключете продукти от промоцията"
              addLabel="Изключи"
              chosen={excluded}
              onToggle={(product) => toggleProduct("excludedProductIds", product)}
              onClose={() => setPicking(null)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setPicking("exclude")}
              className={buttonClasses({ variant: "secondary", size: "sm", className: "mt-2" })}
            >
              Изключи продукт…
            </button>
          )}
          <FieldError id="targets" message={errorOf("targets")} />
        </fieldset>

        <div className="flex flex-col gap-3 rounded-md border border-line-strong bg-paper-raised p-4">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={pending}
              aria-busy={pending || undefined}
              className={buttonClasses({ variant: "primary" })}
            >
              {pending ? "Запазва се…" : mode === "new" ? "Запази промоцията" : "Запази промените"}
            </button>
          </div>
          {locked && preview && preview.leaving > 0 && (
            <p className="rounded-sm bg-caution-100 px-3 py-2 text-sm text-ink-900">
              Със запазването {preview.leaving} {productsWord(preview.leaving)} излизат от
              промоцията. Ако по-късно ги върнете, ще са с намалената цена, но без значка до края ѝ:
              цената им в тази промоция вече е част от последните им 30 дни.
            </p>
          )}
          <div aria-live="polite" className="text-sm">
            {state.conflictVersion && state.error && (
              <p role="alert" className="rounded-sm bg-caution-100 px-3 py-2 text-ink-900">
                {state.error}
              </p>
            )}
            {line && (
              <p role="alert" className="font-medium text-critical">
                {line}
              </p>
            )}
            {state.savedAt && !dirty && (
              <p className="text-ink-500">Запазено в {time(state.savedAt)}.</p>
            )}
            {dirty && <p className="text-ink-500">Има незапазени промени.</p>}
          </div>
        </div>
      </div>

      <PreviewPanel
        preview={covers ? preview : null}
        state={previewState}
        message={
          covers ? previewMessage : "Изберете марка, категория или продукт, за да видите цените."
        }
      />
    </form>
  );
}
