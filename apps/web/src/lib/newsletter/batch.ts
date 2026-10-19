import { createHash } from "node:crypto";
import type { NewsletterAttachment } from "@catalog/db/schema";
import { composeNewsletterEmail } from "@/emails/newsletter";
import { isPlausibleToken } from "@/lib/forms/unsubscribe-token";
import { listUnsubscribeHeaders, unsubscribeUrl } from "./links";
import { lettersWord } from "./status";

/**
 * The newsletter sender's pure parts: what one copy looks like, how copies
 * are grouped into requests, what each request is keyed by, and how a request
 * is retried. No database and no `server-only`, so every rule here is a plain
 * unit test (`test/newsletter-send.test.ts`); `send.ts` puts them to work.
 *
 * WHY RESEND'S BATCH ENDPOINT AND NOT A BROADCAST. A broadcast is one HTML for
 * everybody with Resend's merge tags in it. We want each reader's own
 * unsubscribe link and RFC 8058 one-click header — our endpoint, our list,
 * our record of who left — and a row per reader saying whether their copy
 * went, which is what makes a resumed send safe. The batch endpoint takes up
 * to 100 fully formed messages per request, each with its own headers.
 */

/** Resend's ceiling per batch request. */
export const BATCH_SIZE = 100;

/** Attempts per request before giving up on it for this run. */
export const MAX_ATTEMPTS = 5;

/* -- one copy --------------------------------------------------------------- */

/**
 * Stands in for the reader's token while the message is rendered once per
 * campaign. Letters only, so URL encoding leaves it as it is and it can be
 * replaced in the HTML and the text alike. Rendering 100 copies of a React
 * tree per request to change 64 characters would be the slowest part of the
 * send for no difference in what arrives.
 */
const TOKEN_PLACEHOLDER = "BACUNSUBSCRIBETOKENPLACEHOLDERxQz";

export interface CampaignContent {
  readonly subject: string;
  readonly preheader: string;
  readonly body: string;
  readonly attachments: readonly NewsletterAttachment[];
}

export interface CampaignTemplate {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

/** The campaign rendered once, with a placeholder where each reader's token goes. */
export async function composeCampaign(content: CampaignContent): Promise<CampaignTemplate> {
  const composed = await composeNewsletterEmail(content, {
    unsubscribeUrl: unsubscribeUrl(TOKEN_PLACEHOLDER),
  });
  if (!composed.html.includes(TOKEN_PLACEHOLDER) || !composed.text.includes(TOKEN_PLACEHOLDER)) {
    // A template that lost its unsubscribe link must not reach anybody.
    throw new Error("newsletter template carries no unsubscribe link");
  }
  return { subject: content.subject, html: composed.html, text: composed.text };
}

export interface BatchEmail {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  tags: { name: string; value: string }[];
}

/**
 * One reader's copy: their unsubscribe link in the footer and the text, the
 * one-click headers pointing at the same token, and the campaign as a tag so
 * Resend's logs can be filtered to it.
 *
 * NO TOPIC. Resend can scope a message to a topic, and then drops it for any
 * address not opted in to that topic in Resend — including every subscriber
 * whose copy into Resend failed or predates the topic — silently, while we
 * record the copy as sent. Who may be mailed is decided by our table alone:
 * the unsubscribe endpoint, the webhook's opt-outs and the skip at claim time
 * all write there. The topic is still kept in step for Resend's own pages
 * (`sync.ts`); the send does not depend on it.
 */
export function personalise(
  template: CampaignTemplate,
  recipient: { email: string; token: string },
  envelope: { from: string; campaignId: string },
): BatchEmail {
  if (!isPlausibleToken(recipient.token)) {
    throw new Error("subscriber has no usable unsubscribe token");
  }
  const fill = (value: string) => value.split(TOKEN_PLACEHOLDER).join(recipient.token);
  return {
    from: envelope.from,
    to: recipient.email,
    subject: template.subject,
    html: fill(template.html),
    text: fill(template.text),
    headers: listUnsubscribeHeaders(recipient.token),
    tags: [
      { name: "category", value: "newsletter" },
      { name: "campaign", value: envelope.campaignId },
    ],
  };
}

/* -- grouping and keys ------------------------------------------------------ */

export function chunk<T>(items: readonly T[], size: number = BATCH_SIZE): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error("chunk size must be a positive integer");
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    out.push(items.slice(index, index + size));
  return out;
}

/**
 * The Idempotency-Key of one request: the campaign and exactly which
 * deliveries it carries, independent of their order.
 *
 * This is what makes a resume safe. A request whose answer was lost (the
 * function was killed, the network dropped) leaves its deliveries marked
 * `sending` with this key; the resume sends the same deliveries with the same
 * key, and Resend — which keeps a key for 24 hours — answers from memory
 * instead of sending them again. The same messages under a different key, or
 * a different set under the same key, would not be recognised; hence a key
 * derived from the set, and stored beside each delivery.
 */
export function batchKey(campaignId: string, deliveryIds: readonly string[]): string {
  const digest = createHash("sha256")
    .update([...deliveryIds].sort().join(","))
    .digest("hex");
  return `newsletter/${campaignId}/${digest.slice(0, 32)}`;
}

/** The key of one copy sent on its own, after its batch was refused whole. */
export function singleKey(campaignId: string, deliveryId: string): string {
  return `newsletter/${campaignId}/one/${deliveryId}`;
}

/* -- errors and retries ----------------------------------------------------- */

export interface ApiError {
  readonly name: string;
  readonly message: string;
  readonly statusCode: number | null;
}

/**
 * What a refusal means for the send.
 *
 *   transient  try the same request again later: the network, a rate limit,
 *              Resend having a bad minute, or our own earlier copy of this
 *              request still in flight. The deliveries keep their key.
 *   account    nothing in this request was sent, and nothing else will be
 *              until a person fixes something: the key, the sender domain, the
 *              quota. Stop, and put the deliveries back as they were.
 *   ambiguous  Resend has seen this key with a different payload, or accepted
 *              the request without one id per message. Something under this
 *              key may have gone out; it is never sent under another key.
 *   message    this request was refused for what is in it. One bad address
 *              refuses all hundred, so the copies are tried one by one.
 */
export type ErrorClass = "transient" | "account" | "ambiguous" | "message";

const ACCOUNT_ERRORS = new Set([
  "missing_api_key",
  "invalid_api_key",
  "restricted_api_key",
  "invalid_access",
  "invalid_from_address",
  "invalid_region",
  "daily_quota_exceeded",
  "monthly_quota_exceeded",
  "security_error",
  "method_not_allowed",
]);

export function classifyError(error: ApiError): ErrorClass {
  if (error.name === "invalid_idempotent_request") return "ambiguous";
  if (error.name === "concurrent_idempotent_requests") return "transient";
  if (ACCOUNT_ERRORS.has(error.name)) return "account";
  if (error.statusCode === null) return "transient";
  if (error.statusCode === 429 || error.statusCode >= 500) return "transient";
  if (error.statusCode === 401 || error.statusCode === 403) return "account";
  return "message";
}

/**
 * How long to wait before attempt `attempt + 1`: what `Retry-After` asks for
 * when Resend sends it, else 1, 2, 4, 8 s. Capped, so one request cannot use
 * up the function's whole lifetime waiting.
 */
export function retryDelayMs(attempt: number, retryAfter?: string | null): number {
  const asked = retryAfter ? Number(retryAfter) : Number.NaN;
  const delay = Number.isFinite(asked) && asked >= 0 ? asked * 1000 : 1000 * 2 ** attempt;
  return Math.min(delay, 20_000);
}

/**
 * Could an attempt that ended this way have been processed by Resend?
 *
 * Yes when we never heard back (the network, our own timeout: statusCode
 * null), when Resend failed in the middle of it (5xx), and when Resend says
 * an earlier request with the same key is still running. No for any other
 * answer: a 4xx is Resend refusing the request before acting on it — and had
 * an earlier attempt under the same key succeeded, Resend would have answered
 * with that success instead.
 */
export function mayHaveBeenProcessed(error: ApiError): boolean {
  return (
    error.statusCode === null ||
    error.statusCode >= 500 ||
    error.name === "concurrent_idempotent_requests"
  );
}

export interface BatchResponse {
  data: { id: string }[] | null;
  error: ApiError | null;
  headers?: Record<string, string> | null;
}

/** What `send.ts` needs from Resend: the batch call, and nothing else. */
export interface BatchClient {
  send(
    emails: BatchEmail[],
    options: { idempotencyKey: string; signal?: AbortSignal },
  ): Promise<BatchResponse>;
}

export type SendOutcome =
  | { ok: true; ids: string[] }
  | {
      ok: false;
      kind: ErrorClass;
      message: string;
      /**
       * Some attempt at this request may have been processed by Resend. Then
       * none of its copies may be released or split — only sent again later
       * under this same key, which Resend answers from memory if it did go.
       */
      maybeSent: boolean;
    };

export interface RetryOptions {
  sleep: (ms: number) => Promise<void>;
  now?: () => number;
  /** No wait ends after this moment (epoch ms): the run stops instead. */
  deadline?: number;
  /** Each attempt is aborted after this long. */
  timeoutMs?: number;
}

/** Long enough for a hundred messages; short enough to leave the run its margin. */
export const REQUEST_TIMEOUT_MS = 20_000;

/**
 * One request, retried while the failure is transient and there is time.
 * Every attempt carries the same key, so a retry of a request that did
 * arrive costs nothing — and every attempt has a timeout, so a request that
 * hangs cannot hold the run past its function's lifetime.
 */
export async function sendWithRetry(
  client: BatchClient,
  emails: BatchEmail[],
  idempotencyKey: string,
  options: RetryOptions,
): Promise<SendOutcome> {
  const now = options.now ?? Date.now;
  const deadline = options.deadline ?? Number.POSITIVE_INFINITY;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  let maybeSent = false;
  let last: ApiError = { name: "application_error", message: "no attempt made", statusCode: null };

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    let response: BatchResponse;
    try {
      response = await client.send(emails, {
        idempotencyKey,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      response = {
        data: null,
        error: {
          name: "application_error",
          message: error instanceof Error ? error.message : String(error),
          statusCode: null,
        },
      };
    }

    if (!response.error) {
      const ids = response.data?.map((entry) => entry.id) ?? [];
      if (ids.length === emails.length) return { ok: true, ids };
      // Accepted, but not one id per message: we cannot say who got what.
      return {
        ok: false,
        kind: "ambiguous",
        message: `Resend върна ${ids.length} номера за ${emails.length} ${lettersWord(emails.length)}`,
        maybeSent: true,
      };
    }

    last = response.error;
    maybeSent ||= mayHaveBeenProcessed(last);
    const kind = classifyError(last);
    if (kind !== "transient") {
      return {
        ok: false,
        kind,
        message: describe(last),
        maybeSent: maybeSent || kind === "ambiguous",
      };
    }
    if (attempt === MAX_ATTEMPTS - 1) break;
    const wait = retryDelayMs(attempt, response.headers?.["retry-after"]);
    /* A wait that would end past the deadline is not taken: the run stops,
       and a later one asks again under the same key. */
    if (now() + wait >= deadline) break;
    await options.sleep(wait);
  }
  return { ok: false, kind: "transient", message: describe(last), maybeSent };
}

function describe(error: ApiError): string {
  return `${error.name}${error.statusCode ? ` (${error.statusCode})` : ""}: ${error.message}`;
}
