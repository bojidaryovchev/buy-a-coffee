import { composeNewsletterEmail } from "@/emails/newsletter";
import { isSignedIn } from "@/lib/auth";
import { unsubscribeUrl } from "@/lib/newsletter/links";
import {
  blockReports,
  emptySnapshot,
  hasProductBlocks,
  type PreviewResponse,
} from "@/lib/newsletter/product-blocks";
import { newsletterContentSchema } from "@/lib/newsletter/schemas";

/**
 * The composer's live preview: the draft as it stands, rendered by the real
 * newsletter template — the same function the sender calls — and returned as
 * the HTML a subscriber would receive, with what its product blocks resolved
 * to, for the checks under the composer (`blocks`).
 *
 * A route rather than a server action because the composer asks for a new
 * preview a moment after every pause in typing and abandons the previous one;
 * a fetch can be aborted, and server actions run one at a time per page, so a
 * slow preview would hold up a save.
 *
 * Product blocks are read from the catalog as it stands. The catalog module is
 * imported only when the body has one, so a draft without — and this route's
 * own tests — never open a database connection.
 *
 * The composer draws the answer in a sandboxed iframe (`sandbox=""`: no
 * script, no same-origin, no navigation), so even the parts of the message
 * that are not ours to escape — none, today — could not reach the panel.
 */

const previewSchema = newsletterContentSchema;

export async function POST(request: Request) {
  if (!(await isSignedIn())) return new Response("Няма достъп", { status: 401 });

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return new Response("Невалидна заявка", { status: 400 });
  }
  const parsed = previewSchema.safeParse(input);
  if (!parsed.success) {
    return new Response(parsed.error.issues[0]?.message ?? "Невалидна чернова", { status: 422 });
  }

  const subject = parsed.data.subject || "(без тема)";
  let products = emptySnapshot(subject);
  if (hasProductBlocks(parsed.data.body)) {
    try {
      const { resolveLetterProducts } = await import("@/lib/newsletter/product-source");
      products = await resolveLetterProducts({ subject, body: parsed.data.body });
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          msg: "newsletter.preview_products_failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return new Response("Продуктите не можаха да бъдат прочетени", { status: 503 });
    }
  }

  const { html } = await composeNewsletterEmail(
    { ...parsed.data, subject, products },
    /* A token no row has: the footer link is drawn as a subscriber's would
       be, and opens a page that unsubscribes nobody. */
    { unsubscribeUrl: unsubscribeUrl("pregled") },
  );
  const body: PreviewResponse = { html, blocks: blockReports(products) };
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
