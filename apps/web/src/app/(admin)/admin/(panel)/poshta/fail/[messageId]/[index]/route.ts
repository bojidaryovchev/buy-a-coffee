import { isSignedIn } from "@/lib/auth";
import { getMessage } from "@/lib/mail/store";

/**
 * Attachment download, proxied.
 *
 * Resend hands out signed, expiring URLs rather than permanent ones, so a link
 * stored at receipt is a link that is broken by the time anyone clicks it. This
 * asks for a fresh one per click and streams the answer through.
 *
 * It also means the file is never public: Resend's signed URL is not guessable
 * but it is bearer-shaped, and putting it in the page would put a working
 * download link for a customer's document into browser history and any
 * screenshot of the panel. Here the only URL that exists is behind the session.
 *
 * `index` rather than an attachment id, so the same route serves mail we sent
 * and mail we received. Resend returns the list in order for both.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ messageId: string; index: string }> },
) {
  /* A route handler gets no layout, so the admin gate has to be here. */
  if (!(await isSignedIn())) {
    return new Response("Няма достъп", { status: 401 });
  }

  const { messageId, index } = await context.params;
  const position = Number(index);
  if (!Number.isInteger(position) || position < 0) {
    return new Response("Невалиден файл", { status: 400 });
  }

  const message = await getMessage(messageId);
  if (!message) return new Response("Съобщението не е намерено", { status: 404 });

  const key = process.env.RESEND_API_KEY;
  if (!key) return new Response("Липсва RESEND_API_KEY", { status: 500 });

  const { Resend } = await import("resend");
  const resend = new Resend(key);

  /* Sent and received mail are different endpoints in Resend, and the row we
     just read is the only thing that knows which of the two this was. */
  const attachments =
    message.direction === "in" ? resend.emails.receiving.attachments : resend.emails.attachments;

  const { data, error } = await attachments.list({ emailId: messageId });
  if (error) return new Response(error.message, { status: 502 });

  const item = data?.data?.[position];
  if (!item) return new Response("Файлът не е намерен", { status: 404 });

  const upstream = await fetch(item.download_url);
  if (!upstream.ok || !upstream.body) {
    return new Response("Файлът не може да бъде изтеглен", { status: 502 });
  }

  const filename = item.filename ?? message.attachments?.[position]?.filename ?? "file";

  return new Response(upstream.body, {
    headers: {
      "content-type": item.content_type,
      /* RFC 5987 form, because these filenames are routinely Cyrillic and the
         plain `filename=` parameter is ASCII-only. */
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "cache-control": "private, no-store",
    },
  });
}
