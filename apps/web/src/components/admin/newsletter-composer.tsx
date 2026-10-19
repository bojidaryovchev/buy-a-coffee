"use client";

import { upload } from "@vercel/blob/client";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent } from "react";
import type { NewsletterAttachment } from "@catalog/db/schema";
import { FieldError } from "@/components/forms/field-error";
import {
  HELPER_CLASS,
  INPUT_CLASS,
  LABEL_CLASS,
  TEXTAREA_CLASS,
} from "@/components/forms/field-styles";
import { useActionForm } from "@/components/forms/use-schema-form";
import { NewsletterChecklist } from "@/components/admin/newsletter-checklist";
import { insertBlockLine } from "@/components/admin/newsletter-edits";
import { NewsletterProductPicker } from "@/components/admin/newsletter-product-picker";
import { submitNewsletter, type NewsletterFormState } from "@/lib/newsletter/actions";
import { checkDeliverability } from "@/lib/newsletter/deliverability";
import type { BlockReport, PreviewResponse } from "@/lib/newsletter/product-blocks";
import { DEFAULT_BLOCK_PRODUCTS, productTokenLine } from "@/lib/newsletter/tokens";
import {
  MAX_ATTACHMENTS,
  MAX_UPLOAD_BYTES,
  UPLOAD_ACCEPT,
  UPLOAD_PREFIX,
  UPLOAD_TYPES,
  attachmentKind,
  newsletterDraftSchema,
  requireContent,
  type NewsletterIntent,
} from "@/lib/newsletter/schemas";

/**
 * Writing a newsletter: subject, preview line, text, files, a live preview,
 * and three buttons — save, send a test to the shop's inbox, send to the list.
 *
 * Built like the reply form (`reply-form.tsx`): a real form posting to a
 * server action, validated in the browser with the schema the action checks
 * with, and keeping what was typed when the server says no. What it adds:
 *
 *   - A toolbar that writes the Markdown subset the template reads
 *     (`emails/markdown.ts`). The owner never writes HTML, and nothing typed
 *     here can become HTML in a subscriber's inbox.
 *   - Uploads straight from the browser to Vercel Blob, signed by
 *     `/api/admin/newsletter/upload`. Resend's batch sending carries no
 *     attachments, so a file is hosted and linked: a picture is drawn in the
 *     letter, anything else is a download button. The composer says so.
 *   - Products: a picker that finds them by name, brand or address and puts
 *     a `[[продукти: …]]` line in the text, and one-press lines for the
 *     newest products and the reductions (`lib/newsletter/tokens.ts`). The
 *     letter fills them from the catalog when it is drawn.
 *   - A preview of the real template, rendered on the server a moment after
 *     typing stops, in an iframe with every sandbox restriction on.
 *   - "Преди изпращане": what is likely to send the letter to spam, worked
 *     out as the owner types (`lib/newsletter/deliverability.ts`) and repeated
 *     in the send confirmation. Advice; it blocks nothing.
 *   - Sending behind a second, explicit step that names the number of
 *     recipients. It is a `<details>`, so it works with or without script, and
 *     the action refuses the send if the list has changed since.
 */

export interface ComposerCampaign {
  id: string;
  /** `draftVersion`: what this tab was drawn from, sent back with every press. */
  version: string;
  subject: string;
  preheader: string;
  body: string;
  attachments: NewsletterAttachment[];
}

const BUTTON_PRIMARY =
  "inline-flex min-h-11 items-center justify-center rounded-sm bg-pine-900 px-5 py-2.5 text-sm font-semibold whitespace-nowrap text-paper transition-colors hover:bg-pine-700 disabled:cursor-not-allowed disabled:bg-paper-sunken disabled:text-ink-500";
const BUTTON_SECONDARY =
  "inline-flex min-h-11 items-center justify-center rounded-sm border border-line-strong bg-paper-raised px-4 py-2 text-sm font-medium whitespace-nowrap text-ink-900 transition-colors hover:bg-paper-sunken disabled:cursor-not-allowed disabled:text-ink-500";
const TOOL_BUTTON =
  "inline-flex min-h-9 min-w-9 items-center justify-center rounded-sm border border-line-strong bg-paper-raised px-2.5 text-sm text-ink-900 transition-colors hover:bg-paper-sunken";

const fieldErrorsOf = (state: NewsletterFormState) => state.fieldErrors;

/** "Цени октомври.pdf" → "ceni-oktomvri.pdf"-ish: a path segment Blob and every
    mail client will carry intact. The reader still sees the original name. */
function storageName(name: string): string {
  const dot = name.lastIndexOf(".");
  const stem = (dot > 0 ? name.slice(0, dot) : name)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const extension =
    dot > 0
      ? name
          .slice(dot + 1)
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "")
      : "";
  return `${stem || "fail"}${extension ? `.${extension}` : ""}`;
}

function sizeLabel(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  return `${(bytes / 1_000_000).toFixed(1).replace(".", ",")} MB`;
}

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("bg-BG", { hour: "2-digit", minute: "2-digit" });

/* -- the toolbar ------------------------------------------------------------ */

type Edit = (
  text: string,
  start: number,
  end: number,
) => {
  text: string;
  selectionStart: number;
  selectionEnd: number;
};

/** Wrap the selection, or insert the markers around a placeholder word. */
const wrap =
  (marker: string, placeholder: string): Edit =>
  (text, start, end) => {
    const selected = text.slice(start, end) || placeholder;
    const next = `${text.slice(0, start)}${marker}${selected}${marker}${text.slice(end)}`;
    return {
      text: next,
      selectionStart: start + marker.length,
      selectionEnd: start + marker.length + selected.length,
    };
  };

/** Put a prefix at the start of every line the selection touches. */
const prefixLines =
  (prefix: string): Edit =>
  (text, start, end) => {
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    const lineEndIndex = text.indexOf("\n", end);
    const lineEnd = lineEndIndex === -1 ? text.length : lineEndIndex;
    const block = text
      .slice(lineStart, lineEnd)
      .split("\n")
      .map((line) =>
        line.startsWith(prefix) ? line : `${prefix}${line.replace(/^(#+|-|\*)\s+/, "")}`,
      )
      .join("\n");
    const next = `${text.slice(0, lineStart)}${block}${text.slice(lineEnd)}`;
    return { text: next, selectionStart: lineStart, selectionEnd: lineStart + block.length };
  };

/** `[selection](https://)`, with the address selected for pasting over. */
const link: Edit = (text, start, end) => {
  const label = text.slice(start, end) || "текст на връзката";
  const inserted = `[${label}](https://)`;
  const next = `${text.slice(0, start)}${inserted}${text.slice(end)}`;
  const urlStart = start + label.length + 3;
  return { text: next, selectionStart: urlStart, selectionEnd: urlStart + "https://".length };
};

/** The two automatic blocks, as their buttons write them. */
const NEW_LINE = productTokenLine({ kind: "new", limit: DEFAULT_BLOCK_PRODUCTS });
const SALE_LINE = productTokenLine({ kind: "sale", limit: DEFAULT_BLOCK_PRODUCTS });

const TOOLS: { label: string; title: string; edit: Edit }[] = [
  { label: "Заглавие", title: "Подзаглавие (## в началото на реда)", edit: prefixLines("## ") },
  { label: "Удебелен", title: "Удебелен текст (**…**)", edit: wrap("**", "удебелен текст") },
  { label: "Курсив", title: "Курсив (*…*)", edit: wrap("*", "курсив") },
  { label: "Връзка", title: "Връзка ([текст](https://…))", edit: link },
  { label: "Списък", title: "Списък (- в началото на всеки ред)", edit: prefixLines("- ") },
];

/* -- the composer ----------------------------------------------------------- */

/** One empty list, so the checks are not recomputed for a new `[]` every render. */
const NO_NAMES: readonly string[] = [];

export function NewsletterComposer({
  campaign,
  activeCount,
  sender,
  testRecipient,
  canSend,
  canUpload,
  capitalised = NO_NAMES,
}: {
  campaign: ComposerCampaign;
  activeCount: number;
  sender: string;
  testRecipient: string | null;
  canSend: boolean;
  canUpload: boolean;
  /** Brand and line names that may be written in capitals (`listCapitalisedNames`). */
  capitalised?: readonly string[];
}) {
  const { state, formAction, form, formProps, pending, errorOf, ariaFor } = useActionForm({
    schema: newsletterDraftSchema,
    action: submitNewsletter,
    initialState: {} as NewsletterFormState,
    fieldErrorsOf,
    defaultValuesOf: () => ({
      id: campaign.id,
      version: campaign.version,
      subject: campaign.subject,
      preheader: campaign.preheader,
      body: campaign.body,
      attachments: JSON.stringify(campaign.attachments),
    }),
  });
  const { register, setValue, watch, getValues, reset, setError } = form;

  const [files, setFiles] = useState<NewsletterAttachment[]>(campaign.attachments);
  const [savedFiles, setSavedFiles] = useState(() => JSON.stringify(campaign.attachments));
  const [uploading, setUploading] = useState<string[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [intent, setIntent] = useState<NewsletterIntent>("save");
  const confirmRef = useRef<HTMLDetailsElement>(null);
  /* The pressed button, also written into a hidden field before the form is
     sent: Safari before 16.4 leaves the button out of `new FormData(form,
     submitter)`, and the action would read that as "save" (`resolveIntent`).
     The field follows the state, and is also written directly on the press,
     so it holds the choice whether or not React has rendered again by the
     time the form data is read. (Not `defaultValue`: on a hidden input that
     is the same attribute as the value, and a re-render would put "save"
     back.) */
  const intentRef = useRef<HTMLInputElement>(null);
  const choose = (next: NewsletterIntent) => {
    if (intentRef.current) intentRef.current.value = next;
    setIntent(next);
  };

  /* The files live in component state and travel in one hidden field. */
  const filesJson = JSON.stringify(files);
  useEffect(() => {
    setValue("attachments", filesJson, { shouldDirty: filesJson !== savedFiles });
  }, [filesJson, savedFiles, setValue]);

  /* A save that succeeded is the new baseline for "unsaved changes", and its
     version is the one the next press must match. */
  useEffect(() => {
    if (state.version) setValue("version", state.version);
    if (!state.savedAt) return;
    reset(getValues());
    setSavedFiles(String(getValues("attachments") || "[]"));
  }, [state, reset, getValues, setValue]);

  const dirty = form.formState.isDirty || filesJson !== savedFiles;
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /* -- toolbar -- */
  const bodyField = register("body");
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const apply = (edit: Edit) => {
    const area = bodyRef.current;
    if (!area) return;
    const result = edit(area.value, area.selectionStart, area.selectionEnd);
    setValue("body", result.text, { shouldDirty: true });
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
  };

  /* -- uploads -- */
  const onFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const chosen = Array.from(input.files ?? []);
    input.value = "";
    setUploadError(null);
    if (files.length + chosen.length > MAX_ATTACHMENTS) {
      setUploadError(`До ${MAX_ATTACHMENTS} файла в един бюлетин.`);
      return;
    }
    for (const file of chosen) {
      if (!UPLOAD_TYPES.includes(file.type)) {
        setUploadError(`„${file.name}“: приемат се JPG, PNG, GIF, PDF, Word и Excel.`);
        continue;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        setUploadError(`„${file.name}“ е над ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
        continue;
      }
      setUploading((list) => [...list, file.name]);
      try {
        const blob = await upload(
          `${UPLOAD_PREFIX}${campaign.id}/${storageName(file.name)}`,
          file,
          {
            access: "public",
            handleUploadUrl: "/api/admin/newsletter/upload",
            contentType: file.type,
          },
        );
        const kind = attachmentKind(file.type);
        setFiles((list) => [
          ...list,
          {
            url: blob.url,
            name: file.name,
            contentType: file.type,
            size: file.size,
            kind,
            ...(kind === "image" ? { alt: "" } : {}),
          },
        ]);
      } catch (error) {
        setUploadError(
          `„${file.name}“ не беше качен${error instanceof Error && /[а-я]/i.test(error.message) ? `: ${error.message}` : "."} Опитайте отново.`,
        );
      } finally {
        setUploading((list) => list.filter((name) => name !== file.name));
      }
    }
  };

  /* -- preview -- */
  const subject = watch("subject");
  const preheader = watch("preheader");
  const body = watch("body");
  const [preview, setPreview] = useState<string>("");
  /* What the product blocks resolved to at the last preview, and the letter's
     size, for the checks. Cleared when a preview fails, so the checks and the
     confirmation never speak from a letter that is no longer the one typed. */
  const [blockReports, setBlockReports] = useState<readonly BlockReport[] | null>(null);
  const [previewBytes, setPreviewBytes] = useState<number | null>(null);
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "error">("loading");
  const [previewWidth, setPreviewWidth] = useState<"desktop" | "phone">("desktop");
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setPreviewState("loading");
      try {
        const response = await fetch("/api/admin/newsletter/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ subject, preheader, body, attachments: filesJson }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(await response.text());
        const answer = (await response.json()) as PreviewResponse;
        setPreview(answer.html);
        setBlockReports(answer.blocks);
        setPreviewBytes(new TextEncoder().encode(answer.html).length);
        setPreviewState("idle");
      } catch (error) {
        if (!controller.signal.aborted) {
          setBlockReports(null);
          setPreviewBytes(null);
          setPreviewState("error");
        }
        void error;
      }
    }, 600);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [subject, preheader, body, filesJson]);

  /* -- products -- */
  const [pickerOpen, setPickerOpen] = useState(false);
  const insertLine = (line: string) => apply(insertBlockLine(line));

  /* -- before sending -- */
  const notes = useMemo(
    () =>
      checkDeliverability({
        subject: subject ?? "",
        preheader: preheader ?? "",
        body: body ?? "",
        images: files.filter((file) => file.kind === "image").length,
        files: files.filter((file) => file.kind === "file").length,
        blocks: blockReports,
        htmlBytes: previewBytes,
        capitalised,
      }),
    [subject, preheader, body, files, blockReports, previewBytes, capitalised],
  );

  /* -- sending -- */
  const openConfirmation = (event: MouseEvent<HTMLElement>) => {
    const details = confirmRef.current;
    if (!details || details.open) return;
    // Checked before the question is asked, not after it is answered.
    const missing = requireContent({ subject: getValues("subject"), body: getValues("body") });
    if (missing) {
      event.preventDefault();
      for (const [name, message] of Object.entries(missing)) {
        setError(name as "subject" | "body", { type: "required", message });
      }
    }
  };

  const busy = pending || uploading.length > 0;

  return (
    <form
      {...formProps}
      action={formAction}
      className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
    >
      <div className="flex min-w-0 flex-col gap-6">
        <input type="hidden" {...register("id")} />
        <input type="hidden" {...register("version")} />
        <input type="hidden" {...register("attachments")} />
        <input type="hidden" name="intentChosen" ref={intentRef} value={intent} readOnly />

        <div>
          <label htmlFor="subject" className={LABEL_CLASS}>
            Тема
          </label>
          <input
            id="subject"
            {...register("subject")}
            maxLength={150}
            placeholder="Например: Новите кафета на октомври"
            {...ariaFor("subject", "subject")}
            className={INPUT_CLASS}
          />
          <FieldError id="subject" message={errorOf("subject")} />
        </div>

        <div>
          <label htmlFor="preheader" className={LABEL_CLASS}>
            Въведение <span className="font-normal text-ink-500">(по избор)</span>
          </label>
          <input
            id="preheader"
            {...register("preheader")}
            maxLength={150}
            placeholder="Едно изречение след темата в пощата"
            {...ariaFor("preheader", "preheader", "preheader-help")}
            className={INPUT_CLASS}
          />
          <p id="preheader-help" className={HELPER_CLASS}>
            Пощенските програми го показват след темата, в списъка с писма. В самото писмо не се
            вижда. Ако е празно, се взима началото на текста.
          </p>
          <FieldError id="preheader" message={errorOf("preheader")} />
        </div>

        <div>
          <div className="mb-1 flex flex-wrap items-end justify-between gap-2">
            <label htmlFor="body" className="block text-sm font-medium text-ink-900">
              Текст
            </label>
            <div
              role="toolbar"
              aria-label="Форматиране"
              aria-controls="body"
              className="flex flex-wrap gap-1.5"
            >
              {TOOLS.map((tool) => (
                <button
                  key={tool.label}
                  type="button"
                  title={tool.title}
                  onClick={() => apply(tool.edit)}
                  className={TOOL_BUTTON}
                >
                  {tool.label}
                </button>
              ))}
            </div>
          </div>
          <textarea
            id="body"
            {...bodyField}
            ref={(element) => {
              bodyField.ref(element);
              bodyRef.current = element;
            }}
            rows={16}
            placeholder="Здравейте, …"
            {...ariaFor("body", "body", "body-help")}
            className={`${TEXTAREA_CLASS} font-mono leading-relaxed`}
          />
          <div
            role="toolbar"
            aria-label="Продукти"
            aria-controls="body"
            className="mt-2 flex flex-wrap items-center gap-1.5"
          >
            <span className="mr-1 text-sm text-ink-700">Вмъкни:</span>
            <button
              type="button"
              aria-expanded={pickerOpen}
              title="Избрани продукти ([[продукти: адрес-1, адрес-2]])"
              onClick={() => setPickerOpen((open) => !open)}
              className={`${TOOL_BUTTON} aria-expanded:border-pine-700 aria-expanded:bg-pine-100`}
            >
              Продукти…
            </button>
            <button
              type="button"
              title={`Най-новите продукти от последните 30 дни (${NEW_LINE})`}
              onClick={() => insertLine(NEW_LINE)}
              className={TOOL_BUTTON}
            >
              Нови продукти
            </button>
            <button
              type="button"
              title={`Продуктите с най-голямо намаление (${SALE_LINE})`}
              onClick={() => insertLine(SALE_LINE)}
              className={TOOL_BUTTON}
            >
              Промоции
            </button>
          </div>
          {pickerOpen && (
            <NewsletterProductPicker
              onClose={() => setPickerOpen(false)}
              onInsert={(slugs) => {
                setPickerOpen(false);
                insertLine(productTokenLine({ kind: "picked", slugs }));
              }}
            />
          )}
          <p id="body-help" className={HELPER_CLASS}>
            Празен ред — нов абзац. <code>## Заглавие</code>, <code>**удебелен**</code>,{" "}
            <code>*курсив*</code>, <code>[текст](https://…)</code>, <code>- точка от списък</code>.
            Адрес, написан направо, става връзка. HTML не се приема — показва се като текст.
          </p>
          <p className={HELPER_CLASS}>
            Продукти — всеки блок на отделен ред: <code>[[продукти: адрес-1, адрес-2]]</code> (до
            6), <code>[[нови-продукти]]</code> (от последните 30 дни), <code>[[промоции]]</code>{" "}
            (най-голямото намаление); число след двоеточие казва колко, напр.{" "}
            <code>[[промоции: 6]]</code>. Името, цената и снимката са като на сайта; при изпращането
            се записват и всеки абонат получава едно и също писмо.
          </p>
          <FieldError id="body" message={errorOf("body")} />
        </div>

        <fieldset className="rounded-md border border-line bg-paper-raised p-4">
          <legend className="px-1 text-sm font-medium text-ink-900">Снимки и файлове</legend>
          <p id="files-help" className="text-sm text-ink-500">
            Бюлетинът не носи прикачени файлове: Resend не ги приема при изпращане до много хора, а
            и един PDF, прикачен към всяко писмо, е най-тежкият начин да се изпрати. Файловете се
            качват при нас и в писмото се показват така: снимките (JPG, PNG, GIF) — в самото писмо,
            под текста; документите (PDF, Word, Excel) — като бутон „Изтегли“. До {MAX_ATTACHMENTS}{" "}
            файла, до {MAX_UPLOAD_BYTES / 1024 / 1024} MB всеки.
          </p>

          {files.length > 0 && (
            <ul className="mt-3 flex flex-col divide-y divide-line">
              {files.map((file, index) => (
                <li key={file.url} className="flex flex-wrap items-start gap-3 py-3">
                  {file.kind === "image" ? (
                    <img
                      src={file.url}
                      alt=""
                      width={64}
                      height={64}
                      className="size-16 shrink-0 rounded-sm border border-line bg-well object-contain"
                    />
                  ) : (
                    <span className="flex size-16 shrink-0 items-center justify-center rounded-sm border border-line bg-paper-sunken text-xs font-semibold text-ink-700">
                      {file.name.split(".").pop()?.toUpperCase().slice(0, 4) ?? "ФАЙЛ"}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium break-words text-ink-900">{file.name}</p>
                    <p className="text-xs text-ink-500 tabular-nums">
                      {file.kind === "image" ? "Снимка в писмото" : "Бутон за изтегляне"} ·{" "}
                      {sizeLabel(file.size)}
                    </p>
                    {file.kind === "image" && (
                      <label className="mt-2 block text-xs text-ink-700">
                        Какво показва снимката (за читатели без картинки)
                        <input
                          value={file.alt ?? ""}
                          maxLength={300}
                          onChange={(event) => {
                            const alt = event.currentTarget.value;
                            setFiles((list) =>
                              list.map((item, at) => (at === index ? { ...item, alt } : item)),
                            );
                          }}
                          placeholder="Например: Три нови пакета кафе на зърна"
                          className={`mt-1 ${INPUT_CLASS} min-h-11`}
                        />
                      </label>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setFiles((list) => list.filter((_, at) => at !== index))}
                    className={BUTTON_SECONDARY}
                  >
                    Махни
                  </button>
                </li>
              ))}
            </ul>
          )}

          {canUpload ? (
            <label className="mt-3 block text-sm text-ink-500">
              <span className="block font-medium text-ink-900">Добави файлове</span>
              <input
                type="file"
                multiple
                accept={UPLOAD_ACCEPT}
                onChange={onFiles}
                disabled={files.length >= MAX_ATTACHMENTS}
                aria-describedby="files-help"
                className="mt-1 max-w-full text-sm file:mr-3 file:min-h-9 file:rounded-sm file:border file:border-line-strong file:bg-paper file:px-3 file:text-sm file:font-medium"
              />
            </label>
          ) : (
            <p className="mt-3 rounded-sm bg-caution-100 px-3 py-2 text-sm text-caution">
              Качването не е настроено (липсва BLOB_READ_WRITE_TOKEN).
            </p>
          )}
          {uploading.length > 0 && (
            <p role="status" className="mt-2 text-sm text-ink-700">
              Качва се: {uploading.join(", ")}…
            </p>
          )}
          {uploadError && (
            <p role="alert" className="mt-2 text-sm text-critical">
              {uploadError}
            </p>
          )}
          <FieldError id="attachments" message={errorOf("attachments")} />
        </fieldset>

        <NewsletterChecklist id="checklist" notes={notes} />

        <div className="flex flex-col gap-4 rounded-md border border-line-strong bg-paper-raised p-4">
          <p className="text-sm text-ink-500">
            Изпраща се от <span className="font-medium text-ink-900">{sender}</span> до активните
            абонати в списъка на този сайт. Който се е отписал (оттук, с бутона в писмото или в
            Resend), не го получава.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              name="intent"
              value="save"
              disabled={busy}
              onClick={() => choose("save")}
              aria-busy={(pending && intent === "save") || undefined}
              className={BUTTON_SECONDARY}
            >
              {pending && intent === "save" ? "Запазва се…" : "Запази черновата"}
            </button>
            <button
              type="submit"
              name="intent"
              value="test"
              disabled={busy || !canSend || !testRecipient}
              onClick={() => choose("test")}
              aria-busy={(pending && intent === "test") || undefined}
              className={BUTTON_SECONDARY}
            >
              {pending && intent === "test" ? "Изпраща се…" : "Изпрати пробно"}
            </button>
            {testRecipient && <span className="text-xs text-ink-500">до {testRecipient}</span>}
          </div>

          <details ref={confirmRef} className="group border-t border-line pt-4">
            <summary
              onClick={openConfirmation}
              aria-disabled={!canSend || activeCount === 0 || busy || undefined}
              className={`${BUTTON_PRIMARY} cursor-pointer list-none [&::-webkit-details-marker]:hidden ${
                !canSend || activeCount === 0
                  ? "pointer-events-none bg-paper-sunken text-ink-500"
                  : ""
              }`}
            >
              Изпрати до {activeCount} {activeCount === 1 ? "абонат" : "абонати"}
            </summary>
            <div className="mt-4 rounded-md bg-caution-100 p-4 text-sm text-ink-900">
              <p className="font-semibold text-caution">Изпращане до целия списък</p>
              <p className="mt-1">
                Бюлетинът „{subject || "без тема"}“ ще отиде до{" "}
                <strong className="tabular-nums">{activeCount}</strong>{" "}
                {activeCount === 1 ? "активен абонат" : "активни абонати"}. Изпратеното не може да
                бъде върнато, а след това текстът не може да се променя.
              </p>
              <NewsletterChecklist id="confirm-checklist" notes={notes} compact />
              <input type="hidden" name="confirmCount" value={activeCount} />
              <div className="mt-3 flex flex-wrap gap-3">
                <button
                  type="submit"
                  name="intent"
                  value="send"
                  disabled={busy || !canSend || activeCount === 0}
                  onClick={() => choose("send")}
                  aria-busy={(pending && intent === "send") || undefined}
                  className={BUTTON_PRIMARY}
                >
                  {pending && intent === "send" ? "Изпраща се…" : `Да, изпрати до ${activeCount}`}
                </button>
                <button
                  type="button"
                  onClick={() => confirmRef.current?.removeAttribute("open")}
                  className={BUTTON_SECONDARY}
                >
                  Отказ
                </button>
              </div>
            </div>
          </details>
          {!canSend && (
            <p className="text-sm text-caution">
              Липсва RESEND_API_KEY — оттук не може да се изпраща.
            </p>
          )}

          <div aria-live="polite" className="text-sm">
            {state.error && (
              <p role="alert" className="font-medium text-critical">
                {state.error}
              </p>
            )}
            {!state.error && state.testSentTo && (
              <p className="text-ink-700">Пробното писмо е изпратено до {state.testSentTo}.</p>
            )}
            {state.savedAt && !dirty && (
              <p className="text-ink-500">Черновата е запазена в {time(state.savedAt)}.</p>
            )}
            {dirty && <p className="text-ink-500">Има незапазени промени.</p>}
          </div>
        </div>
      </div>

      <section aria-labelledby="preview-title" className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="preview-title" className="font-display text-xl font-semibold text-ink-900">
            Преглед
          </h2>
          <div className="flex gap-1.5" role="group" aria-label="Ширина на прегледа">
            {(["desktop", "phone"] as const).map((width) => (
              <button
                key={width}
                type="button"
                aria-pressed={previewWidth === width}
                onClick={() => setPreviewWidth(width)}
                className={`${TOOL_BUTTON} aria-pressed:border-pine-700 aria-pressed:bg-pine-100`}
              >
                {width === "desktop" ? "Компютър" : "Телефон"}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-1 text-xs text-ink-500" aria-live="polite">
          {previewState === "loading"
            ? "Обновява се…"
            : previewState === "error"
              ? "Прегледът не можа да се обнови. Текстът е запазен във формата."
              : "Така изглежда писмото, с връзка за отписване като на абонат."}
        </p>
        <div className="mt-3 overflow-hidden rounded-md border border-line bg-paper">
          <iframe
            title="Преглед на бюлетина"
            sandbox=""
            srcDoc={preview}
            className={`mx-auto block h-[56rem] max-w-full border-0 bg-paper ${
              previewWidth === "phone" ? "w-[375px]" : "w-full"
            }`}
          />
        </div>
      </section>
    </form>
  );
}
