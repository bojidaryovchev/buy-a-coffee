import { composeNewsletterEmail } from "@/emails/newsletter";
import { isSignedIn } from "@/lib/auth";
import { unsubscribeUrl } from "@/lib/newsletter/links";
import { newsletterContentSchema } from "@/lib/newsletter/schemas";

/**
 * The composer's live preview: the draft as it stands, rendered by the real
 * newsletter template — the same function the sender calls — and returned as
 * the HTML a subscriber would receive.
 *
 * A route rather than a server action because the composer asks for a new
 * preview a moment after every pause in typing and abandons the previous one;
 * a fetch can be aborted, and server actions run one at a time per page, so a
 * slow preview would hold up a save.
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

  const { html } = await composeNewsletterEmail(
    { ...parsed.data, subject: parsed.data.subject || "(без тема)" },
    /* A token no row has: the footer link is drawn as a subscriber's would
       be, and opens a page that unsubscribes nobody. */
    { unsubscribeUrl: unsubscribeUrl("pregled") },
  );
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
