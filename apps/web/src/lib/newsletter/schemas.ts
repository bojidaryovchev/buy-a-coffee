import { z } from "zod";
import type { NewsletterAttachment } from "@catalog/db/schema";
import { MAX_BODY_LENGTH } from "@/emails/markdown";

/**
 * The newsletter composer's rules, shared by the form in the browser, the
 * server action and the upload route, as the storefront's forms share theirs
 * (`lib/forms/schemas.ts`).
 *
 * What may be uploaded is decided here once. The upload route signs a token
 * only for these types and this size; the action accepts an attachment only
 * if its address is one of ours, under `newsletter/`. A file URL typed into
 * the hidden field by hand is therefore not something a newsletter can carry.
 */

/** Per file. Blob takes far more; a newsletter that links a 15 MB file is
    already asking a lot of a reader on a phone. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/** How many files one newsletter carries. */
export const MAX_ATTACHMENTS = 10;

/**
 * Pictures a mail client will actually draw. Not WebP or AVIF: Outlook on
 * Windows and several webmail clients show a broken image for both, and a
 * picture in a newsletter is drawn by the reader's client, not by our site.
 */
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif"] as const;

/** Documents a reader can open: PDF, Word and Excel, old and new formats. */
export const FILE_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

export const UPLOAD_TYPES: readonly string[] = [...IMAGE_TYPES, ...FILE_TYPES];

/** For the file input's `accept`, so the picker offers only what will pass. */
export const UPLOAD_ACCEPT = [
  ...UPLOAD_TYPES,
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
].join(",");

/** Where every upload goes in the Blob store; the images of the catalog live
    beside it under their own prefix and are never touched from here. */
export const UPLOAD_PREFIX = "newsletter/";

export function attachmentKind(contentType: string): NewsletterAttachment["kind"] {
  return (IMAGE_TYPES as readonly string[]).includes(contentType) ? "image" : "file";
}

/**
 * Is this a file we uploaded: https, on a Vercel Blob public host, under
 * `newsletter/`. The host is checked by suffix rather than against one store
 * id, so moving the files to a new store is not a code change; the prefix is
 * what keeps a catalog image or a stranger's URL out.
 */
export function isNewsletterUpload(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname.endsWith(".public.blob.vercel-storage.com") &&
      parsed.pathname.startsWith(`/${UPLOAD_PREFIX}`) &&
      !parsed.search &&
      !parsed.hash
    );
  } catch {
    return false;
  }
}

export const NEWSLETTER_MESSAGES = {
  subject: "Напишете тема — тя е първото, което абонатът вижда.",
  subjectLong: "Темата е твърде дълга: до 150 знака.",
  preheaderLong: "Въведението е твърде дълго: до 150 знака.",
  body: "Напишете текста на бюлетина.",
  bodyLong: `Текстът е твърде дълъг: до ${MAX_BODY_LENGTH.toLocaleString("bg-BG")} знака.`,
  attachments: "Файловете не могат да бъдат прочетени. Презаредете страницата.",
  tooManyAttachments: `До ${MAX_ATTACHMENTS} файла в един бюлетин.`,
  noCampaign: "Липсва бюлетин.",
  noVersion: "Страницата е стара. Презаредете я и опитайте отново.",
} as const;

const attachmentSchema = z.object({
  url: z.string().refine(isNewsletterUpload),
  name: z.string().trim().min(1).max(200),
  contentType: z.string().refine((type) => UPLOAD_TYPES.includes(type)),
  size: z.number().int().min(0).max(MAX_UPLOAD_BYTES),
  kind: z.enum(["image", "file"]),
  alt: z.string().trim().max(300).optional(),
});

/** The hidden field's JSON, read into attachments, or refused as a whole. */
const attachmentsField = z
  .string()
  .default("[]")
  .transform((raw, context) => {
    try {
      return JSON.parse(raw || "[]") as unknown;
    } catch {
      context.addIssue({ code: z.ZodIssueCode.custom, message: NEWSLETTER_MESSAGES.attachments });
      return z.NEVER;
    }
  })
  .pipe(
    z
      .array(attachmentSchema, { invalid_type_error: NEWSLETTER_MESSAGES.attachments })
      .max(MAX_ATTACHMENTS, NEWSLETTER_MESSAGES.tooManyAttachments),
  )
  /* The kind follows the type, whatever the field said, and only a picture
     keeps a description. */
  .transform((files): NewsletterAttachment[] =>
    files.map(({ alt, ...file }) => {
      const kind = attachmentKind(file.contentType);
      return { ...file, kind, ...(kind === "image" && alt !== undefined ? { alt } : {}) };
    }),
  );

/**
 * What the composer posts. Everything may be empty while it is a draft;
 * sending (or a test) needs a subject and a body, which `requireContent`
 * checks on the server and the form checks before it opens the confirmation.
 */
/** The letter itself, as the preview renders it. */
export const newsletterContentSchema = z.object({
  subject: z.string().trim().max(150, NEWSLETTER_MESSAGES.subjectLong),
  preheader: z.string().trim().max(150, NEWSLETTER_MESSAGES.preheaderLong),
  body: z.string().max(MAX_BODY_LENGTH, NEWSLETTER_MESSAGES.bodyLong),
  attachments: attachmentsField,
});

/** The letter, which draft it is, and which version of it this tab was showing. */
export const newsletterDraftSchema = newsletterContentSchema.extend({
  id: z.string().uuid(NEWSLETTER_MESSAGES.noCampaign),
  version: z
    .string()
    .regex(/^\d{1,9}$/, NEWSLETTER_MESSAGES.noVersion)
    .transform(Number),
});

export type NewsletterDraftInput = z.input<typeof newsletterDraftSchema>;
export type NewsletterDraft = z.output<typeof newsletterDraftSchema>;

/** Field messages for what a send cannot go without. */
export function requireContent(draft: {
  subject: string;
  body: string;
}): Record<string, string> | null {
  const errors: Record<string, string> = {};
  if (!draft.subject.trim()) errors.subject = NEWSLETTER_MESSAGES.subject;
  if (!draft.body.trim()) errors.body = NEWSLETTER_MESSAGES.body;
  return Object.keys(errors).length > 0 ? errors : null;
}

export const NEWSLETTER_INTENTS = ["save", "test", "send"] as const;
export type NewsletterIntent = (typeof NEWSLETTER_INTENTS)[number];

const isIntent = (value: unknown): value is NewsletterIntent =>
  typeof value === "string" && (NEWSLETTER_INTENTS as readonly string[]).includes(value);

/**
 * Which of the composer's three buttons was pressed.
 *
 * The buttons carry `name="intent"`, which the browser posts for the pressed
 * one — without script, and with script where `new FormData(form, submitter)`
 * is supported. Safari before 16.4 ignores the submitter there, and the post
 * would arrive with no intent at all: read as "save", a press of "send" would
 * quietly only save. So the composer also writes the pressed button into a
 * hidden `intentChosen` field before the form is sent, and that is the
 * fallback. The button wins when both are present: without script the hidden
 * field still holds its first value.
 */
export function resolveIntent(formData: FormData): NewsletterIntent {
  const pressed = formData.get("intent");
  if (isIntent(pressed)) return pressed;
  const chosen = formData.get("intentChosen");
  return isIntent(chosen) ? chosen : "save";
}
