import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { isSignedIn } from "@/lib/auth";
import { MAX_UPLOAD_BYTES, UPLOAD_PREFIX, UPLOAD_TYPES } from "@/lib/newsletter/schemas";

/**
 * Signs uploads for the newsletter composer.
 *
 * The browser sends the file straight to Vercel Blob, so a 15 MB PDF never
 * passes through a function — whose request body stops at about 4.5 MB, the
 * limit the reply form's attachments live under. What passes through here is
 * the request for a token, and the token is what carries the rules: only the
 * types and the size `lib/newsletter/schemas.ts` allows, only under
 * `newsletter/`, a random suffix on every name so nothing is overwritten and
 * no address can be guessed, and valid for ten minutes.
 *
 * Signed only for a signed-in session. A route handler gets no layout, so the
 * panel's gate is repeated here; without it this would hand anybody a token
 * to put files on the shop's storage.
 *
 * Nothing is recorded when an upload completes. The browser has the file's
 * address the moment it finishes and puts it in the draft; a completion
 * callback would also need a public URL to reach, which a development
 * machine does not have.
 */

export async function POST(request: Request) {
  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return Response.json({ error: "Невалидна заявка." }, { status: 400 });
  }
  if (body?.type !== "blob.generate-client-token") {
    return Response.json({ error: "Невалидна заявка." }, { status: 400 });
  }
  if (!(await isSignedIn())) {
    return Response.json({ error: "Сесията е изтекла. Влезте отново." }, { status: 401 });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return Response.json(
      { error: "Липсва BLOB_READ_WRITE_TOKEN — качването на файлове не е настроено." },
      { status: 503 },
    );
  }

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith(UPLOAD_PREFIX) || pathname.includes("..")) {
          throw new Error("Файлът трябва да е в newsletter/.");
        }
        return {
          allowedContentTypes: [...UPLOAD_TYPES],
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          addRandomSuffix: true,
          validUntil: Date.now() + 10 * 60 * 1000,
        };
      },
    });
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "newsletter.upload_token_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return Response.json({ error: "Качването не можа да започне." }, { status: 400 });
  }
}
