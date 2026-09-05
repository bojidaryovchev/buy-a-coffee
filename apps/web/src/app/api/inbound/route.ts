import { handleInboundEmail } from "@/lib/mail/inbound";

/**
 * Resend's `email.received` webhook.
 *
 * Register this URL in the Resend dashboard under Webhooks, subscribed to
 * `email.received` only, and put the signing secret it hands back into
 * `RESEND_WEBHOOK_SECRET`. Everything else lives in `lib/mail/inbound.ts`.
 *
 * The status codes are load-bearing: Resend retries on 5xx and gives up on 2xx,
 * so "we understood this and chose not to forward it" has to be a 200 or it
 * comes back every few minutes forever.
 */
export async function POST(request: Request) {
  /* Raw text, not request.json(). The signature covers the exact bytes, and a
     parse-and-restringify round trip changes them. */
  const payload = await request.text();

  const id = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signature = request.headers.get("svix-signature");

  if (!id || !timestamp || !signature) {
    return new Response("Missing signature headers", { status: 400 });
  }

  const result = await handleInboundEmail(payload, { id, timestamp, signature });

  switch (result.status) {
    case "forwarded":
      return Response.json({ forwarded: result.id });
    case "recorded":
      /* In the panel but not in the shop's inbox. Worth a log line, not a
         retry: retrying would not fix a missing MAIL_TO and the message is
         already safe. */
      console.warn(
        JSON.stringify({ level: "warn", msg: "inbound.recorded_only", reason: result.reason }),
      );
      return Response.json({ recorded: result.reason });
    case "ignored":
      return Response.json({ ignored: result.reason });
    case "unauthorized":
      return new Response("Invalid signature", { status: 401 });
    case "failed":
      console.error(JSON.stringify({ level: "error", msg: "inbound.failed", error: result.error }));
      return new Response(result.error, { status: 500 });
  }
}
